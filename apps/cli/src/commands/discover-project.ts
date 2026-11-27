import { readdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import {
  applicationScopeFromCwd,
  type CheckoutMatch,
  isSupportingExecutable,
  matchCheckoutEvidence,
} from '@portcn/core';
import type { Command } from 'commander';
import { readCurrentNamespace } from './diagnose.js';
import {
  InvalidProjectDiscoveryInputError,
  JSON_SCHEMA_VERSION,
  jsonSchemaIsSupported,
  UnsupportedJsonVersionError,
} from './json.js';
import { discoverListeningPorts, type ListeningPort } from './list.js';
import {
  type GitMetadata,
  inspectProjectContext,
  type ProjectContext,
  readProcessStartTime,
  resolveGitProject,
} from './project-context.js';

export const PROJECT_DISCOVERY_JSON_VERSION = 1 as const;

export type ProjectRuntimeRole = 'application-listener' | 'application-process' | 'supporting-process';

export interface ProjectPortBinding {
  protocol: 'tcp' | 'udp';
  address: string;
  port: number;
  state: string;
  association: 'project-owner' | 'mixed-ownership' | 'unidentified-owner';
  ownerPids: number[];
  evidence: string[];
}

export interface ProjectRuntimeRecord {
  role: ProjectRuntimeRole;
  application: string | null;
  pid: number;
  processName: string | null;
  startTime: string | null;
  identityStable: boolean;
  checkoutMatch: CheckoutMatch;
  ports: ProjectPortBinding[];
  evidence: string[];
}

export interface ProjectDiscoveryResult {
  schemaVersion: typeof PROJECT_DISCOVERY_JSON_VERSION;
  status: 'complete' | 'partial';
  observedAt: string;
  visibility: 'full' | 'partial';
  project: {
    root: string;
    gitDir: string;
    gitCommonDir: string;
    branch: string | null;
    commit: string | null;
    worktree: boolean;
  };
  host: {
    hostId: string;
    pidNamespace: string | null;
    networkNamespace: string | null;
  };
  runtimes: ProjectRuntimeRecord[];
  unresolved: string[];
  limitations: string[];
}

export interface ProjectDiscoveryDependencies {
  platform?: NodeJS.Platform;
  resolveProject?: (directory: string) => GitMetadata | null;
  discoverListeners?: () => ListeningPort[];
  inspectProject?: (pid: number) => ProjectContext;
  readStartTime?: (pid: number) => string | null;
  listPids?: () => number[];
  hostname?: () => string;
  now?: () => Date;
  processScanLimit?: number;
}

function worktreeSelected(metadata: GitMetadata): boolean {
  return metadata.gitDir !== metadata.gitCommonDir;
}

function ownersFor(listener: ListeningPort): number[] {
  const pids = new Set<number>();
  for (const owner of listener.owners ?? []) {
    if (owner.pid > 0) pids.add(owner.pid);
  }
  if (listener.pid !== null && listener.pid > 0) pids.add(listener.pid);
  return [...pids].sort((left, right) => left - right);
}

function defaultPidScan(limit: number): number[] {
  const uid = process.getuid?.();
  if (uid === undefined) return [];
  const pids: number[] = [];
  for (const entry of readdirSync('/proc')) {
    if (!/^\d+$/.test(entry)) continue;
    const pid = Number(entry);
    if (!Number.isSafeInteger(pid) || pid <= 0) continue;
    try {
      const processUid = Number(/^Uid:\s+(\d+)/m.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))?.[1]);
      if (processUid !== uid) continue;
    } catch {
      continue;
    }
    pids.push(pid);
    if (pids.length >= limit) break;
  }
  return pids.sort((left, right) => left - right);
}

function evaluatePid(
  pid: number,
  expected: GitMetadata,
  dependencies: ProjectDiscoveryDependencies,
): { context: ProjectContext; startTime: string | null; stable: boolean; match: CheckoutMatch } | null {
  const readStartTime = dependencies.readStartTime ?? readProcessStartTime;
  const inspectProject = dependencies.inspectProject ?? inspectProjectContext;
  const initial = readStartTime(pid);
  if (initial === null) return null;
  const context = inspectProject(pid);
  const final = readStartTime(pid);
  const stable = final !== null && final === initial;
  if (!stable) return null;
  const match = matchCheckoutEvidence(expected, context);
  return { context, startTime: initial, stable, match };
}

export function discoverProjectRuntimes(
  projectDirectory: string,
  dependencies: ProjectDiscoveryDependencies = {},
): ProjectDiscoveryResult {
  const platform = dependencies.platform ?? process.platform;
  if (platform !== 'linux') throw new Error('Project discovery is available only on Linux.');
  if (!projectDirectory.trim()) throw new InvalidProjectDiscoveryInputError('A Git project path is required.');
  const resolveProject = dependencies.resolveProject ?? resolveGitProject;
  const expected = resolveProject(projectDirectory);
  if (!expected) throw new InvalidProjectDiscoveryInputError('Project path must resolve inside a Git repository.');
  const listeners = (dependencies.discoverListeners ?? discoverListeningPorts)();
  const observedAt = (dependencies.now ?? (() => new Date()))().toISOString();
  const hostId = dependencies.hostname?.() ?? hostname();
  const pidNamespace = readCurrentNamespace('pid');
  const networkNamespace = readCurrentNamespace('net');
  const limitations = [
    'Project discovery is read-only and limited to the current user, PID namespace, and network namespace.',
    'Git evidence is filesystem metadata and does not prove which source revision is loaded in memory.',
    'Processes can exit or change working directories after observation.',
  ];
  const unresolved: string[] = [];
  const scanLimit = dependencies.processScanLimit ?? 64;
  const listenerPids = new Set(listeners.flatMap((listener) => ownersFor(listener)));
  const scannedPids = new Set([...listenerPids, ...(dependencies.listPids ?? (() => defaultPidScan(scanLimit)))()]);
  const pidEvidence = new Map<
    number,
    { context: ProjectContext; startTime: string | null; stable: boolean; match: CheckoutMatch }
  >();
  for (const pid of [...scannedPids].sort((left, right) => left - right)) {
    const evaluated = evaluatePid(pid, expected, dependencies);
    if (evaluated) pidEvidence.set(pid, evaluated);
  }
  const portsByPid = new Map<number, ProjectPortBinding[]>();
  for (const listener of listeners) {
    const owners = ownersFor(listener);
    const projectOwners = owners.filter((pid) => pidEvidence.get(pid)?.match === 'matching');
    const unidentified = owners.filter((pid) => !pidEvidence.has(pid));
    const nonProject = owners.filter((pid) => {
      const match = pidEvidence.get(pid)?.match;
      return match !== undefined && match !== 'matching';
    });
    let association: ProjectPortBinding['association'] = 'unidentified-owner';
    let evidence: string[] = [];
    if (projectOwners.length && owners.length === projectOwners.length) {
      association = 'project-owner';
      evidence = ['Every visible socket owner matches the selected checkout.'];
    } else if (projectOwners.length) {
      association = 'mixed-ownership';
      evidence = ['Some visible socket owners match the selected checkout; others differ or are unresolved.'];
      if (unidentified.length)
        unresolved.push(
          `TCP/UDP ${listener.protocol} ${listener.address}:${listener.port} has unidentified owner PID(s) ${unidentified.join(', ')}.`,
        );
      if (nonProject.length)
        unresolved.push(
          `TCP/UDP ${listener.protocol} ${listener.address}:${listener.port} has owner PID(s) outside the selected worktree: ${nonProject.join(', ')}.`,
        );
    } else if (owners.length) {
      evidence = ['No visible owner matched the selected checkout.'];
      unresolved.push(
        `TCP/UDP ${listener.protocol} ${listener.address}:${listener.port} has no owner associated with this checkout.`,
      );
    }
    const binding: ProjectPortBinding = {
      protocol: listener.protocol,
      address: listener.address,
      port: listener.port,
      state: listener.state,
      association,
      ownerPids: owners,
      evidence,
    };
    for (const pid of projectOwners) {
      const existing = portsByPid.get(pid) ?? [];
      existing.push(binding);
      portsByPid.set(pid, existing);
    }
  }
  const runtimes: ProjectRuntimeRecord[] = [];
  for (const [pid, evaluated] of [...pidEvidence.entries()].sort(([left], [right]) => left - right)) {
    if (evaluated.match !== 'matching') continue;
    const ports = portsByPid.get(pid) ?? [];
    const role: ProjectRuntimeRole = ports.length
      ? 'application-listener'
      : isSupportingExecutable(evaluated.context.executable, null)
        ? 'supporting-process'
        : 'application-process';
    const application =
      applicationScopeFromCwd(expected.projectRoot, evaluated.context.cwd) ??
      applicationScopeFromCwd(
        expected.projectRoot,
        evaluated.context.ancestors.find((ancestor) => ancestor.cwd)?.cwd ?? null,
      );
    runtimes.push({
      role,
      application,
      pid,
      processName: evaluated.context.executable?.split('/').pop() ?? null,
      startTime: evaluated.startTime,
      identityStable: evaluated.stable,
      checkoutMatch: evaluated.match,
      ports,
      evidence: [
        `Checkout match: ${evaluated.match} (${evaluated.context.source ?? 'unknown'} evidence, ${evaluated.context.confidence} confidence).`,
        ...(evaluated.context.evidence.length ? evaluated.context.evidence.slice(0, 3) : []),
      ],
    });
  }
  const visibility: ProjectDiscoveryResult['visibility'] =
    unresolved.length || pidEvidence.size < scannedPids.size ? 'partial' : 'full';
  return {
    schemaVersion: PROJECT_DISCOVERY_JSON_VERSION,
    status: visibility === 'full' ? 'complete' : 'partial',
    observedAt,
    visibility,
    project: {
      root: expected.projectRoot,
      gitDir: expected.gitDir,
      gitCommonDir: expected.gitCommonDir,
      branch: expected.checkoutBranch,
      commit: expected.checkoutCommit,
      worktree: worktreeSelected(expected),
    },
    host: { hostId, pidNamespace, networkNamespace },
    runtimes,
    unresolved,
    limitations,
  };
}

function formatHuman(result: ProjectDiscoveryResult): string {
  const lines = [
    `Project ${result.project.root}${result.project.worktree ? `  Worktree ${result.project.root}` : ''}`,
    `Visibility ${result.visibility}${result.status === 'partial' ? ' (partial)' : ''}`,
    '',
    'Project runtimes',
  ];
  for (const runtime of result.runtimes) {
    const portSummary = runtime.ports.length
      ? runtime.ports.map((port) => `${port.protocol.toUpperCase()} ${port.address}:${port.port}`).join(', ')
      : 'Process only';
    const label = runtime.application ?? runtime.role;
    lines.push(`  ${label}  PID ${runtime.pid}  ${portSummary}  ${runtime.evidence[0] ?? ''}`);
  }
  if (result.unresolved.length) {
    lines.push('', 'Unresolved');
    for (const item of result.unresolved) lines.push(`  ${item}`);
  }
  if (result.limitations.length) {
    lines.push('', 'Limitations');
    for (const item of result.limitations) lines.push(`  - ${item}`);
  }
  return `${lines.join('\n')}\n`;
}

export function registerDiscoverProjectCommand(discover: Command): void {
  discover
    .command('project')
    .description('Discover native runtimes and listening ports for the current Git checkout (Linux, read-only).')
    .option('--project <path>', 'Git checkout path (defaults to the current working directory)')
    .option('--json', 'Print versioned JSON')
    .option('--json-version <version>', 'JSON schema version when using --json', String(JSON_SCHEMA_VERSION))
    .action((options: { project?: string; json?: boolean; jsonVersion?: string }) => {
      if (process.platform !== 'linux') throw new Error('Project discovery is available only on Linux.');
      const directory = options.project ?? process.cwd();
      const result = discoverProjectRuntimes(directory);
      if (options.json) {
        const jsonVersion = Number(options.jsonVersion ?? JSON_SCHEMA_VERSION);
        if (!jsonSchemaIsSupported(String(jsonVersion))) throw new UnsupportedJsonVersionError();
        process.stdout.write(`${JSON.stringify({ schemaVersion: jsonVersion, projectDiscovery: result }, null, 2)}\n`);
        return;
      }
      process.stdout.write(formatHuman(result));
    });
}
