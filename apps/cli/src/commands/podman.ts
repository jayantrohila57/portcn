import { execFileSync } from 'node:child_process';
import type { Command } from 'commander';
import { formatEmpty } from '../terminal.js';
import {
  type DockerAvailability,
  type DockerContainer,
  type DockerInventory,
  formatDockerInventory,
  listenerMatchesBinding,
  parseDockerInspect,
} from './docker.js';
import type { ListeningPort } from './list.js';
import { discoverListeningPorts } from './list.js';
import { inspectRootlessportProcess, type RootlessPortDependencies } from './rootlessport.js';

export type PodmanAvailability = DockerAvailability;
export interface PodmanInventory extends Omit<DockerInventory, 'containers' | 'limitations'> {
  containers: PodmanContainer[];
  limitations: string[];
}
export interface PodmanDependencies {
  runPodman?: (args: string[]) => string;
  discoverListeners?: () => ListeningPort[];
  rootlessport?: RootlessPortDependencies;
}

export interface RootlessportAttribution {
  status: 'attributed' | 'ambiguous' | 'unknown';
  processIdentity: { pid: number; startTime: string } | null;
  evidence: string[];
}
export type PodmanContainer = Omit<DockerContainer, 'ports'> & {
  ports: Array<
    Omit<DockerContainer['ports'][number], 'hostBindings'> & {
      hostBindings: Array<
        DockerContainer['ports'][number]['hostBindings'][number] & {
          rootlessForwarder: RootlessportAttribution;
        }
      >;
    }
  >;
};

const LIMITATIONS = [
  'Podman inventory uses the Podman CLI, current user, and configured connection; rootless and rootful containers are visible only to the selected user/context.',
  'Published mappings are Podman configuration. Matching host listeners are point-in-time observations from Portcn’s current network namespace.',
  'A remote Podman connection can describe another host; local listeners are not evidence about that remote host.',
  'Exposed container ports are metadata and do not mean a port is published or listening. Stopped-container mappings remain configured, not active.',
  'Portcn does not elevate privileges, enter container namespaces, or change container state.',
];

function parsePodmanInspect(
  input: string,
  listeners: ListeningPort[] | null,
  dependencies?: RootlessPortDependencies,
): PodmanContainer[] {
  const decoded: unknown = JSON.parse(input);
  if (!Array.isArray(decoded)) throw new Error('Podman inspect returned an unexpected response.');
  const containers = parseDockerInspect(input, listeners);
  const labelsById = new Map<string, Record<string, string>>();
  for (const value of decoded) {
    if (!value || typeof value !== 'object') throw new Error('Podman inspect returned an invalid container.');
    const inspect = value as { Id?: string; Config?: { Labels?: Record<string, string> | null } };
    labelsById.set(inspect.Id ?? '', inspect.Config?.Labels ?? {});
  }
  return containers
    .map((container) => {
      const labels = labelsById.get(container.id) ?? {};
      return {
        ...container,
        composeProject: labels['io.podman.compose.project'] || labels['com.docker.compose.project'] || null,
        composeService: labels['io.podman.compose.service'] || labels['com.docker.compose.service'] || null,
      };
    })
    .map((container) => ({
      ...container,
      ports: container.ports.map((port) => ({
        ...port,
        hostBindings: port.hostBindings.map((binding) => {
          const unknown = (evidence: string): RootlessportAttribution => ({
            status: 'unknown',
            processIdentity: null,
            evidence: [evidence],
          });
          let rootlessForwarder = unknown('Rootlessport forwarding could not be verified from visible local evidence.');
          if (binding.bindingState !== 'active' || binding.exposure !== 'published') {
            rootlessForwarder = unknown('Configured or inactive mappings are not attributed to a forwarding process.');
          } else if (!listeners) {
            rootlessForwarder = unknown('Host listener discovery is unavailable in the current namespace.');
          } else if (!binding.port || !container.networkAddresses.length) {
            rootlessForwarder = unknown('The published host port or container network address is unavailable.');
          } else {
            const candidates = listeners.filter(
              (listener) =>
                listener.protocol === port.protocol &&
                listener.port === binding.port &&
                listenerMatchesBinding(binding.address, listener.address),
            );
            const visibleOwnerCount = new Set(
              candidates.flatMap(
                (listener) => listener.owners?.map(({ pid }) => pid) ?? (listener.pid === null ? [] : [listener.pid]),
              ),
            ).size;
            const matches: Array<{ pid: number; startTime: string }> = [];
            let ambiguous = false;
            for (const listener of candidates) {
              const owners = listener.owners?.map(({ pid }) => pid) ?? (listener.pid === null ? [] : [listener.pid]);
              for (const pid of new Set(owners)) {
                const inspected = inspectRootlessportProcess(pid, dependencies);
                if (inspected.status === 'ambiguous') ambiguous = true;
                if (inspected.status !== 'available' || !inspected.startTime) continue;
                if (
                  !inspected.forwards.some(
                    (forward) =>
                      forward.protocol === port.protocol &&
                      forward.hostPort === binding.port &&
                      listenerMatchesBinding(binding.address, forward.hostAddress) &&
                      forward.containerPort === port.containerPort &&
                      container.networkAddresses.some(({ address }) => address === forward.containerAddress),
                  )
                )
                  continue;
                if (inspectRootlessportProcess(pid, dependencies).startTime !== inspected.startTime) continue;
                matches.push({ pid, startTime: inspected.startTime });
              }
            }
            const unique = [...new Map(matches.map((match) => [`${match.pid}:${match.startTime}`, match])).values()];
            const onlyMatch = unique[0];
            if (onlyMatch && !ambiguous && visibleOwnerCount === 1) {
              rootlessForwarder = {
                status: 'attributed',
                processIdentity: onlyMatch,
                evidence: [
                  'Listener protocol, host binding, verified rootlessport arguments, container IP and port, and stable PID lifetime matched.',
                ],
              };
            } else if (unique.length > 1 || ambiguous || (unique.length === 1 && visibleOwnerCount > 1)) {
              rootlessForwarder = {
                status: 'ambiguous',
                processIdentity: null,
                evidence: ['Multiple or conflicting visible rootlessport forwarding candidates were found.'],
              };
            } else rootlessForwarder = unknown('No visible rootlessport process provided a complete matching mapping.');
          }
          return { ...binding, rootlessForwarder };
        }),
      })),
    }));
}

function availabilityFromError(error: unknown): { availability: PodmanAvailability; code: string; message: string } {
  const failure = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
  const detail = `${failure.message ?? ''} ${String(failure.stderr ?? '')}`;
  if (failure.code === 'ENOENT')
    return {
      availability: 'not-installed',
      code: 'PODMAN_NOT_INSTALLED',
      message: 'Podman CLI was not found. Install Podman and ensure podman is on PATH.',
    };
  if (failure.code === 'EACCES' || failure.code === 'EPERM' || /permission denied|access is denied/i.test(detail))
    return {
      availability: 'permission-denied',
      code: 'PODMAN_PERMISSION_DENIED',
      message:
        'Podman access was denied. Check the current user and selected connection; Portcn will not elevate privileges.',
    };
  if (
    /cannot connect|connection refused|no such file or directory.*podman|service is not available|socket.*(unavailable|not found)/i.test(
      detail,
    )
  )
    return {
      availability: 'daemon-unavailable',
      code: 'PODMAN_SERVICE_UNAVAILABLE',
      message: 'Podman is installed, but the selected Podman service or connection is unavailable.',
    };
  if (failure.code === 'ETIMEDOUT')
    return {
      availability: 'daemon-unavailable',
      code: 'PODMAN_SERVICE_UNAVAILABLE',
      message: 'Podman did not respond before the inventory timeout.',
    };
  return {
    availability: 'discovery-failed',
    code: 'PODMAN_DISCOVERY_FAILED',
    message: 'Podman inventory failed. Check the Podman CLI and selected connection.',
  };
}

function errorInventory(error: unknown): PodmanInventory {
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

export function discoverPodmanInventory(dependencies: PodmanDependencies = {}): PodmanInventory {
  const runPodman =
    dependencies.runPodman ??
    ((args) => execFileSync('podman', args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 32 * 1024 * 1024 }));
  const discoverListeners = dependencies.discoverListeners ?? discoverListeningPorts;
  let ids: string[];
  try {
    ids = runPodman(['container', 'ls', '--all', '--quiet', '--no-trunc'])
      .split(/\r?\n/)
      .map((id) => id.trim())
      .filter(Boolean);
    if (ids.some((id) => !/^[\da-f]{12,64}$/i.test(id)))
      throw new Error('Podman container list returned an invalid ID.');
  } catch (error) {
    return errorInventory(error);
  }
  let listeners: ListeningPort[] | null;
  try {
    listeners = discoverListeners();
  } catch {
    listeners = null;
  }
  if (ids.length === 0)
    return {
      schemaVersion: 1,
      availability: 'available',
      containers: [],
      hostListenerDiscovery: listeners ? 'available' : 'unavailable',
      limitations: LIMITATIONS,
    };
  try {
    return {
      schemaVersion: 1,
      availability: 'available',
      containers: parsePodmanInspect(runPodman(['container', 'inspect', ...ids]), listeners, dependencies.rootlessport),
      hostListenerDiscovery: listeners ? 'available' : 'unavailable',
      limitations: LIMITATIONS,
    };
  } catch (error) {
    return errorInventory(error);
  }
}

export function formatPodmanInventory(result: PodmanInventory): string {
  if (result.error) return `Podman ${result.availability}: ${result.error.message}`;
  if (!result.containers.length) return formatEmpty('No Podman containers found.');
  return [formatDockerInventory({ ...result, limitations: [] }), ...result.limitations.map((item) => `- ${item}`)].join(
    '\n',
  );
}

export type PodmanDaemonHostProvenance = 'local-proven' | 'remote-endpoint' | 'unresolved';

/** Resolve daemon host identity from the default connection URI; never treat the connection name as host proof. */
export function resolvePodmanDaemonHostId(
  localHostId: string,
  dependencies: PodmanDependencies = {},
): { daemonHostId: string; provenance: PodmanDaemonHostProvenance } {
  const runPodman =
    dependencies.runPodman ??
    ((args: string[]) => execFileSync('podman', args, { encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024 }));
  try {
    const table = runPodman(['system', 'connection', 'list', '--format', '{{.Name}}\t{{.URI}}\t{{.Default}}'])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const line =
      table.find((row) => row.endsWith('\ttrue') || row.endsWith('\t*'))?.split('\t') ?? table[0]?.split('\t');
    const uri = line?.[1]?.trim() ?? '';
    if (!uri || /^unix:/i.test(uri)) return { daemonHostId: localHostId, provenance: 'local-proven' };
    const ssh = /^ssh:\/\/([^@/]+@)?([^:/]+)/i.exec(uri);
    if (ssh?.[2]) return { daemonHostId: ssh[2].toLowerCase(), provenance: 'remote-endpoint' };
    const tcp = /^tcp:\/\/\[?([^[\]/:]+)/i.exec(uri);
    const host = tcp?.[1]?.toLowerCase() ?? '';
    if (!host) return { daemonHostId: 'unresolved-daemon-host', provenance: 'unresolved' };
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1')
      return { daemonHostId: localHostId, provenance: 'local-proven' };
    return { daemonHostId: host, provenance: 'remote-endpoint' };
  } catch {
    return { daemonHostId: 'unresolved-daemon-host', provenance: 'unresolved' };
  }
}

/** Resolve the default Podman connection name when the CLI is available. */
export function readPodmanConnectionName(dependencies: PodmanDependencies = {}): string | null {
  const runPodman =
    dependencies.runPodman ??
    ((args: string[]) => execFileSync('podman', args, { encoding: 'utf8', timeout: 5_000, maxBuffer: 1024 * 1024 }));
  try {
    const lines = runPodman(['system', 'connection', 'list', '--format', '{{.Name}}\t{{.Default}}'])
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      const [name, isDefault] = line.split('\t');
      if (name && (isDefault === 'true' || isDefault === '*')) return name;
    }
    const first = lines[0]?.split('\t')[0];
    return first?.trim() || null;
  } catch {
    return null;
  }
}

export function registerPodmanCommand(program: Command, dependencies: PodmanDependencies = {}): void {
  program
    .command('podman')
    .description('Inspect containers visible through the current Podman user and connection (read-only).')
    .option('--json', 'Print versioned JSON')
    .action((options: { json?: boolean }) => {
      const result = discoverPodmanInventory(dependencies);
      process.stdout.write(`${options.json ? JSON.stringify(result) : formatPodmanInventory(result)}\n`);
      if (result.error) process.exitCode = 1;
    });
}
