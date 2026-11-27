import {
  buildDiscoveryDisplaySummary,
  isPositiveUnrelatedHostListener,
  listenerAttention,
  type PortBindingLike,
  type ProcessRole,
  type ProjectDiscoverySummaryV1,
  type ProjectRuntimeRole,
  type RuntimeState,
  type SocketAssociation,
} from './project-discovery-semantics.js';

export type { PortBindingLike, ProcessRole, ProjectRuntimeRole, RuntimeState, SocketAssociation };
export type ProjectDiscoverySummary = ProjectDiscoverySummaryV1;
export {
  buildDiscoveryDisplaySummary as buildProjectDiscoverySummary,
  isPositiveUnrelatedHostListener as isUnrelatedHostListener,
  listenerAttention,
};

export interface ListenerAssociationLike {
  association: SocketAssociation;
  ownerPids: number[];
  binding: PortBindingLike;
}

export interface RuntimeRecordLike {
  role: ProjectRuntimeRole;
  processRole: ProcessRole;
  runtimeState: RuntimeState;
  application: string | null;
  pid: number;
  processName: string | null;
  executable: string | null;
  ports: PortBindingLike[];
}

export function isPortcnInspectionProcess(
  executable: string | null,
  cmdline: string | null,
  options: { pid: number; selfPid?: number } = { pid: 0 },
): boolean {
  if (options.selfPid !== undefined && options.pid === options.selfPid) return true;
  const base = executable?.split('/').pop()?.toLowerCase() ?? '';
  if (base === 'portcn') return true;
  const normalized = cmdline?.replace(/\0/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  if (!normalized) return false;
  if (/\bportcn\b/i.test(normalized) && /\bdiscover\b/i.test(normalized)) return true;
  if (/\bportcn\b/i.test(normalized) && /\bmcp\b/i.test(normalized)) return true;
  if (/apps\/cli\/dist\/index\.js/i.test(normalized) && /\bdiscover\b/i.test(normalized)) return true;
  if (/packages\/cli\/dist\/index\.js/i.test(normalized) && /\bdiscover\b/i.test(normalized)) return true;
  return false;
}

export function runtimeDisplayName(runtime: RuntimeRecordLike): string {
  if (runtime.application) return runtime.application;
  const comm = runtime.processName ?? runtime.executable?.split('/').pop() ?? null;
  if (comm) return comm;
  return runtime.processRole;
}

export interface ApplicationGroup {
  scope: string;
  listeners: RuntimeRecordLike[];
  workers: RuntimeRecordLike[];
}

export function groupRuntimesByApplication(runtimes: RuntimeRecordLike[]): ApplicationGroup[] {
  const groups = new Map<string, ApplicationGroup>();
  for (const runtime of runtimes) {
    const scope = runtime.application ?? '(unscoped)';
    const existing = groups.get(scope) ?? { scope, listeners: [], workers: [] };
    if (runtime.runtimeState === 'listening' || runtime.runtimeState === 'forwarding' || runtime.ports.length) {
      existing.listeners.push(runtime);
    } else if (runtime.processRole === 'application-worker' || runtime.processRole === 'application-server') {
      existing.workers.push(runtime);
    } else {
      existing.workers.push(runtime);
    }
    groups.set(scope, existing);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, group]) => ({
      ...group,
      listeners: group.listeners.sort((left, right) => left.pid - right.pid),
      workers: group.workers.sort((left, right) => left.pid - right.pid),
    }));
}

export function formatPortSummary(ports: PortBindingLike[]): string {
  if (!ports.length) return 'process only';
  return ports.map((port) => `${port.protocol.toUpperCase()} ${port.address}:${port.port}`).join(', ');
}

export function dedupeEvidenceLines(lines: string[]): string[] {
  return [...new Set(lines.filter(Boolean))];
}
