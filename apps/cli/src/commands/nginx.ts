import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import type { Command } from 'commander';
import { formatEmpty } from '../terminal.js';
import type { ListeningPort } from './list.js';
import { discoverListeningPorts } from './list.js';

export interface NginxVirtualHost {
  source: string;
  serverNames: string[];
  listeners: Array<{
    address: string;
    port: number;
    protocol: 'tcp';
    state: 'configured' | 'observed' | 'not-observed' | 'unknown';
  }>;
}
export interface NginxInventory {
  schemaVersion: 1;
  availability: 'available' | 'not-installed' | 'permission-denied' | 'unavailable' | 'partial';
  processes: Array<{ pid: number; executable: string }>;
  servers: NginxVirtualHost[];
  limitations: string[];
}
export interface NginxDependencies {
  platform?: NodeJS.Platform;
  configPath?: string;
  readFile?: (path: string) => string;
  readDirectory?: (path: string) => string[];
  realpath?: (path: string) => string;
  stat?: (path: string) => { isFile(): boolean };
  listeners?: () => ListeningPort[];
  processIds?: () => number[];
  executable?: (pid: number) => string | null;
}

const LIMITATIONS = [
  'Nginx configuration is configured evidence. It does not prove a worker is active, a socket is reachable, or a virtual host responds.',
  'Only readable local configuration files reachable through bounded include patterns are considered; remote, container, chroot, and alternate mount-namespace configuration may differ.',
  'Portcn does not invoke Nginx, elevate privileges, reload configuration, or expose unrelated configuration values.',
];
const readText = (path: string) => readFileSync(path, 'utf8');
const listDirectory = (path: string) => readdirSync(path);
const resolveRealpath = (path: string) => realpathSync(path);
const getStat = (path: string) => statSync(path);

function expandInclude(pattern: string, directory: string, readDirectory: (path: string) => string[]): string[] {
  const absolute = isAbsolute(pattern) ? pattern : resolve(directory, pattern);
  if (!absolute.includes('*')) return [absolute];
  const slash = absolute.lastIndexOf('/');
  const parent = absolute.slice(0, slash) || '/';
  const filename = absolute.slice(slash + 1);
  const regex = new RegExp(
    `^${filename
      .split('*')
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
  );
  try {
    return readDirectory(parent)
      .filter((name) => regex.test(name))
      .map((name) => join(parent, name));
  } catch {
    return [];
  }
}

function parseListen(value: string): { address: string; port: number } | null {
  const endpoint = value.trim().split(/\s+/)[0]?.replace(/;$/, '');
  if (!endpoint) return null;
  const match = /^\[(.+)\]:(\d+)$/.exec(endpoint) ?? /^([^:]+):(\d+)$/.exec(endpoint);
  const wildcard = /^:(\d+)$/.exec(endpoint);
  if (wildcard) {
    const port = Number(wildcard[1]);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? { address: '0.0.0.0', port } : null;
  }
  if (!match) {
    const portOnly = /^(\d+)$/.exec(endpoint);
    if (!portOnly) return null;
    const port = Number(portOnly[1]);
    return Number.isInteger(port) && port > 0 && port <= 65535 ? { address: '0.0.0.0', port } : null;
  }
  const port = Number(match[2]);
  const address = match[1];
  return Number.isInteger(port) && port > 0 && port <= 65535 && address ? { address, port } : null;
}

export function discoverNginxInventory(dependencies: NginxDependencies = {}): NginxInventory {
  const platform = dependencies.platform ?? process.platform;
  const base: NginxInventory = {
    schemaVersion: 1,
    availability: 'unavailable',
    processes: [],
    servers: [],
    limitations: LIMITATIONS,
  };
  if (platform !== 'linux') return base;
  const readFile = dependencies.readFile ?? readText;
  const readDirectory = dependencies.readDirectory ?? listDirectory;
  const realpath = dependencies.realpath ?? resolveRealpath;
  const stat = dependencies.stat ?? getStat;
  let pids: number[] = [];
  try {
    pids =
      dependencies.processIds?.() ??
      readDirectory('/proc')
        .filter((entry) => /^\d+$/.test(entry))
        .map(Number);
  } catch {
    /* process visibility is optional */
  }
  const executable =
    dependencies.executable ??
    ((pid) => {
      try {
        return realpath(`/proc/${pid}/exe`);
      } catch {
        return null;
      }
    });
  const processes = pids.flatMap((pid) => {
    const path = executable(pid);
    return path &&
      path
        .replace(/\s+\(deleted\)$/, '')
        .split('/')
        .pop() === 'nginx'
      ? [{ pid, executable: path }]
      : [];
  });
  const root = dependencies.configPath ?? '/etc/nginx/nginx.conf';
  const visited = new Set<string>();
  const servers: NginxVirtualHost[] = [];
  let partial = false;
  let fileCount = 0;
  const walk = (file: string): void => {
    if (fileCount >= 256) {
      partial = true;
      return;
    }
    let canonical: string;
    try {
      canonical = realpath(file);
      if (visited.has(canonical) || !stat(canonical).isFile()) return;
      visited.add(canonical);
      fileCount += 1;
    } catch {
      partial = true;
      return;
    }
    let content: string;
    try {
      content = readFile(canonical);
    } catch {
      partial = true;
      return;
    }
    const lines = content.replace(/#[^\n]*/g, '').split(/[;{}]/);
    let current: NginxVirtualHost | null = null;
    for (const raw of lines) {
      const line = raw.trim();
      if (/^server\s*$/.test(line)) {
        if (current) servers.push(current);
        current = { source: canonical, serverNames: [], listeners: [] };
        continue;
      }
      if (line.startsWith('include ')) {
        const include = line.slice('include '.length).trim();
        const targets = expandInclude(include, dirname(canonical), readDirectory);
        if (!targets.length) partial = true;
        for (const target of targets) walk(target);
        continue;
      }
      if (!current) continue;
      const listen = /^listen\s+(.+)$/.exec(line);
      if (listen?.[1]) {
        const parsed = parseListen(listen[1]);
        if (parsed && !current.listeners.some((item) => item.address === parsed.address && item.port === parsed.port))
          current.listeners.push({ ...parsed, protocol: 'tcp', state: 'configured' });
      }
      const names = /^server_name\s+(.+)$/.exec(line);
      if (names?.[1])
        current.serverNames.push(...names[1].split(/\s+/).filter((name) => name !== '_' && /^[\w.*-]+$/.test(name)));
    }
    if (current) servers.push(current);
  };
  walk(root);
  if (!visited.size) return { ...base, availability: 'not-installed' };
  let listeners: ListeningPort[] | null = null;
  try {
    listeners = (dependencies.listeners ?? discoverListeningPorts)();
  } catch {
    partial = true;
  }
  const enriched = servers.map((server) => ({
    ...server,
    listeners: server.listeners.map((listener) => {
      if (!listeners) return { ...listener, state: 'unknown' as const };
      const observed = listeners.some(
        (candidate) =>
          candidate.protocol === 'tcp' &&
          candidate.port === listener.port &&
          (listener.address === '0.0.0.0' ||
            listener.address === '*' ||
            candidate.address === listener.address ||
            candidate.address === '0.0.0.0' ||
            candidate.address === '::'),
      );
      return { ...listener, state: observed ? ('observed' as const) : ('not-observed' as const) };
    }),
  }));
  return { ...base, availability: partial ? 'partial' : 'available', processes, servers: enriched };
}

export function registerNginxCommand(program: Command, dependencies: NginxDependencies = {}): void {
  program
    .command('nginx')
    .description('Inspect readable local Nginx configuration and visible processes (read-only).')
    .option('--config <path>', 'Nginx configuration entry file', '/etc/nginx/nginx.conf')
    .option('--json', 'Print versioned JSON')
    .action((options: { config?: string; json?: boolean }) => {
      const result = discoverNginxInventory({ ...dependencies, configPath: dependencies.configPath ?? options.config });
      if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
      else if (!result.servers.length) process.stdout.write(formatEmpty('No readable Nginx server blocks found.'));
      else
        process.stdout.write(
          `${result.servers.map((server) => `${server.serverNames.join(', ') || '(unnamed)'}: ${server.listeners.map((item) => `${item.address}:${item.port} ${item.state}`).join(', ')}`).join('\n')}\n`,
        );
    });
}
