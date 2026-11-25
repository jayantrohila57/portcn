import { describe, expect, it } from 'vitest';
import type { PortNumber } from '../src/index.js';
import {
  createDiscoverySnapshot,
  type DiscoveryCorrelation,
  type DiscoveryEvidence,
  type DiscoveryIdentity,
  type DiscoveryProviderResult,
  type DiscoveryScope,
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
