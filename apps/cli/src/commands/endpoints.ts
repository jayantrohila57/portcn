import { execFile } from 'node:child_process';
import type { Command } from 'commander';
import { configPath, readConfig, type SavedService, type ServiceConfig, serviceId } from './config-store.js';
import { endpointCandidate } from './endpoint-url.js';
import { discoverListeningPorts, type ListeningPort } from './list.js';

const DEFAULT_TIMEOUT_MS = 1500;
const MAX_TIMEOUT_MS = 5000;

export type BrowserLauncher = (executable: string, args: string[]) => Promise<void>;

export type EndpointProbeStatus = 'responded' | 'timeout' | 'tls-error' | 'unreachable';

export interface EndpointProbeResult {
  schemaVersion: 1;
  serviceId: string;
  url: string;
  status: EndpointProbeStatus;
  statusCode: number | null;
  observedAt: string;
  elapsedMs: number;
  detail: string;
}

export interface EndpointCommandDependencies {
  loadConfig?: () => Promise<ServiceConfig>;
  discover?: () => ListeningPort[];
  fetch?: typeof fetch;
  open?: (url: string) => Promise<void>;
  now?: () => Date;
}

const execFileBrowserLauncher: BrowserLauncher = (executable, args) =>
  new Promise((resolve, reject) => {
    execFile(executable, args, { timeout: 5000, windowsHide: true, shell: false }, (error) => {
      if (error) reject(new Error(`Could not open browser with xdg-open: ${error.message}`));
      else resolve();
    });
  });

export function openLocalUrl(url: string, launch: BrowserLauncher = execFileBrowserLauncher): Promise<void> {
  return launch('xdg-open', [url]);
}

function timeoutFrom(value: string | undefined): number {
  if (value === undefined) return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(value)) throw new Error('--timeout must be an integer from 100 to 5000 milliseconds.');
  const timeout = Number(value);
  if (timeout < 100 || timeout > MAX_TIMEOUT_MS)
    throw new Error('--timeout must be an integer from 100 to 5000 milliseconds.');
  return timeout;
}

function nestedErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const value = error as { code?: unknown; cause?: unknown };
  if (typeof value.code === 'string') return value.code;
  if (value.cause && typeof value.cause === 'object' && 'code' in value.cause) {
    const code = (value.cause as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

function isTlsFailure(error: unknown): boolean {
  const code = nestedErrorCode(error);
  if (code !== null && /(TLS|SSL|CERT|VERIFY_LEAF_SIGNATURE)/i.test(code)) return true;
  if (error instanceof Error && /(certificate|self.signed|TLS|SSL)/i.test(error.message)) return true;
  return false;
}

export async function probeEndpoint(
  serviceId: string,
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  dependencies: { fetch?: typeof fetch; now?: () => Date } = {},
): Promise<EndpointProbeResult> {
  const fetcher = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  const start = Date.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let status: EndpointProbeStatus;
  let statusCode: number | null = null;
  let detail: string;
  try {
    const response = await fetcher(url, {
      method: 'HEAD',
      redirect: 'manual',
      signal: controller.signal,
    });
    await response.body?.cancel();
    status = 'responded';
    statusCode = response.status;
    detail =
      response.status >= 300 && response.status < 400
        ? 'The endpoint returned a redirect; Portcn did not follow it.'
        : 'The endpoint returned an HTTP response; application readiness was not assessed.';
  } catch (error) {
    status = timedOut ? 'timeout' : isTlsFailure(error) ? 'tls-error' : 'unreachable';
    detail =
      status === 'timeout'
        ? `No response within ${timeoutMs} ms.`
        : status === 'tls-error'
          ? 'TLS validation failed; certificate checks were not bypassed.'
          : 'No HTTP response was received from this local endpoint.';
  } finally {
    clearTimeout(timeout);
  }
  return {
    schemaVersion: 1,
    serviceId,
    url,
    status,
    statusCode,
    observedAt: now().toISOString(),
    elapsedMs: Math.max(0, Date.now() - start),
    detail,
  };
}

export function terminalEndpointLink(url: string, label: string, isTTY: boolean): string {
  const safeLabel = [...label]
    .map((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 ? '?' : character;
    })
    .join('');
  return isTTY ? `\u001b]8;;${url}\u001b\\${safeLabel}\u001b]8;;\u001b\\` : `${safeLabel} (${url})`;
}

function reportError(error: unknown): void {
  process.stderr.write(`portcn endpoint: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

function observedServices(config: ServiceConfig, discover: () => ListeningPort[]): SavedService[] {
  return discover().map((listener) => {
    const id = serviceId(listener.protocol, listener.address, listener.port);
    return (
      config.services.find((entry) => entry.id === id) ?? {
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
  });
}

function observedService(config: ServiceConfig, id: string, discover: () => ListeningPort[]): SavedService {
  const service = observedServices(config, discover).find((entry) => entry.id === id);
  if (!service) throw new Error(`No current local listener matches service ${id}.`);
  return service;
}

export function registerEndpointCommands(program: Command, dependencies: EndpointCommandDependencies = {}): void {
  const loadConfig = dependencies.loadConfig ?? (async () => (await readConfig(configPath())).config);
  const discover = dependencies.discover ?? discoverListeningPorts;
  const now = dependencies.now ?? (() => new Date());
  const endpoint = program.command('endpoint').description('List and explicitly check local service endpoints.');
  endpoint
    .command('list')
    .description('Show local URL candidates without probing services.')
    .option('--json', 'Emit JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        const config = await loadConfig();
        const services = observedServices(config, discover).map((service) => {
          const candidate = endpointCandidate(service);
          return {
            serviceId: service.id,
            alias: service.alias,
            ...candidate,
            reason: 'reason' in candidate ? candidate.reason : null,
            verificationStatus: candidate.url ? ('unverified' as const) : null,
          };
        });
        const result = { schemaVersion: 1, observedAt: now().toISOString(), services };
        if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        else if (!services.length) process.stdout.write('No local listening services found.\n');
        else
          for (const service of services) {
            const label = service.alias || service.serviceId;
            const url = service.url
              ? terminalEndpointLink(service.url, service.url, process.stdout.isTTY ?? false)
              : '—';
            process.stdout.write(
              `${service.status.padEnd(10)} ${label}  ${url}${service.reason ? `  ${service.reason}` : ''}\n`,
            );
          }
      } catch (error) {
        reportError(error);
      }
    });

  endpoint
    .command('check <service-id>')
    .description('Send one bounded HTTP HEAD request to an observed local endpoint; never follows redirects.')
    .option('--timeout <ms>', 'Request timeout from 100 to 5000 ms', String(DEFAULT_TIMEOUT_MS))
    .option('--json', 'Emit JSON')
    .action(async (id: string, options: { timeout: string; json?: boolean }) => {
      try {
        const service = observedService(await loadConfig(), id, discover);
        const candidate = endpointCandidate(service);
        if (candidate.status === 'non-web')
          throw new Error(`No local HTTP(S) endpoint is available: ${candidate.reason}`);
        const timeoutMs = timeoutFrom(options.timeout);
        const result = await probeEndpoint(id, candidate.url, timeoutMs, { fetch: dependencies.fetch, now });
        if (options.json) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        else
          process.stdout.write(
            `${result.status} ${result.url}${result.statusCode === null ? '' : ` (${result.statusCode})`} — ${result.detail}\n`,
          );
        if (result.status !== 'responded') process.exitCode = 1;
      } catch (error) {
        reportError(error);
      }
    });

  program
    .command('open <service-id>')
    .description('Open an observed local endpoint in the system browser.')
    .action(async (id: string) => {
      try {
        const service = observedService(await loadConfig(), id, discover);
        const candidate = endpointCandidate(service);
        if (candidate.status === 'non-web')
          throw new Error(`No local HTTP(S) endpoint is available: ${candidate.reason}`);
        await (dependencies.open ?? openLocalUrl)(candidate.url);
        process.stdout.write(`Opened ${candidate.url}\n`);
      } catch (error) {
        reportError(error);
      }
    });
}
