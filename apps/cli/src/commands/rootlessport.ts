import { readFileSync, readlinkSync } from 'node:fs';
import { basename } from 'node:path';
import { readProcessStartTime } from './project-context.js';

export interface RootlessPortForward {
  protocol: 'tcp' | 'udp';
  hostAddress: string;
  hostPort: number;
  containerAddress: string;
  containerPort: number;
}

export type RootlessPortInspectionStatus =
  | 'available'
  | 'not-rootlessport'
  | 'ambiguous'
  | 'permission-denied'
  | 'process-exited'
  | 'identity-changed'
  | 'unavailable';

export interface RootlessPortInspection {
  status: RootlessPortInspectionStatus;
  pid: number;
  startTime: string | null;
  forwards: RootlessPortForward[];
  reason: string;
}

export interface RootlessPortDependencies {
  platform?: NodeJS.Platform;
  readFile?: (path: string, encoding: BufferEncoding) => string;
  readLink?: (path: string) => string;
}

const readFile = (path: string, encoding: BufferEncoding): string => readFileSync(path, encoding);
const readLink = (path: string): string => readlinkSync(path);
const optionNames = new Set(['proto', 'host-ip', 'host-port', 'container-ip', 'container-port']);

function failureStatus(error: unknown): RootlessPortInspectionStatus {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
  if (code === 'ENOENT' || code === 'ESRCH') return 'process-exited';
  return 'unavailable';
}

function emptyResult(status: RootlessPortInspectionStatus, pid: number, reason: string): RootlessPortInspection {
  return { status, pid, startTime: null, forwards: [], reason };
}

function validPort(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : null;
}

/** Parse only the supported rootlessport mapping flags; never return the raw process command line. */
export function parseRootlessportCommandLine(
  commandLine: string,
  executablePath: string,
): {
  status: 'available' | 'not-rootlessport' | 'ambiguous' | 'unavailable';
  forwards: RootlessPortForward[];
} {
  const args = commandLine.split('\0').filter(Boolean);
  if (basename(executablePath).replace(/\s+\(deleted\)$/, '') !== 'rootlessport')
    return { status: 'not-rootlessport', forwards: [] };
  if (!args.length) return { status: 'unavailable', forwards: [] };
  const values = new Map<string, string[]>();
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) continue;
    const match = /^--?([a-z-]+)(?:=(.*))?$/.exec(argument);
    if (!match || !optionNames.has(match[1] ?? '')) continue;
    const name = match[1] ?? '';
    const inline = match[2];
    const value = inline ?? args[index + 1];
    if (inline === undefined) index += 1;
    if (!value) continue;
    const list = values.get(name) ?? [];
    list.push(value);
    values.set(name, list);
  }
  if ([...values.values()].some((items) => items.length > 1)) return { status: 'ambiguous', forwards: [] };
  const protocol = values.get('proto')?.[0]?.toLowerCase();
  const hostAddress = values.get('host-ip')?.[0];
  const hostPort = validPort(values.get('host-port')?.[0]);
  const containerAddress = values.get('container-ip')?.[0];
  const containerPort = validPort(values.get('container-port')?.[0]);
  if ((protocol !== 'tcp' && protocol !== 'udp') || !hostAddress || !hostPort || !containerAddress || !containerPort)
    return { status: 'unavailable', forwards: [] };
  return {
    status: 'available',
    forwards: [{ protocol, hostAddress, hostPort, containerAddress, containerPort }],
  };
}

/** Read a visible PID's rootlessport executable and mapping, then verify its process lifetime did not change. */
export function inspectRootlessportProcess(
  pid: number,
  dependencies: RootlessPortDependencies = {},
): RootlessPortInspection {
  if (!Number.isSafeInteger(pid) || pid < 1)
    return emptyResult('unavailable', pid, 'A positive listener PID is required.');
  if ((dependencies.platform ?? process.platform) !== 'linux')
    return emptyResult('unavailable', pid, 'Rootlessport process inspection is available only on Linux.');
  const read = dependencies.readFile ?? readFile;
  const readLinkPath = dependencies.readLink ?? readLink;
  const startTime = readProcessStartTime(pid, read);
  if (!startTime) return emptyResult('unavailable', pid, 'The process lifetime could not be read from /proc.');
  let commandLine: string;
  let executablePath: string;
  try {
    commandLine = read(`/proc/${pid}/cmdline`, 'utf8');
    executablePath = readLinkPath(`/proc/${pid}/exe`);
  } catch (error) {
    return emptyResult(failureStatus(error), pid, 'The process command or executable is not visible.');
  }
  const verifiedStartTime = readProcessStartTime(pid, read);
  if (!verifiedStartTime)
    return emptyResult('process-exited', pid, 'The process exited or became inaccessible during inspection.');
  if (verifiedStartTime !== startTime)
    return emptyResult(
      'identity-changed',
      pid,
      'The PID lifetime changed during inspection; attribution was discarded.',
    );
  const parsed = parseRootlessportCommandLine(commandLine, executablePath);
  return {
    status: parsed.status,
    pid,
    startTime,
    forwards: parsed.forwards,
    reason:
      parsed.status === 'available'
        ? 'Verified rootlessport executable, stable PID lifetime, and structured forwarding arguments.'
        : parsed.status === 'not-rootlessport'
          ? 'The visible listener PID does not resolve to the rootlessport executable.'
          : parsed.status === 'ambiguous'
            ? 'The process exposes multiple candidate forwarding values.'
            : 'The rootlessport command does not expose a complete supported mapping.',
  };
}
