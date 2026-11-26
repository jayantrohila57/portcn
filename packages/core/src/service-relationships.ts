import {
  type AnyDiscoveryObservation,
  correlateContainerMappings,
  type DiscoveryConfidence,
  type DiscoveryCorrelation,
  type DiscoveryEvidence,
  type DiscoveryObservation,
  type DiscoveryRelationshipNature,
  type DiscoveryScope,
  discoveryIdentityKey,
  type EvidenceFreshness,
  evidenceFreshness,
} from './discovery.js';
import type { PortNumber } from './port-number.js';

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

const scopeFields: readonly (keyof DiscoveryScope)[] = [
  'hostId',
  'pidNamespace',
  'networkNamespace',
  'mountNamespace',
  'daemonContext',
];

export function scopesCompatible(left: DiscoveryScope, right: DiscoveryScope): boolean {
  return scopeFields.every((field) => left[field] === null || right[field] === null || left[field] === right[field]);
}

function bareAddress(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

/** Match published Docker/Podman bind addresses to native listener addresses without wildcard guessing. */
export function discoveryBindAddressesEquivalent(bindingAddress: string, listenerAddress: string): boolean {
  const bind = bareAddress(bindingAddress);
  const local = bareAddress(listenerAddress);
  if (bind === '' || bind === '*' || bind === local) return true;
  if (local === '*' || local === '0.0.0.0' || local === '::') return true;
  if (bind === '0.0.0.0' || bind === '::') return true;
  return false;
}

function stableObservations(observations: AnyDiscoveryObservation[]): DiscoveryObservation[] {
  return observations.filter(
    (item): item is DiscoveryObservation => item.identity !== null && item.identityStatus === 'stable',
  );
}

function relationshipNatureFromEvidence(evidence: DiscoveryEvidence[]): DiscoveryRelationshipNature {
  if (!evidence.length) return 'unavailable';
  const provenances = new Set(evidence.map(({ provenance }) => provenance));
  if (provenances.size > 1) {
    if (provenances.has('configured') && (provenances.has('direct') || provenances.has('derived'))) return 'incomplete';
    return 'incomplete';
  }
  const provenance = evidence[0]?.provenance;
  if (provenance === 'configured') return 'configured';
  if (provenance === 'inferred') return 'inferred';
  if (provenance === 'direct' || provenance === 'derived') return 'observed';
  return 'unavailable';
}

function relationshipFreshnessFromEvidence(evidence: DiscoveryEvidence[], requestedAt: string): EvidenceFreshness {
  if (!evidence.length) return 'unknown';
  const outcomes = evidence.map((item) => evidenceFreshness(item, requestedAt));
  if (outcomes.includes('unknown')) return 'unknown';
  if (outcomes.includes('stale')) return 'stale';
  return 'fresh';
}

function evidenceForIds(ids: string[], evidenceById: Map<string, DiscoveryEvidence>): DiscoveryEvidence[] {
  return ids.flatMap((id) => {
    const item = evidenceById.get(id);
    return item ? [item] : [];
  });
}

export function withRelationshipMetadata(
  correlation: Omit<DiscoveryCorrelation, 'nature' | 'freshness'>,
  evidenceById: Map<string, DiscoveryEvidence>,
  requestedAt: string,
): DiscoveryCorrelation {
  const evidence = evidenceForIds(correlation.evidenceIds, evidenceById);
  return {
    ...correlation,
    nature: relationshipNatureFromEvidence(evidence),
    freshness: relationshipFreshnessFromEvidence(evidence, requestedAt),
  };
}

function pushCorrelation(
  correlations: DiscoveryCorrelation[],
  seen: Set<string>,
  correlation: Omit<DiscoveryCorrelation, 'nature' | 'freshness'>,
  evidenceById: Map<string, DiscoveryEvidence>,
  requestedAt: string,
): void {
  const key = `${correlation.fromIdentityKey}|${correlation.type}|${correlation.toIdentityKey}`;
  if (seen.has(key)) return;
  seen.add(key);
  correlations.push(withRelationshipMetadata(correlation, evidenceById, requestedAt));
}

function ownerPidFromEvidence(evidence: DiscoveryEvidence[]): number | null {
  for (const item of evidence) {
    const match = /^owner:pid:(\d+)$/.exec(item.sourceRef);
    if (match) {
      const pid = Number(match[1]);
      if (Number.isSafeInteger(pid) && pid > 0) return pid;
    }
  }
  return null;
}

/** Relate host listeners to published container bindings when protocol, port, and bind rules agree. */
export function correlateHostEndpointBindings(
  observations: AnyDiscoveryObservation[],
  evidenceById: Map<string, DiscoveryEvidence>,
  requestedAt: string,
): DiscoveryCorrelation[] {
  const stable = stableObservations(observations);
  const correlations: DiscoveryCorrelation[] = [];
  const seen = new Set<string>();
  for (const listenerObservation of stable) {
    const listener = listenerObservation.identity;
    if (listener.kind !== 'native-listener') continue;
    for (const bindingObservation of stable) {
      const binding = bindingObservation.identity;
      if (
        binding.kind !== 'published-binding' ||
        binding.protocol !== listener.protocol ||
        binding.hostPort !== listener.port ||
        !discoveryBindAddressesEquivalent(binding.hostAddress, listener.bindAddress)
      )
        continue;
      const evidence = [...listenerObservation.evidence, ...bindingObservation.evidence];
      if (!evidence.length) continue;
      if (evidence.some((left) => evidence.some((right) => !scopesCompatible(left.scope, right.scope)))) continue;
      const observedAt = [listenerObservation.observedAt, bindingObservation.observedAt].sort(compareText).at(-1);
      const correlationScope = evidence.at(0)?.scope;
      if (!observedAt || !correlationScope) continue;
      pushCorrelation(
        correlations,
        seen,
        {
          fromIdentityKey: discoveryIdentityKey(listener),
          toIdentityKey: discoveryIdentityKey(binding),
          type: 'same-endpoint',
          confidence: bindingObservation.evidence.some(({ provenance }) => provenance === 'direct') ? 'high' : 'medium',
          evidenceIds: [...new Set(evidence.map(({ id }) => id))].sort(compareText),
          observedAt,
          scope: correlationScope,
        },
        evidenceById,
        requestedAt,
      );
    }
  }
  return correlations;
}

/** Relate listeners to visible owner processes when stable process lifetimes are available. */
export function correlateListenerProcessOwnership(
  observations: AnyDiscoveryObservation[],
  evidenceById: Map<string, DiscoveryEvidence>,
  requestedAt: string,
): DiscoveryCorrelation[] {
  const stable = stableObservations(observations);
  const processes = stable.filter((item) => item.identity.kind === 'process');
  const correlations: DiscoveryCorrelation[] = [];
  const seen = new Set<string>();
  for (const listenerObservation of stable) {
    const listener = listenerObservation.identity;
    if (listener.kind !== 'native-listener') continue;
    const ownerPid = ownerPidFromEvidence(listenerObservation.evidence);
    if (ownerPid === null) continue;
    for (const processObservation of processes) {
      const process = processObservation.identity;
      if (process.kind !== 'process' || process.pid !== ownerPid) continue;
      const evidence = [...listenerObservation.evidence, ...processObservation.evidence];
      if (evidence.some((left) => evidence.some((right) => !scopesCompatible(left.scope, right.scope)))) continue;
      const observedAt = [listenerObservation.observedAt, processObservation.observedAt].sort(compareText).at(-1);
      const correlationScope = evidence.at(0)?.scope;
      if (!observedAt || !correlationScope) continue;
      pushCorrelation(
        correlations,
        seen,
        {
          fromIdentityKey: discoveryIdentityKey(process),
          toIdentityKey: discoveryIdentityKey(listener),
          type: 'owned-by',
          confidence: 'high',
          evidenceIds: [...new Set(evidence.map(({ id }) => id))].sort(compareText),
          observedAt,
          scope: correlationScope,
        },
        evidenceById,
        requestedAt,
      );
    }
  }
  return correlations;
}

/** Relate rootlessport forwarding helpers to published bindings when direct evidence claims a mapping. */
export function correlateForwardingAttribution(
  observations: AnyDiscoveryObservation[],
  evidenceById: Map<string, DiscoveryEvidence>,
  requestedAt: string,
): DiscoveryCorrelation[] {
  const stable = stableObservations(observations);
  const correlations: DiscoveryCorrelation[] = [];
  const seen = new Set<string>();
  for (const bindingObservation of stable) {
    const binding = bindingObservation.identity;
    if (binding.kind !== 'published-binding') continue;
    for (const processObservation of stable) {
      const process = processObservation.identity;
      if (process.kind !== 'process') continue;
      const forwardEvidence = processObservation.evidence.filter(
        ({ claim }) => claim === 'rootlessport-forwarder' || claim === 'forwarded-by',
      );
      if (!forwardEvidence.length) continue;
      const bindingEvidence = bindingObservation.evidence.filter(({ claim }) => claim.includes('binding'));
      const evidence = [...forwardEvidence, ...bindingEvidence, ...bindingObservation.evidence];
      if (!bindingEvidence.length) continue;
      const observedAt = [bindingObservation.observedAt, processObservation.observedAt].sort(compareText).at(-1);
      const correlationScope = evidence.at(0)?.scope;
      if (!observedAt || !correlationScope) continue;
      pushCorrelation(
        correlations,
        seen,
        {
          fromIdentityKey: discoveryIdentityKey(process),
          toIdentityKey: discoveryIdentityKey(binding),
          type: 'forwarded-by',
          confidence:
            forwardEvidence.some(({ confidence }) => confidence === 'high') &&
            bindingEvidence.some(({ confidence }) => confidence === 'high')
              ? 'high'
              : 'medium',
          evidenceIds: [...new Set(evidence.map(({ id }) => id))].sort(compareText),
          observedAt,
          scope: correlationScope,
        },
        evidenceById,
        requestedAt,
      );
    }
  }
  return correlations;
}

function configuredEndpointFromEvidence(evidence: DiscoveryEvidence[]): {
  protocol: 'tcp' | 'udp' | null;
  port: PortNumber | null;
  address: string | null;
  observed: boolean | null;
} {
  let protocol: 'tcp' | 'udp' | null = null;
  let port: PortNumber | null = null;
  let address: string | null = null;
  let observed: boolean | null = null;
  for (const item of evidence) {
    const endpoint = /^configured:([^:]+):([^:]+):(\d+)$/.exec(item.sourceRef);
    if (endpoint) {
      protocol = endpoint[1] === 'udp' ? 'udp' : 'tcp';
      address = endpoint[2] === '*' ? null : endpoint[2];
      port = Number(endpoint[3]) as PortNumber;
      if (item.claim === 'configured-listener-observed') observed = true;
      else if (item.claim === 'configured-listener') observed = false;
      continue;
    }
    const mainPid = /^mainpid:(\d+)$/.exec(item.sourceRef);
    if (mainPid) continue;
  }
  return { protocol, port, address, observed };
}

/** Relate configured manager records to listeners, processes, or bindings without inventing activity. */
export function correlateConfiguredServiceEndpoints(
  observations: AnyDiscoveryObservation[],
  evidenceById: Map<string, DiscoveryEvidence>,
  requestedAt: string,
): DiscoveryCorrelation[] {
  const stable = stableObservations(observations);
  const correlations: DiscoveryCorrelation[] = [];
  const seen = new Set<string>();
  const services = stable.filter((item) => item.identity.kind === 'system-service');
  for (const serviceObservation of services) {
    const service = serviceObservation.identity;
    if (service.kind !== 'system-service') continue;
    const configured = configuredEndpointFromEvidence(serviceObservation.evidence);
    if (configured.port === null || configured.protocol === null) {
      const mainPidEvidence = serviceObservation.evidence.find(({ sourceRef }) => mainPidRef(sourceRef));
      const mainPid = mainPidEvidence ? Number(/^mainpid:(\d+)$/.exec(mainPidEvidence.sourceRef)?.[1]) : null;
      if (mainPid) {
        for (const processObservation of stable) {
          const process = processObservation.identity;
          if (process.kind !== 'process' || process.pid !== mainPid) continue;
          const evidence = [...serviceObservation.evidence, ...processObservation.evidence];
          const observedAt = [serviceObservation.observedAt, processObservation.observedAt].sort(compareText).at(-1);
          const correlationScope = evidence.at(0)?.scope;
          if (!observedAt || !correlationScope) continue;
          pushCorrelation(
            correlations,
            seen,
            {
              fromIdentityKey: discoveryIdentityKey(service),
              toIdentityKey: discoveryIdentityKey(process),
              type: 'owned-by',
              confidence: 'medium',
              evidenceIds: [...new Set(evidence.map(({ id }) => id))].sort(compareText),
              observedAt,
              scope: correlationScope,
            },
            evidenceById,
            requestedAt,
          );
        }
      }
      continue;
    }
    for (const listenerObservation of stable) {
      const listener = listenerObservation.identity;
      if (
        listener.kind !== 'native-listener' ||
        listener.protocol !== configured.protocol ||
        listener.port !== configured.port
      )
        continue;
      if (configured.address && !discoveryBindAddressesEquivalent(configured.address, listener.bindAddress)) continue;
      const evidence = [...serviceObservation.evidence, ...listenerObservation.evidence];
      const observedAt = [serviceObservation.observedAt, listenerObservation.observedAt].sort(compareText).at(-1);
      const correlationScope = evidence.at(0)?.scope;
      if (!observedAt || !correlationScope) continue;
      const confidence: DiscoveryConfidence =
        configured.observed === true ? 'high' : configured.observed === false ? 'low' : 'medium';
      pushCorrelation(
        correlations,
        seen,
        {
          fromIdentityKey: discoveryIdentityKey(service),
          toIdentityKey: discoveryIdentityKey(listener),
          type: 'configured-as',
          confidence,
          evidenceIds: [...new Set(evidence.map(({ id }) => id))].sort(compareText),
          observedAt,
          scope: correlationScope,
        },
        evidenceById,
        requestedAt,
      );
    }
  }
  return correlations;
}

function mainPidRef(sourceRef: string): boolean {
  return /^mainpid:\d+$/.test(sourceRef);
}

function evidenceIndex(observations: AnyDiscoveryObservation[]): Map<string, DiscoveryEvidence> {
  const evidenceById = new Map<string, DiscoveryEvidence>();
  for (const observation of observations) {
    for (const item of observation.evidence) evidenceById.set(item.id, item);
  }
  return evidenceById;
}

/** Build evidence-backed relationships across stable discovery observations. */
export function buildDiscoveryCorrelations(
  observations: AnyDiscoveryObservation[],
  requestedAt: string,
): DiscoveryCorrelation[] {
  const evidenceById = evidenceIndex(observations);
  const base = correlateContainerMappings(observations, requestedAt);
  const extra = [
    ...correlateHostEndpointBindings(observations, evidenceById, requestedAt),
    ...correlateListenerProcessOwnership(observations, evidenceById, requestedAt),
    ...correlateForwardingAttribution(observations, evidenceById, requestedAt),
    ...correlateConfiguredServiceEndpoints(observations, evidenceById, requestedAt),
  ];
  const merged = [...base, ...extra];
  return merged.sort(
    (left, right) =>
      compareText(left.fromIdentityKey, right.fromIdentityKey) ||
      compareText(left.toIdentityKey, right.toIdentityKey) ||
      compareText(left.type, right.type),
  );
}

import type { DISCOVERY_SCHEMA_VERSION, DiscoverySnapshot } from './discovery.js';

export interface DiscoveryRelationshipSummary {
  schemaVersion: typeof DISCOVERY_SCHEMA_VERSION;
  requestedAt: string;
  status: 'complete' | 'partial';
  providerCount: number;
  observationCount: number;
  correlationCount: number;
  correlations: DiscoveryCorrelation[];
  limitations: string[];
}

export function summarizeDiscoveryRelationships(
  snapshot: DiscoverySnapshot,
  options: { maxCorrelations?: number } = {},
): DiscoveryRelationshipSummary {
  const maxCorrelations = options.maxCorrelations ?? 200;
  const observationCount = snapshot.providers.reduce((total, provider) => total + provider.observations.length, 0);
  const limitations =
    maxCorrelations < snapshot.correlations.length
      ? [`Correlation output truncated to ${maxCorrelations} edges out of ${snapshot.correlations.length}.`]
      : [];
  return {
    schemaVersion: snapshot.schemaVersion,
    requestedAt: snapshot.requestedAt,
    status: snapshot.status,
    providerCount: snapshot.providers.length,
    observationCount,
    correlationCount: snapshot.correlations.length,
    correlations: snapshot.correlations.slice(0, maxCorrelations),
    limitations,
  };
}
