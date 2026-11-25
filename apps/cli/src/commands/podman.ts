import { execFileSync } from 'node:child_process';
import type { Command } from 'commander';
import { formatEmpty } from '../terminal.js';
import {
  type DockerAvailability,
  type DockerContainer,
  type DockerInventory,
  formatDockerInventory,
  parseDockerInspect,
} from './docker.js';
import type { ListeningPort } from './list.js';
import { discoverListeningPorts } from './list.js';

export type PodmanAvailability = DockerAvailability;
export interface PodmanInventory extends Omit<DockerInventory, 'containers' | 'limitations'> {
  containers: DockerContainer[];
  limitations: string[];
}
export interface PodmanDependencies {
  runPodman?: (args: string[]) => string;
  discoverListeners?: () => ListeningPort[];
}

const LIMITATIONS = [
  'Podman inventory uses the Podman CLI, current user, and configured connection; rootless and rootful containers are visible only to the selected user/context.',
  'Published mappings are Podman configuration. Matching host listeners are point-in-time observations from Portcn’s current network namespace.',
  'A remote Podman connection can describe another host; local listeners are not evidence about that remote host.',
  'Exposed container ports are metadata and do not mean a port is published or listening. Stopped-container mappings remain configured, not active.',
  'Portcn does not elevate privileges, enter container namespaces, or change container state.',
];

function parsePodmanInspect(input: string, listeners: ListeningPort[] | null): DockerContainer[] {
  const decoded: unknown = JSON.parse(input);
  if (!Array.isArray(decoded)) throw new Error('Podman inspect returned an unexpected response.');
  const containers = parseDockerInspect(input, listeners);
  const labelsById = new Map<string, Record<string, string>>();
  for (const value of decoded) {
    if (!value || typeof value !== 'object') throw new Error('Podman inspect returned an invalid container.');
    const inspect = value as { Id?: string; Config?: { Labels?: Record<string, string> | null } };
    labelsById.set(inspect.Id ?? '', inspect.Config?.Labels ?? {});
  }
  return containers.map((container) => {
    const labels = labelsById.get(container.id) ?? {};
    return {
      ...container,
      composeProject: labels['io.podman.compose.project'] || labels['com.docker.compose.project'] || null,
      composeService: labels['io.podman.compose.service'] || labels['com.docker.compose.service'] || null,
    };
  });
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
      containers: parsePodmanInspect(runPodman(['container', 'inspect', ...ids]), listeners),
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
