import { execFileSync } from 'node:child_process';
import type { Command } from 'commander';
import { formatEmpty } from '../terminal.js';
import type { ListeningPort } from './list.js';
import { discoverListeningPorts } from './list.js';

export type SystemdScope = 'user' | 'system';
export interface SystemdUnit {
  name: string;
  type: 'service' | 'socket';
  scope: SystemdScope;
  load: string;
  active: string;
  sub: string;
  mainPid: number | null;
  processListenerPorts: number[];
  configuredSockets: Array<{ address: string | null; port: number | null; observed: boolean | null }>;
}
export interface SystemdInventory {
  schemaVersion: 1;
  availability:
    | 'available'
    | 'partial'
    | 'not-installed'
    | 'user-manager-unavailable'
    | 'permission-denied'
    | 'unavailable';
  managers: Record<
    SystemdScope,
    { status: 'available' | 'not-installed' | 'user-manager-unavailable' | 'permission-denied' | 'unavailable' }
  >;
  units: SystemdUnit[];
  limitations: string[];
  observationTime: string;
}
export interface SystemdDependencies {
  platform?: NodeJS.Platform;
  run?: (scope: SystemdScope, args: string[]) => string;
  listeners?: () => ListeningPort[];
  now?: () => Date;
}
type ManagerStatus = SystemdInventory['managers'][SystemdScope]['status'];

const LIMITATIONS = [
  'Systemd unit state is a point-in-time manager report. Configured socket activation does not prove that a service process is running.',
  'User and system manager visibility follows the current user and permissions; Portcn never requests elevation or changes unit state.',
  'Only MainPID is used for process correlation. Worker processes and control groups are not inferred from names or port numbers.',
];
const runSystemctl = (scope: SystemdScope, args: string[]) =>
  execFileSync('systemctl', [...(scope === 'user' ? ['--user'] : ['--system']), ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 8 * 1024 * 1024,
  });

function parseListUnits(
  output: string,
  scope: SystemdScope,
): Array<Omit<SystemdUnit, 'mainPid' | 'processListenerPorts' | 'configuredSockets'>> {
  return output.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('UNIT ')) return [];
    const columns = trimmed.split(/\s+/);
    const name = columns[0];
    const load = columns[1];
    const active = columns[2];
    const sub = columns[3];
    if (!name || !load || !active || !sub || (!name.endsWith('.service') && !name.endsWith('.socket'))) return [];
    return [
      { name, type: name.endsWith('.socket') ? ('socket' as const) : ('service' as const), scope, load, active, sub },
    ];
  });
}

function parseShow(output: string): { mainPid: number | null; listen: string[] } {
  const props = new Map<string, string[]>();
  for (const line of output.split(/\r?\n/)) {
    const index = line.indexOf('=');
    if (index < 0) continue;
    const key = line.slice(0, index);
    const values = props.get(key) ?? [];
    values.push(line.slice(index + 1));
    props.set(key, values);
  }
  const rawPid = props.get('MainPID')?.[0] ?? '';
  const pid = /^\d+$/.test(rawPid) ? Number(rawPid) : 0;
  return { mainPid: pid > 0 && Number.isSafeInteger(pid) ? pid : null, listen: props.get('Listen') ?? [] };
}

function parseListen(value: string): { address: string | null; port: number | null } {
  const endpoint = value.replace(/^(?:Stream|Datagram|SequentialPacket|Special|FIFO)\s+/, '');
  const bracketed = /^\[([^\]]+)\]:(\d+)$/.exec(endpoint);
  const plain = /^([^:]*):(\d+)$/.exec(endpoint);
  const match = bracketed ?? plain;
  if (!match) return { address: null, port: null };
  const portText = match[2];
  const port = Number(portText);
  const address = bracketed?.[1] ?? plain?.[1] ?? '0.0.0.0';
  return Number.isInteger(port) && port > 0 && port <= 65535 ? { address, port } : { address: null, port: null };
}

function errorAvailability(error: unknown, scope: SystemdScope): ManagerStatus {
  const failure = error as NodeJS.ErrnoException & { stderr?: string | Buffer };
  const detail = `${failure.message ?? ''} ${String(failure.stderr ?? '')}`;
  if (failure.code === 'ENOENT') return 'not-installed';
  if (failure.code === 'EACCES' || failure.code === 'EPERM' || /access denied|permission denied/i.test(detail))
    return 'permission-denied';
  if (scope === 'user' && /failed to connect to bus|no medium found|not been booted with systemd/i.test(detail))
    return 'user-manager-unavailable';
  return 'unavailable';
}

export function discoverSystemdInventory(dependencies: SystemdDependencies = {}): SystemdInventory {
  if ((dependencies.platform ?? process.platform) !== 'linux')
    return {
      schemaVersion: 1,
      availability: 'unavailable',
      managers: { user: { status: 'unavailable' }, system: { status: 'unavailable' } },
      units: [],
      limitations: LIMITATIONS,
      observationTime: (dependencies.now ?? (() => new Date()))().toISOString(),
    };
  const run = dependencies.run ?? runSystemctl;
  let listeners: ListeningPort[] | null = null;
  try {
    listeners = (dependencies.listeners ?? discoverListeningPorts)();
  } catch {
    /* retain partial unit results */
  }
  const units: SystemdUnit[] = [];
  const managerStatuses: ManagerStatus[] = [];
  let partialResult = false;
  const managers: SystemdInventory['managers'] = { user: { status: 'unavailable' }, system: { status: 'unavailable' } };
  for (const scope of ['user', 'system'] as const) {
    let parsed: ReturnType<typeof parseListUnits>;
    try {
      parsed = parseListUnits(
        run(scope, ['list-units', '--all', '--type=service', '--type=socket', '--no-legend', '--no-pager']),
        scope,
      );
      managerStatuses.push('available');
      managers[scope] = { status: 'available' };
    } catch (error) {
      const status = errorAvailability(error, scope);
      managerStatuses.push(status);
      managers[scope] = { status };
      continue;
    }
    for (const unit of parsed) {
      try {
        const detail = parseShow(
          run(scope, ['show', '--no-pager', '--property=MainPID', '--property=Listen', unit.name]),
        );
        const processListenerPorts =
          detail.mainPid && listeners
            ? listeners
                .filter(
                  (listener) =>
                    listener.pid === detail.mainPid || listener.owners?.some(({ pid }) => pid === detail.mainPid),
                )
                .map(({ port }) => port)
            : [];
        const configuredSockets =
          unit.type === 'socket'
            ? detail.listen.map((value) => {
                const endpoint = parseListen(value);
                const observed =
                  endpoint.port === null
                    ? null
                    : listeners === null
                      ? null
                      : listeners.some(
                          (listener) =>
                            listener.protocol === 'tcp' &&
                            listener.port === endpoint.port &&
                            (!endpoint.address ||
                              endpoint.address === '0.0.0.0' ||
                              endpoint.address === '*' ||
                              listener.address === endpoint.address ||
                              listener.address === '0.0.0.0' ||
                              listener.address === '::'),
                        );
                return { ...endpoint, observed };
              })
            : [];
        units.push({
          ...unit,
          mainPid: detail.mainPid,
          processListenerPorts: [...new Set(processListenerPorts)].sort((a, b) => a - b),
          configuredSockets,
        });
      } catch {
        units.push({ ...unit, mainPid: null, processListenerPorts: [], configuredSockets: [] });
        partialResult = true;
      }
    }
  }
  const successful = managerStatuses.includes('available');
  const failure = managerStatuses.find((status) => status !== 'available');
  const availability = successful
    ? managerStatuses.some((status) => status !== 'available') || partialResult || !listeners
      ? 'partial'
      : 'available'
    : (failure ?? 'unavailable');
  return {
    schemaVersion: 1,
    availability,
    managers,
    units,
    limitations: LIMITATIONS,
    observationTime: (dependencies.now ?? (() => new Date()))().toISOString(),
  };
}

export function registerSystemdCommand(program: Command, dependencies: SystemdDependencies = {}): void {
  program
    .command('systemd')
    .description('Inspect visible user and system systemd service/socket units (read-only).')
    .option('--json', 'Print versioned JSON')
    .action((options: { json?: boolean }) => {
      const result = discoverSystemdInventory(dependencies);
      if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
      else if (!result.units.length)
        process.stdout.write(formatEmpty(`No visible systemd units (${result.availability}).`));
      else
        process.stdout.write(
          `${result.units.map((unit) => `${unit.scope} ${unit.name} ${unit.active}/${unit.sub}${unit.mainPid ? ` pid ${unit.mainPid}` : ''}`).join('\n')}\n`,
        );
    });
}
