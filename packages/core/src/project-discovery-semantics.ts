import { type CheckoutMatch, isSupportingExecutable } from './project-discovery.js';

export type ProcessRole =
  | 'application-server'
  | 'application-worker'
  | 'development-tooling'
  | 'editor'
  | 'shell'
  | 'task-orchestrator'
  | 'container-infrastructure'
  | 'network-forwarding'
  | 'unknown';

export type RuntimeState = 'listening' | 'running' | 'forwarding';

export type ProjectRuntimeRole = 'application-listener' | 'application-process' | 'supporting-process';

export interface ProcessIdentity {
  comm: string | null;
  executable: string | null;
  displayName: string;
}

export interface ProcessAssociation {
  checkoutMatch: CheckoutMatch;
  applicationScope: string | null;
}

export interface ProcessClassification {
  identity: ProcessIdentity;
  association: ProcessAssociation;
  processRole: ProcessRole;
  runtimeState: RuntimeState;
  /** @deprecated Use processRole and runtimeState; kept for schema version 1 consumers. */
  role: ProjectRuntimeRole;
  evidence: string[];
}

export interface ProcessClassificationInput {
  comm: string | null;
  executable: string | null;
  cmdline: string | null;
  applicationScope: string | null;
  checkoutMatch: CheckoutMatch;
  projectListenerBindings: number;
}

export function processDisplayName(
  comm: string | null,
  executable: string | null,
  applicationScope: string | null,
): string {
  if (applicationScope) return applicationScope;
  const commName = comm?.trim();
  if (commName) return commName;
  const base = executable?.split('/').pop()?.trim();
  if (base) return base;
  return 'unknown';
}

export function classifyRuntimeState(processRole: ProcessRole, projectListenerBindings: number): RuntimeState {
  if (processRole === 'network-forwarding' && projectListenerBindings > 0) return 'forwarding';
  if (projectListenerBindings > 0) return 'listening';
  return 'running';
}

export function legacyRuntimeRole(processRole: ProcessRole, runtimeState: RuntimeState): ProjectRuntimeRole {
  if (runtimeState === 'listening' || runtimeState === 'forwarding') return 'application-listener';
  if (processRole === 'application-worker') return 'application-process';
  if (processRole === 'application-server') return 'application-process';
  return 'supporting-process';
}

/** Evidence-backed process role; does not treat every matching checkout process as an application worker. */
export function classifyProcessRole(input: ProcessClassificationInput): {
  processRole: ProcessRole;
  evidence: string[];
} {
  const comm = (input.comm ?? '').toLowerCase();
  const base = (input.executable?.split('/').pop() ?? comm).toLowerCase();
  const cmd = (input.cmdline ?? '').toLowerCase();
  const scoped =
    Boolean(input.applicationScope?.startsWith('apps/')) || Boolean(input.applicationScope?.startsWith('packages/'));

  if (comm === 'conmon' || base === 'conmon') {
    return { processRole: 'container-infrastructure', evidence: ['Process name matches conmon.'] };
  }
  if (comm === 'exe' || base === 'exe' || base === 'pause') {
    return {
      processRole: 'container-infrastructure',
      evidence: ['Generic executable name consistent with container pause/helper processes.'],
    };
  }
  if (comm === 'rootlessport' || base === 'rootlessport' || cmd.includes('rootlessport')) {
    return {
      processRole: 'network-forwarding',
      evidence: ['Process name or command line matches rootlessport forwarding.'],
    };
  }
  if (comm === 'nginx' || base === 'nginx') {
    if (scoped) {
      return {
        processRole: input.projectListenerBindings > 0 ? 'application-server' : 'application-worker',
        evidence: ['nginx with working directory under an application path.'],
      };
    }
    return { processRole: 'unknown', evidence: ['nginx without application scope under the selected checkout.'] };
  }
  if (comm === 'node_repl' || cmd.includes(' node_repl') || cmd.endsWith('repl')) {
    return { processRole: 'development-tooling', evidence: ['Process name indicates an interactive Node REPL.'] };
  }
  if (comm === 'biome' || base === 'biome' || cmd.includes(' biome ')) {
    return { processRole: 'task-orchestrator', evidence: ['Process name matches Biome.'] };
  }
  if (comm === 'cursor' || base === 'cursor' || comm === 'code' || base === 'code') {
    return { processRole: 'editor', evidence: ['Process name matches an editor executable.'] };
  }
  if (isSupportingExecutable(input.executable, input.comm)) {
    return { processRole: 'shell', evidence: ['Process name matches a known shell or terminal multiplexer.'] };
  }
  const isNode = comm === 'node' || comm.startsWith('node') || base === 'node';
  if (isNode) {
    if (input.projectListenerBindings > 0 && scoped) {
      return {
        processRole: 'application-server',
        evidence: ['Node process owns a project-attributed listener with application scope.'],
      };
    }
    if (
      scoped &&
      (cmd.includes(' next') || cmd.includes('next dev') || cmd.includes('next-server') || cmd.includes('next start'))
    ) {
      return {
        processRole: input.projectListenerBindings > 0 ? 'application-server' : 'application-worker',
        evidence: ['Command line references Next.js under application scope.'],
      };
    }
    if (scoped && (cmd.includes(' vite') || cmd.includes('webpack') || cmd.includes('nest start'))) {
      return {
        processRole: input.projectListenerBindings > 0 ? 'application-server' : 'application-worker',
        evidence: ['Command line references an application dev runtime under application scope.'],
      };
    }
    if (scoped && (cmd.includes('vitest') || cmd.includes('jest') || cmd.includes(' test'))) {
      return {
        processRole: 'task-orchestrator',
        evidence: ['Command line references a test runner in application scope.'],
      };
    }
    if (scoped && (cmd.includes('tsup') || cmd.includes('turbo') || cmd.includes('tsx watch'))) {
      return {
        processRole: 'task-orchestrator',
        evidence: ['Command line references build/watch tooling in application scope.'],
      };
    }
    if (scoped) {
      return {
        processRole: 'development-tooling',
        evidence: ['Application scope present without listener or explicit application runtime command evidence.'],
      };
    }
    return {
      processRole: 'development-tooling',
      evidence: ['Node process lacks application scope and project listener ownership evidence.'],
    };
  }
  if (comm === 'turbo' || base === 'turbo') {
    return { processRole: 'task-orchestrator', evidence: ['Process name matches turbo task orchestrator.'] };
  }
  if (!comm && !base) {
    return { processRole: 'unknown', evidence: ['Process comm and executable path were unavailable.'] };
  }
  return { processRole: 'unknown', evidence: ['No evidence-backed process role rule matched.'] };
}

export function classifyProjectProcess(input: ProcessClassificationInput): ProcessClassification {
  const { processRole, evidence: roleEvidence } = classifyProcessRole(input);
  const runtimeState = classifyRuntimeState(processRole, input.projectListenerBindings);
  const identity: ProcessIdentity = {
    comm: input.comm,
    executable: input.executable,
    displayName: processDisplayName(input.comm, input.executable, input.applicationScope),
  };
  return {
    identity,
    association: {
      checkoutMatch: input.checkoutMatch,
      applicationScope: input.applicationScope,
    },
    processRole,
    runtimeState,
    role: legacyRuntimeRole(processRole, runtimeState),
    evidence: roleEvidence,
  };
}

export type ListenerAttention = 'project' | 'unrelated-host' | 'unknown-ownership' | 'non-project-owner';

export interface PortBindingLike {
  protocol: 'tcp' | 'udp';
  address: string;
  port: number;
  state: string;
}

export type SocketAssociation = 'project-owner' | 'mixed-ownership' | 'unidentified-owner';

/**
 * Classifies listener visibility without treating unknown ownership as unrelated or ownerless loopback as project-relevant.
 */
export function listenerAttention(binding: PortBindingLike, association: SocketAssociation): ListenerAttention {
  if (association === 'project-owner') return 'project';
  if (association === 'mixed-ownership') return 'non-project-owner';
  if (association === 'unidentified-owner') {
    if (isPositiveUnrelatedHostListener(binding)) return 'unrelated-host';
    return 'unknown-ownership';
  }
  if (isPositiveUnrelatedHostListener(binding)) return 'unrelated-host';
  return 'non-project-owner';
}

/** Positive evidence that a listener is host-wide noise, not merely unowned. */
export function isPositiveUnrelatedHostListener(binding: PortBindingLike): boolean {
  const { protocol, address, port, state } = binding;
  if (protocol === 'tcp' && state === 'LISTEN') {
    if (port === 22 || port === 631) return true;
    if ((address === '0.0.0.0' || address === '::' || address === '*') && (port === 80 || port === 443)) return true;
  }
  if (protocol === 'udp') {
    if (port === 3702 || port === 5353 || port === 1900) return true;
    if (address.startsWith('224.') || address.startsWith('239.') || address === '224.0.0.251') return true;
    if (address.startsWith('[ff') || address.includes('%') || address.startsWith('[fe80:')) return true;
    if (/^172\.(1[89]|2\d|3[01])\.\d+\.\d+$/.test(address)) return true;
    if ((address === '*' || address === '0.0.0.0' || address === '::') && port >= 32768) return true;
  }
  if (protocol === 'tcp' && /^172\.(1[89]|2\d|3[01])\.\d+\.\d+$/.test(address)) return true;
  return false;
}

export interface DisplaySummaryInput {
  runtimes: Array<{ processRole: ProcessRole; runtimeState: RuntimeState; association: ProcessAssociation }>;
  excludedCount: number;
  unrelatedHostListeners: number;
  unknownOwnershipListeners: number;
  projectRelevantListeners: number;
}

export interface ProjectDiscoverySummaryV1 {
  applicationGroups: number;
  listenerProcesses: number;
  workerProcesses: number;
  supportingProcesses: number;
  excludedInspectionProcesses: number;
  projectListenerBindings: number;
  unrelatedHostListeners: number;
  /** Listeners with mixed or non-project owners tied to this checkout investigation. */
  ambiguousProjectListeners: number;
  applicationScopes: number;
  applicationServers: number;
  applicationWorkers: number;
  byProcessRole: Partial<Record<ProcessRole, number>>;
  unknownOwnershipListeners: number;
}

export function buildDiscoveryDisplaySummary(
  input: DisplaySummaryInput & { projectListenerBindings: number },
): ProjectDiscoverySummaryV1 {
  const byProcessRole: Partial<Record<ProcessRole, number>> = {};
  for (const runtime of input.runtimes) {
    byProcessRole[runtime.processRole] = (byProcessRole[runtime.processRole] ?? 0) + 1;
  }
  const applicationScopes = new Set(
    input.runtimes
      .filter((runtime) => runtime.processRole === 'application-server' || runtime.processRole === 'application-worker')
      .map((runtime) => runtime.association.applicationScope)
      .filter((scope): scope is string => Boolean(scope?.startsWith('apps/') || scope?.startsWith('packages/'))),
  ).size;
  const applicationServers = input.runtimes.filter((runtime) => runtime.processRole === 'application-server').length;
  const applicationWorkers = input.runtimes.filter((runtime) => runtime.processRole === 'application-worker').length;
  const listenerProcesses = input.runtimes.filter(
    (runtime) => runtime.runtimeState === 'listening' || runtime.runtimeState === 'forwarding',
  ).length;
  const supportingProcesses = input.runtimes.filter((runtime) =>
    ['editor', 'shell', 'development-tooling', 'task-orchestrator', 'container-infrastructure', 'unknown'].includes(
      runtime.processRole,
    ),
  ).length;
  const workerProcesses = applicationWorkers;
  return {
    applicationGroups: applicationScopes,
    listenerProcesses,
    workerProcesses,
    supportingProcesses,
    excludedInspectionProcesses: input.excludedCount,
    projectListenerBindings: input.projectListenerBindings,
    unrelatedHostListeners: input.unrelatedHostListeners,
    ambiguousProjectListeners: input.projectRelevantListeners,
    applicationScopes,
    applicationServers,
    applicationWorkers,
    byProcessRole,
    unknownOwnershipListeners: input.unknownOwnershipListeners,
  };
}

export const PROCESS_ROLE_DISPLAY_ORDER: ProcessRole[] = [
  'application-server',
  'application-worker',
  'network-forwarding',
  'task-orchestrator',
  'development-tooling',
  'editor',
  'shell',
  'container-infrastructure',
  'unknown',
];
