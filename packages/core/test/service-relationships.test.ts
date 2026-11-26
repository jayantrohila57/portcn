import { describe, expect, it } from 'vitest';
import type { PortNumber } from '../src/index.js';
import {
  buildDiscoveryCorrelations,
  correlateHostEndpointBindings,
  createDiscoverySnapshot,
  type DiscoveryEvidence,
  type DiscoveryObservation,
  type DiscoveryScope,
  deduplicateDiscoveryObservations,
  discoveryBindAddressesEquivalent,
  discoveryIdentityKey,
  withRelationshipMetadata,
} from '../src/index.js';

const scope: DiscoveryScope = {
  hostId: 'host-a',
  pidNamespace: 'pid:[1]',
  networkNamespace: 'net:[1]',
  mountNamespace: 'mnt:[1]',
  daemonContext: 'docker-local',
};

const observedAt = '2026-11-25T12:00:00.000Z';

function baseEvidence(
  id: string,
  provider: DiscoveryEvidence['provider'],
  sourceRef: string,
  claim: string,
): DiscoveryEvidence {
  return {
    id,
    provider,
    method: 'fixture',
    sourceRef,
    claim,
    provenance: 'direct',
    confidence: 'high',
    observedAt,
    validUntil: '2026-11-25T12:00:10.000Z',
    scope,
    limitations: [],
  };
}

function listener(port: number, ownerPid: number | null = 92): DiscoveryObservation {
  return {
    identity: {
      kind: 'native-listener',
      hostId: 'host-a',
      networkNamespace: 'net:[1]',
      protocol: 'tcp',
      bindAddress: '127.0.0.1',
      port: port as PortNumber,
    },
    identityStatus: 'stable',
    state: 'running',
    displayName: null,
    observedAt,
    evidence: [
      baseEvidence(`native:listener:${port}`, 'native-sockets', `socket:tcp:127.0.0.1:${port}`, 'listener-observed'),
      ...(ownerPid
        ? [
            baseEvidence(
              `native:owner:${port}:${ownerPid}`,
              'native-sockets',
              `owner:pid:${ownerPid}`,
              'listener-owner',
            ),
          ]
        : []),
    ],
  };
}

function binding(port: number, containerId: string): DiscoveryObservation {
  return {
    identity: {
      kind: 'published-binding',
      runtime: 'docker',
      daemonContext: 'docker-local',
      daemonHostId: 'host-a',
      containerId,
      hostNetworkNamespace: 'net:[1]',
      protocol: 'tcp',
      containerPort: 80 as PortNumber,
      hostAddress: '127.0.0.1',
      hostPort: port as PortNumber,
    },
    identityStatus: 'stable',
    state: 'running',
    displayName: null,
    observedAt,
    evidence: [
      baseEvidence(`docker:binding:${port}`, 'docker', `binding:tcp:127.0.0.1:${port}->80`, 'published-binding'),
    ],
  };
}

function processObs(pid: number): DiscoveryObservation {
  return {
    identity: { kind: 'process', hostId: 'host-a', pidNamespace: 'pid:[1]', pid, startTime: 'ticks:42' },
    identityStatus: 'stable',
    state: 'running',
    displayName: 'fixture',
    observedAt,
    evidence: [baseEvidence(`process:${pid}`, 'native-sockets', `pid:${pid}`, 'process-lifetime')],
  };
}

describe('service relationship correlation', () => {
  it('matches bind addresses conservatively', () => {
    expect(discoveryBindAddressesEquivalent('', '127.0.0.1')).toBe(true);
    expect(discoveryBindAddressesEquivalent('0.0.0.0', '127.0.0.1')).toBe(true);
    expect(discoveryBindAddressesEquivalent('10.0.0.1', '127.0.0.1')).toBe(false);
  });

  it('relates shared host ports distinctly and keeps multiple upstream mappings', () => {
    const observations = deduplicateDiscoveryObservations([
      listener(8080),
      listener(8081),
      binding(8080, 'container-a'),
      binding(8080, 'container-b'),
      binding(8081, 'container-a'),
    ]);
    const evidenceById = new Map(
      observations.flatMap((item) => item.evidence.map((evidence) => [evidence.id, evidence])),
    );
    const endpoints = correlateHostEndpointBindings(observations, evidenceById, observedAt);
    expect(endpoints).toHaveLength(3);
    expect(new Set(endpoints.map(({ toIdentityKey }) => toIdentityKey)).size).toBe(3);
  });

  it('labels process exit and partial visibility without inventing parents', () => {
    const observations = deduplicateDiscoveryObservations([listener(9000, null), binding(9000, 'container-alone')]);
    const edges = buildDiscoveryCorrelations(observations, observedAt);
    const owned = edges.filter(({ type }) => type === 'owned-by');
    expect(owned).toHaveLength(0);
    expect(edges.some(({ type }) => type === 'same-endpoint')).toBe(true);
  });

  it('preserves ambiguous configured-only relationships separately from observed listeners', () => {
    const service: DiscoveryObservation = {
      identity: {
        kind: 'system-service',
        provider: 'nginx',
        hostId: 'host-a',
        mountNamespace: 'mnt:[1]',
        localId: 'server:cfg:0',
      },
      identityStatus: 'stable',
      state: 'configured',
      displayName: 'fixture',
      observedAt,
      evidence: [
        {
          ...baseEvidence('nginx:cfg', 'nginx', 'configured:tcp:127.0.0.1:4000', 'configured-listener'),
          provenance: 'configured',
          confidence: 'low',
        },
      ],
    };
    const edges = buildDiscoveryCorrelations([service, listener(4000)], observedAt);
    const configured = edges.find(({ type }) => type === 'configured-as');
    expect(configured).toMatchObject({ confidence: 'low' });
    expect(configured?.nature === 'configured' || configured?.nature === 'incomplete').toBe(true);
  });

  it('adds owned-by edges when owner pid and process lifetimes agree', () => {
    const edges = buildDiscoveryCorrelations(
      deduplicateDiscoveryObservations([listener(43117, 92), processObs(92)]),
      observedAt,
    );
    expect(edges.some(({ type, nature }) => type === 'owned-by' && nature === 'observed')).toBe(true);
  });

  it('rejects self-referential and evidence-free snapshot edges deterministically', () => {
    const publishedBinding = binding(3000, 'container-z');
    const observations = deduplicateDiscoveryObservations([listener(3000), publishedBinding, processObs(42)]);
    const evidenceById = new Map(
      observations.flatMap((item) => item.evidence.map((evidence) => [evidence.id, evidence])),
    );
    const listenerIdentity = listener(3000).identity;
    const bindingIdentity = publishedBinding.identity;
    if (!listenerIdentity || !bindingIdentity) throw new Error('Test fixtures require stable identities.');
    const invalid = withRelationshipMetadata(
      {
        fromIdentityKey: discoveryIdentityKey(listenerIdentity),
        toIdentityKey: discoveryIdentityKey(bindingIdentity),
        type: 'same-endpoint',
        confidence: 'high',
        evidenceIds: ['missing'],
        observedAt,
        scope,
      },
      evidenceById,
      observedAt,
    );
    expect(() =>
      createDiscoverySnapshot(
        [
          {
            providerId: 'native-local',
            provider: 'native-sockets',
            status: 'complete',
            scope,
            startedAt: observedAt,
            finishedAt: observedAt,
            observations,
            issues: [],
            limitations: [],
          },
        ],
        [invalid],
        observedAt,
      ),
    ).toThrow(/evidence in the snapshot/);
  });
});
