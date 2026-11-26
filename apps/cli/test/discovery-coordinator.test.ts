import { describe, expect, it } from 'vitest';
import { collectLinuxDiscoverySnapshot } from '../src/commands/discovery-coordinator.js';
import type { DockerInventory } from '../src/commands/docker.js';
import type { ListeningPort } from '../src/commands/list.js';

const listeners: ListeningPort[] = [
  {
    protocol: 'tcp',
    state: 'LISTEN',
    address: '127.0.0.1',
    port: 8080,
    pid: 42,
    processName: 'app',
    owners: [{ pid: 42, processName: 'app' }],
  },
];

const dockerInventory: DockerInventory = {
  schemaVersion: 1,
  availability: 'available',
  containers: [
    {
      id: 'abc123def456',
      name: 'web',
      image: 'web:latest',
      state: 'running',
      health: 'healthy',
      networkMode: 'bridge',
      hostNetwork: false,
      composeProject: 'demo',
      composeService: 'web',
      networkAddresses: [{ network: 'bridge', address: '172.17.0.2' }],
      ports: [
        {
          containerPort: 80,
          protocol: 'tcp',
          exposure: 'published',
          hostBindings: [
            {
              address: '127.0.0.1',
              port: 8080,
              exposure: 'published',
              bindingState: 'active',
              listenerStatus: 'observed',
              listeners: [{ address: '127.0.0.1', pid: 42, processName: 'app' }],
            },
          ],
        },
      ],
    },
  ],
  hostListenerDiscovery: 'available',
  limitations: [],
};

describe('linux discovery coordinator', () => {
  it('collects provider observations and evidence-backed relationships deterministically', () => {
    const snapshot = collectLinuxDiscoverySnapshot({
      platform: 'linux',
      listeners: () => listeners,
      docker: () => dockerInventory,
      podman: () => ({ ...dockerInventory, containers: [] }),
      nginx: () => ({
        schemaVersion: 1,
        availability: 'available',
        servers: [],
        processes: [],
        limitations: [],
      }),
      systemd: () => ({
        schemaVersion: 1,
        availability: 'available',
        managers: { user: { status: 'available' }, system: { status: 'available' } },
        units: [],
        limitations: [],
        observationTime: '2026-11-25T12:00:00.000Z',
      }),
      now: () => new Date('2026-11-25T12:00:00.000Z'),
      hostId: 'host-test',
      scope: {
        hostId: 'host-test',
        pidNamespace: 'pid:[4026531836]',
        networkNamespace: 'net:[4026531833]',
        mountNamespace: 'mnt:[4026531840]',
        daemonContext: null,
      },
    });
    expect(snapshot.providers.map(({ providerId }) => providerId)).toEqual([
      'docker-local',
      'native-local',
      'nginx-local',
      'podman-local',
      'systemd-local',
    ]);
    expect(snapshot.correlations.some(({ type }) => type === 'same-endpoint' || type === 'published-as')).toBe(true);
  });
});
