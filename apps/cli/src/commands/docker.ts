import { execFileSync } from 'node:child_process';
import { isIP } from 'node:net';
import type { Command } from 'commander';
import { formatEmpty, formatTable } from '../terminal.js';
import type { ListeningPort } from './list.js';
import { discoverListeningPorts } from './list.js';

export type DockerAvailability =
  | 'available'
  | 'not-installed'
  | 'permission-denied'
  | 'daemon-unavailable'
  | 'discovery-failed';
export interface DockerHostListener {
  address: string;
  pid: number | null;
  processName: string | null;
}
export interface DockerPort {
  containerPort: number;
  protocol: 'tcp' | 'udp' | 'sctp';
  exposure: 'exposed' | 'published' | 'direct' | 'configured';
  hostBindings: Array<{
    address: string;
    port: number | null;
    exposure: 'published' | 'direct' | 'configured';
    bindingState: 'active' | 'configured';
    listenerStatus: 'observed' | 'not-observed' | 'unknown';
    listeners: DockerHostListener[];
  }>;
}
export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  state: string;
  health: string;
  networkMode: string;
  hostNetwork: boolean;
  composeProject: string | null;
  composeService: string | null;
  networkAddresses: Array<{ network: string; address: string }>;
  ports: DockerPort[];
}
export interface DockerInventory {
  schemaVersion: 1;
  availability: DockerAvailability;
  containers: DockerContainer[];
  hostListenerDiscovery: 'available' | 'unavailable';
  limitations: string[];
  error?: { code: string; message: string };
}
export interface DockerDependencies {
  runDocker?: (args: string[]) => string;
  discoverListeners?: () => ListeningPort[];
}

interface InspectPortBinding {
  HostIp?: string;
  HostPort?: string;
}
interface InspectContainer {
  Id?: string;
  Name?: string;
  Config?: { Image?: string; Labels?: Record<string, string> | null; ExposedPorts?: Record<string, unknown> | null };
  State?: { Status?: string; Running?: boolean; Health?: { Status?: string } | null };
  HostConfig?: {
    NetworkMode?: string;
    PortBindings?: Record<string, InspectPortBinding[] | null> | null;
  };
  NetworkSettings?: {
    Ports?: Record<string, InspectPortBinding[] | null> | null;
    Networks?: Record<string, { IPAddress?: string; GlobalIPv6Address?: string } | null> | null;
  };
}

const LIMITATIONS = [
  'Docker inventory uses the Docker CLI and the daemon context selected by Docker; containers outside that context are not visible.',
  'Published mappings are Docker configuration. Matching host listeners are point-in-time observations and do not prove reachability or that Docker uses a docker-proxy process.',
  'Host listener observations come from Portcn’s current network namespace, which may differ from the Docker daemon host when the selected context is remote.',
  'Exposed container ports are image/container metadata and do not mean the port is published or listening.',
  'Host-network containers share the host network stack; Portcn does not attribute host listeners to a container based only on declared exposed ports.',
];

function parsePortKey(key: string): { port: number; protocol: DockerPort['protocol'] } | null {
  const match = /^(\d+)\/(tcp|udp|sctp)$/.exec(key);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535
    ? { port, protocol: match[2] as DockerPort['protocol'] }
    : null;
}

function bareAddress(value: string): string {
  return value.startsWith('[') && value.endsWith(']') ? value.slice(1, -1) : value;
}

function displayAddress(value: string): string {
  const address = bareAddress(value);
  return isIP(address) === 6 ? `[${address}]` : address;
}

export function listenerMatchesBinding(binding: string, listener: string): boolean {
  const bind = bareAddress(binding);
  const local = bareAddress(listener);
  if (bind === '' || bind === '*' || bind === local) return true;
  const bindFamily = isIP(bind);
  const localFamily = isIP(local);
  if (bindFamily !== localFamily && bindFamily !== 0 && localFamily !== 0) return false;
  if (local === '*' || local === '0.0.0.0' || local === '::') return true;
  if (bind === '0.0.0.0' || bind === '::') return bindFamily === 0 || localFamily === 0 || bindFamily === localFamily;
  return false;
}

function mapPorts(inspect: InspectContainer, listeners: ListeningPort[] | null): DockerPort[] {
  const configured = inspect.Config?.ExposedPorts ?? {};
  const runtime = inspect.NetworkSettings?.Ports ?? {};
  const declaredBindings = inspect.HostConfig?.PortBindings ?? {};
  const isRunning = inspect.State?.Running ?? inspect.State?.Status === 'running';
  const keys = new Set([...Object.keys(configured), ...Object.keys(runtime)]);
  for (const key of Object.keys(declaredBindings)) keys.add(key);
  const ports: DockerPort[] = [];
  for (const key of keys) {
    const parsed = parsePortKey(key);
    if (!parsed) continue;
    const runtimeBindings = runtime[key] ?? [];
    const declared = declaredBindings[key] ?? [];
    const bindings = runtimeBindings.length ? runtimeBindings : declared;
    if (!bindings.length) {
      ports.push({ containerPort: parsed.port, protocol: parsed.protocol, exposure: 'exposed', hostBindings: [] });
      continue;
    }
    const hostBindings = bindings.map((binding) => {
      const address = binding.HostIp ?? '';
      const rawPort = binding.HostPort ?? '';
      const isRuntimeBinding = runtimeBindings.length > 0;
      const hostPort =
        /^\d+$/.test(rawPort) && Number(rawPort) >= 1 && Number(rawPort) <= 65535 ? Number(rawPort) : null;
      const exposure: DockerPort['hostBindings'][number]['exposure'] =
        hostPort !== null
          ? 'published'
          : isRuntimeBinding && rawPort === '' && address !== ''
            ? 'direct'
            : 'configured';
      const bindingState: DockerPort['hostBindings'][number]['bindingState'] =
        isRuntimeBinding && isRunning && exposure !== 'configured' ? 'active' : 'configured';
      const matches =
        listeners && hostPort !== null && parsed.protocol !== 'sctp' && bindingState === 'active'
          ? listeners.filter(
              (listener) =>
                listener.protocol === parsed.protocol &&
                listener.port === hostPort &&
                listenerMatchesBinding(address, listener.address),
            )
          : [];
      const listenerStatus: DockerPort['hostBindings'][number]['listenerStatus'] =
        listeners === null || parsed.protocol === 'sctp' || hostPort === null || bindingState !== 'active'
          ? 'unknown'
          : matches.length
            ? 'observed'
            : 'not-observed';
      return {
        address,
        port: hostPort,
        exposure,
        bindingState,
        listenerStatus,
        listeners: matches.map(({ address: listenerAddress, pid, processName }) => ({
          address: listenerAddress,
          pid,
          processName,
        })),
      };
    });
    ports.push({
      containerPort: parsed.port,
      protocol: parsed.protocol,
      exposure: hostBindings.some(({ exposure, bindingState }) => exposure === 'published' && bindingState === 'active')
        ? 'published'
        : hostBindings.some(({ exposure, bindingState }) => exposure === 'direct' && bindingState === 'active')
          ? 'direct'
          : hostBindings.length
            ? 'configured'
            : 'exposed',
      hostBindings,
    });
  }
  return ports.sort(
    (left, right) => left.containerPort - right.containerPort || left.protocol.localeCompare(right.protocol),
  );
}

export function parseDockerInspect(input: string, listeners: ListeningPort[] | null = []): DockerContainer[] {
  const decoded: unknown = JSON.parse(input);
  if (!Array.isArray(decoded)) throw new Error('Docker inspect returned an unexpected response.');
  return decoded
    .map((value) => {
      if (!value || typeof value !== 'object') throw new Error('Docker inspect returned an invalid container.');
      const inspect = value as InspectContainer;
      const labels = inspect.Config?.Labels ?? {};
      const networkMode = inspect.HostConfig?.NetworkMode || 'unknown';
      const networkAddresses = Object.entries(inspect.NetworkSettings?.Networks ?? {}).flatMap(([network, item]) => {
        if (!item) return [];
        return [item.IPAddress, item.GlobalIPv6Address]
          .filter((address): address is string => typeof address === 'string' && address.length > 0)
          .map((address) => ({ network, address: address.split('/')[0] ?? address }));
      });
      return {
        id: inspect.Id ?? '',
        name: (inspect.Name ?? '').replace(/^\//, ''),
        image: inspect.Config?.Image ?? '',
        state: inspect.State?.Status ?? 'unknown',
        health: inspect.State?.Health?.Status ?? 'not-configured',
        networkMode,
        hostNetwork: networkMode === 'host',
        composeProject: labels['com.docker.compose.project'] || null,
        composeService: labels['com.docker.compose.service'] || null,
        networkAddresses,
        ports: mapPorts(inspect, listeners),
      } satisfies DockerContainer;
    })
    .sort(
      (left, right) =>
        (left.composeProject ?? '').localeCompare(right.composeProject ?? '') ||
        (left.composeService ?? '').localeCompare(right.composeService ?? '') ||
        left.name.localeCompare(right.name) ||
        left.id.localeCompare(right.id),
    );
}

function availabilityFromError(error: unknown): { availability: DockerAvailability; code: string; message: string } {
  const failure = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
  const detail = `${failure.message ?? ''} ${String(failure.stderr ?? '')}`;
  if (failure.code === 'ENOENT')
    return {
      availability: 'not-installed',
      code: 'DOCKER_NOT_INSTALLED',
      message: 'Docker CLI was not found. Install Docker Engine or Docker Desktop and ensure docker is on PATH.',
    };
  if (failure.code === 'EACCES' || failure.code === 'EPERM' || /permission denied|access is denied/i.test(detail))
    return {
      availability: 'permission-denied',
      code: 'DOCKER_PERMISSION_DENIED',
      message:
        'Docker access was denied. Check access to the selected Docker daemon; Portcn will not elevate privileges.',
    };
  if (
    /cannot connect to the docker daemon|is the docker daemon running|failed to connect to the docker api|check if the path is correct and if the daemon is running|context deadline exceeded/i.test(
      detail,
    )
  )
    return {
      availability: 'daemon-unavailable',
      code: 'DOCKER_DAEMON_UNAVAILABLE',
      message: 'Docker CLI is installed, but the selected Docker daemon is unavailable.',
    };
  if (failure.code === 'ETIMEDOUT')
    return {
      availability: 'daemon-unavailable',
      code: 'DOCKER_DAEMON_UNAVAILABLE',
      message: 'Docker did not respond before the inventory timeout.',
    };
  return {
    availability: 'discovery-failed',
    code: 'DOCKER_DISCOVERY_FAILED',
    message: 'Docker inventory failed. Check the Docker CLI and daemon context.',
  };
}

function errorInventory(error: unknown): DockerInventory {
  const failure = availabilityFromError(error);
  return {
    schemaVersion: 1,
    availability: failure.availability,
    containers: [],
    hostListenerDiscovery: 'unavailable',
    limitations: LIMITATIONS,
    error: { code: failure.code, message: failure.message },
  };
}

export function discoverDockerInventory(dependencies: DockerDependencies = {}): DockerInventory {
  const runDocker =
    dependencies.runDocker ??
    ((args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 32 * 1024 * 1024 }));
  const discoverListeners = dependencies.discoverListeners ?? discoverListeningPorts;
  let ids: string[];
  try {
    ids = runDocker(['container', 'ls', '--all', '--quiet', '--no-trunc'])
      .split(/\r?\n/)
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.some((id) => !/^[\da-f]{12,64}$/i.test(id)))
      throw new Error('Docker container list returned an invalid ID.');
  } catch (error) {
    return errorInventory(error);
  }
  let listeners: ListeningPort[] | null;
  try {
    listeners = discoverListeners();
  } catch {
    listeners = null;
  }
  if (ids.length === 0) {
    return {
      schemaVersion: 1,
      availability: 'available',
      containers: [],
      hostListenerDiscovery: listeners ? 'available' : 'unavailable',
      limitations: LIMITATIONS,
    };
  }
  try {
    const containers = parseDockerInspect(runDocker(['container', 'inspect', ...ids]), listeners);
    return {
      schemaVersion: 1,
      availability: 'available',
      containers,
      hostListenerDiscovery: listeners ? 'available' : 'unavailable',
      limitations: LIMITATIONS,
    };
  } catch (error) {
    return errorInventory(error);
  }
}

export function formatDockerInventory(result: DockerInventory): string {
  if (result.error) return `Docker ${result.availability}: ${result.error.message}`;
  if (!result.containers.length) return formatEmpty('No Docker containers found.');
  const rows = result.containers.map((container) => {
    const ports = container.ports.flatMap((port) => {
      const target = `${port.containerPort}/${port.protocol}`;
      if (!port.hostBindings.length) return [`${target} (exposed)`];
      return port.hostBindings.map((binding) => {
        const bindingState = binding.bindingState === 'configured' ? ' (configured; not active)' : '';
        if (binding.exposure === 'configured')
          return `${binding.address ? `${displayAddress(binding.address)}:` : ''}${binding.port ?? 'dynamic'} (configured) -> ${target}`;
        if (binding.exposure === 'direct')
          return `${displayAddress(binding.address)} (direct route; no host port)${bindingState} -> ${target}`;
        if (binding.port === null) return `${target} (exposed)`;
        const listeners = binding.listeners.length
          ? `; listener ${binding.listeners.map((listener) => `${listener.address}${listener.pid ? ` pid=${listener.pid}` : ''}`).join(', ')}`
          : '';
        return `${binding.address ? displayAddress(binding.address) : '*'}:${binding.port} -> ${target}${bindingState}${listeners}`;
      });
    });
    return [
      container.composeProject ?? '-',
      container.composeService ?? '-',
      container.name,
      container.state,
      container.health,
      ports.join(', ') || '-',
    ];
  });
  return [
    formatTable(['PROJECT', 'SERVICE', 'CONTAINER', 'STATE', 'HEALTH', 'PORT MAPPINGS'], rows),
    ...result.limitations.map((item) => `- ${item}`),
  ].join('\n');
}

export function registerDockerCommand(program: Command, dependencies: DockerDependencies = {}): void {
  program
    .command('docker')
    .description('Inspect local Docker containers, health, and port mappings (read-only).')
    .option('--json', 'Print versioned JSON')
    .action((options: { json?: boolean }) => {
      const result = discoverDockerInventory(dependencies);
      process.stdout.write(`${options.json ? JSON.stringify(result) : formatDockerInventory(result)}\n`);
      if (result.error) process.exitCode = 1;
    });
}
