import { execFileSync } from 'node:child_process';
import type { Command } from 'commander';

export interface ListeningPort {
  protocol: 'tcp' | 'udp';
  address: string;
  port: number;
  pid: number | null;
  processName: string | null;
}

const SS_ARGS = ['--no-header', '--listening', '--tcp', '--udp', '--numeric', '--processes'];

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

    const owner = /"([^"]+)",pid=(\d+)/.exec(line);
    ports.push({
      protocol,
      address: endpoint.slice(0, separator),
      port,
      pid: owner ? Number(owner[2]) : null,
      processName: owner?.[1] ?? null,
    });
  }

  return ports.sort(
    (left, right) =>
      left.port - right.port ||
      left.protocol.localeCompare(right.protocol) ||
      left.address.localeCompare(right.address),
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

export function formatListeningPorts(ports: ListeningPort[]): string {
  if (ports.length === 0) return 'No listening TCP or UDP ports found.';

  const headers = ['PROTO', 'PORT', 'LOCAL ADDRESS', 'PID', 'PROCESS'];
  const rows = ports.map((port) => [
    port.protocol.toUpperCase(),
    String(port.port),
    port.address,
    port.pid === null ? '-' : String(port.pid),
    port.processName ?? '-',
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const formatRow = (row: string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();
  return [formatRow(headers), ...rows.map(formatRow)].join('\n');
}

export function registerListCommand(program: Command): void {
  program
    .command('list')
    .description('List listening TCP and UDP ports (Linux)')
    .action(() => {
      try {
        process.stdout.write(`${formatListeningPorts(discoverListeningPorts())}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`portcn: ${message}\n`);
        process.exitCode = 1;
      }
    });
}
