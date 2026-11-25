import { describe, expect, it } from 'vitest';
import type { ListeningPort } from '../src/commands/list.js';
import {
  discoverDashboardServices,
  searchDashboardServices,
  sortDashboardServices,
} from '../src/commands/service-dashboard.js';
import { formatServiceDashboardView, tabForKey } from '../src/commands/tabs.js';

const listener: ListeningPort = {
  protocol: 'tcp',
  state: 'LISTEN',
  address: '127.0.0.1',
  port: 8080,
  pid: 700,
  processName: 'nginx',
  owners: [{ pid: 700, processName: 'nginx' }],
};
const docker = {
  schemaVersion: 1 as const,
  availability: 'available' as const,
  hostListenerDiscovery: 'available' as const,
  limitations: [],
  containers: [
    {
      id: 'container-1',
      name: 'web',
      image: 'nginx',
      state: 'running',
      health: 'healthy',
      networkMode: 'bridge',
      hostNetwork: false,
      composeProject: 'demo',
      composeService: 'frontend',
      networkAddresses: [],
      ports: [
        {
          containerPort: 80,
          protocol: 'tcp' as const,
          exposure: 'published' as const,
          hostBindings: [
            {
              address: '127.0.0.1',
              port: 8080,
              exposure: 'published' as const,
              bindingState: 'active' as const,
              listenerStatus: 'observed' as const,
              listeners: [],
            },
          ],
        },
      ],
    },
  ],
};
const podman = { ...docker, containers: [] };
const nginx = {
  schemaVersion: 1 as const,
  availability: 'available' as const,
  processes: [{ pid: 700, executable: '/usr/sbin/nginx' }],
  servers: [
    {
      source: '/etc/nginx/nginx.conf',
      serverNames: ['web.test'],
      listeners: [{ address: '127.0.0.1', port: 8080, protocol: 'tcp' as const, state: 'observed' as const }],
    },
  ],
  limitations: [],
};
const systemd = {
  schemaVersion: 1 as const,
  availability: 'available' as const,
  managers: { user: { status: 'available' as const }, system: { status: 'available' as const } },
  units: [
    {
      name: 'nginx.service',
      type: 'service' as const,
      scope: 'system' as const,
      load: 'loaded',
      active: 'active',
      sub: 'running',
      mainPid: 700,
      processListenerPorts: [8080],
      configuredSockets: [],
    },
  ],
  limitations: [],
  observationTime: '2026-11-25T12:00:00.000Z',
};

describe('unified service dashboard records', () => {
  it('combines native, Docker, Podman, Nginx, and systemd source records', () => {
    const records = discoverDashboardServices({
      listeners: () => [listener],
      docker: () => docker,
      podman: () => podman,
      nginx: () => nginx,
      systemd: () => systemd,
    });
    expect(records.map(({ source }) => source)).toEqual(['native', 'docker', 'podman', 'nginx', 'systemd']);
    expect(records.find(({ source }) => source === 'docker')).toMatchObject({
      name: 'web (frontend)',
      project: 'demo',
      endpoint: '127.0.0.1:8080 -> 80/tcp (active, observed)',
    });
    expect(records.find(({ source }) => source === 'systemd')).toMatchObject({
      owner: 'pid 700',
      status: 'active/running',
    });
  });

  it('keeps provider failures visible and searches evidence without changing identities', () => {
    const records = discoverDashboardServices({
      listeners: () => [listener],
      docker: () => ({ ...docker, containers: [], availability: 'daemon-unavailable' }),
      podman: () => ({ ...podman, availability: 'not-installed' }),
      nginx: () => ({ ...nginx, servers: [], availability: 'partial' }),
      systemd: () => ({ ...systemd, units: [], availability: 'partial' }),
    });
    expect(records.some(({ source, status }) => source === 'docker' && status === 'daemon-unavailable')).toBe(true);
    expect(searchDashboardServices(records, '127.0.0.1').map(({ identity }) => identity)).toEqual([
      'native:tcp:127.0.0.1:8080:700',
    ]);
    expect(sortDashboardServices(records, 'process').map(({ name }) => name)).toEqual(
      [...records].map(({ name }) => name).sort((left, right) => left.localeCompare(right)),
    );
  });

  it('renders a service view with source-aware details and navigates to it on key 5', () => {
    const records = discoverDashboardServices({
      listeners: () => [listener],
      docker: () => docker,
      podman: () => podman,
      nginx: () => nginx,
      systemd: () => systemd,
    });
    const output = formatServiceDashboardView(records, 0, 24, '', 'process', 0, false, 80);
    expect(output).toContain('DISCOVERED SERVICES');
    expect(output).toContain('Source/status: native / LISTEN');
    expect(tabForKey('5')).toBe('services');
    expect(tabForKey('\t', 'process')).toBe('services');
  });
});
