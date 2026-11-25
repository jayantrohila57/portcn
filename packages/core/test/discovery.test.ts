import { describe, expect, it } from 'vitest';
import type { PortNumber } from '../src/index.js';
import {
  correlateContainerMappings,
  createDiscoverySnapshot,
  type DiscoveryCorrelation,
  type DiscoveryEvidence,
  type DiscoveryIdentity,
  type DiscoveryObservation,
  type DiscoveryProviderResult,
  type DiscoveryScope,
  deduplicateDiscoveryObservations,
  discoveryIdentityKey,
  evidenceFreshness,
} from '../src/index.js';

const scope: DiscoveryScope = {
  hostId: 'host-a',
  pidNamespace: 'pid:[4026531836]',
  networkNamespace: 'net:[4026531833]',
  mountNamespace: 'mnt:[4026531840]',
  daemonContext: 'docker-context-local',
};

const listener: DiscoveryIdentity = {
  kind: 'native-listener',
  hostId: 'host-a',
  networkNamespace: 'net:[4026531833]',
  protocol: 'tcp',
  bindAddress: '127.0.0.1',
  port: 8080 as PortNumber,
};

const publishedBinding: DiscoveryIdentity = {
  kind: 'published-binding',
  runtime: 'docker',
  daemonContext: 'docker-context-local',
  daemonHostId: 'host-a',
  containerId: 'container-a',
  hostNetworkNamespace: 'net:[4026531833]',
  protocol: 'tcp',
  containerPort: 80 as PortNumber,
  hostAddress: '127.0.0.1',
  hostPort: 8080 as PortNumber,
};

const evidence: DiscoveryEvidence = {
  id: 'native-sockets:socket:8080',
  provider: 'native-sockets',
  method: 'ss --listening --tcp --numeric --processes',
  sourceRef: 'socket:tcp:127.0.0.1:8080',
  claim: 'listener-observed',
  provenance: 'direct',
  confidence: 'high',
  observedAt: '2026-11-25T11:00:00.000Z',
  validUntil: '2026-11-25T11:00:10.000Z',
  scope,
  limitations: [],
};

function providerResult(providerId: string, status: DiscoveryProviderResult['status']): DiscoveryProviderResult {
  const isDocker = providerId === 'docker-local';
  const identity = isDocker ? publishedBinding : listener;
  const providerEvidence = isDocker
    ? { ...evidence, id: 'docker-local:binding:8080', provider: 'docker' as const, provenance: 'derived' as const }
    : evidence;
  return {
    providerId,
    provider: providerId === 'docker-local' ? 'docker' : 'native-sockets',
    status,
    scope,
    startedAt: '2026-11-25T11:00:00.000Z',
    finishedAt: '2026-11-25T11:00:01.000Z',
    observations: [
      {
        identity,
        identityStatus: 'stable',
        state: 'running',
        displayName: null,
        observedAt: '2026-11-25T11:00:00.000Z',
        evidence: [providerEvidence],
      },
    ],
    issues: [],
    limitations: [],
  };
}

function containerObservation(
  runtime: 'docker' | 'podman',
  containerId: string,
  provider: 'docker' | 'podman',
  source: string,
  observedAt: string,
  evidenceScope = scope,
): DiscoveryObservation {
  return {
    identity: { kind: 'container', runtime, daemonContext: `${runtime}-local`, daemonHostId: 'host-a', containerId },
    identityStatus: 'stable',
    state: 'running',
    displayName: containerId,
    observedAt,
    evidence: [{ ...evidence, id: source, provider, observedAt, scope: evidenceScope }],
  };
}

function containerPortObservation(
  runtime: 'docker' | 'podman',
  containerId: string,
  source: string,
  provider: 'docker' | 'podman' = runtime,
): DiscoveryObservation {
  return {
    identity: {
      kind: 'container-port',
      runtime,
      daemonContext: `${runtime}-local`,
      daemonHostId: 'host-a',
      containerId,
      protocol: 'tcp',
      containerPort: 80 as PortNumber,
    },
    identityStatus: 'stable',
    state: 'running',
    displayName: null,
    observedAt: evidence.observedAt,
    evidence: [{ ...evidence, id: source, provider, observedAt: evidence.observedAt }],
  };
}

function bindingObservation(
  runtime: 'docker' | 'podman',
  containerId: string,
  hostAddress: string,
  hostPort: number,
  source: string,
): DiscoveryObservation {
  return {
    identity: {
      kind: 'published-binding',
      runtime,
      daemonContext: `${runtime}-local`,
      daemonHostId: 'host-a',
      containerId,
      hostNetworkNamespace: 'net:[4026531833]',
      protocol: 'tcp',
      containerPort: 80 as PortNumber,
      hostAddress,
      hostPort: hostPort as PortNumber,
    },
    identityStatus: 'stable',
    state: 'running',
    displayName: null,
    observedAt: evidence.observedAt,
    evidence: [{ ...evidence, id: source, provider: runtime, observedAt: evidence.observedAt }],
  };
}

describe('unified discovery contracts', () => {
  it('encodes source identity deterministically and distinguishes endpoint scope', () => {
    expect(discoveryIdentityKey(listener)).toBe(discoveryIdentityKey({ ...listener }));
    expect(discoveryIdentityKey({ ...listener, protocol: 'udp' })).not.toBe(discoveryIdentityKey(listener));
    expect(discoveryIdentityKey({ ...listener, bindAddress: '0.0.0.0' })).not.toBe(discoveryIdentityKey(listener));
    expect(discoveryIdentityKey({ ...listener, networkNamespace: 'net:[4026532999]' })).not.toBe(
      discoveryIdentityKey(listener),
    );
  });

  it('keeps container and process identities distinct by runtime and namespace-safe process lifetime', () => {
    const container: DiscoveryIdentity = {
      kind: 'container',
      runtime: 'docker',
      daemonContext: 'local',
      daemonHostId: 'host-a',
      containerId: 'container-a',
    };
    const process: DiscoveryIdentity = {
      kind: 'process',
      hostId: 'host-a',
      pidNamespace: 'pid:[1]',
      pid: 73,
      startTime: 'ticks:1234',
    };

    expect(discoveryIdentityKey(container)).not.toBe(discoveryIdentityKey({ ...container, runtime: 'podman' }));
    expect(discoveryIdentityKey(container)).not.toBe(discoveryIdentityKey({ ...container, daemonHostId: 'host-b' }));
    expect(discoveryIdentityKey(container)).not.toBe(
      discoveryIdentityKey({ ...container, containerId: 'container-b' }),
    );
    expect(discoveryIdentityKey(process)).not.toBe(discoveryIdentityKey({ ...process, pidNamespace: 'pid:[2]' }));
    expect(discoveryIdentityKey(process)).not.toBe(discoveryIdentityKey({ ...process, startTime: 'ticks:5678' }));
  });

  it('keeps published bindings distinct by host bind and target port', () => {
    const binding: DiscoveryIdentity = {
      kind: 'published-binding',
      runtime: 'docker',
      daemonContext: 'remote-prod',
      daemonHostId: 'host-remote-a',
      containerId: 'container-a',
      hostNetworkNamespace: 'net:[9]',
      protocol: 'tcp',
      containerPort: 80 as PortNumber,
      hostAddress: '127.0.0.1',
      hostPort: 8080 as PortNumber,
    };
    expect(discoveryIdentityKey(binding)).not.toBe(discoveryIdentityKey({ ...binding, hostAddress: '0.0.0.0' }));
    expect(discoveryIdentityKey(binding)).not.toBe(discoveryIdentityKey({ ...binding, hostPort: 8081 as PortNumber }));
    expect(discoveryIdentityKey(binding)).not.toBe(
      discoveryIdentityKey({ ...binding, containerPort: 443 as PortNumber }),
    );
  });

  it('deduplicates repeat runtime/container identities but keeps Docker and Podman distinct', () => {
    const dockerFirst = containerObservation('docker', 'same-id', 'docker', 'docker:a', '2026-11-25T11:00:00.000Z');
    const dockerSecond = containerObservation('docker', 'same-id', 'docker', 'docker:b', '2026-11-25T11:00:02.000Z');
    const podman = containerObservation('podman', 'same-id', 'podman', 'podman:a', '2026-11-25T11:00:01.000Z');
    const result = deduplicateDiscoveryObservations([dockerFirst, podman, dockerSecond]);
    expect(result).toHaveLength(2);
    const docker = result.find((item) => item.identity?.kind === 'container' && item.identity.runtime === 'docker');
    expect(docker).toMatchObject({
      observedAt: '2026-11-25T11:00:02.000Z',
      evidence: [{ id: 'docker:a' }, { id: 'docker:b' }],
    });
    expect(result.map((item) => item.identity?.kind === 'container' && item.identity.runtime)).toEqual([
      'docker',
      'podman',
    ]);
  });

  it('keeps shared host ports and multiple mappings distinct, then links only matching container ports', () => {
    const dockerPort = containerPortObservation('docker', 'docker-a', 'docker:port:a');
    const podmanPort = containerPortObservation('podman', 'podman-a', 'podman:port:a');
    const dockerBinding = bindingObservation('docker', 'docker-a', '127.0.0.1', 8080, 'docker:binding:a');
    const sameHostPortOtherContainer = bindingObservation('podman', 'podman-a', '127.0.0.1', 8080, 'podman:binding:a');
    const secondMapping = bindingObservation('docker', 'docker-a', '::1', 8081, 'docker:binding:b');
    const dockerBindingEvidence = dockerBinding.evidence.at(0);
    if (!dockerBindingEvidence) throw new Error('Test fixture is missing Docker binding evidence.');
    const observations = deduplicateDiscoveryObservations([
      dockerPort,
      podmanPort,
      dockerBinding,
      sameHostPortOtherContainer,
      secondMapping,
      { ...dockerBinding, evidence: [{ ...dockerBindingEvidence, id: 'docker:binding:repeat' }] },
    ]);
    expect(observations).toHaveLength(5);
    const edges = correlateContainerMappings(observations);
    expect(edges).toHaveLength(3);
    expect(edges.every(({ type, confidence }) => type === 'published-as' && confidence === 'high')).toBe(true);
    expect(new Set(edges.map(({ fromIdentityKey }) => fromIdentityKey)).size).toBe(3);
    expect(correlateContainerMappings([dockerPort, { ...dockerBinding, evidence: [] }])).toEqual([]);
    expect(
      correlateContainerMappings([
        dockerPort,
        { ...dockerBinding, evidence: [{ ...dockerBindingEvidence, scope: { ...scope, hostId: 'host-b' } }] },
      ]),
    ).toEqual([]);
  });

  it('does not collapse the same key when known provider scopes conflict', () => {
    const first = containerObservation('docker', 'container-a', 'docker', 'docker:host-a', evidence.observedAt);
    const otherScope: DiscoveryScope = { ...scope, hostId: 'host-b' };
    const second = containerObservation(
      'docker',
      'container-a',
      'docker',
      'docker:host-b',
      evidence.observedAt,
      otherScope,
    );
    const result = deduplicateDiscoveryObservations([first, second]);
    expect(result).toHaveLength(2);
    expect(result.every((item) => item.identityStatus === 'observation-only')).toBe(true);
  });

  it('preserves separate provider observations and partial-result reasons without port-based deduplication', () => {
    const edge: DiscoveryCorrelation = {
      fromIdentityKey: discoveryIdentityKey(listener),
      toIdentityKey: discoveryIdentityKey(publishedBinding),
      type: 'published-as',
      confidence: 'medium',
      evidenceIds: ['native-sockets:socket:8080', 'docker-local:binding:8080'],
      observedAt: '2026-11-25T11:00:01.000Z',
      scope,
    };
    const snapshot = createDiscoverySnapshot(
      [providerResult('docker-local', 'partial'), providerResult('native-local', 'complete')],
      [edge],
      '2026-11-25T11:00:00.000Z',
    );

    expect(snapshot.status).toBe('partial');
    expect(snapshot.providers.map(({ providerId }) => providerId)).toEqual(['docker-local', 'native-local']);
    expect(snapshot.providers.map(({ observations }) => observations.length)).toEqual([1, 1]);
    expect(snapshot.providers[0]?.observations[0]?.identity).not.toEqual(
      snapshot.providers[1]?.observations[0]?.identity,
    );
    expect(snapshot.providers[0]?.status).toBe('partial');
    expect(snapshot.correlations).toEqual([edge]);
    expect(createDiscoverySnapshot([], [], '2026-11-25T11:00:00.000Z').status).toBe('partial');
    expect(() => createDiscoverySnapshot([providerResult('native-local', 'complete')], [edge], 'now')).toThrow(
      /identities in the snapshot/,
    );
    expect(() =>
      createDiscoverySnapshot(
        [providerResult('docker-local', 'complete'), providerResult('native-local', 'complete')],
        [{ ...edge, evidenceIds: ['missing:evidence'] }],
        'now',
      ),
    ).toThrow(/evidence in the snapshot/);
    const observationOnly = providerResult('native-local', 'complete');
    const observation = observationOnly.observations[0];
    if (observation) observation.identityStatus = 'observation-only';
    expect(() =>
      createDiscoverySnapshot([providerResult('docker-local', 'complete'), observationOnly], [edge], 'now'),
    ).toThrow(/identities in the snapshot/);
  });

  it('computes evidence freshness against an explicit deterministic timestamp', () => {
    expect(evidenceFreshness(evidence, '2026-11-25T11:00:05.000Z')).toBe('fresh');
    expect(evidenceFreshness(evidence, '2026-11-25T11:00:11.000Z')).toBe('stale');
    expect(evidenceFreshness(evidence, '2026-11-25T10:59:59.000Z')).toBe('unknown');
    expect(evidenceFreshness({ ...evidence, validUntil: null }, '2026-11-25T11:00:05.000Z')).toBe('unknown');
    expect(evidenceFreshness({ ...evidence, observedAt: 'invalid' }, '2026-11-25T11:00:05.000Z')).toBe('unknown');
  });

  it('rejects malformed port and process keys at the identity boundary', () => {
    expect(() => discoveryIdentityKey({ ...listener, port: 0 as PortNumber })).toThrow(/valid port/);
    expect(() =>
      discoveryIdentityKey({ kind: 'process', hostId: 'host-a', pidNamespace: 'pid:[1]', pid: 0, startTime: '1' }),
    ).toThrow(/positive safe PID/);
  });
});
