import { isIP } from 'node:net';
import type { Command } from 'commander';
import { formatEmpty } from '../terminal.js';
import { readCurrentNamespace } from './diagnose.js';
import { InvalidPortError, parsePort } from './inspect.js';
import {
  InvalidAvailabilityInputError,
  JSON_SCHEMA_VERSION,
  jsonSchemaIsSupported,
  UnsupportedJsonVersionError,
  versionedJsonError,
} from './json.js';
import { discoverListeningPorts, type ListeningPort } from './list.js';

export type AvailabilityProtocol = 'tcp' | 'udp';
export type AvailabilityStatus = 'conflict-observed' | 'no-conflict-observed' | 'unknown';
type AddressFamily = 'IPv4' | 'IPv6';
interface NormalizedAddress {
  address: string;
  family: AddressFamily;
}

export interface AvailabilityConflict {
  protocol: AvailabilityProtocol;
  state: string;
  address: string;
  addressFamily: AddressFamily | 'unknown';
  reason: string;
}

export interface PortAvailability {
  schemaVersion: typeof JSON_SCHEMA_VERSION;
  port: number;
  protocol: AvailabilityProtocol;
  address: string;
  status: AvailabilityStatus;
  conflicts: AvailabilityConflict[];
  message: string;
  namespace: string | null;
  limitations: string[];
}

export interface PortSuggestions {
  schemaVersion: typeof JSON_SCHEMA_VERSION;
  protocol: AvailabilityProtocol;
  address: string;
  range: { start: number; end: number };
  suggestions: number[];
  namespace: string | null;
  limitations: string[];
}

export interface AvailabilityDependencies {
  discover?: () => ListeningPort[];
  readNamespace?: () => string | null;
}

export interface PortWatchOptions extends AvailabilityDependencies {
  protocol?: string;
  address?: string;
  intervalMs?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
  onChange?: (result: PortAvailability) => void;
  sleep?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

interface AvailabilityOptions extends AvailabilityDependencies {
  protocol?: string;
  address?: string;
  platform?: NodeJS.Platform;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeProtocol(protocol: string | undefined): AvailabilityProtocol {
  const normalized = protocol ?? 'tcp';
  if (normalized !== 'tcp' && normalized !== 'udp')
    throw new InvalidAvailabilityInputError('Protocol must be tcp or udp.');
  return normalized;
}

function canonicalIPv6(address: string): string | null {
  if (address.includes('%')) return null;
  let input = address.toLowerCase();
  if (input.includes('.')) {
    const separator = input.lastIndexOf(':');
    const ipv4 = input
      .slice(separator + 1)
      .split('.')
      .map(Number);
    if (separator < 0 || ipv4.length !== 4 || ipv4.some((part) => !Number.isInteger(part) || part < 0 || part > 255))
      return null;
    const high = ((ipv4[0] ?? 0) << 8) | (ipv4[1] ?? 0);
    const low = ((ipv4[2] ?? 0) << 8) | (ipv4[3] ?? 0);
    input = `${input.slice(0, separator + 1)}${high.toString(16)}:${low.toString(16)}`;
  }
  const halves = input.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const zeroCount = 8 - left.length - right.length;
  if ((halves.length === 1 && zeroCount !== 0) || (halves.length === 2 && zeroCount < 1)) return null;
  const groups = [...left, ...Array.from({ length: zeroCount }, () => '0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => Number.parseInt(group, 16).toString(16)).join(':');
}

function normalizeAddress(address: string | undefined): NormalizedAddress {
  const raw = address ?? '127.0.0.1';
  const unwrapped = raw.startsWith('[') && raw.endsWith(']') ? raw.slice(1, -1) : raw;
  const family = isIP(unwrapped);
  if (family !== 4 && family !== 6)
    throw new InvalidAvailabilityInputError('Address must be an IPv4 or IPv6 literal (hostnames are not resolved).');
  if (family === 4) return { address: unwrapped, family: 'IPv4' };
  const normalized = canonicalIPv6(unwrapped);
  if (!normalized)
    throw new InvalidAvailabilityInputError('Scoped or malformed IPv6 addresses are not supported for bind checks.');
  return { address: normalized, family: 'IPv6' };
}

function normalizeListenerAddress(address: string): NormalizedAddress | null {
  const unwrapped = address.startsWith('[') && address.endsWith(']') ? address.slice(1, -1) : address;
  const family = isIP(unwrapped);
  if (family === 4) return { address: unwrapped, family: 'IPv4' };
  if (family === 6) {
    const normalized = canonicalIPv6(unwrapped);
    return normalized ? { address: normalized, family: 'IPv6' } : null;
  }
  return null;
}

function familyOfListener(address: string): AddressFamily | 'unknown' {
  return normalizeListenerAddress(address)?.family ?? 'unknown';
}

function isWildcard(address: string, family: AddressFamily): boolean {
  return (family === 'IPv4' && address === '0.0.0.0') || (family === 'IPv6' && address === '0:0:0:0:0:0:0:0');
}

function isIPv4MappedIPv6(address: string): boolean {
  return address.startsWith('0:0:0:0:0:ffff:');
}

function overlapReason(
  listener: ListeningPort,
  requestedAddress: string,
  requestedFamily: AddressFamily,
): string | null | 'unknown' {
  const listenerFamily = familyOfListener(listener.address);
  if (listenerFamily === 'unknown') return 'unknown';
  const normalizedListener = normalizeListenerAddress(listener.address);
  if (!normalizedListener) return 'unknown';
  if (listenerFamily !== requestedFamily) {
    if (
      requestedFamily === 'IPv4' &&
      listenerFamily === 'IPv6' &&
      (isWildcard(normalizedListener.address, listenerFamily) || isIPv4MappedIPv6(normalizedListener.address))
    )
      return 'unknown';
    if (
      requestedFamily === 'IPv6' &&
      listenerFamily === 'IPv4' &&
      (isWildcard(requestedAddress, requestedFamily) || isIPv4MappedIPv6(requestedAddress))
    )
      return 'unknown';
    return null;
  }

  const requestedWildcard = isWildcard(requestedAddress, requestedFamily);
  const listenerWildcard = isWildcard(normalizedListener.address, listenerFamily);
  if (listenerWildcard || requestedWildcard || normalizedListener.address === requestedAddress) {
    return listenerWildcard
      ? `The listener is bound to the ${listenerFamily} wildcard address and overlaps the requested address.`
      : requestedWildcard
        ? `The requested ${requestedFamily} wildcard address includes the listener's bind address.`
        : 'The listener is bound to the requested address.';
  }
  return null;
}

function limitations(namespace: string | null, platform: NodeJS.Platform = process.platform): string[] {
  return [
    platform === 'darwin'
      ? 'Discovery covers sockets visible to the current macOS host process; other hosts are not inspected.'
      : namespace
        ? `Discovery is limited to the current network namespace (${namespace}); other namespaces are not inspected.`
        : 'The current network namespace could not be identified; discovery still covers only the namespace visible to this process.',
    'This read-only snapshot observes listeners only. It does not bind or reserve the port, and another process can claim it after the check.',
    'Wildcard availability across IPv4 and IPv6 can be uncertain because dual-stack socket settings may vary.',
  ];
}

function assessFromListeners(
  port: number,
  protocol: AvailabilityProtocol,
  address: string,
  family: AddressFamily,
  listeners: ListeningPort[],
  namespace: string | null,
  platform: NodeJS.Platform = process.platform,
): PortAvailability {
  const relevant = listeners
    .filter((listener) => listener.port === port && listener.protocol === protocol)
    .sort((left, right) => compareText(left.address, right.address) || compareText(left.state, right.state));
  const conflicts: AvailabilityConflict[] = [];
  let uncertain = false;
  for (const listener of relevant) {
    const reason = overlapReason(listener, address, family);
    if (reason === 'unknown') {
      uncertain = true;
      continue;
    }
    if (reason) {
      conflicts.push({
        protocol: listener.protocol,
        state: listener.state,
        address: listener.address,
        addressFamily: familyOfListener(listener.address),
        reason,
      });
    }
  }

  const status: AvailabilityStatus = conflicts.length
    ? 'conflict-observed'
    : uncertain
      ? 'unknown'
      : 'no-conflict-observed';
  const message =
    status === 'conflict-observed'
      ? `A ${protocol.toUpperCase()} listener overlaps ${address}:${port}; inspect the port before starting another service.`
      : status === 'unknown'
        ? `Listener visibility is ambiguous for ${address}:${port}; do not assume this address is available.`
        : `No overlapping ${protocol.toUpperCase()} listener was observed on ${address}:${port}. This does not guarantee a future bind.`;

  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    port,
    protocol,
    address,
    status,
    conflicts,
    message,
    namespace,
    limitations: limitations(namespace, platform),
  };
}

export function checkPortAvailability(port: number, options: AvailabilityOptions = {}): PortAvailability {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new InvalidPortError();
  const protocol = normalizeProtocol(options.protocol);
  const { address, family } = normalizeAddress(options.address);
  const discover = options.discover ?? (() => discoverListeningPorts());
  const namespace = (
    options.readNamespace ??
    (() => ((options.platform ?? process.platform) === 'linux' ? readCurrentNamespace('net') : null))
  )();
  return assessFromListeners(port, protocol, address, family, discover(), namespace, options.platform);
}

export class PortWatchTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Port watch timed out after ${timeoutMs} ms.`);
    this.name = 'PortWatchTimeoutError';
  }
}

export class PortWatchCancelledError extends Error {
  constructor() {
    super('Port watch was cancelled.');
    this.name = 'PortWatchCancelledError';
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new PortWatchCancelledError());
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    }, milliseconds);
    const cancel = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', cancel);
      reject(new PortWatchCancelledError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

export async function watchPortAvailability(port: number, options: PortWatchOptions = {}): Promise<PortAvailability> {
  const intervalMs = options.intervalMs ?? 250;
  const timeoutMs = options.timeoutMs ?? 30_000;
  if (!Number.isInteger(intervalMs) || intervalMs < 50 || intervalMs > 5_000)
    throw new InvalidAvailabilityInputError('Watch interval must be an integer between 50 and 5000 ms.');
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300_000)
    throw new InvalidAvailabilityInputError('Watch timeout must be an integer between 1 and 300000 ms.');
  const check = () => checkPortAvailability(port, options);
  const sleep = options.sleep ?? delay;
  const startedAt = Date.now();
  let previous: AvailabilityStatus | undefined;
  while (true) {
    if (options.signal?.aborted) throw new PortWatchCancelledError();
    const result = check();
    if (result.status !== previous) options.onChange?.(result);
    previous = result.status;
    if (result.status === 'no-conflict-observed') return result;
    const remaining = timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) throw new PortWatchTimeoutError(timeoutMs);
    await sleep(Math.min(intervalMs, remaining), options.signal);
  }
}

function parseRange(range: string | undefined): { start: number; end: number } {
  const value = range ?? '3000-3999';
  const match = /^(\d+)-(\d+)$/.exec(value);
  if (!match) throw new InvalidAvailabilityInputError('Range must use START-END, for example 3000-3999.');
  const start = Number(match[1]);
  const end = Number(match[2]);
  if (start < 1 || end > 65_535 || end < start || end - start + 1 > 1_024)
    throw new InvalidAvailabilityInputError('Range must be ordered, within 1-65535, and contain at most 1024 ports.');
  return { start, end };
}

export function suggestAvailablePorts(
  options: AvailabilityOptions & {
    range?: string;
    from?: string;
    limit?: string;
  } = {},
): PortSuggestions {
  const protocol = normalizeProtocol(options.protocol);
  const { address, family } = normalizeAddress(options.address);
  const range = parseRange(options.range);
  const from = options.from === undefined ? range.start : Number(options.from);
  const limit = options.limit === undefined ? 5 : Number(options.limit);
  if (!Number.isInteger(from) || from < range.start || from > range.end)
    throw new InvalidAvailabilityInputError('Starting port must be inside the requested range.');
  if (!Number.isInteger(limit) || limit < 1 || limit > 20)
    throw new InvalidAvailabilityInputError('Suggestion limit must be an integer between 1 and 20.');
  const discover = options.discover ?? (() => discoverListeningPorts());
  const namespace = (
    options.readNamespace ??
    (() => ((options.platform ?? process.platform) === 'linux' ? readCurrentNamespace('net') : null))
  )();
  const listeners = discover();
  const suggestions: number[] = [];
  for (let port = from; port <= range.end && suggestions.length < limit; port += 1) {
    const assessment = assessFromListeners(port, protocol, address, family, listeners, namespace);
    if (assessment.status === 'no-conflict-observed') suggestions.push(port);
  }
  return {
    schemaVersion: JSON_SCHEMA_VERSION,
    protocol,
    address,
    range,
    suggestions,
    namespace,
    limitations: limitations(namespace, options.platform),
  };
}

export function formatPortAvailability(result: PortAvailability): string {
  const status =
    result.status === 'conflict-observed'
      ? 'Listener overlap observed'
      : result.status === 'unknown'
        ? 'Availability is uncertain'
        : 'No overlapping listener observed';
  const lines = [`${status}: ${result.protocol.toUpperCase()} ${result.address}:${result.port}`, result.message];
  if (result.conflicts.length)
    lines.push(
      ...result.conflicts.map((conflict) => `- ${conflict.addressFamily} ${conflict.address} (${conflict.state})`),
    );
  lines.push(...result.limitations.map((limitation) => `- ${limitation}`));
  return lines.join('\n');
}

export function formatPortSuggestions(result: PortSuggestions): string {
  const lines = [`Port suggestions for ${result.protocol.toUpperCase()} ${result.address}:`];
  if (result.suggestions.length) lines.push(...result.suggestions.map((port) => `- ${port}`));
  else
    lines.push(
      formatEmpty(`No candidate ports without an observed conflict in ${result.range.start}-${result.range.end}.`),
    );
  lines.push(...result.limitations.map((limitation) => `- ${limitation}`));
  return lines.join('\n');
}

export function registerAvailabilityCommands(program: Command, dependencies: AvailabilityDependencies = {}): void {
  program
    .command('wait <port>')
    .description('Wait until no overlapping listener is observed; does not reserve the port')
    .option('--protocol <protocol>', 'Protocol to check (tcp or udp)', 'tcp')
    .option('--address <address>', 'IPv4 or IPv6 bind address to check', '127.0.0.1')
    .option('--interval <milliseconds>', 'Polling interval (50-5000 ms)', '250')
    .option('--timeout <milliseconds>', 'Maximum wait (1-300000 ms)', '30000')
    .option('--json', 'Print versioned state changes and final result as JSON lines')
    .option('--json-version <version>', 'Print versioned state changes and final result as JSON lines (supported: 1)')
    .action(
      async (
        value: string,
        options: {
          protocol?: string;
          address?: string;
          interval?: string;
          timeout?: string;
          json?: boolean;
          jsonVersion?: string;
        },
      ) => {
        const controller = new AbortController();
        const cancel = () => controller.abort();
        process.once('SIGINT', cancel);
        process.once('SIGTERM', cancel);
        const json = options.json || options.jsonVersion !== undefined;
        try {
          if (!jsonSchemaIsSupported(options.jsonVersion)) throw new UnsupportedJsonVersionError();
          const intervalMs = Number(options.interval);
          const timeoutMs = Number(options.timeout);
          if (!/^\d+$/.test(options.interval ?? '') || !/^\d+$/.test(options.timeout ?? ''))
            throw new InvalidAvailabilityInputError('Watch interval and timeout must be integer milliseconds.');
          const result = await watchPortAvailability(parsePort(value), {
            ...options,
            intervalMs,
            timeoutMs,
            ...dependencies,
            signal: controller.signal,
            onChange: (state) => {
              if (json)
                process.stdout.write(
                  `${JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, event: 'state-change', status: state.status, port: state.port, protocol: state.protocol, address: state.address, observedAt: new Date().toISOString() })}\n`,
                );
              else process.stdout.write(`${state.status}: ${state.message}\n`);
            },
          });
          if (json)
            process.stdout.write(
              `${JSON.stringify({ ...result, event: 'available', observedAt: new Date().toISOString() })}\n`,
            );
          else
            process.stdout.write(
              `Port ${result.port} has no observed ${result.protocol.toUpperCase()} listener overlap. Another process may claim it before you bind.\n`,
            );
        } catch (error) {
          if (json)
            process.stdout.write(
              `${JSON.stringify({ ...versionedJsonError(error, value), event: error instanceof PortWatchTimeoutError ? 'timeout' : error instanceof PortWatchCancelledError ? 'cancelled' : 'error' })}\n`,
            );
          else if (!(error instanceof PortWatchCancelledError))
            process.stderr.write(`portcn: ${error instanceof Error ? error.message : String(error)}\n`);
          process.exitCode =
            error instanceof InvalidPortError ||
            error instanceof InvalidAvailabilityInputError ||
            error instanceof UnsupportedJsonVersionError
              ? 2
              : error instanceof PortWatchCancelledError
                ? 130
                : 1;
        } finally {
          process.removeListener('SIGINT', cancel);
          process.removeListener('SIGTERM', cancel);
        }
      },
    );

  program
    .command('check <port>')
    .description('Check for visible TCP or UDP listener overlap without reserving the port (Linux)')
    .option('--protocol <protocol>', 'Protocol to check (tcp or udp)', 'tcp')
    .option('--address <address>', 'IPv4 or IPv6 bind address to check', '127.0.0.1')
    .option('--json', 'Print versioned JSON')
    .option('--json-version <version>', 'Print versioned JSON (supported: 1)')
    .action((value: string, options: { protocol?: string; address?: string; json?: boolean; jsonVersion?: string }) => {
      try {
        if (!jsonSchemaIsSupported(options.jsonVersion)) throw new UnsupportedJsonVersionError();
        const result = checkPortAvailability(parsePort(value), { ...options, ...dependencies });
        process.stdout.write(
          `${options.json || options.jsonVersion ? JSON.stringify(result) : formatPortAvailability(result)}\n`,
        );
      } catch (error) {
        const json = options.json || options.jsonVersion !== undefined;
        if (json) process.stdout.write(`${JSON.stringify(versionedJsonError(error, value))}\n`);
        else process.stderr.write(`portcn: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode =
          error instanceof InvalidPortError ||
          error instanceof InvalidAvailabilityInputError ||
          error instanceof UnsupportedJsonVersionError
            ? 2
            : 1;
      }
    });

  program
    .command('suggest')
    .description('Suggest ports without visible conflicts in a bounded range (Linux)')
    .option('--range <start-end>', 'Candidate range (maximum 1024 ports)', '3000-3999')
    .option('--from <port>', 'First candidate to consider')
    .option('--limit <count>', 'Maximum number of suggestions (1-20)', '5')
    .option('--protocol <protocol>', 'Protocol to check (tcp or udp)', 'tcp')
    .option('--address <address>', 'IPv4 or IPv6 bind address to check', '127.0.0.1')
    .option('--json', 'Print versioned JSON')
    .option('--json-version <version>', 'Print versioned JSON (supported: 1)')
    .action(
      (options: {
        range?: string;
        from?: string;
        limit?: string;
        protocol?: string;
        address?: string;
        json?: boolean;
        jsonVersion?: string;
      }) => {
        try {
          if (!jsonSchemaIsSupported(options.jsonVersion)) throw new UnsupportedJsonVersionError();
          const result = suggestAvailablePorts({ ...options, ...dependencies });
          process.stdout.write(
            `${options.json || options.jsonVersion ? JSON.stringify(result) : formatPortSuggestions(result)}\n`,
          );
        } catch (error) {
          const json = options.json || options.jsonVersion !== undefined;
          if (json) process.stdout.write(`${JSON.stringify(versionedJsonError(error))}\n`);
          else process.stderr.write(`portcn: ${error instanceof Error ? error.message : String(error)}\n`);
          process.exitCode =
            error instanceof InvalidAvailabilityInputError || error instanceof UnsupportedJsonVersionError ? 2 : 1;
        }
      },
    );
}
