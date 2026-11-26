import { hostname } from 'node:os';
import {
  type AnyDiscoveryObservation,
  buildDiscoveryCorrelations,
  createDiscoverySnapshot,
  type DiscoveryEvidence,
  type DiscoveryObservation,
  type DiscoveryProviderResult,
  type DiscoveryScope,
  type DiscoverySnapshot,
  deduplicateDiscoveryObservations,
  type PortNumber,
} from '@portcn/core';

function stableObservations(observations: AnyDiscoveryObservation[]): DiscoveryObservation[] {
  return observations.filter(
    (item): item is DiscoveryObservation => item.identity !== null && item.identityStatus === 'stable',
  );
}

import { readCurrentNamespace } from './diagnose.js';
import { type DockerContainer, type DockerInventory, discoverDockerInventory } from './docker.js';
import { discoverListeningPorts, type ListeningPort } from './list.js';
import { discoverNginxInventory, type NginxInventory } from './nginx.js';
import { discoverPodmanInventory, type PodmanInventory } from './podman.js';
import { readProcessStartTime } from './project-context.js';
import { discoverSystemdInventory, type SystemdInventory } from './systemd.js';

const EVIDENCE_TTL_MS = 10_000;

export interface DiscoveryCoordinatorDependencies {
  platform?: NodeJS.Platform;
  listeners?: () => ListeningPort[];
  docker?: (listeners: ListeningPort[]) => DockerInventory;
  podman?: (listeners: ListeningPort[]) => PodmanInventory;
  nginx?: (listeners: ListeningPort[]) => NginxInventory;
  systemd?: (listeners: ListeningPort[]) => SystemdInventory;
  now?: () => Date;
  hostId?: string;
  scope?: DiscoveryScope;
}

function defaultScope(hostId: string): DiscoveryScope {
  return {
    hostId,
    pidNamespace: readCurrentNamespace('pid'),
    networkNamespace: readCurrentNamespace('net'),
    mountNamespace: null,
    daemonContext: null,
  };
}

function observationTime(now: Date): { observedAt: string; validUntil: string } {
  const observedAt = now.toISOString();
  return { observedAt, validUntil: new Date(now.getTime() + EVIDENCE_TTL_MS).toISOString() };
}

function evidence(
  id: string,
  provider: DiscoveryEvidence['provider'],
  method: string,
  sourceRef: string,
  claim: string,
  provenance: DiscoveryEvidence['provenance'],
  confidence: DiscoveryEvidence['confidence'],
  scope: DiscoveryScope,
  times: { observedAt: string; validUntil: string },
  limitations: string[] = [],
): DiscoveryEvidence {
  return {
    id,
    provider,
    method,
    sourceRef,
    claim,
    provenance,
    confidence,
    observedAt: times.observedAt,
    validUntil: times.validUntil,
    scope,
    limitations,
  };
}

function nativeProvider(
  listeners: ListeningPort[],
  scope: DiscoveryScope,
  times: { observedAt: string; validUntil: string },
): DiscoveryProviderResult {
  const observations: DiscoveryObservation[] = [];
  for (const listener of listeners) {
    const owners = listener.owners ?? (listener.pid ? [{ pid: listener.pid, processName: listener.processName }] : []);
    const listenerEvidence = [
      evidence(
        `native-sockets:listener:${listener.protocol}:${listener.address}:${listener.port}`,
        'native-sockets',
        'ss --listening',
        `socket:${listener.protocol}:${listener.address}:${listener.port}`,
        'listener-observed',
        'direct',
        'high',
        scope,
        times,
      ),
      ...owners.map((owner) =>
        evidence(
          `native-sockets:owner:${owner.pid}:${listener.protocol}:${listener.port}`,
          'native-sockets',
          'ss --listening --processes',
          `owner:pid:${owner.pid}`,
          'listener-owner',
          'direct',
          owner.pid ? 'high' : 'unknown',
          scope,
          times,
        ),
      ),
    ];
    observations.push({
      identity: {
        kind: 'native-listener',
        hostId: scope.hostId ?? 'unknown-host',
        networkNamespace: scope.networkNamespace ?? 'unknown-net',
        protocol: listener.protocol,
        bindAddress: listener.address,
        port: listener.port as PortNumber,
      },
      identityStatus: 'stable',
      state: listener.state.toLowerCase().includes('listen') ? 'running' : 'unknown',
      displayName: listener.processName,
      observedAt: times.observedAt,
      evidence: listenerEvidence,
    });
    for (const owner of owners) {
      if (!owner.pid) continue;
      const startTime = readProcessStartTime(owner.pid);
      if (!startTime) continue;
      observations.push({
        identity: {
          kind: 'process',
          hostId: scope.hostId ?? 'unknown-host',
          pidNamespace: scope.pidNamespace ?? 'unknown-pid',
          pid: owner.pid,
          startTime: `ticks:${startTime}`,
        },
        identityStatus: 'stable',
        state: 'running',
        displayName: owner.processName,
        observedAt: times.observedAt,
        evidence: [
          evidence(
            `native-sockets:process:${owner.pid}:${startTime}`,
            'native-sockets',
            'stat /proc/pid',
            `pid:${owner.pid}`,
            'process-lifetime',
            'direct',
            'high',
            scope,
            times,
          ),
        ],
      });
    }
  }
  return {
    providerId: 'native-local',
    provider: 'native-sockets',
    status: 'complete',
    scope,
    startedAt: times.observedAt,
    finishedAt: times.observedAt,
    observations: stableObservations(deduplicateDiscoveryObservations(observations)),
    issues: [],
    limitations: [],
  };
}

function dockerObservations(
  runtime: 'docker' | 'podman',
  inventory: DockerInventory,
  scope: DiscoveryScope,
  times: { observedAt: string; validUntil: string },
): DiscoveryObservation[] {
  if (!inventory.containers.length) return [];
  const daemonContext = 'default';
  const daemonHostId = scope.hostId ?? 'unknown-host';
  const networkNamespace = scope.networkNamespace ?? 'unknown-net';
  const observations: DiscoveryObservation[] = [];
  for (const container of inventory.containers) {
    observations.push({
      identity: {
        kind: 'container',
        runtime,
        daemonContext,
        daemonHostId,
        containerId: container.id,
      },
      identityStatus: 'stable',
      state: container.state === 'running' ? 'running' : 'stopped',
      displayName: container.name,
      observedAt: times.observedAt,
      evidence: [
        evidence(
          `${runtime}:container:${container.id}`,
          runtime,
          `${runtime} container inspect`,
          `container:${container.id}`,
          'container-inventory',
          'direct',
          'high',
          { ...scope, daemonContext },
          times,
        ),
      ],
    });
    for (const port of container.ports) {
      observations.push({
        identity: {
          kind: 'container-port',
          runtime,
          daemonContext,
          daemonHostId,
          containerId: container.id,
          protocol: port.protocol === 'sctp' ? 'tcp' : port.protocol,
          containerPort: port.containerPort as PortNumber,
        },
        identityStatus: 'stable',
        state: port.exposure === 'published' ? 'running' : 'configured',
        displayName: `${container.name}:${port.containerPort}`,
        observedAt: times.observedAt,
        evidence: [
          evidence(
            `${runtime}:container-port:${container.id}:${port.containerPort}:${port.protocol}`,
            runtime,
            `${runtime} container inspect NetworkSettings.Ports`,
            `container-port:${port.containerPort}/${port.protocol}`,
            'container-port',
            'direct',
            'high',
            { ...scope, daemonContext },
            times,
          ),
        ],
      });
      for (const binding of port.hostBindings) {
        if (binding.port === null) continue;
        observations.push({
          identity: {
            kind: 'published-binding',
            runtime,
            daemonContext,
            daemonHostId,
            containerId: container.id,
            hostNetworkNamespace: networkNamespace,
            protocol: port.protocol === 'sctp' ? 'tcp' : port.protocol,
            containerPort: port.containerPort as PortNumber,
            hostAddress: binding.address || '0.0.0.0',
            hostPort: binding.port as PortNumber,
          },
          identityStatus: 'stable',
          state: binding.bindingState === 'active' ? 'running' : 'configured',
          displayName: `${binding.address || '*'}:${binding.port}`,
          observedAt: times.observedAt,
          evidence: [
            evidence(
              `${runtime}:binding:${container.id}:${binding.address}:${binding.port}:${port.containerPort}`,
              runtime,
              `${runtime} container inspect PortBindings`,
              `binding:${port.protocol}:${binding.address}:${binding.port}->${port.containerPort}`,
              'published-binding',
              binding.listenerStatus === 'observed' ? 'derived' : 'configured',
              binding.listenerStatus === 'observed' ? 'high' : 'medium',
              { ...scope, daemonContext, networkNamespace },
              times,
            ),
          ],
        });
      }
    }
  }
  return stableObservations(deduplicateDiscoveryObservations(observations));
}

function runtimeContainerObservations(
  runtime: 'docker' | 'podman',
  inventory: DockerInventory | PodmanInventory,
  scope: DiscoveryScope,
  times: { observedAt: string; validUntil: string },
): DiscoveryObservation[] {
  return dockerObservations(runtime, inventory as DockerInventory, scope, times);
}

function providerFromInventory(
  providerId: string,
  provider: DiscoveryEvidence['provider'],
  inventory: { availability: string; limitations: string[]; containers?: DockerContainer[] },
  observations: DiscoveryObservation[],
  scope: DiscoveryScope,
  times: { observedAt: string; validUntil: string },
): DiscoveryProviderResult {
  const status =
    inventory.availability === 'available'
      ? 'complete'
      : inventory.availability === 'partial'
        ? 'partial'
        : inventory.availability === 'permission-denied'
          ? 'permission-denied'
          : inventory.availability === 'not-installed' || inventory.availability === 'daemon-unavailable'
            ? 'unavailable'
            : 'failed';
  return {
    providerId,
    provider,
    status,
    scope,
    startedAt: times.observedAt,
    finishedAt: times.observedAt,
    observations,
    issues: [],
    limitations: inventory.limitations,
  };
}

function nginxObservations(
  inventory: NginxInventory,
  scope: DiscoveryScope,
  times: { observedAt: string; validUntil: string },
): DiscoveryObservation[] {
  const observations: DiscoveryObservation[] = [];
  const hostId = scope.hostId ?? 'unknown-host';
  const mountNamespace = scope.mountNamespace ?? 'unknown-mnt';
  for (const [index, server] of inventory.servers.entries()) {
    const localId = `server:${server.source}:${index}`;
    const evidenceItems = server.listeners.flatMap((listener) => [
      evidence(
        `nginx:${localId}:${listener.address}:${listener.port}`,
        'nginx',
        'nginx configuration parse',
        `configured:${'tcp'}:${listener.address}:${listener.port}`,
        listener.state === 'observed' ? 'configured-listener-observed' : 'configured-listener',
        'configured',
        listener.state === 'observed' ? 'medium' : 'low',
        scope,
        times,
      ),
    ]);
    observations.push({
      identity: { kind: 'system-service', provider: 'nginx', hostId, mountNamespace, localId },
      identityStatus: 'stable',
      state: 'configured',
      displayName: server.serverNames.join(', ') || 'nginx server',
      observedAt: times.observedAt,
      evidence: evidenceItems.length
        ? evidenceItems
        : [
            evidence(
              `nginx:${localId}:config`,
              'nginx',
              'nginx configuration parse',
              `config:${server.source}`,
              'configured-service',
              'configured',
              'low',
              scope,
              times,
            ),
          ],
    });
  }
  return stableObservations(deduplicateDiscoveryObservations(observations));
}

function systemdObservations(
  inventory: SystemdInventory,
  scope: DiscoveryScope,
  times: { observedAt: string; validUntil: string },
): DiscoveryObservation[] {
  const observations: DiscoveryObservation[] = [];
  const hostId = scope.hostId ?? 'unknown-host';
  const mountNamespace = scope.mountNamespace ?? 'unknown-mnt';
  for (const unit of inventory.units) {
    const localId = `${unit.scope}:${unit.name}`;
    const evidenceItems = [
      evidence(
        `systemd:${localId}:state`,
        'systemd',
        'systemctl show',
        `unit:${unit.name}`,
        'configured-service',
        'configured',
        'medium',
        scope,
        times,
      ),
      ...(unit.mainPid
        ? [
            evidence(
              `systemd:${localId}:mainpid`,
              'systemd',
              'systemctl show MainPID',
              `mainpid:${unit.mainPid}`,
              'manager-mainpid',
              'direct',
              'medium',
              scope,
              times,
            ),
          ]
        : []),
      ...unit.configuredSockets.map((socket, socketIndex) =>
        evidence(
          `systemd:${localId}:socket:${socketIndex}`,
          'systemd',
          'systemctl show Listen',
          `configured:tcp:${socket.address ?? '*'}:${socket.port ?? 0}`,
          socket.observed ? 'configured-listener-observed' : 'configured-listener',
          'configured',
          socket.observed ? 'medium' : 'low',
          scope,
          times,
        ),
      ),
    ];
    observations.push({
      identity: { kind: 'system-service', provider: 'systemd', hostId, mountNamespace, localId },
      identityStatus: 'stable',
      state: unit.active === 'active' ? 'running' : 'configured',
      displayName: unit.name,
      observedAt: times.observedAt,
      evidence: evidenceItems,
    });
    if (unit.mainPid) {
      const startTime = readProcessStartTime(unit.mainPid);
      if (startTime) {
        observations.push({
          identity: {
            kind: 'process',
            hostId,
            pidNamespace: scope.pidNamespace ?? 'unknown-pid',
            pid: unit.mainPid,
            startTime: `ticks:${startTime}`,
          },
          identityStatus: 'stable',
          state: 'running',
          displayName: unit.name,
          observedAt: times.observedAt,
          evidence: [
            evidence(
              `systemd:process:${unit.mainPid}:${startTime}`,
              'systemd',
              'systemctl MainPID + stat',
              `pid:${unit.mainPid}`,
              'process-lifetime',
              'derived',
              'medium',
              scope,
              times,
            ),
          ],
        });
      }
    }
  }
  return stableObservations(deduplicateDiscoveryObservations(observations));
}

export function collectLinuxDiscoverySnapshot(dependencies: DiscoveryCoordinatorDependencies = {}): DiscoverySnapshot {
  if ((dependencies.platform ?? process.platform) !== 'linux')
    throw new Error('Unified discovery snapshot collection is available only on Linux.');
  const now = dependencies.now?.() ?? new Date();
  const times = observationTime(now);
  const hostId = dependencies.hostId ?? hostname();
  const scope = dependencies.scope ?? defaultScope(hostId);
  const listeners = (dependencies.listeners ?? discoverListeningPorts)();
  const providers: DiscoveryProviderResult[] = [nativeProvider(listeners, scope, times)];
  const docker = (dependencies.docker ?? ((ports) => discoverDockerInventory({ discoverListeners: () => ports })))(
    listeners,
  );
  providers.push(
    providerFromInventory(
      'docker-local',
      'docker',
      docker,
      runtimeContainerObservations('docker', docker, scope, times),
      scope,
      times,
    ),
  );
  const podman = (dependencies.podman ?? ((ports) => discoverPodmanInventory({ discoverListeners: () => ports })))(
    listeners,
  );
  providers.push(
    providerFromInventory(
      'podman-local',
      'podman',
      podman,
      runtimeContainerObservations('podman', podman, scope, times),
      scope,
      times,
    ),
  );
  const nginx = (dependencies.nginx ?? ((ports) => discoverNginxInventory({ listeners: () => ports })))(listeners);
  providers.push(
    providerFromInventory(
      'nginx-local',
      'nginx',
      { availability: nginx.availability, limitations: nginx.limitations, containers: [] },
      nginxObservations(nginx, scope, times),
      scope,
      times,
    ),
  );
  const systemd = (dependencies.systemd ?? ((ports) => discoverSystemdInventory({ listeners: () => ports })))(
    listeners,
  );
  providers.push(
    providerFromInventory(
      'systemd-local',
      'systemd',
      { availability: systemd.availability, limitations: systemd.limitations, containers: [] },
      systemdObservations(systemd, scope, times),
      scope,
      times,
    ),
  );
  const observations = providers.flatMap((provider) => provider.observations);
  const correlations = buildDiscoveryCorrelations(observations, times.observedAt);
  return createDiscoverySnapshot(providers, correlations, times.observedAt);
}
