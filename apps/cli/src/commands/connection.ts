import { lookup as dnsLookup } from 'node:dns/promises';
import { createConnection, isIP, type Socket } from 'node:net';
import { hostname as systemHostname } from 'node:os';
import type { Command } from 'commander';
import { configPath, readConfig, type SavedService, type ServiceConfig, serviceId } from './config-store.js';
import { readCurrentNamespace } from './diagnose.js';
import { type DockerDependencies, type DockerInventory, discoverDockerInventory } from './docker.js';
import { discoverListeningPorts, type ListeningPort } from './list.js';

type StageStatus = 'success' | 'failure' | 'warning' | 'skipped' | 'unknown';
export interface ConnectionResult {
  schemaVersion: 1;
  serviceId: string;
  observedAt: string;
  vantage: { hostname: string; networkNamespace: string | null };
  stages: {
    resolution: {
      status: StageStatus;
      host: string;
      addresses: Array<{ address: string; family: 'IPv4' | 'IPv6' }>;
      detail: string;
    };
    bind: {
      status: StageStatus;
      protocol: string;
      address: string;
      family: 'IPv4' | 'IPv6' | 'unknown';
      scope: 'loopback' | 'interface-specific' | 'all-interfaces' | 'unknown';
      detail: string;
    };
    tcp: {
      status: 'reachable' | 'refused' | 'timeout' | 'failed' | 'skipped';
      attempts: Array<{
        address: string;
        family: 'IPv4' | 'IPv6';
        status: 'reachable' | 'refused' | 'timeout' | 'failed';
        code: string | null;
        detail: string;
      }>;
    };
    http: {
      status: 'responded' | 'redirect' | 'unhealthy' | 'tls-error' | 'timeout' | 'unreachable' | 'skipped';
      url: string | null;
      statusCode: number | null;
      detail: string;
    };
    docker: {
      status: 'available' | 'unavailable';
      matches: Array<{
        container: string;
        state: string;
        health: string;
        hostAddress: string;
        hostPort: number | null;
        exposure: string;
      }>;
      detail: string;
    };
  };
  limitations: string[];
}

export interface ConnectionDependencies {
  loadConfig?: () => Promise<ServiceConfig>;
  discover?: () => ListeningPort[];
  resolve?: (host: string) => Promise<Array<{ address: string; family: number }>>;
  connect?: (address: string, port: number, family: number, timeoutMs: number) => Promise<void>;
  fetch?: typeof fetch;
  docker?: (dependencies?: DockerDependencies) => DockerInventory;
  dockerDependencies?: DockerDependencies;
  now?: () => Date;
  hostname?: () => string;
  networkNamespace?: () => string | null;
}

function bareAddress(address: string): string {
  const unwrapped = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  return unwrapped.split('%', 1)[0] ?? unwrapped;
}

function localTarget(service: SavedService): string {
  if (service.address === '*' || service.address === '0.0.0.0') return 'localhost';
  if (service.address === '::') return '::1';
  return bareAddress(service.address);
}

function familyName(family: number): 'IPv4' | 'IPv6' {
  return family === 6 ? 'IPv6' : 'IPv4';
}

function bindDetails(service: SavedService): ConnectionResult['stages']['bind'] {
  const address = bareAddress(service.address);
  const familyNumber = isIP(address);
  const family = familyNumber === 4 ? 'IPv4' : familyNumber === 6 ? 'IPv6' : 'unknown';
  const ipv4FirstOctet = familyNumber === 4 ? Number(address.split('.')[0]) : null;
  const ipv6Groups = familyNumber === 6 ? address.split(':') : [];
  const ipv6Loopback =
    familyNumber === 6 &&
    ipv6Groups.filter(Boolean).every((group) => Number.parseInt(group, 16) === 0) &&
    ipv6Groups.at(-1) === '1';
  const scope =
    address === '*' || address === '0.0.0.0' || address === '::'
      ? 'all-interfaces'
      : address === 'localhost' || ipv4FirstOctet === 127 || ipv6Loopback
        ? 'loopback'
        : familyNumber !== 0
          ? 'interface-specific'
          : 'unknown';
  return {
    status: family === 'unknown' ? 'unknown' : scope === 'all-interfaces' ? 'warning' : 'success',
    protocol: service.protocol,
    address: service.address,
    family,
    scope,
    detail:
      scope === 'all-interfaces'
        ? 'The listener is bound to all interfaces in its address family; this does not establish remote reachability.'
        : scope === 'loopback'
          ? 'The listener accepts connections only through loopback in the observed network namespace.'
          : scope === 'interface-specific'
            ? `The listener is bound to a specific ${family} address.`
            : 'The bind address could not be classified.',
  };
}

function connectTcp(address: string, port: number, family: number, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket: Socket = createConnection({ host: address, port, family });
    const timer = setTimeout(
      () => socket.destroy(Object.assign(new Error('Connection timed out.'), { code: 'ETIMEDOUT' })),
      timeoutMs,
    );
    const cleanup = () => clearTimeout(timer);
    socket.once('connect', () => {
      cleanup();
      socket.destroy();
      resolve();
    });
    socket.once('error', (error) => {
      cleanup();
      reject(error);
    });
  });
}

function errorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const item = error as { code?: unknown; cause?: unknown };
  if (typeof item.code === 'string') return item.code;
  if (item.cause && typeof item.cause === 'object' && 'code' in item.cause && typeof item.cause.code === 'string')
    return item.cause.code;
  return null;
}

function stageForError(error: unknown): 'refused' | 'timeout' | 'failed' {
  const code = errorCode(error) ?? '';
  if (code === 'ECONNREFUSED') return 'refused';
  if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') return 'timeout';
  return 'failed';
}

function dockerMatches(inventory: DockerInventory, service: SavedService): ConnectionResult['stages']['docker'] {
  if (inventory.availability !== 'available')
    return {
      status: 'unavailable',
      matches: [],
      detail: `Docker inventory is ${inventory.availability}; ${inventory.error?.message ?? 'no container mapping evidence is available.'}`,
    };
  const matches = inventory.containers.flatMap((container) =>
    container.ports
      .filter(
        (port) =>
          port.protocol === service.protocol && port.hostBindings.some((binding) => binding.port === service.port),
      )
      .flatMap((port) =>
        port.hostBindings
          .filter((binding) => binding.port === service.port)
          .map((binding) => ({
            container: container.name,
            state: container.state,
            health: container.health,
            hostAddress: binding.address || '*',
            hostPort: binding.port,
            exposure: binding.exposure,
          })),
      ),
  );
  return {
    status: 'available',
    matches,
    detail: matches.length
      ? 'Matching host-port mapping metadata was found; it does not prove connectivity to the container.'
      : 'Docker is available, but no matching host-port mapping was found.',
  };
}

export async function diagnoseConnection(
  service: SavedService,
  options: { timeoutMs?: number } = {},
  dependencies: ConnectionDependencies = {},
): Promise<ConnectionResult> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const host = localTarget(service);
  const limitations = [
    'All stages run from this process in its current network namespace; host, peer, and other container namespaces are not tested.',
    'Results are point-in-time evidence. Docker port mappings are configuration and do not prove container reachability.',
    'No external hosts, firewall rules, routes, container commands, or remediation actions are inspected or changed.',
  ];
  let addresses: Array<{ address: string; family: number }> = [];
  let resolutionStatus: StageStatus = 'success';
  let resolutionDetail = '';
  try {
    addresses = await (dependencies.resolve ?? ((value) => dnsLookup(value, { all: true, verbatim: true })))(host);
    if (!addresses.length) {
      resolutionStatus = 'failure';
      resolutionDetail = 'Name resolution returned no addresses.';
    } else
      resolutionDetail = `Resolved locally to ${addresses.map(({ address, family }) => `${address} (${familyName(family)})`).join(', ')}.`;
  } catch (error) {
    resolutionStatus = 'failure';
    resolutionDetail = error instanceof Error ? error.message : 'Name resolution failed.';
  }

  const attempts: ConnectionResult['stages']['tcp']['attempts'] = [];
  for (const address of service.protocol === 'tcp' ? addresses : []) {
    try {
      await (dependencies.connect ?? connectTcp)(address.address, service.port, address.family, timeoutMs);
      attempts.push({
        address: address.address,
        family: familyName(address.family),
        status: 'reachable',
        code: null,
        detail: 'TCP connection succeeded.',
      });
    } catch (error) {
      const status = stageForError(error);
      attempts.push({
        address: address.address,
        family: familyName(address.family),
        status,
        code: errorCode(error),
        detail: error instanceof Error ? error.message : 'TCP connection failed.',
      });
    }
  }
  const tcpStatus = attempts.some(({ status }) => status === 'reachable')
    ? 'reachable'
    : !attempts.length
      ? 'skipped'
      : attempts.every(({ status }) => status === 'refused')
        ? 'refused'
        : attempts.some(({ status }) => status === 'timeout')
          ? 'timeout'
          : 'failed';

  let http: ConnectionResult['stages']['http'];
  if (service.protocol !== 'tcp' || !service.url)
    http = {
      status: 'skipped',
      url: null,
      statusCode: null,
      detail:
        service.protocol !== 'tcp'
          ? 'HTTP checks do not apply to UDP services.'
          : 'No explicit local HTTP(S) health URL is saved; no HTTP request was sent.',
    };
  else {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await (dependencies.fetch ?? fetch)(service.url, {
        method: 'HEAD',
        redirect: 'manual',
        signal: controller.signal,
      });
      await response.body?.cancel();
      const status =
        response.status >= 300 && response.status < 400
          ? 'redirect'
          : response.status >= 200 && response.status < 300
            ? 'responded'
            : 'unhealthy';
      http = {
        status,
        url: service.url,
        statusCode: response.status,
        detail:
          status === 'redirect'
            ? 'HTTP redirect returned; it was not followed.'
            : status === 'responded'
              ? 'HTTP health endpoint responded successfully.'
              : `HTTP health endpoint returned status ${response.status}.`,
      };
    } catch (error) {
      const code = errorCode(error) ?? '';
      const tls =
        /TLS|SSL|CERT|VERIFY/i.test(code) || (error instanceof Error && /certificate|TLS|SSL/i.test(error.message));
      http = {
        status: controller.signal.aborted ? 'timeout' : tls ? 'tls-error' : 'unreachable',
        url: service.url,
        statusCode: null,
        detail: controller.signal.aborted
          ? `No HTTP response within ${timeoutMs} ms.`
          : tls
            ? 'TLS validation failed; certificate verification was not bypassed.'
            : 'No HTTP response was received from the saved local endpoint.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  const dockerResult = (dependencies.docker ?? discoverDockerInventory)(dependencies.dockerDependencies);
  return {
    schemaVersion: 1,
    serviceId: service.id,
    observedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
    vantage: {
      hostname: (dependencies.hostname ?? systemHostname)(),
      networkNamespace: (dependencies.networkNamespace ?? (() => readCurrentNamespace('net')))(),
    },
    stages: {
      resolution: {
        status: resolutionStatus,
        host,
        addresses: addresses.map(({ address, family }) => ({ address, family: familyName(family) })),
        detail: resolutionDetail,
      },
      bind: bindDetails(service),
      tcp: { status: tcpStatus, attempts },
      http,
      docker: dockerMatches(dockerResult, service),
    },
    limitations,
  };
}

function timeoutFrom(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 100 || Number(value) > 5000)
    throw new Error('--timeout must be an integer from 100 to 5000 milliseconds.');
  return Number(value);
}

function locateService(config: ServiceConfig, listeners: ListeningPort[], id: string): SavedService | null {
  const listener = listeners.find((item) => serviceId(item.protocol, item.address, item.port) === id);
  if (!listener) return null;
  return (
    config.services.find((item) => item.id === id) ?? {
      id,
      protocol: listener.protocol,
      address: listener.address,
      port: listener.port,
      favorite: false,
      alias: null,
      note: null,
      groups: [],
      url: null,
    }
  );
}

function formatConnection(result: ConnectionResult): string {
  const { resolution, bind, tcp, http, docker } = result.stages;
  const lines = [
    `Connection diagnosis: ${result.serviceId}`,
    `From ${result.vantage.hostname} in network namespace ${result.vantage.networkNamespace ?? 'unknown'}.`,
    `Resolution ${resolution.status}: ${resolution.detail}`,
    `Bind ${bind.status}: ${bind.protocol} ${bind.address} (${bind.family}, ${bind.scope}). ${bind.detail}`,
    `TCP ${tcp.status}: ${tcp.attempts.map(({ address, family, status, code }) => `${address} ${family} ${status}${code ? ` (${code})` : ''}`).join('; ') || 'no connection attempts'}.`,
    `HTTP ${http.status}: ${http.detail}`,
    `Docker ${docker.status}: ${docker.detail}`,
    'Limitations:',
    ...result.limitations.map((item) => `- ${item}`),
  ];
  return lines.join('\n');
}

export function registerConnectionCommands(program: Command, dependencies: ConnectionDependencies = {}): void {
  const loadConfig = dependencies.loadConfig ?? (async () => (await readConfig(configPath())).config);
  const discover = dependencies.discover ?? discoverListeningPorts;
  program
    .command('connection')
    .description('Diagnose connectivity for one selected local service.')
    .command('check <service-id>')
    .description('Resolve and test one observed local service from this network namespace.')
    .option('--timeout <ms>', 'Per-address and HTTP timeout from 100 to 5000 ms', '1500')
    .option('--json', 'Emit versioned JSON')
    .action(async (id: string, options: { timeout: string; json?: boolean }) => {
      try {
        const service = locateService(await loadConfig(), discover(), id);
        if (!service) throw new Error(`No saved or observed service matches ${id}.`);
        const result = await diagnoseConnection(service, { timeoutMs: timeoutFrom(options.timeout) }, dependencies);
        process.stdout.write(`${options.json ? JSON.stringify(result, null, 2) : formatConnection(result)}\n`);
      } catch (error) {
        process.stderr.write(`portcn connection: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
}
