import { isIP } from 'node:net';
import type { Command } from 'commander';
import { formatEmpty, formatTable } from '../terminal.js';
import { type DockerPort, discoverDockerInventory } from './docker.js';
import { discoverListeningPorts, type ListeningPort } from './list.js';

export type BindScope =
  | 'loopback'
  | 'interface-specific'
  | 'all-interfaces'
  | 'direct-routed'
  | 'container-only'
  | 'unknown';
export type AddressFamily = 'IPv4' | 'IPv6' | 'unknown';
export interface ExposureFinding {
  source: 'host-listener' | 'docker-published' | 'docker-direct' | 'docker-configured' | 'docker-exposed';
  project: string | null;
  service: string | null;
  container: string | null;
  containerState: string | null;
  bindingState: 'active' | 'configured' | null;
  protocol: 'tcp' | 'udp' | 'sctp';
  addressFamily: AddressFamily;
  bindAddress: string;
  hostPort: number | null;
  containerPort: number | null;
  scope: BindScope;
  hostListenerStatus: 'observed' | 'not-observed' | 'unknown' | null;
  pid: number | null;
  processName: string | null;
  assessment: string;
}
export interface ExposureReport {
  schemaVersion: 1;
  observedAt: string;
  listenerAvailability: 'available' | 'unavailable';
  dockerAvailability: string;
  dockerError: { code: string; message: string } | null;
  findings: ExposureFinding[];
  limitations: string[];
}

const LIMITATIONS = [
  'A bind address describes where a socket or Docker mapping accepts traffic locally; it does not establish that traffic can reach the service.',
  'Portcn does not inspect firewall rules, router policies, external routes, or internet reachability. Do not treat wildcard scope as proof of public exposure.',
  'Host listeners cover only the network namespace visible to Portcn. A remote Docker context can describe a different daemon host.',
  'Docker host-listener comparisons are point-in-time observations and do not establish ownership or require a docker-proxy process.',
  'Docker documents that localhost-published ports may be reachable by same-L2 peers with Engine versions before 28.0.0; Portcn does not verify the daemon version.',
];

function bareAddress(address: string): string {
  return address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
}

function family(address: string): AddressFamily {
  const version = isIP(bareAddress(address));
  return version === 4 ? 'IPv4' : version === 6 ? 'IPv6' : 'unknown';
}

function isIPv6Loopback(address: string): boolean {
  const plain = bareAddress(address).split('%')[0] ?? '';
  if (isIP(plain) !== 6) return false;
  try {
    return new URL(`http://[${plain}]/`).hostname === '[::1]';
  } catch {
    return false;
  }
}

export function classifyBindScope(address: string): BindScope {
  const plain = bareAddress(address);
  const version = isIP(plain);
  if (version === 4) {
    if (plain === '0.0.0.0') return 'all-interfaces';
    if (Number(plain.split('.')[0]) === 127) return 'loopback';
    return 'interface-specific';
  }
  if (version === 6) {
    const unscoped = plain.split('%')[0] ?? plain;
    if (unscoped === '::') return 'all-interfaces';
    if (isIPv6Loopback(plain)) return 'loopback';
    return 'interface-specific';
  }
  if (plain === '*' || plain === '') return 'all-interfaces';
  return 'unknown';
}

function nativeAssessment(scope: BindScope): string {
  if (scope === 'loopback') return 'Loopback bind; remote reachability was not tested.';
  if (scope === 'all-interfaces')
    return 'Wildcard bind may accept traffic addressed to this host’s interfaces; firewall and reachability are unknown.';
  if (scope === 'interface-specific')
    return 'Bound to a specific interface address; routing and firewall reachability are unknown.';
  return 'Bind scope could not be classified; reachability is unknown.';
}

function dockerAssessment(scope: BindScope, port: DockerPort): string {
  if (scope === 'loopback') return 'Docker publishes on loopback; daemon-version-specific exposure caveats may apply.';
  if (scope === 'all-interfaces')
    return 'Docker publishes on a wildcard address; routing and firewall reachability are unknown.';
  if (scope === 'interface-specific')
    return 'Docker publishes on a specific address; routing and firewall reachability are unknown.';
  if (scope === 'direct-routed')
    return 'Docker reports a direct route without a host port; external routing and firewall reachability are unknown.';
  if (scope === 'container-only')
    return 'Container port metadata only; no host publication is configured, and peer-network reachability is unknown.';
  return `Docker port exposure is ${port.exposure}; network reachability is unknown.`;
}

function nativeFinding(listener: ListeningPort): ExposureFinding {
  const scope = classifyBindScope(listener.address);
  return {
    source: 'host-listener',
    project: null,
    service: null,
    container: null,
    containerState: null,
    bindingState: null,
    protocol: listener.protocol,
    addressFamily: family(listener.address),
    bindAddress: listener.address,
    hostPort: listener.port,
    containerPort: null,
    scope,
    hostListenerStatus: 'observed',
    pid: listener.pid,
    processName: listener.processName,
    assessment: nativeAssessment(scope),
  };
}

function dockerFindings(inventory: ReturnType<typeof discoverDockerInventory>): ExposureFinding[] {
  const findings: ExposureFinding[] = [];
  for (const container of inventory.containers) {
    // Host-network container sockets appear in the host listener snapshot when visible.
    if (container.hostNetwork) continue;
    for (const port of container.ports) {
      if (port.exposure === 'exposed') {
        findings.push({
          source: 'docker-exposed',
          project: container.composeProject,
          service: container.composeService,
          container: container.name,
          containerState: container.state,
          bindingState: null,
          protocol: port.protocol,
          addressFamily: 'unknown',
          bindAddress: 'container network',
          hostPort: null,
          containerPort: port.containerPort,
          scope: 'container-only',
          hostListenerStatus: null,
          pid: null,
          processName: null,
          assessment: dockerAssessment('container-only', port),
        });
        continue;
      }
      for (const binding of port.hostBindings) {
        const scope = binding.exposure === 'direct' ? 'direct-routed' : classifyBindScope(binding.address);
        const assessment =
          binding.bindingState === 'configured'
            ? 'Container mapping is configured but no active host binding was observed.'
            : dockerAssessment(scope, port);
        findings.push({
          source:
            binding.exposure === 'direct'
              ? 'docker-direct'
              : binding.exposure === 'configured'
                ? 'docker-configured'
                : 'docker-published',
          project: container.composeProject,
          service: container.composeService,
          container: container.name,
          containerState: container.state,
          bindingState: binding.bindingState,
          protocol: port.protocol,
          addressFamily: family(binding.address),
          bindAddress: binding.address || 'Docker default',
          hostPort: binding.port,
          containerPort: port.containerPort,
          scope,
          hostListenerStatus: binding.listenerStatus,
          pid: null,
          processName: null,
          assessment,
        });
      }
    }
  }
  return findings;
}

function compareFinding(left: ExposureFinding, right: ExposureFinding): number {
  return (
    (left.project ?? '').localeCompare(right.project ?? '') ||
    (left.service ?? '').localeCompare(right.service ?? '') ||
    left.source.localeCompare(right.source) ||
    (left.hostPort ?? left.containerPort ?? 0) - (right.hostPort ?? right.containerPort ?? 0) ||
    left.protocol.localeCompare(right.protocol) ||
    left.bindAddress.localeCompare(right.bindAddress)
  );
}

export function createExposureReport(
  options: {
    listeners?: ListeningPort[] | null;
    docker?: ReturnType<typeof discoverDockerInventory>;
    observedAt?: Date;
  } = {},
): ExposureReport {
  let listeners = options.listeners;
  if (listeners === undefined) {
    try {
      listeners = discoverListeningPorts();
    } catch {
      listeners = null;
    }
  }
  const docker =
    options.docker ??
    discoverDockerInventory({
      discoverListeners: () => {
        if (listeners === null) throw new Error('Host listener discovery is unavailable.');
        return listeners ?? [];
      },
    });
  const findings = [...(listeners ?? []).map(nativeFinding), ...dockerFindings(docker)].sort(compareFinding);
  return {
    schemaVersion: 1,
    observedAt: (options.observedAt ?? new Date()).toISOString(),
    listenerAvailability: listeners === null ? 'unavailable' : 'available',
    dockerAvailability: docker.availability,
    dockerError: docker.error ?? null,
    findings,
    limitations: LIMITATIONS,
  };
}

export function formatExposureReport(report: ExposureReport): string {
  if (!report.findings.length)
    return [
      `Observed at ${report.observedAt} | listeners: ${report.listenerAvailability} | Docker: ${report.dockerAvailability}`,
      ...(report.dockerError ? [`Docker: ${report.dockerError.message}`] : []),
      formatEmpty('No visible host listeners or Docker port records found.'),
      ...report.limitations.map((limitation) => `- ${limitation}`),
    ].join('\n');
  const rows = report.findings.map((finding) => [
    finding.source,
    finding.project ?? '-',
    finding.service ?? '-',
    finding.container ?? finding.processName ?? '-',
    finding.protocol,
    finding.addressFamily,
    finding.bindAddress,
    finding.hostPort === null ? '-' : String(finding.hostPort),
    finding.containerPort === null ? '-' : String(finding.containerPort),
    finding.scope,
    finding.hostListenerStatus ?? '-',
    finding.assessment,
  ]);
  return [
    `Observed at ${report.observedAt} | listeners: ${report.listenerAvailability} | Docker: ${report.dockerAvailability}`,
    ...(report.dockerError ? [`Docker: ${report.dockerError.message}`] : []),
    formatTable(
      [
        'SOURCE',
        'PROJECT',
        'SERVICE',
        'PROCESS / CONTAINER',
        'PROTO',
        'FAMILY',
        'BIND ADDRESS',
        'HOST PORT',
        'CONTAINER PORT',
        'SCOPE',
        'LISTENER',
        'ASSESSMENT',
      ],
      rows,
    ),
    ...report.limitations.map((limitation) => `- ${limitation}`),
  ].join('\n');
}

export function registerExposureCommand(
  program: Command,
  dependencies: { createReport?: () => ExposureReport } = {},
): void {
  program
    .command('exposure')
    .description('Classify visible bind scope and potential Docker port exposure (read-only).')
    .option('--json', 'Print versioned JSON')
    .action((options: { json?: boolean }) => {
      const report = dependencies.createReport?.() ?? createExposureReport();
      process.stdout.write(`${options.json ? JSON.stringify(report) : formatExposureReport(report)}\n`);
      if (report.listenerAvailability === 'unavailable' && report.dockerAvailability !== 'available')
        process.exitCode = 1;
    });
}
