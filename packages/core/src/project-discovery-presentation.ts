export type ProjectRuntimeRole = 'application-listener' | 'application-process' | 'supporting-process';

export interface PortBindingLike {
  protocol: 'tcp' | 'udp';
  address: string;
  port: number;
  state: string;
}

export interface ListenerAssociationLike {
  association: 'project-owner' | 'mixed-ownership' | 'unidentified-owner';
  ownerPids: number[];
  binding: PortBindingLike;
}

export interface RuntimeRecordLike {
  role: ProjectRuntimeRole;
  application: string | null;
  pid: number;
  processName: string | null;
  executable: string | null;
  ports: PortBindingLike[];
}

export type ListenerAttention = 'project' | 'unrelated-host' | 'ambiguous-project';

/** Heuristic classification for host-wide listeners that are not tied to one checkout. */
export function listenerAttention(
  binding: PortBindingLike,
  association: ListenerAssociationLike['association'],
): ListenerAttention {
  if (association === 'project-owner') return 'project';
  if (association === 'mixed-ownership') return 'ambiguous-project';
  if (isUnrelatedHostListener(binding)) return 'unrelated-host';
  if (association === 'unidentified-owner' && binding.protocol === 'tcp' && binding.state === 'LISTEN') {
    const loopback =
      binding.address === '127.0.0.1' ||
      binding.address === '::1' ||
      binding.address === '*' ||
      binding.address === '0.0.0.0' ||
      binding.address === '::';
    if (loopback) return 'ambiguous-project';
  }
  if (association === 'unidentified-owner' && binding.protocol === 'udp') return 'unrelated-host';
  return 'unrelated-host';
}

export function isUnrelatedHostListener(binding: PortBindingLike): boolean {
  const { protocol, address, port, state } = binding;
  if (protocol === 'tcp' && state === 'LISTEN') {
    if (port === 22 || port === 631) return true;
    if ((address === '0.0.0.0' || address === '::' || address === '*') && (port === 80 || port === 443)) {
      return true;
    }
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
  return runtime.role;
}

export interface ApplicationGroup {
  scope: string;
  listeners: RuntimeRecordLike[];
  workers: RuntimeRecordLike[];
}

export function groupRuntimesByApplication(runtimes: RuntimeRecordLike[]): ApplicationGroup[] {
  const groups = new Map<string, ApplicationGroup>();
  const supporting = runtimes.filter((runtime) => runtime.role === 'supporting-process');
  const primary = runtimes.filter((runtime) => runtime.role !== 'supporting-process');
  for (const runtime of primary) {
    const scope = runtime.application ?? '(unscoped)';
    const existing = groups.get(scope) ?? { scope, listeners: [], workers: [] };
    if (runtime.role === 'application-listener' || runtime.ports.length) existing.listeners.push(runtime);
    else existing.workers.push(runtime);
    groups.set(scope, existing);
  }
  for (const runtime of supporting) {
    const scope = runtime.application ?? '(supporting)';
    const existing = groups.get(scope) ?? { scope, listeners: [], workers: [] };
    existing.workers.push(runtime);
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

export interface ProjectDiscoverySummary {
  applicationGroups: number;
  listenerProcesses: number;
  workerProcesses: number;
  supportingProcesses: number;
  excludedInspectionProcesses: number;
  projectListenerBindings: number;
  unrelatedHostListeners: number;
  ambiguousProjectListeners: number;
}

export function buildProjectDiscoverySummary(input: {
  runtimes: RuntimeRecordLike[];
  excludedCount: number;
  unrelatedHostListeners: number;
  ambiguousProjectListeners: number;
}): ProjectDiscoverySummary {
  const listenerProcesses = input.runtimes.filter((runtime) => runtime.role === 'application-listener').length;
  const supportingProcesses = input.runtimes.filter((runtime) => runtime.role === 'supporting-process').length;
  const workerProcesses = input.runtimes.length - listenerProcesses - supportingProcesses;
  const groups = groupRuntimesByApplication(input.runtimes);
  const projectListenerBindings = input.runtimes.reduce((count, runtime) => count + runtime.ports.length, 0);
  return {
    applicationGroups: groups.length,
    listenerProcesses,
    workerProcesses,
    supportingProcesses,
    excludedInspectionProcesses: input.excludedCount,
    projectListenerBindings,
    unrelatedHostListeners: input.unrelatedHostListeners,
    ambiguousProjectListeners: input.ambiguousProjectListeners,
  };
}

export function formatPortSummary(ports: PortBindingLike[]): string {
  if (!ports.length) return 'process only';
  return ports.map((port) => `${port.protocol.toUpperCase()} ${port.address}:${port.port}`).join(', ');
}

export function dedupeEvidenceLines(lines: string[]): string[] {
  return [...new Set(lines.filter(Boolean))];
}
