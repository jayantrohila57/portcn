import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  type DockerDependencies,
  discoverDockerInventory,
  formatDockerInventory,
  parseDockerInspect,
  registerDockerCommand,
} from '../src/commands/docker.js';
import type { ListeningPort } from '../src/commands/list.js';

const FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/docker-inspect.json', import.meta.url)), 'utf8');
const IDS = [
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
].join('\n');
const LISTENERS: ListeningPort[] = [
  { protocol: 'tcp', state: 'LISTEN', address: '127.0.0.1', port: 8080, pid: 10, processName: 'node' },
  { protocol: 'tcp', state: 'LISTEN', address: '[::1]', port: 8080, pid: 11, processName: 'node' },
  { protocol: 'udp', state: 'UNCONN', address: '127.0.0.1', port: 5353, pid: null, processName: null },
  { protocol: 'tcp', state: 'LISTEN', address: '0.0.0.0', port: 3000, pid: 12, processName: 'host-service' },
];

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

function mockedDependencies(listeners: ListeningPort[] | null = LISTENERS): DockerDependencies {
  const runDocker = vi.fn((args: string[]) => (args.includes('--quiet') ? IDS : FIXTURE));
  const discoverListeners = vi.fn(() => {
    if (listeners === null) throw new Error('ss unavailable');
    return listeners;
  });
  return { runDocker, discoverListeners };
}

describe('Docker container inventory', () => {
  it('parses health, Compose labels, exposed and multiple published IPv4/IPv6 mappings', () => {
    const containers = parseDockerInspect(FIXTURE, LISTENERS);
    expect(containers.map(({ name }) => name)).toEqual(['host-service', 'stopped-worker', 'api-1', 'web-1']);
    const web = containers.find(({ name }) => name === 'web-1');
    expect(web).toMatchObject({
      composeProject: 'demo',
      composeService: 'web',
      state: 'running',
      health: 'healthy',
      networkAddresses: [
        { network: 'demo_default', address: '172.20.0.2' },
        { network: 'demo_default', address: '2001:db8::2' },
      ],
    });
    expect(web?.ports).toEqual([
      {
        containerPort: 53,
        protocol: 'udp',
        exposure: 'published',
        hostBindings: [
          {
            address: '127.0.0.1',
            port: 5353,
            exposure: 'published',
            bindingState: 'active',
            listenerStatus: 'observed',
            listeners: [{ address: '127.0.0.1', pid: null, processName: null }],
          },
        ],
      },
      {
        containerPort: 80,
        protocol: 'tcp',
        exposure: 'published',
        hostBindings: [
          {
            address: '0.0.0.0',
            port: 8080,
            exposure: 'published',
            bindingState: 'active',
            listenerStatus: 'observed',
            listeners: [{ address: '127.0.0.1', pid: 10, processName: 'node' }],
          },
          {
            address: '::',
            port: 8080,
            exposure: 'published',
            bindingState: 'active',
            listenerStatus: 'observed',
            listeners: [{ address: '[::1]', pid: 11, processName: 'node' }],
          },
        ],
      },
      { containerPort: 443, protocol: 'tcp', exposure: 'exposed', hostBindings: [] },
      {
        containerPort: 8443,
        protocol: 'tcp',
        exposure: 'direct',
        hostBindings: [
          {
            address: '::',
            port: null,
            exposure: 'direct',
            bindingState: 'active',
            listenerStatus: 'unknown',
            listeners: [],
          },
        ],
      },
    ]);
    expect(JSON.stringify(containers)).not.toContain('must-not-be-returned');
  });

  it('retains stopped containers and reports shared host networking without attributing listeners', () => {
    const containers = parseDockerInspect(FIXTURE, LISTENERS);
    expect(containers.find(({ name }) => name === 'stopped-worker')).toMatchObject({
      state: 'exited',
      health: 'not-configured',
      ports: [
        {
          containerPort: 9000,
          protocol: 'tcp',
          exposure: 'configured',
          hostBindings: [
            {
              address: '0.0.0.0',
              port: 9001,
              exposure: 'published',
              bindingState: 'configured',
              listenerStatus: 'unknown',
            },
          ],
        },
      ],
    });
    expect(containers.find(({ name }) => name === 'host-service')).toMatchObject({
      hostNetwork: true,
      networkMode: 'host',
      ports: [{ containerPort: 3000, protocol: 'tcp', exposure: 'exposed', hostBindings: [] }],
    });
  });

  it('uses read-only Docker CLI commands and correlates listeners by mapped bind, port, and protocol', () => {
    const dependencies = mockedDependencies();
    const result = discoverDockerInventory(dependencies);
    expect(result.availability).toBe('available');
    expect(result.hostListenerDiscovery).toBe('available');
    expect(dependencies.runDocker).toHaveBeenNthCalledWith(1, ['container', 'ls', '--all', '--quiet', '--no-trunc']);
    expect(dependencies.runDocker).toHaveBeenNthCalledWith(2, ['container', 'inspect', ...IDS.split('\n')]);
    expect(
      result.containers.find(({ name }) => name === 'web-1')?.ports[1]?.hostBindings[0]?.listeners[0]?.processName,
    ).toBe('node');
  });

  it('reports host listener visibility as unknown when listener discovery is unavailable', () => {
    const result = discoverDockerInventory(mockedDependencies(null));
    const published = result.containers.find(({ name }) => name === 'web-1')?.ports[0]?.hostBindings[0];
    expect(result.hostListenerDiscovery).toBe('unavailable');
    expect(published).toMatchObject({ listenerStatus: 'unknown', listeners: [] });
  });

  it('distinguishes missing Docker, denied daemon access, and an unavailable daemon', () => {
    for (const [failure, availability, code] of [
      [Object.assign(new Error('spawn docker ENOENT'), { code: 'ENOENT' }), 'not-installed', 'DOCKER_NOT_INSTALLED'],
      [
        Object.assign(new Error('permission denied'), { code: 'EACCES' }),
        'permission-denied',
        'DOCKER_PERMISSION_DENIED',
      ],
      [new Error('Cannot connect to the Docker daemon'), 'daemon-unavailable', 'DOCKER_DAEMON_UNAVAILABLE'],
    ] as const) {
      const result = discoverDockerInventory({
        runDocker: () => {
          throw failure;
        },
      });
      expect(result).toMatchObject({ availability, error: { code } });
    }
  });

  it('classifies current Docker CLI connection failures as daemon-unavailable', () => {
    const result = discoverDockerInventory({
      runDocker: () => {
        throw Object.assign(new Error('Command failed: docker container ls'), {
          stderr:
            'failed to connect to the docker API at unix:///tmp/docker.sock; check if the path is correct and if the daemon is running',
        });
      },
    });
    expect(result).toMatchObject({
      availability: 'daemon-unavailable',
      error: { code: 'DOCKER_DAEMON_UNAVAILABLE' },
    });
  });

  it('does not invoke inspect when no containers are present', () => {
    const runDocker = vi.fn(() => '');
    expect(discoverDockerInventory({ runDocker }).containers).toEqual([]);
    expect(runDocker).toHaveBeenCalledTimes(1);
  });

  it('prints versioned JSON and returns an error status when Docker is missing', async () => {
    const program = new Command();
    registerDockerCommand(program, {
      runDocker: () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      },
    });
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    await program.parseAsync(['node', 'portcn', 'docker', '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({
      schemaVersion: 1,
      availability: 'not-installed',
      error: { code: 'DOCKER_NOT_INSTALLED' },
    });
    expect(process.exitCode).toBe(1);
  });

  it('renders Compose group and mappings without a docker-proxy ownership assumption', () => {
    const output = formatDockerInventory(discoverDockerInventory(mockedDependencies()));
    expect(output).toContain('demo');
    expect(output).toContain('web');
    expect(output).toContain('8080 -> 80/tcp');
    expect(output).toContain('[::]:8080');
    expect(output).toContain('[::] (direct route; no host port) -> 8443/tcp');
    expect(output).toContain('do not prove reachability');
    expect(output).not.toContain('docker-proxy pid');
  });

  it('labels retained stopped-container mappings as configured and inactive', () => {
    const containers = parseDockerInspect(FIXTURE, LISTENERS);
    const output = formatDockerInventory({
      schemaVersion: 1,
      availability: 'available',
      containers,
      hostListenerDiscovery: 'available',
      limitations: [],
    });
    expect(output).toContain('0.0.0.0:9001 -> 9000/tcp (configured; not active)');
  });
});
