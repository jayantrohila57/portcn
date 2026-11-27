import { isValidPortNumber, type PortNumber } from './port-number.js';

export const DISCOVERY_SCHEMA_VERSION = 1 as const;

export type DiscoveryRuntime = 'docker' | 'podman';
export type DiscoveryProviderName = 'native-sockets' | 'docker' | 'podman' | 'nginx' | 'systemd' | 'resource';
export type DiscoveryConfidence = 'high' | 'medium' | 'low' | 'unknown';
export type EvidenceProvenance = 'direct' | 'derived' | 'inferred' | 'configured';

/** A best-effort view boundary. Null means the provider could not establish that boundary. */
export interface DiscoveryScope {
  hostId: string | null;
  pidNamespace: string | null;
  networkNamespace: string | null;
  mountNamespace: string | null;
  daemonContext: string | null;
}

/** Identity keys name source entities. Correlation between entities is represented separately. */
export type DiscoveryIdentity =
  | {
      kind: 'native-listener';
      hostId: string;
      networkNamespace: string;
      protocol: 'tcp' | 'udp';
      bindAddress: string;
      port: PortNumber;
    }
  | {
      kind: 'process';
      hostId: string;
      pidNamespace: string;
      pid: number;
      startTime: string;
    }
  | {
      kind: 'container';
      runtime: DiscoveryRuntime;
      daemonContext: string;
      daemonHostId: string;
      containerId: string;
    }
  | {
      kind: 'container-port';
      runtime: DiscoveryRuntime;
      daemonContext: string;
      daemonHostId: string;
      containerId: string;
      protocol: 'tcp' | 'udp' | 'sctp';
      containerPort: PortNumber;
    }
  | {
      kind: 'published-binding';
      runtime: DiscoveryRuntime;
      daemonContext: string;
      daemonHostId: string;
      containerId: string;
      hostNetworkNamespace: string;
      protocol: 'tcp' | 'udp';
      containerPort: PortNumber;
      hostAddress: string;
      hostPort: PortNumber;
    }
  | {
      kind: 'system-service';
      provider: 'nginx' | 'systemd';
      hostId: string;
      mountNamespace: string;
      localId: string;
    }
  | {
      kind: 'configured-service';
      storeId: string;
      localId: string;
    }
  | {
      kind: 'resource';
      hostId: string;
      namespaceId: string;
      subjectIdentityKey: string;
      metric: string;
    };

function requireIdentityFields(kind: string, fields: string[]): void {
  if (fields.some((field) => typeof field !== 'string' || field.trim().length === 0))
    throw new Error(`${kind} identity requires non-empty scope and resource fields.`);
}

/** The version prefix makes future identity encoding changes explicit. Values remain case- and address-exact. */
export function discoveryIdentityKey(identity: DiscoveryIdentity): string {
  let parts: readonly (string | number)[];
  switch (identity.kind) {
    case 'native-listener':
      requireIdentityFields(identity.kind, [identity.hostId, identity.networkNamespace, identity.bindAddress]);
      if (!isValidPortNumber(identity.port)) throw new Error('Native listener identity requires a valid port.');
      parts = [
        identity.kind,
        identity.hostId,
        identity.networkNamespace,
        identity.protocol,
        identity.bindAddress,
        identity.port,
      ];
      break;
    case 'process':
      requireIdentityFields(identity.kind, [identity.hostId, identity.pidNamespace, identity.startTime]);
      if (!Number.isSafeInteger(identity.pid) || identity.pid < 1)
        throw new Error('Process identity requires a positive safe PID.');
      parts = [identity.kind, identity.hostId, identity.pidNamespace, identity.pid, identity.startTime];
      break;
    case 'container':
      requireIdentityFields(identity.kind, [identity.daemonContext, identity.daemonHostId, identity.containerId]);
      parts = [identity.kind, identity.runtime, identity.daemonContext, identity.daemonHostId, identity.containerId];
      break;
    case 'container-port':
      requireIdentityFields(identity.kind, [identity.daemonContext, identity.daemonHostId, identity.containerId]);
      if (!isValidPortNumber(identity.containerPort)) throw new Error('Container-port identity requires a valid port.');
      parts = [
        identity.kind,
        identity.runtime,
        identity.daemonContext,
        identity.daemonHostId,
        identity.containerId,
        identity.protocol,
        identity.containerPort,
      ];
      break;
    case 'published-binding':
      requireIdentityFields(identity.kind, [
        identity.daemonContext,
        identity.daemonHostId,
        identity.containerId,
        identity.hostNetworkNamespace,
        identity.hostAddress,
      ]);
      if (!isValidPortNumber(identity.containerPort) || !isValidPortNumber(identity.hostPort))
        throw new Error('Published-binding identity requires valid host and container ports.');
      parts = [
        identity.kind,
        identity.runtime,
        identity.daemonContext,
        identity.daemonHostId,
        identity.containerId,
        identity.hostNetworkNamespace,
        identity.protocol,
        identity.containerPort,
        identity.hostAddress,
        identity.hostPort,
      ];
      break;
    case 'system-service':
      requireIdentityFields(identity.kind, [identity.hostId, identity.mountNamespace, identity.localId]);
      parts = [identity.kind, identity.provider, identity.hostId, identity.mountNamespace, identity.localId];
      break;
    case 'configured-service':
      requireIdentityFields(identity.kind, [identity.storeId, identity.localId]);
      parts = [identity.kind, identity.storeId, identity.localId];
      break;
    case 'resource':
      requireIdentityFields(identity.kind, [
        identity.hostId,
        identity.namespaceId,
        identity.subjectIdentityKey,
        identity.metric,
      ]);
      parts = [identity.kind, identity.hostId, identity.namespaceId, identity.subjectIdentityKey, identity.metric];
      break;
  }
  return `portcn:discovery:v${DISCOVERY_SCHEMA_VERSION}:${encodeURIComponent(JSON.stringify(parts))}`;
}

export interface DiscoveryEvidence {
  id: string;
  provider: DiscoveryProviderName;
  method: string;
  sourceRef: string;
  claim: string;
  provenance: EvidenceProvenance;
  confidence: DiscoveryConfidence;
  observedAt: string;
  validUntil: string | null;
  scope: DiscoveryScope;
  limitations: string[];
}

export type EvidenceFreshness = 'fresh' | 'stale' | 'unknown';

/** Freshness is time-relative. Unknown expiry or malformed timestamps never imply fresh evidence. */
export function evidenceFreshness(
  evidence: Pick<DiscoveryEvidence, 'observedAt' | 'validUntil'>,
  at: string,
): EvidenceFreshness {
  const observedAt = Date.parse(evidence.observedAt);
  const checkedAt = Date.parse(at);
  if (!Number.isFinite(observedAt) || !Number.isFinite(checkedAt) || evidence.validUntil === null) return 'unknown';
  const validUntil = Date.parse(evidence.validUntil);
  if (!Number.isFinite(validUntil) || validUntil < observedAt) return 'unknown';
  if (checkedAt < observedAt) return 'unknown';
  return checkedAt <= validUntil ? 'fresh' : 'stale';
}

export type DiscoveryObservationState = 'running' | 'stopped' | 'configured' | 'unknown';

export interface DiscoveryObservation {
  state: DiscoveryObservationState;
  displayName: string | null;
  observedAt: string;
  evidence: DiscoveryEvidence[];
  identity: DiscoveryIdentity;
  identityStatus: 'stable' | 'observation-only';
}

export interface UnidentifiedDiscoveryObservation extends Omit<DiscoveryObservation, 'identity' | 'identityStatus'> {
  identity: null;
  identityStatus: 'observation-only' | 'unavailable';
}

export type AnyDiscoveryObservation = DiscoveryObservation | UnidentifiedDiscoveryObservation;

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function withRelationshipMetadata(
  correlation: Omit<DiscoveryCorrelation, 'nature' | 'freshness'>,
  evidence: DiscoveryEvidence[],
  requestedAt: string,
): DiscoveryCorrelation {
  return {
    ...correlation,
    nature: relationshipNatureFromEvidence(evidence),
    freshness: relationshipFreshnessFromEvidence(evidence, requestedAt),
  };
}

export type ProviderResultStatus = 'complete' | 'partial' | 'permission-denied' | 'unavailable' | 'failed';

export interface ProviderIssue {
  code: string;
  message: string;
  retryable: boolean;
  scope: DiscoveryScope;
}

export interface DiscoveryProviderRequest {
  requestedAt: string;
  scope: DiscoveryScope;
  deadlineMs: number;
}

/** Provider adapters normalize observations but never perform cross-provider deduplication. */
export interface DiscoveryProvider {
  readonly id: string;
  readonly name: DiscoveryProviderName;
  discover(request: DiscoveryProviderRequest): Promise<DiscoveryProviderResult>;
}

export interface DiscoveryProviderResult {
  providerId: string;
  provider: DiscoveryProviderName;
  status: ProviderResultStatus;
  scope: DiscoveryScope;
  startedAt: string;
  finishedAt: string;
  observations: AnyDiscoveryObservation[];
  issues: ProviderIssue[];
  limitations: string[];
}

export type CorrelationType =
  | 'same-endpoint'
  | 'published-as'
  | 'forwarded-by'
  | 'owned-by'
  | 'project-of'
  | 'configured-as'
  | 'hosts'
  | 'depends-on';

export type DiscoveryRelationshipNature = 'observed' | 'configured' | 'inferred' | 'incomplete' | 'unavailable';

/** A correlation is a sourced claim between distinct identities; it does not merge either record. */
export interface DiscoveryCorrelation {
  fromIdentityKey: string;
  toIdentityKey: string;
  type: CorrelationType;
  confidence: DiscoveryConfidence;
  evidenceIds: string[];
  observedAt: string;
  scope: DiscoveryScope;
  nature: DiscoveryRelationshipNature;
  freshness: EvidenceFreshness;
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

/** Stricter scope checks for cross-provider correlations; unknown boundaries do not imply compatibility. */
export function scopesJoinableForCorrelation(left: DiscoveryScope, right: DiscoveryScope): boolean {
  if (!scopesCompatible(left, right)) return false;
  const leftDaemon = left.daemonContext;
  const rightDaemon = right.daemonContext;
  if (leftDaemon === null && rightDaemon === null) return true;
  if (leftDaemon !== null && rightDaemon !== null) return leftDaemon === rightDaemon;
  if (left.hostId === null || right.hostId === null) return false;
  if (left.networkNamespace === null || right.networkNamespace === null) return false;
  return left.hostId === right.hostId && left.networkNamespace === right.networkNamespace;
}

function mergeObservationGroup(group: DiscoveryObservation[]): DiscoveryObservation {
  const ordered = [...group].sort(
    (left, right) =>
      Date.parse(left.observedAt) - Date.parse(right.observedAt) || compareText(left.observedAt, right.observedAt),
  );
  const latest = ordered.at(-1);
  if (!latest) throw new Error('Cannot merge an empty discovery identity group.');
  const evidenceById = new Map<string, DiscoveryEvidence>();
  for (const observation of ordered) {
    for (const item of observation.evidence) {
      if (!evidenceById.has(item.id)) evidenceById.set(item.id, item);
    }
  }
  return {
    ...latest,
    displayName:
      latest.displayName ?? [...ordered].reverse().find(({ displayName }) => displayName)?.displayName ?? null,
    evidence: [...evidenceById.values()].sort((left, right) => compareText(left.id, right.id)),
  };
}

/** Collapse only repeated stable identities with compatible known scope; retain every distinct source record. */
export function deduplicateDiscoveryObservations(observations: AnyDiscoveryObservation[]): AnyDiscoveryObservation[] {
  const byIdentity = new Map<string, DiscoveryObservation[][]>();
  const unidentified: AnyDiscoveryObservation[] = [];
  for (const observation of observations) {
    if (observation.identity === null || observation.identityStatus !== 'stable') {
      unidentified.push(observation);
      continue;
    }
    const key = discoveryIdentityKey(observation.identity);
    const groups = byIdentity.get(key) ?? [];
    const compatibleGroup = groups.find((group) =>
      group.every((item) =>
        observation.evidence.every((evidence) =>
          item.evidence.every((prior) => scopesCompatible(prior.scope, evidence.scope)),
        ),
      ),
    );
    if (compatibleGroup) compatibleGroup.push(observation);
    else groups.push([observation]);
    byIdentity.set(key, groups);
  }
  const stable = [...byIdentity.entries()].flatMap(([, groups]) =>
    groups.map((group) =>
      mergeObservationGroup(
        group.map((item) => (groups.length > 1 ? { ...item, identityStatus: 'observation-only' } : item)),
      ),
    ),
  );
  return [...stable, ...unidentified].sort((left, right) => {
    const leftKey = left.identity && left.identityStatus === 'stable' ? discoveryIdentityKey(left.identity) : '';
    const rightKey = right.identity && right.identityStatus === 'stable' ? discoveryIdentityKey(right.identity) : '';
    return compareText(leftKey, rightKey) || compareText(left.observedAt, right.observedAt);
  });
}

/** Add published-as edges only when runtime, daemon, container, protocol, and target port all agree. */
export function correlateContainerMappings(
  observations: AnyDiscoveryObservation[],
  requestedAt = new Date(0).toISOString(),
): DiscoveryCorrelation[] {
  const stable = observations.filter(
    (item): item is DiscoveryObservation => item.identity !== null && item.identityStatus === 'stable',
  );
  const correlations: DiscoveryCorrelation[] = [];
  for (const bindingObservation of stable) {
    const binding = bindingObservation.identity;
    if (binding.kind !== 'published-binding') continue;
    for (const portObservation of stable) {
      const port = portObservation.identity;
      if (
        port.kind !== 'container-port' ||
        port.runtime !== binding.runtime ||
        port.daemonContext !== binding.daemonContext ||
        port.daemonHostId !== binding.daemonHostId ||
        port.containerId !== binding.containerId ||
        port.protocol !== binding.protocol ||
        port.containerPort !== binding.containerPort
      )
        continue;
      if (!bindingObservation.evidence.length || !portObservation.evidence.length) continue;
      const evidence = [...bindingObservation.evidence, ...portObservation.evidence];
      if (
        bindingObservation.evidence.some((bindingEvidence) =>
          portObservation.evidence.some(
            (portEvidence) => !scopesJoinableForCorrelation(bindingEvidence.scope, portEvidence.scope),
          ),
        )
      )
        continue;
      const observedAt = [bindingObservation.observedAt, portObservation.observedAt].sort(compareText).at(-1);
      const correlationScope = evidence.at(0)?.scope;
      if (!observedAt || !correlationScope) continue;
      correlations.push(
        withRelationshipMetadata(
          {
            fromIdentityKey: discoveryIdentityKey(binding),
            toIdentityKey: discoveryIdentityKey(port),
            type: 'published-as',
            confidence: 'high',
            evidenceIds: [...new Set(evidence.map(({ id }) => id))].sort(compareText),
            observedAt,
            scope: correlationScope,
          },
          evidence,
          requestedAt,
        ),
      );
    }
  }
  return correlations.sort(
    (left, right) =>
      compareText(left.fromIdentityKey, right.fromIdentityKey) || compareText(left.toIdentityKey, right.toIdentityKey),
  );
}

export interface DiscoverySnapshot {
  schemaVersion: typeof DISCOVERY_SCHEMA_VERSION;
  requestedAt: string;
  status: 'complete' | 'partial';
  providers: DiscoveryProviderResult[];
  correlations: DiscoveryCorrelation[];
}

/** Validate edge references, preserve every provider result and record, and sort for stable serialization. */
export function createDiscoverySnapshot(
  providers: DiscoveryProviderResult[],
  correlations: DiscoveryCorrelation[],
  requestedAt: string,
): DiscoverySnapshot {
  const orderedProviders = [...providers].sort((left, right) => compareText(left.providerId, right.providerId));
  const identityKeys = new Set<string>();
  const evidenceIds = new Set<string>();
  for (const provider of orderedProviders) {
    for (const observation of provider.observations) {
      if (observation.identity !== null && observation.identityStatus === 'stable')
        identityKeys.add(discoveryIdentityKey(observation.identity));
      for (const evidence of observation.evidence) evidenceIds.add(evidence.id);
    }
  }
  for (const correlation of correlations) {
    if (correlation.fromIdentityKey === correlation.toIdentityKey)
      throw new Error('A discovery correlation must connect distinct identities.');
    if (!identityKeys.has(correlation.fromIdentityKey) || !identityKeys.has(correlation.toIdentityKey))
      throw new Error('A discovery correlation must reference identities in the snapshot.');
    if (correlation.evidenceIds.length === 0 || correlation.evidenceIds.some((id) => !evidenceIds.has(id)))
      throw new Error('A discovery correlation must reference evidence in the snapshot.');
  }
  const orderedCorrelations = [...correlations].sort(
    (left, right) =>
      compareText(left.fromIdentityKey, right.fromIdentityKey) ||
      compareText(left.toIdentityKey, right.toIdentityKey) ||
      compareText(left.type, right.type),
  );
  return {
    schemaVersion: DISCOVERY_SCHEMA_VERSION,
    requestedAt,
    status:
      orderedProviders.length > 0 && orderedProviders.every(({ status }) => status === 'complete')
        ? 'complete'
        : 'partial',
    providers: orderedProviders,
    correlations: orderedCorrelations,
  };
}
