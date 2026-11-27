import { readdirSync, readFileSync } from 'node:fs';
import { hostname } from 'node:os';
import {
  type ApplicationGroup,
  applicationScopeFromCwd,
  buildProjectDiscoverySummary,
  type CheckoutMatch,
  classifyProjectProcess,
  dedupeEvidenceLines,
  formatPortSummary,
  groupRuntimesByApplication,
  isPortcnInspectionProcess,
  listenerAttention,
  matchCheckoutEvidence,
  PROCESS_ROLE_DISPLAY_ORDER,
  type ProcessRole,
  type RuntimeState,
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
  readProcessCmdline,
  readProcessComm,
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
  processRole: ProcessRole;
  runtimeState: RuntimeState;
  application: string | null;
  pid: number;
  processName: string | null;
  executable: string | null;
  startTime: string | null;
  identityStable: boolean;
  checkoutMatch: CheckoutMatch;
  ports: ProjectPortBinding[];
  evidence: string[];
}

export interface ExcludedInspectionProcess {
  pid: number;
  processName: string | null;
  reason: 'portcn-inspection';
  evidence: string[];
}

export interface ListenerInventorySection {
  count: number;
  bindings: ProjectPortBinding[];
}

export interface ProjectDiscoveryResult {
  schemaVersion: typeof PROJECT_DISCOVERY_JSON_VERSION;
  status: 'complete' | 'partial';
  observedAt: string;
  visibility: 'full' | 'partial';
  summary: ReturnType<typeof buildProjectDiscoverySummary>;
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
  applications: ApplicationGroup[];
  supportingProcesses: ProjectRuntimeRecord[];
  runtimes: ProjectRuntimeRecord[];
  tentativeProcesses: Array<{ pid: number; processName: string | null; startTime: string | null }>;
  excluded: ExcludedInspectionProcess[];
  listenerInventory: {
    tentative: ListenerInventorySection;
    unrelated: ListenerInventorySection;
    ambiguous: ListenerInventorySection;
    unknownOwnership: ListenerInventorySection;
  };
  unresolved: string[];
  visibilityNotes: string[];
  limitations: string[];
}

export interface ProjectDiscoveryDependencies {
  platform?: NodeJS.Platform;
  resolveProject?: (directory: string) => GitMetadata | null;
  discoverListeners?: () => ListeningPort[];
  inspectProject?: (pid: number) => ProjectContext;
  readStartTime?: (pid: number) => string | null;
  readComm?: (pid: number) => string | null;
  readCmdline?: (pid: number) => string | null;
  listPids?: () => number[];
  hostname?: () => string;
  now?: () => Date;
  processScanLimit?: number;
  selfPid?: number;
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

function ownerProcessName(listener: ListeningPort, pid: number): string | null {
  return listener.owners?.find((owner) => owner.pid === pid)?.processName ?? listener.processName ?? null;
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
): {
  context: ProjectContext;
  startTime: string | null;
  stable: boolean;
  match: CheckoutMatch;
  comm: string | null;
  cmdline: string | null;
} | null {
  const readStartTime = dependencies.readStartTime ?? readProcessStartTime;
  const inspectProject = dependencies.inspectProject ?? inspectProjectContext;
  const readComm = dependencies.readComm ?? readProcessComm;
  const readCmdline = dependencies.readCmdline ?? readProcessCmdline;
  const initial = readStartTime(pid);
  if (initial === null) return null;
  const context = inspectProject(pid);
  const comm = readComm(pid);
  const cmdline = readCmdline(pid);
  const final = readStartTime(pid);
  const stable = final !== null && final === initial;
  if (!stable) return null;
  // A parent launcher may belong to another checkout. The context reader
  // selects the owner's Git metadata first and retains the conflicting ancestry.
  const ownerCheckout = context.status === 'ambiguous' && context.source === 'owner';
  const match = matchCheckoutEvidence(expected, ownerCheckout ? { ...context, status: 'identified' } : context);
  return {
    context,
    startTime: initial,
    stable,
    match,
    comm,
    cmdline,
  };
}

function buildRuntimeRecord(
  pid: number,
  evaluated: NonNullable<ReturnType<typeof evaluatePid>>,
  expected: GitMetadata,
  ports: ProjectPortBinding[],
): ProjectRuntimeRecord {
  const application =
    applicationScopeFromCwd(expected.projectRoot, evaluated.context.cwd) ??
    applicationScopeFromCwd(
      expected.projectRoot,
      evaluated.context.ancestors.find((ancestor) => ancestor.cwd)?.cwd ?? null,
    );
  const processName = evaluated.comm ?? evaluated.context.executable?.split('/').pop() ?? null;
  const checkoutLine = `Checkout match: ${evaluated.match} (${evaluated.context.source ?? 'unknown'} evidence, ${evaluated.context.confidence} confidence).`;
  const classification = classifyProjectProcess({
    comm: evaluated.comm,
    executable: evaluated.context.executable,
    cmdline: evaluated.cmdline,
    applicationScope: application,
    checkoutMatch: evaluated.match,
    projectListenerBindings: ports.length,
  });
  return {
    role: classification.role,
    processRole: classification.processRole,
    runtimeState: classification.runtimeState,
    application,
    pid,
    processName,
    executable: evaluated.context.executable,
    startTime: evaluated.startTime,
    identityStable: evaluated.stable,
    checkoutMatch: evaluated.match,
    ports,
    evidence: dedupeEvidenceLines([checkoutLine, ...classification.evidence, ...evaluated.context.evidence]),
  };
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
  const pidEvidence = new Map<number, NonNullable<ReturnType<typeof evaluatePid>>>();
  for (const pid of [...scannedPids].sort((left, right) => left - right)) {
    const evaluated = evaluatePid(pid, expected, dependencies);
    if (evaluated) pidEvidence.set(pid, evaluated);
  }
  const selfPid = dependencies.selfPid ?? process.pid;
  const excluded: ExcludedInspectionProcess[] = [];
  const tentativeProcesses: ProjectDiscoveryResult['tentativeProcesses'] = [];
  const tentativeBindings: ProjectPortBinding[] = [];
  const unrelatedBindings: ProjectPortBinding[] = [];
  const ambiguousBindings: ProjectPortBinding[] = [];
  const unknownOwnershipBindings: ProjectPortBinding[] = [];
  const portsByPid = new Map<number, ProjectPortBinding[]>();
  for (const listener of listeners) {
    const owners = ownersFor(listener);
    const matchingOwners = owners.filter((pid) => pidEvidence.get(pid)?.match === 'matching');
    const projectOwners = matchingOwners.filter((pid) => pidEvidence.get(pid)?.context.source === 'owner');
    const tentativeOnly = matchingOwners.length > 0 && projectOwners.length === 0;
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
    } else if (owners.length) {
      evidence = ['No visible owner matched the selected checkout.'];
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
    if (tentativeOnly) {
      binding.evidence = ['A visible owner has matching ancestor evidence, without direct checkout ownership.'];
      tentativeBindings.push(binding);
      continue;
    }
    const attention = listenerAttention(binding, association);
    if (attention === 'unrelated-host') {
      unrelatedBindings.push(binding);
    } else if (attention === 'unknown-ownership') {
      unknownOwnershipBindings.push(binding);
    } else if (attention === 'non-project-owner') {
      ambiguousBindings.push(binding);
      if (association === 'mixed-ownership' && projectOwners.length) {
        if (unidentified.length) {
          const names = unidentified.map((pid) => ownerProcessName(listener, pid) ?? `pid ${pid}`).join(', ');
          unresolved.push(
            `${listener.protocol.toUpperCase()} ${listener.address}:${listener.port} has unidentified owner(s): ${names}.`,
          );
        }
        if (nonProject.length) {
          unresolved.push(
            `${listener.protocol.toUpperCase()} ${listener.address}:${listener.port} has owner PID(s) outside the selected worktree: ${nonProject.join(', ')}.`,
          );
        }
      } else if (projectOwners.length === 0 && owners.length && nonProject.length) {
        unresolved.push(
          `${listener.protocol.toUpperCase()} ${listener.address}:${listener.port} is owned only by non-project process(es): ${nonProject.join(', ')}.`,
        );
      }
    }
    for (const pid of projectOwners) {
      const existing = portsByPid.get(pid) ?? [];
      existing.push(binding);
      portsByPid.set(pid, existing);
    }
  }
  const runtimes: ProjectRuntimeRecord[] = [];
  for (const [pid, evaluated] of [...pidEvidence.entries()].sort(([left], [right]) => left - right)) {
    if (evaluated.match !== 'matching') continue;
    if (
      isPortcnInspectionProcess(evaluated.context.executable, evaluated.cmdline, {
        pid,
        selfPid,
      })
    ) {
      excluded.push({
        pid,
        processName: evaluated.comm ?? evaluated.context.executable?.split('/').pop() ?? null,
        reason: 'portcn-inspection',
        evidence: dedupeEvidenceLines([
          'Inspection identity was checked against the current process.',
          'Portcn inspection processes are omitted from project runtimes.',
        ]),
      });
      continue;
    }
    if (evaluated.context.source === 'ancestor') {
      tentativeProcesses.push({ pid, processName: evaluated.comm, startTime: evaluated.startTime });
      continue;
    }
    const ports = portsByPid.get(pid) ?? [];
    runtimes.push(buildRuntimeRecord(pid, evaluated, expected, ports));
  }
  const supportingProcesses = runtimes.filter(
    (runtime) =>
      runtime.processRole === 'editor' ||
      runtime.processRole === 'shell' ||
      runtime.processRole === 'development-tooling',
  );
  const applications = groupRuntimesByApplication(
    runtimes.filter((runtime) => ['application-server', 'application-worker'].includes(runtime.processRole)),
  );
  const projectListenerBindings = runtimes.reduce((count, runtime) => count + runtime.ports.length, 0);
  const summary = buildProjectDiscoverySummary({
    runtimes: runtimes.map((runtime) => ({
      processRole: runtime.processRole,
      runtimeState: runtime.runtimeState,
      association: { checkoutMatch: runtime.checkoutMatch, applicationScope: runtime.application },
    })),
    excludedCount: excluded.length,
    unrelatedHostListeners: unrelatedBindings.length,
    unknownOwnershipListeners: unknownOwnershipBindings.length,
    projectRelevantListeners: ambiguousBindings.length,
    projectListenerBindings,
  });
  const visibilityNotes: string[] = [];
  if (unrelatedBindings.length) {
    visibilityNotes.push(
      `${unrelatedBindings.length} listener(s) on this host are unrelated multicast, Docker bridge, or ephemeral UDP sockets. They remain in JSON listenerInventory.unrelated and are hidden from the default terminal view.`,
    );
  }
  if (unknownOwnershipBindings.length) {
    visibilityNotes.push(
      `${unknownOwnershipBindings.length} listener(s) have no visible owner; they are not treated as project runtimes without association evidence (see listenerInventory.unknownOwnership).`,
    );
  }
  if (ambiguousBindings.length) {
    visibilityNotes.push(
      `${ambiguousBindings.length} listener(s) have mixed or non-project owners with enough context to investigate (see unresolved).`,
    );
  }
  const uninspiable = scannedPids.size - pidEvidence.size;
  if (uninspiable > 0) {
    visibilityNotes.push(
      `${uninspiable} scanned process(es) could not be attributed (exited during inspection, permissions, or PID reuse).`,
    );
  }
  if (excluded.length) {
    visibilityNotes.push(
      `${excluded.length} Portcn inspection process(es) were excluded so discovery does not report itself.`,
    );
  }
  const visibility: ProjectDiscoveryResult['visibility'] =
    tentativeProcesses.length ||
    unresolved.length ||
    pidEvidence.size < scannedPids.size ||
    unrelatedBindings.length ||
    ambiguousBindings.length ||
    unknownOwnershipBindings.length
      ? 'partial'
      : 'full';
  return {
    schemaVersion: PROJECT_DISCOVERY_JSON_VERSION,
    status: visibility === 'full' ? 'complete' : 'partial',
    observedAt,
    visibility,
    summary,
    project: {
      root: expected.projectRoot,
      gitDir: expected.gitDir,
      gitCommonDir: expected.gitCommonDir,
      branch: expected.checkoutBranch,
      commit: expected.checkoutCommit,
      worktree: worktreeSelected(expected),
    },
    host: { hostId, pidNamespace, networkNamespace },
    applications,
    supportingProcesses,
    tentativeProcesses,
    runtimes,
    excluded,
    listenerInventory: {
      tentative: { count: tentativeBindings.length, bindings: tentativeBindings },
      unrelated: { count: unrelatedBindings.length, bindings: unrelatedBindings },
      ambiguous: { count: ambiguousBindings.length, bindings: ambiguousBindings },
      unknownOwnership: { count: unknownOwnershipBindings.length, bindings: unknownOwnershipBindings },
    },
    unresolved: dedupeEvidenceLines(unresolved),
    visibilityNotes,
    limitations,
  };
}

function formatProcessRoleLabel(role: ProcessRole): string {
  return role.replace(/-/g, ' ');
}

function formatHuman(result: ProjectDiscoveryResult, verbose: boolean): string {
  const commit = result.project.commit ? ` @ ${result.project.commit.slice(0, 7)}` : '';
  const branch = result.project.branch ? ` on ${result.project.branch}` : '';
  const displayedApplicationGroups = result.applications.length;
  const lines = [
    `Project ${result.project.root}${branch}${commit}`,
    `Observed ${result.observedAt}  Host ${result.host.hostId}  Visibility ${result.visibility}`,
    '',
    'Summary',
    `  ${displayedApplicationGroups} application scope(s); ${result.summary.applicationServers} server(s); ${result.summary.applicationWorkers} worker(s); ${result.summary.supportingProcesses} supporting/tooling; ${result.summary.projectListenerBindings} project binding(s).`,
    `  ${result.summary.unrelatedHostListeners} unrelated (positive evidence); ${result.summary.unknownOwnershipListeners} unknown ownership; ${result.summary.ambiguousProjectListeners} mixed/non-project socket(s); ${result.summary.excludedInspectionProcesses} excluded inspection process(es).`,
  ];
  if (result.summary.applicationServers === 0) lines.push('  No associated application server was observed.');
  if (result.tentativeProcesses.length)
    lines.push(
      `  ${result.tentativeProcesses.length} process(es) associated only through ancestry; ${result.listenerInventory.tentative.count} tentative listener(s).`,
    );
  if (result.visibilityNotes.length) {
    lines.push('', 'Visibility');
    for (const note of result.visibilityNotes) lines.push(`  - ${note}`);
  }
  if (result.applications.length) {
    lines.push('', 'Application scopes');
    for (const group of result.applications) {
      lines.push(`  ${group.scope}`);
      for (const stub of [...group.listeners, ...group.workers].sort((left, right) => left.pid - right.pid)) {
        const runtime = result.runtimes.find((entry) => entry.pid === stub.pid);
        if (!runtime) continue;
        const ports = runtime.ports.length ? formatPortSummary(runtime.ports) : 'process only';
        lines.push(
          `    ${runtime.processName ?? 'process'}  PID ${runtime.pid}  ${formatProcessRoleLabel(runtime.processRole)}  ${ports}${verbose ? `  ${runtime.evidence[0] ?? ''}` : ''}`,
        );
      }
    }
  }
  const infrastructureRoles = new Set<ProcessRole>([
    'development-tooling',
    'task-orchestrator',
    'container-infrastructure',
    'network-forwarding',
    'unknown',
  ]);
  const infrastructure = result.runtimes.filter((runtime) => infrastructureRoles.has(runtime.processRole));
  if (infrastructure.length) {
    lines.push('', 'Tooling and infrastructure');
    for (const role of PROCESS_ROLE_DISPLAY_ORDER) {
      const bucket = infrastructure.filter((runtime) => runtime.processRole === role);
      if (!bucket.length) continue;
      for (const runtime of bucket.sort((left, right) => left.pid - right.pid)) {
        const ports = runtime.ports.length ? formatPortSummary(runtime.ports) : 'process only';
        lines.push(
          `  ${runtime.processName ?? 'process'}  PID ${runtime.pid}  ${formatProcessRoleLabel(role)}  ${ports}${verbose ? `  ${runtime.evidence[0] ?? ''}` : ''}`,
        );
      }
    }
  }
  const editors = result.runtimes.filter(
    (runtime) => runtime.processRole === 'editor' || runtime.processRole === 'shell',
  );
  if (editors.length) {
    lines.push('', 'Editors and shells');
    for (const runtime of editors.sort((left, right) => left.pid - right.pid)) {
      lines.push(
        `  ${runtime.processName ?? 'process'}  PID ${runtime.pid}  ${formatProcessRoleLabel(runtime.processRole)}${verbose ? `  ${runtime.evidence[0] ?? ''}` : ''}`,
      );
    }
  }
  if (result.excluded.length) {
    lines.push('', 'Excluded');
    for (const entry of result.excluded) {
      lines.push(`  ${entry.processName ?? 'process'}  PID ${entry.pid}  ${entry.reason}`);
    }
  }
  if (result.unresolved.length) {
    lines.push('', 'Unresolved (project-relevant)');
    for (const item of result.unresolved) lines.push(`  ${item}`);
  }
  if (verbose) {
    if (result.listenerInventory.unrelated.bindings.length) {
      lines.push('', 'Unrelated host listeners (verbose)');
      for (const binding of result.listenerInventory.unrelated.bindings) {
        lines.push(`  ${binding.protocol.toUpperCase()} ${binding.address}:${binding.port}  ${binding.state}`);
      }
    }
    if (result.listenerInventory.ambiguous.bindings.length) {
      lines.push('', 'Mixed or non-project listeners (verbose)');
      for (const binding of result.listenerInventory.ambiguous.bindings) {
        lines.push(
          `  ${binding.protocol.toUpperCase()} ${binding.address}:${binding.port}  ${binding.association}  owners ${binding.ownerPids.join(', ') || 'none'}`,
        );
      }
    }
    if (result.listenerInventory.unknownOwnership.bindings.length) {
      lines.push('', 'Unknown ownership listeners (verbose)');
      for (const binding of result.listenerInventory.unknownOwnership.bindings) {
        lines.push(`  ${binding.protocol.toUpperCase()} ${binding.address}:${binding.port}  ${binding.state}`);
      }
    }
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
    .option('--verbose', 'Include detailed evidence and full unrelated listener inventory')
    .option('--json', 'Print versioned JSON')
    .option('--json-version <version>', 'JSON schema version when using --json', String(JSON_SCHEMA_VERSION))
    .action((options: { project?: string; json?: boolean; jsonVersion?: string; verbose?: boolean }) => {
      if (process.platform !== 'linux') throw new Error('Project discovery is available only on Linux.');
      const directory = options.project ?? process.cwd();
      const result = discoverProjectRuntimes(directory);
      if (options.json) {
        const jsonVersion = Number(options.jsonVersion ?? JSON_SCHEMA_VERSION);
        if (!jsonSchemaIsSupported(String(jsonVersion))) throw new UnsupportedJsonVersionError();
        process.stdout.write(`${JSON.stringify({ schemaVersion: jsonVersion, projectDiscovery: result }, null, 2)}\n`);
        return;
      }
      process.stdout.write(formatHuman(result, Boolean(options.verbose)));
    });
}
