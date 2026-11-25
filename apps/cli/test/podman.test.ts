import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ListeningPort } from '../src/commands/list.js';
import {
  discoverPodmanInventory,
  formatPodmanInventory,
  type PodmanDependencies,
  registerPodmanCommand,
} from '../src/commands/podman.js';

const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/podman-inspect.json', import.meta.url)), 'utf8');
const IDS = [
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
].join('\n');
const LISTENERS: ListeningPort[] = [
  { protocol: 'tcp', state: 'LISTEN', address: '127.0.0.1', port: 43117, pid: 92, processName: 'rootlessport' },
  { protocol: 'udp', state: 'UNCONN', address: '::1', port: 5353, pid: null, processName: null },
];

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

function dependencies(listeners: ListeningPort[] | null = LISTENERS): PodmanDependencies {
  const runPodman = vi.fn((args: string[]) => (args.includes('--quiet') ? IDS : FIXTURE));
  const discoverListeners = vi.fn(() => {
    if (listeners === null) throw new Error('ss unavailable');
    return listeners;
  });
  return { runPodman, discoverListeners };
}

describe('Podman container inventory', () => {
  it('discovers current-user rootless containers with mappings and Compose labels', () => {
    const deps = dependencies();
    const result = discoverPodmanInventory(deps);
    expect(result).toMatchObject({ availability: 'available', hostListenerDiscovery: 'available' });
    expect(result.containers.map(({ name }) => name)).toEqual(['api-rootless', 'stopped-worker']);
    expect(result.containers[0]).toMatchObject({
      composeProject: 'demo',
      composeService: 'api',
      state: 'running',
      health: 'healthy',
      networkMode: 'slirp4netns',
      networkAddresses: [{ network: 'podman', address: '10.88.0.4' }],
      ports: [
        { containerPort: 5353, protocol: 'udp', exposure: 'published' },
        { containerPort: 8080, protocol: 'tcp', exposure: 'published' },
        { containerPort: 8443, protocol: 'tcp', exposure: 'exposed' },
      ],
    });
    expect(result.containers[0]?.ports[1]?.hostBindings).toEqual([
      {
        address: '127.0.0.1',
        port: 43117,
        exposure: 'published',
        bindingState: 'active',
        listenerStatus: 'observed',
        listeners: [{ address: '127.0.0.1', pid: 92, processName: 'rootlessport' }],
      },
      {
        address: '::1',
        port: 43117,
        exposure: 'published',
        bindingState: 'active',
        listenerStatus: 'not-observed',
        listeners: [],
      },
    ]);
    expect(result.containers[1]?.ports[0]?.hostBindings[0]).toMatchObject({
      bindingState: 'configured',
      listenerStatus: 'unknown',
    });
  });

  it('uses only read-only Podman inventory commands and the selected user connection', () => {
    const calls: string[][] = [];
    const runPodman = (args: string[]) => {
      calls.push(args);
      return args.includes('--quiet') ? IDS : FIXTURE;
    };
    discoverPodmanInventory({ runPodman });
    expect(calls).toEqual([
      ['container', 'ls', '--all', '--quiet', '--no-trunc'],
      ['container', 'inspect', ...IDS.split('\n')],
    ]);
    expect(calls.every(([group]) => group === 'container')).toBe(true);
    expect(calls.every(([, operation]) => operation === 'ls' || operation === 'inspect')).toBe(true);
  });

  it('preserves rootful bridge-mode container observations without requesting elevation', () => {
    const calls: string[][] = [];
    const result = discoverPodmanInventory({
      runPodman: (args) => {
        calls.push(args);
        return args.includes('--quiet') ? IDS : FIXTURE.replace('slirp4netns', 'bridge');
      },
    });
    expect(result.containers[0]).toMatchObject({ networkMode: 'bridge', state: 'running' });
    expect(calls.every(([, operation]) => operation === 'ls' || operation === 'inspect')).toBe(true);
  });

  it('returns partial listener visibility when host inspection is unavailable', () => {
    const result = discoverPodmanInventory(dependencies(null));
    expect(result.hostListenerDiscovery).toBe('unavailable');
    expect(result.containers[0]?.ports[1]?.hostBindings[0]?.listenerStatus).toBe('unknown');
  });

  it('distinguishes missing CLI, permission denial, and unavailable service', () => {
    for (const [error, availability, code] of [
      [Object.assign(new Error('spawn podman ENOENT'), { code: 'ENOENT' }), 'not-installed', 'PODMAN_NOT_INSTALLED'],
      [
        Object.assign(new Error('permission denied'), { code: 'EACCES' }),
        'permission-denied',
        'PODMAN_PERMISSION_DENIED',
      ],
      [new Error('cannot connect to Podman socket'), 'daemon-unavailable', 'PODMAN_SERVICE_UNAVAILABLE'],
    ] as const) {
      expect(
        discoverPodmanInventory({
          runPodman: () => {
            throw error;
          },
        }),
      ).toMatchObject({ availability, error: { code } });
    }
  });

  it('prints versioned JSON and returns a failure code when Podman is not installed', async () => {
    const program = new Command();
    registerPodmanCommand(program, {
      runPodman: () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    });
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    await program.parseAsync(['node', 'portcn', 'podman', '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({
      schemaVersion: 1,
      availability: 'not-installed',
      error: { code: 'PODMAN_NOT_INSTALLED' },
    });
    expect(process.exitCode).toBe(1);
  });

  it('formats mappings and states the current-user and namespace limits', () => {
    const output = formatPodmanInventory(discoverPodmanInventory(dependencies()));
    expect(output).toContain('demo');
    expect(output).toContain('api');
    expect(output).toContain('43117 -> 8080/tcp');
    expect(output).toContain('current network namespace');
    expect(output).toContain('does not elevate privileges');
  });
});
