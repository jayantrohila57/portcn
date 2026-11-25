import { readFileSync } from 'node:fs';
import { isValidPortNumber, type PortNumber } from '@portcn/core';
import type { Command } from 'commander';
import { formatEmpty, formatTable, TERMINAL_THEME } from '../terminal.js';
import { JSON_SCHEMA_VERSION, jsonSchemaIsSupported, UnsupportedJsonVersionError, versionedJsonError } from './json.js';
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
    const command = formatProcessCommand(readFile(`/proc/${pid}/cmdline`, 'utf8'), name);
    return { details: { command, user: uid ? `uid:${uid}` : null }, status: 'available' };
  } catch (error) {
    return {
      details: { command: name, user: uid ? `uid:${uid}` : null },
      status: processDetailStatus(error),
    };
  }
}

const sensitiveOption =
  /^--?[\w-]*(?:password|passwd|token|secret|api[-_]?key|access[-_]?key|private[-_]?key|authorization)$/i;
const sensitiveAssignment =
  /^([A-Za-z_][A-Za-z0-9_]*(?:PASSWORD|PASSWD|TOKEN|SECRET|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTHORIZATION)[A-Za-z0-9_]*)=(.*)$/i;
const compareText = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

export function formatProcessCommand(rawCommand: string, fallback: string | null = null): string | null {
  const args = rawCommand.split('\0').filter(Boolean);
  if (args.length === 0) return fallback;
  let redactNext = false;
  const safeArgs = args.map((argument) => {
    if (redactNext) {
      redactNext = false;
      return '[REDACTED]';
    }
    if (sensitiveOption.test(argument)) {
      redactNext = true;
      return argument;
    }
    const assignment = sensitiveAssignment.exec(argument);
    if (assignment) return `${assignment[1]}=[REDACTED]`;
    const equals = argument.indexOf('=');
    if (equals > 0 && sensitiveOption.test(argument.slice(0, equals))) return `${argument.slice(0, equals)}=[REDACTED]`;
    return argument.replace(/(\b[a-z][a-z\d+.-]*:\/\/[^:\s/@]+:)[^@\s]+@/gi, '$1[REDACTED]@');
  });
  return safeArgs.join(' ');
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
    .sort(
      (left, right) =>
        compareText(left.protocol, right.protocol) ||
        compareText(left.address, right.address) ||
        compareText(left.state, right.state) ||
        (left.pid ?? 0) - (right.pid ?? 0),
    )
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
  return formatTable(headers, rows, { columnColors: { 0: TERMINAL_THEME.focused, 1: TERMINAL_THEME.success } });
}

export function registerInspectCommand(
  program: Command,
  inspectPort: typeof inspectListeningPort = inspectListeningPort,
): void {
  program
    .command('inspect <port>')
    .description('Inspect listeners on a TCP or UDP port (Linux)')
    .option('--json', 'Print inspection results as JSON')
    .option('--json-version <version>', 'Print versioned JSON (supported: 1)')
    .action((value: string, options: { json?: boolean; jsonVersion?: string }) => {
      try {
        if (!jsonSchemaIsSupported(options.jsonVersion)) throw new UnsupportedJsonVersionError();
        const port = parsePort(value);
        const results = inspectPort(port);
        if (options.jsonVersion === String(JSON_SCHEMA_VERSION))
          process.stdout.write(`${JSON.stringify({ schemaVersion: JSON_SCHEMA_VERSION, port, listeners: results })}\n`);
        else process.stdout.write(`${options.json ? JSON.stringify(results) : formatInspectedPorts(results)}\n`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (options.jsonVersion !== undefined || options.json) {
          process.stdout.write(`${JSON.stringify(versionedJsonError(error, value))}\n`);
          process.exitCode = error instanceof InvalidPortError || error instanceof UnsupportedJsonVersionError ? 2 : 1;
        } else {
          process.stderr.write(`portcn: ${message}\n`);
          process.exitCode = error instanceof InvalidPortError ? 2 : 1;
        }
      }
    });
}
