import { readFileSync } from 'node:fs';
import { isValidPortNumber, type PortNumber } from '@portcn/core';
import type { Command } from 'commander';
import { formatEmpty, formatTable } from '../terminal.js';
import { discoverListeningPorts, type ListeningPort } from './list.js';

export interface ProcessDetails {
  command: string | null;
  user: string | null;
}

export type ProcessDetailStatus = 'available' | 'permission-denied' | 'process-exited' | 'unavailable';

export interface ProcessDetailResult {
  details: ProcessDetails | null;
  status: ProcessDetailStatus;
}

export interface InspectedPort extends ListeningPort {
  details: ProcessDetails | null;
}

export class InvalidPortError extends Error {
  constructor() {
    super('Port must be an integer between 1 and 65535.');
    this.name = 'InvalidPortError';
  }
}

export function parsePort(value: string): PortNumber {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !isValidPortNumber(port)) {
    throw new InvalidPortError();
  }
  return port;
}

export function inspectProcessDetails(
  pid: number,
  readFile: (path: string, encoding: BufferEncoding) => string = (path, encoding) => readFileSync(path, encoding),
): ProcessDetailResult {
  let status: string;
  try {
    status = readFile(`/proc/${pid}/status`, 'utf8');
  } catch (error) {
    return { details: null, status: processDetailStatus(error) };
  }

  const name = /^Name:\s*(.+)$/m.exec(status)?.[1]?.trim() ?? null;
  const uid = /^Uid:\s*(\d+)/m.exec(status)?.[1] ?? null;
  try {
    const command = readFile(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim() || name;
    return { details: { command, user: uid ? `uid:${uid}` : null }, status: 'available' };
  } catch (error) {
    return {
      details: { command: name, user: uid ? `uid:${uid}` : null },
      status: processDetailStatus(error),
    };
  }
}

function processDetailStatus(error: unknown): ProcessDetailStatus {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
  if (code === 'ENOENT') return 'process-exited';
  return 'unavailable';
}

export function readProcessDetails(
  pid: number,
  readFile: (path: string, encoding: BufferEncoding) => string = (path, encoding) => readFileSync(path, encoding),
): ProcessDetails | null {
  const result = inspectProcessDetails(pid, readFile);
  return result.status === 'available' ? result.details : null;
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
  if (ports.length === 0) return formatEmpty('No listeners found for the requested port.');
  const headers = ['PROTO', 'STATE', 'LOCAL ADDRESS', 'PID', 'PROCESS', 'DETAILS'];
  const rows = ports.map((port) => [
    port.protocol.toUpperCase(),
    port.state,
    port.address,
    port.pid === null ? '-' : String(port.pid),
    port.processName ?? '-',
    port.details?.command ?? 'unavailable',
  ]);
  return formatTable(headers, rows, { columnColors: { 0: '\u001b[36m', 1: '\u001b[32m' } });
}

export function registerInspectCommand(program: Command): void {
  program
    .command('inspect <port>')
    .description('Inspect listeners on a TCP or UDP port (Linux)')
    .option('--json', 'Print inspection results as JSON')
    .action((value: string, options: { json?: boolean }) => {
      try {
        const port = parsePort(value);
        const results = inspectListeningPort(port);
        process.stdout.write(`${options.json ? JSON.stringify(results) : formatInspectedPorts(results)}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`portcn: ${message}\n`);
        process.exitCode = error instanceof InvalidPortError ? 2 : 1;
      }
    });
}
