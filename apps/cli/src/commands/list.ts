import { execFileSync } from 'node:child_process';
import type { Command } from 'commander';
import { formatEmpty, formatTable, type TableOptions } from '../terminal.js';
import { JSON_SCHEMA_VERSION, jsonSchemaIsSupported, UnsupportedJsonVersionError, versionedJsonError } from './json.js';
import { runTabbedList } from './tabs.js';

export interface ListeningPort {
  protocol: 'tcp' | 'udp';
  state: string;
  address: string;
  port: number;
  pid: number | null;
  processName: string | null;
  owners?: ListeningOwner[];
}

export interface ListeningOwner {
  pid: number;
  processName: string;
}

const SS_ARGS = ['--no-header', '--listening', '--tcp', '--udp', '--numeric', '--processes'];
const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function parseSsOutput(output: string): ListeningPort[] {
  const ports: ListeningPort[] = [];

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const fields = line.split(/\s+/);
    const protocol = fields[0];
    const endpoint = fields[4];

    if ((protocol !== 'tcp' && protocol !== 'udp') || fields.length < 6 || !endpoint) {
      throw new Error(`Unexpected output from ss: ${line}`);
    }

    const separator = endpoint.lastIndexOf(':');
    const portString = endpoint.slice(separator + 1);
    const port = Number(portString);
    if (separator < 0 || !/^\d+$/.test(portString) || !Number.isInteger(port) || port < 1 || port > 65_535) {
      throw new Error(`Unexpected local port from ss: ${endpoint}`);
    }

    const owners = [...line.matchAll(/"([^"]+)",pid=(\d+)/g)]
      .map((owner) => ({ processName: owner[1] ?? 'unknown', pid: Number(owner[2]) }))
      .sort((left, right) => left.pid - right.pid || compareText(left.processName, right.processName));
    const owner = owners[0];
    ports.push({
      protocol,
      state: fields[1] ?? 'UNKNOWN',
      address: endpoint.slice(0, separator),
      port,
      pid: owner?.pid ?? null,
      processName: owner?.processName ?? null,
      owners,
    });
  }

  return ports.sort(
    (left, right) =>
      left.port - right.port || compareText(left.protocol, right.protocol) || compareText(left.address, right.address),
  );
}

export function discoverListeningPorts({
  platform = process.platform,
  runSs = (args) => execFileSync('ss', args, { encoding: 'utf8', timeout: 10_000, maxBuffer: 8 * 1024 * 1024 }),
}: {
  platform?: NodeJS.Platform;
  runSs?: (args: string[]) => string;
} = {}): ListeningPort[] {
  if (platform !== 'linux') {
    throw new Error('Port listing currently supports Linux only.');
  }

  let output: string;
  try {
    output = runSs(SS_ARGS);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException;
    if (failure.code === 'ENOENT') {
      throw new Error('The ss command is missing. Install iproute2 (Ubuntu: sudo apt install iproute2).');
    }
    if (failure.code === 'ETIMEDOUT') {
      throw new Error('The ss command timed out while listing ports.');
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to list ports using ss: ${message}`);
  }

  return parseSsOutput(output);
}

export function formatListeningPorts(ports: ListeningPort[], options: TableOptions = {}): string {
  if (ports.length === 0) return formatEmpty('No listening TCP or UDP ports found.');

  const headers = ['PROTO', 'STATE', 'PORT', 'LOCAL ADDRESS', 'PID', 'PROCESS'];
  const rows = ports.map((port) => [
    port.protocol.toUpperCase(),
    port.state,
    String(port.port),
    port.address,
    port.pid === null ? '-' : String(port.pid),
    port.processName ?? '-',
  ]);
  return formatTable(headers, rows, { ...options, columnColors: { 0: '\u001b[36m', 1: '\u001b[32m' } });
}

export function registerListCommand(
  program: Command,
  discover: typeof discoverListeningPorts = discoverListeningPorts,
): void {
  program
    .command('list')
    .description('List listening TCP and UDP ports (Linux)')
    .option('-i, --interactive', 'Switch between filtered port tabs with the keyboard')
    .option('--json', 'Print all listeners as JSON without terminal formatting or pagination')
    .option('--json-version <version>', 'Print versioned JSON (supported: 1)')
    .action(async (options: { interactive?: boolean; json?: boolean; jsonVersion?: string }) => {
      try {
        if (!jsonSchemaIsSupported(options.jsonVersion)) throw new UnsupportedJsonVersionError();
        const ports = discover();
        if (options.jsonVersion === String(JSON_SCHEMA_VERSION))
          process.stdout.write(`${JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, listeners: ports })}\n`);
        else if (options.json) process.stdout.write(`${JSON.stringify(ports)}\n`);
        else if (options.interactive) await runTabbedList(ports, discover);
        else process.stdout.write(`${formatListeningPorts(ports)}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.jsonVersion !== undefined || options.json) {
          process.stdout.write(`${JSON.stringify(versionedJsonError(error))}\n`);
          process.exitCode = error instanceof UnsupportedJsonVersionError ? 2 : 1;
        } else {
          process.stderr.write(`portcn: ${message}\n`);
          process.exitCode = 1;
        }
      }
    });
}
