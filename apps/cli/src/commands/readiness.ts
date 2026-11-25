import { createConnection, type Socket } from 'node:net';
import type { Command } from 'commander';
import { configPath, readConfig, type SavedService, type ServiceConfig, serviceId } from './config-store.js';
import { discoverListeningPorts, type ListeningPort } from './list.js';

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_RETRIES = 2;
const DEFAULT_INTERVAL_MS = 250;

export type ReadinessStatus = 'listening' | 'reachable' | 'ready' | 'unhealthy' | 'stopped' | 'unknown';
export interface ReadinessResult {
  schemaVersion: 1;
  serviceId: string;
  status: ReadinessStatus;
  mode: 'tcp' | 'http' | null;
  endpoint: string | null;
  attempts: number;
  statusCode: number | null;
  observedAt: string;
  detail: string;
}

export interface ReadinessDependencies {
  loadConfig?: () => Promise<ServiceConfig>;
  discover?: () => ListeningPort[];
  fetch?: typeof fetch;
  connect?: (host: string, port: number, signal: AbortSignal, timeoutMs: number) => Promise<void>;
  now?: () => Date;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

function integerOption(raw: string, name: string, min: number, max: number): number {
  if (!/^\d+$/.test(raw) || Number(raw) < min || Number(raw) > max)
    throw new Error(`--${name} must be an integer from ${min} to ${max}.`);
  return Number(raw);
}

function abortError(): Error {
  return Object.assign(new Error('Readiness check cancelled.'), { name: 'AbortError' });
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function tcpConnect(host: string, port: number, signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    const socket: Socket = createConnection({ host, port });
    const timer = setTimeout(() => socket.destroy(new Error('TCP probe timed out.')), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => socket.destroy(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
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

function targetHost(service: SavedService): string {
  if (service.address === '*' || service.address === '0.0.0.0') return '127.0.0.1';
  if (service.address === '::') return '::1';
  return service.address.replace(/^\[|\]$/g, '');
}

export async function checkReadiness(
  service: SavedService,
  observed: boolean,
  options: { timeoutMs?: number; retries?: number; intervalMs?: number; signal?: AbortSignal } = {},
  dependencies: ReadinessDependencies = {},
): Promise<ReadinessResult> {
  const now = dependencies.now ?? (() => new Date());
  const signal = options.signal ?? new AbortController().signal;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retries = options.retries ?? DEFAULT_RETRIES;
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const base = { schemaVersion: 1 as const, serviceId: service.id, observedAt: now().toISOString() };
  if (!observed)
    return {
      ...base,
      status: 'stopped',
      mode: null,
      endpoint: null,
      attempts: 0,
      statusCode: null,
      detail: 'No matching listener was observed; no probe was sent.',
    };
  if (service.protocol !== 'tcp')
    return {
      ...base,
      status: 'listening',
      mode: null,
      endpoint: null,
      attempts: 0,
      statusCode: null,
      detail: 'A UDP listener was observed; TCP and HTTP readiness probes do not apply.',
    };
  const endpoint = service.url;
  const mode = endpoint ? 'http' : 'tcp';
  let statusCode: number | null = null;
  let attempts = 0;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal.aborted) throw abortError();
    attempts += 1;
    try {
      if (endpoint) {
        const controller = new AbortController();
        const onAbort = () => controller.abort();
        signal.addEventListener('abort', onAbort, { once: true });
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await (dependencies.fetch ?? fetch)(endpoint, {
            method: 'HEAD',
            redirect: 'manual',
            signal: controller.signal,
          });
          await response.body?.cancel();
          statusCode = response.status;
          if (response.status >= 200 && response.status < 300)
            return {
              ...base,
              status: 'ready',
              mode,
              endpoint,
              attempts,
              statusCode,
              detail: 'The explicitly configured health endpoint returned a successful HTTP response.',
            };
          lastError = new Error(`HTTP ${response.status}`);
        } finally {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
        }
      } else {
        await (dependencies.connect ?? tcpConnect)(targetHost(service), service.port, signal, timeoutMs);
        return {
          ...base,
          status: 'reachable',
          mode,
          endpoint: null,
          attempts,
          statusCode: null,
          detail: 'TCP connection succeeded; application readiness was not assessed.',
        };
      }
    } catch (error) {
      if (signal.aborted) throw abortError();
      lastError = error;
    }
    if (attempt < retries) await (dependencies.sleep ?? delay)(intervalMs, signal);
  }
  const isHttpResponse = statusCode !== null;
  return {
    ...base,
    status: isHttpResponse ? 'unhealthy' : 'unknown',
    mode,
    endpoint: endpoint ?? null,
    attempts,
    statusCode,
    detail: isHttpResponse
      ? `The health endpoint returned HTTP ${statusCode} after ${attempts} attempt(s).`
      : `The local probe did not establish readiness after ${attempts} attempt(s): ${lastError instanceof Error ? lastError.message : 'connection failed'}`,
  };
}

function servicesById(
  config: ServiceConfig,
  listeners: ListeningPort[],
): Map<string, { service: SavedService; observed: boolean }> {
  const result = new Map<string, { service: SavedService; observed: boolean }>();
  for (const service of config.services) result.set(service.id, { service, observed: false });
  for (const listener of listeners) {
    const id = serviceId(listener.protocol, listener.address, listener.port);
    const existing = result.get(id);
    result.set(id, {
      service: existing?.service ?? {
        id,
        protocol: listener.protocol,
        address: listener.address,
        port: listener.port,
        favorite: false,
        alias: null,
        note: null,
        groups: [],
        url: null,
      },
      observed: true,
    });
  }
  return result;
}

export function registerReadinessCommands(program: Command, dependencies: ReadinessDependencies = {}): void {
  const loadConfig = dependencies.loadConfig ?? (async () => (await readConfig(configPath())).config);
  const discover = dependencies.discover ?? discoverListeningPorts;
  const now = dependencies.now ?? (() => new Date());
  const command = program.command('readiness').description('Check bounded local service readiness.');
  command
    .command('list')
    .description('List observed and saved services with readiness states.')
    .option('--json', 'Emit JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        const entries = [...servicesById(await loadConfig(), discover()).entries()].map(([id, item]) => ({
          serviceId: id,
          status: item.observed ? 'listening' : 'stopped',
          mode: item.service.protocol === 'tcp' ? (item.service.url ? 'http' : 'tcp') : null,
          endpoint: item.service.url,
          detail: item.observed
            ? 'Listener observed; readiness has not been probed.'
            : 'No matching listener was observed.',
        }));
        const result = { schemaVersion: 1, observedAt: now().toISOString(), services: entries };
        if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        else if (!entries.length) process.stdout.write('No saved or observed services.\n');
        else
          for (const entry of entries)
            process.stdout.write(
              `${entry.status.padEnd(10)} ${entry.serviceId}${entry.endpoint ? `  ${entry.endpoint}` : ''}\n`,
            );
      } catch (error) {
        process.stderr.write(`portcn readiness: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      }
    });
  command
    .command('check <service-id>')
    .description('Probe one observed local service with bounded retries.')
    .option('--timeout <ms>', 'Per-attempt timeout from 100 to 5000 ms', String(DEFAULT_TIMEOUT_MS))
    .option('--retries <count>', 'Retries from 0 to 5', String(DEFAULT_RETRIES))
    .option('--interval <ms>', 'Retry interval from 0 to 2000 ms', String(DEFAULT_INTERVAL_MS))
    .option('--json', 'Emit JSON')
    .action(async (id: string, options: { timeout: string; retries: string; interval: string; json?: boolean }) => {
      const controller = new AbortController();
      const onInterrupt = () => controller.abort();
      process.once('SIGINT', onInterrupt);
      process.once('SIGTERM', onInterrupt);
      try {
        const item = servicesById(await loadConfig(), discover()).get(id);
        if (!item) throw new Error(`No saved or observed service matches ${id}.`);
        const result = await checkReadiness(
          item.service,
          item.observed,
          {
            timeoutMs: integerOption(options.timeout, 'timeout', 100, 5000),
            retries: integerOption(options.retries, 'retries', 0, 5),
            intervalMs: integerOption(options.interval, 'interval', 0, 2000),
            signal: controller.signal,
          },
          { ...dependencies, now },
        );
        if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        else
          process.stdout.write(
            `${result.status} ${result.serviceId} (${result.attempts} attempt(s)): ${result.detail}\n`,
          );
        if (!['ready', 'reachable'].includes(result.status)) process.exitCode = 1;
      } catch (error) {
        process.stderr.write(`portcn readiness: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
      } finally {
        process.removeListener('SIGINT', onInterrupt);
        process.removeListener('SIGTERM', onInterrupt);
      }
    });
}
