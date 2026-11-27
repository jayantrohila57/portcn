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
  formatConfiguredEndpointRef,
  scopesJoinableForCorrelation,
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

function listener(
  port: number,
  ownerPid: number | null = 92,
  overrides: Partial<Extract<DiscoveryObservation['identity'], { kind: 'native-listener' }>> = {},
): DiscoveryObservation {
  return {
    identity: {
      kind: 'native-listener',
      hostId: 'host-a',
      networkNamespace: 'net:[1]',
      protocol: 'tcp',
      bindAddress: '127.0.0.1',
      port: port as PortNumber,
      ...overrides,
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
              `owner:pid:${ownerPid}:ticks:42`,
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

function processObs(pid: number, startTime = pid === 93 ? '43' : '42'): DiscoveryObservation {
  return {
    identity: { kind: 'process', hostId: 'host-a', pidNamespace: 'pid:[1]', pid, startTime: `ticks:${startTime}` },
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

  it('emits owned-by edges for every visible listener owner with process lifetime', () => {
    const shared = listener(43117, null, {});
    shared.evidence.push(
      baseEvidence('native:owner:a', 'native-sockets', 'owner:pid:92:ticks:42', 'listener-owner'),
      baseEvidence('native:owner:b', 'native-sockets', 'owner:pid:93:ticks:43', 'listener-owner'),
    );
    const edges = buildDiscoveryCorrelations(
      deduplicateDiscoveryObservations([shared, processObs(92), processObs(93)]),
      observedAt,
    );
    expect(edges.filter(({ type }) => type === 'owned-by')).toHaveLength(2);
  });

  it('adds owned-by edges when owner pid and process lifetimes agree', () => {
    const edges = buildDiscoveryCorrelations(
      deduplicateDiscoveryObservations([listener(43117, 92), processObs(92)]),
      observedAt,
    );
    expect(edges.some(({ type, nature }) => type === 'owned-by' && nature === 'observed')).toBe(true);
  });

  it('matches IPv6 configured systemd sockets to native listeners', () => {
    const service: DiscoveryObservation = {
      identity: {
        kind: 'system-service',
        provider: 'systemd',
        hostId: 'host-a',
        mountNamespace: 'mnt:[1]',
        localId: 'system:web.socket',
      },
      identityStatus: 'stable',
      state: 'configured',
      displayName: 'fixture',
      observedAt,
      evidence: [
        {
          ...baseEvidence(
            'systemd:ipv6',
            'systemd',
            formatConfiguredEndpointRef('tcp', '::1', 8443),
            'configured-listener-observed',
          ),
          provenance: 'configured',
          confidence: 'medium',
        },
      ],
    };
    const ipv6Listener = listener(8443, null, { bindAddress: '::1' });
    const edges = buildDiscoveryCorrelations([service, ipv6Listener], observedAt);
    expect(edges.some(({ type }) => type === 'configured-as')).toBe(true);
  });

  it('does not join native listeners to bindings on a different daemon host', () => {
    const remoteBinding = binding(8080, 'container-a');
    if (remoteBinding.identity?.kind !== 'published-binding') throw new Error('fixture');
    remoteBinding.identity.daemonHostId = 'remote-host';
    const evidenceById = new Map(
      [listener(8080), remoteBinding].flatMap((item) => item.evidence.map((entry) => [entry.id, entry])),
    );
    expect(correlateHostEndpointBindings([listener(8080), remoteBinding], evidenceById, observedAt)).toHaveLength(0);
  });

  it('requires matching host and network scope across daemon and native evidence', () => {
    expect(
      scopesJoinableForCorrelation(
        { ...scope, daemonContext: null },
        { ...scope, daemonContext: 'docker-local', hostId: 'other-host' },
      ),
    ).toBe(false);
    expect(
      scopesJoinableForCorrelation(
        { ...scope, daemonContext: null },
        { ...scope, daemonContext: 'docker-local', hostId: scope.hostId, networkNamespace: scope.networkNamespace },
      ),
    ).toBe(true);
  });

  it('skips owned-by edges when listener owner ticks disagree with process lifetime', () => {
    const reused = listener(9001, null);
    reused.evidence.push(baseEvidence('owner:reused', 'native-sockets', 'owner:pid:92:ticks:1', 'listener-owner'));
    const edges = buildDiscoveryCorrelations(deduplicateDiscoveryObservations([reused, processObs(92)]), observedAt);
    expect(edges.filter(({ type }) => type === 'owned-by')).toHaveLength(0);
  });

  it('matches forwarded-by edges only when forwarder source references agree', () => {
    const forwarder = processObs(55, '900');
    forwarder.evidence.push({
      ...baseEvidence('fwd:bad', 'podman', 'forwarder:podman:x:tcp:*:9000->80', 'rootlessport-forwarder'),
      provenance: 'derived',
    });
    const publishedBinding = binding(9000, 'container-z');
    if (publishedBinding.identity?.kind !== 'published-binding') throw new Error('fixture');
    publishedBinding.evidence.push({
      ...baseEvidence('fwd:binding', 'podman', 'forwarder:podman:z:tcp:*:9000->80', 'forwarded-by'),
      provenance: 'derived',
    });
    const edges = buildDiscoveryCorrelations([forwarder, publishedBinding], observedAt);
    expect(edges.filter(({ type }) => type === 'forwarded-by')).toHaveLength(0);
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
