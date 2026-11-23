import { readFileSync } from 'node:fs';
import { isValidPortNumber, type PortNumber } from '@portcn/core';
import type { Command } from 'commander';
import { discoverListeningPorts, type ListeningPort } from './list.js';

export interface ProcessDetails {
  command: string | null;
  user: string | null;
}

export interface InspectedPort extends ListeningPort {
  details: ProcessDetails | null;
}

export function parsePort(value: string): PortNumber {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !isValidPortNumber(port)) {
    throw new Error('Port must be an integer between 1 and 65535.');
  }
  return port;
}

export function readProcessDetails(
  pid: number,
  readFile: (path: string, encoding: BufferEncoding) => string = (path, encoding) => readFileSync(path, encoding),
): ProcessDetails | null {
  try {
    const status = readFile(`/proc/${pid}/status`, 'utf8');
    const name = /^Name:\s*(.+)$/m.exec(status)?.[1]?.trim() ?? null;
    const uid = /^Uid:\s*(\d+)/m.exec(status)?.[1] ?? null;
    const command = readFile(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim() || name;
    return { command, user: uid ? `uid:${uid}` : null };
  } catch {
    return null;
  }
}

export function inspectListeningPort(
  port: PortNumber,
  options: {
    discover?: () => ListeningPort[];
    readDetails?: (pid: number) => ProcessDetails | null;
  } = {},
): InspectedPort[] {
  const discover = options.discover ?? (() => discoverListeningPorts());
  const readDetails = options.readDetails ?? readProcessDetails;
  return discover()
    .filter((candidate) => candidate.port === port)
    .map((candidate) => ({
      ...candidate,
      details: candidate.pid === null ? null : readDetails(candidate.pid),
    }));
}

export function formatInspectedPorts(ports: InspectedPort[]): string {
  if (ports.length === 0) return 'No listeners found for the requested port.';
  const headers = ['PROTO', 'STATE', 'LOCAL ADDRESS', 'PID', 'PROCESS', 'DETAILS'];
  const rows = ports.map((port) => [
    port.protocol.toUpperCase(),
    port.state,
    port.address,
    port.pid === null ? '-' : String(port.pid),
    port.processName ?? '-',
    port.details?.command ?? 'unavailable',
  ]);
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => row[index]?.length ?? 0)));
  const row = (values: string[]) =>
    values
      .map((value, index) => value.padEnd(widths[index] ?? 0))
      .join('  ')
      .trimEnd();
  return [row(headers), ...rows.map(row)].join('\n');
}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect <port>')
    .description('Inspect listeners on a TCP or UDP port (Linux)')
    .action((value: string) => {
      try {
        const port = parsePort(value);
        process.stdout.write(`${formatInspectedPorts(inspectListeningPort(port))}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`portcn: ${message}\n`);
        process.exitCode = message.startsWith('Port must') ? 2 : 1;
      }
    });
}
