import type { DockerInventory } from './docker.js';
import { discoverDockerInventory } from './docker.js';
import type { ListeningPort } from './list.js';
import { discoverListeningPorts } from './list.js';
import type { NginxInventory } from './nginx.js';
import { discoverNginxInventory } from './nginx.js';
import type { PodmanInventory } from './podman.js';
import { discoverPodmanInventory } from './podman.js';
import type { SystemdInventory } from './systemd.js';
import { discoverSystemdInventory } from './systemd.js';

export interface DashboardServiceRecord {
  identity: string;
  source: 'native' | 'docker' | 'podman' | 'nginx' | 'systemd';
  name: string;
  status: string;
  endpoint: string;
  owner: string;
  project: string;
  evidence: string[];
}
export interface ServiceDashboardDependencies {
  listeners?: () => ListeningPort[];
  docker?: (listeners: ListeningPort[]) => DockerInventory;
  podman?: (listeners: ListeningPort[]) => PodmanInventory;
  nginx?: (listeners: ListeningPort[]) => NginxInventory;
  systemd?: (listeners: ListeningPort[]) => SystemdInventory;
}

function containerRecords(
  source: 'docker' | 'podman',
  inventory: ReturnType<typeof discoverDockerInventory> | ReturnType<typeof discoverPodmanInventory>,
): DashboardServiceRecord[] {
  const result: DashboardServiceRecord[] = inventory.containers.map((container) => {
    const bindings = container.ports.flatMap((port) =>
      port.hostBindings.map(
        (binding) =>
          `${binding.address || '*'}:${binding.port ?? '-'} -> ${port.containerPort}/${port.protocol} (${binding.bindingState}, ${binding.listenerStatus})`,
      ),
    );
    return {
      identity: `${source}:${container.id}`,
      source,
      name: container.composeService ? `${container.name} (${container.composeService})` : container.name,
      status: container.state,
      endpoint:
        bindings.join(', ') ||
        container.networkAddresses.map(({ address }) => address).join(', ') ||
        'no published endpoint',
      owner: 'runtime metadata',
      project: container.composeProject ?? 'unavailable',
      evidence: [container.image, `network: ${container.networkMode}`, ...bindings],
    };
  });
  if (!result.length)
    result.push({
      identity: `${source}:provider`,
      source,
      name: source === 'docker' ? 'Docker provider' : 'Podman provider',
      status: inventory.error?.code ?? inventory.availability,
      endpoint: 'unavailable',
      owner: 'unavailable',
      project: 'unavailable',
      evidence: [inventory.error?.message ?? 'No containers were returned by this provider.'],
    });
  return result;
}

export function discoverDashboardServices(dependencies: ServiceDashboardDependencies = {}): DashboardServiceRecord[] {
  const visibleListeners = (dependencies.listeners ?? discoverListeningPorts)();
  const records: DashboardServiceRecord[] = visibleListeners.map((listener) => ({
    identity: `native:${listener.protocol}:${listener.address}:${listener.port}:${listener.owners?.map(({ pid }) => pid).join(',') ?? listener.pid ?? 'unknown'}`,
    source: 'native',
    name: listener.processName ?? 'unknown process',
    status: listener.state,
    endpoint: `${listener.address}:${listener.port}/${listener.protocol}`,
    owner: listener.pid === null ? 'unavailable' : `pid ${listener.pid}`,
    project: 'select listener for project details',
    evidence: [
      `Native listener observed in the current network namespace.`,
      ...(listener.owners ?? []).map(({ pid, processName }) => `owner ${processName} pid ${pid}`),
    ],
  }));
  try {
    records.push(
      ...containerRecords(
        'docker',
        (dependencies.docker ?? ((ports) => discoverDockerInventory({ discoverListeners: () => ports })))(
          visibleListeners,
        ),
      ),
    );
  } catch (error) {
    records.push({
      identity: 'docker:provider',
      source: 'docker',
      name: 'Docker provider',
      status: 'failed',
      endpoint: 'unavailable',
      owner: 'unavailable',
      project: 'unavailable',
      evidence: [error instanceof Error ? error.message : 'Docker discovery failed.'],
    });
  }
  try {
    records.push(
      ...containerRecords(
        'podman',
        (dependencies.podman ?? ((ports) => discoverPodmanInventory({ discoverListeners: () => ports })))(
          visibleListeners,
        ),
      ),
    );
  } catch (error) {
    records.push({
      identity: 'podman:provider',
      source: 'podman',
      name: 'Podman provider',
      status: 'failed',
      endpoint: 'unavailable',
      owner: 'unavailable',
      project: 'unavailable',
      evidence: [error instanceof Error ? error.message : 'Podman discovery failed.'],
    });
  }
  try {
    const nginx = (dependencies.nginx ?? ((ports) => discoverNginxInventory({ listeners: () => ports })))(
      visibleListeners,
    );
    for (const [index, server] of nginx.servers.entries()) {
      records.push({
        identity: `nginx:${server.source}:${index}`,
        source: 'nginx',
        name: server.serverNames.join(', ') || 'unnamed server',
        status: server.listeners.map(({ state }) => state).join(', ') || nginx.availability,
        endpoint:
          server.listeners.map(({ address, port }) => `${address}:${port}/tcp`).join(', ') || 'no listen directive',
        owner: nginx.processes.map(({ pid }) => `pid ${pid}`).join(', ') || 'process unavailable',
        project: 'unavailable',
        evidence: [
          `config: ${server.source}`,
          ...server.listeners.map(({ address, port, state }) => `configured ${address}:${port}; listener ${state}`),
        ],
      });
    }
    if (nginx.servers.length && nginx.availability !== 'available')
      records.push({
        identity: 'nginx:provider-status',
        source: 'nginx',
        name: 'Nginx provider status',
        status: nginx.availability,
        endpoint: 'partial configuration view',
        owner: 'unavailable',
        project: 'unavailable',
        evidence: nginx.limitations,
      });
    if (!nginx.servers.length)
      records.push({
        identity: 'nginx:provider',
        source: 'nginx',
        name: 'Nginx provider',
        status: nginx.availability,
        endpoint: 'no readable server blocks',
        owner: nginx.processes.map(({ pid }) => `pid ${pid}`).join(', ') || 'unavailable',
        project: 'unavailable',
        evidence: nginx.limitations,
      });
  } catch (error) {
    records.push({
      identity: 'nginx:provider',
      source: 'nginx',
      name: 'Nginx provider',
      status: 'failed',
      endpoint: 'unavailable',
      owner: 'unavailable',
      project: 'unavailable',
      evidence: [error instanceof Error ? error.message : 'Nginx discovery failed.'],
    });
  }
  try {
    const systemd = (dependencies.systemd ?? ((ports) => discoverSystemdInventory({ listeners: () => ports })))(
      visibleListeners,
    );
    for (const unit of systemd.units) {
      const endpoints = [
        ...unit.processListenerPorts.map((port) => `observed :${port}/tcp`),
        ...unit.configuredSockets.map(
          ({ address, port, observed }) =>
            `${address ?? '*'}:${port ?? '?'} ${observed === null ? 'configured' : observed ? 'observed' : 'not observed'}`,
        ),
      ];
      records.push({
        identity: `systemd:${unit.scope}:${unit.name}`,
        source: 'systemd',
        name: unit.name,
        status: `${unit.active}/${unit.sub}`,
        endpoint: endpoints.join(', ') || 'no endpoint metadata',
        owner: unit.mainPid ? `pid ${unit.mainPid}` : 'no MainPID',
        project: unit.scope,
        evidence: [`${unit.scope} manager; load ${unit.load}`, ...endpoints],
      });
    }
    if (systemd.units.length && systemd.availability !== 'available')
      records.push({
        identity: 'systemd:provider-status',
        source: 'systemd',
        name: 'systemd provider status',
        status: systemd.availability,
        endpoint: 'partial manager view',
        owner: 'unavailable',
        project: 'unavailable',
        evidence: [
          `user manager: ${systemd.managers.user.status}`,
          `system manager: ${systemd.managers.system.status}`,
          ...systemd.limitations,
        ],
      });
    if (!systemd.units.length)
      records.push({
        identity: 'systemd:provider',
        source: 'systemd',
        name: 'systemd provider',
        status: systemd.availability,
        endpoint: 'no visible units',
        owner: 'unavailable',
        project: 'unavailable',
        evidence: [
          `user manager: ${systemd.managers.user.status}`,
          `system manager: ${systemd.managers.system.status}`,
          ...systemd.limitations,
        ],
      });
  } catch (error) {
    records.push({
      identity: 'systemd:provider',
      source: 'systemd',
      name: 'systemd provider',
      status: 'failed',
      endpoint: 'unavailable',
      owner: 'unavailable',
      project: 'unavailable',
      evidence: [error instanceof Error ? error.message : 'systemd discovery failed.'],
    });
  }
  return records;
}

export function searchDashboardServices(records: DashboardServiceRecord[], query: string): DashboardServiceRecord[] {
  const normalized = query.trim().toLowerCase();
  return normalized
    ? records.filter((record) =>
        [record.source, record.name, record.status, record.endpoint, record.owner, record.project, ...record.evidence]
          .join(' ')
          .toLowerCase()
          .includes(normalized),
      )
    : records;
}

export function sortDashboardServices(
  records: DashboardServiceRecord[],
  sort: 'port' | 'protocol' | 'process',
): DashboardServiceRecord[] {
  return [...records].sort((left, right) =>
    sort === 'protocol'
      ? left.source.localeCompare(right.source) || left.name.localeCompare(right.name)
      : sort === 'process'
        ? left.name.localeCompare(right.name) || left.source.localeCompare(right.source)
        : left.source.localeCompare(right.source) || left.name.localeCompare(right.name),
  );
}
