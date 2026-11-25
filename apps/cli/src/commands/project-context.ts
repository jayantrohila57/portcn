import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync, realpathSync } from 'node:fs';

export type ProjectContextStatus =
  | 'identified'
  | 'ambiguous'
  | 'not-found'
  | 'permission-denied'
  | 'process-exited'
  | 'unavailable';
export type ProjectContextConfidence = 'high' | 'medium' | 'low' | 'none';

export interface ProcessAncestor {
  pid: number;
  name: string | null;
  cwd: string | null;
  executable: string | null;
}

export interface ProjectContext {
  status: ProjectContextStatus;
  confidence: ProjectContextConfidence;
  source: 'owner' | 'ancestor' | null;
  cwd: string | null;
  executable: string | null;
  projectRoot: string | null;
  gitDir: string | null;
  gitCommonDir: string | null;
  worktree: boolean | null;
  ancestors: ProcessAncestor[];
  evidence: string[];
}

export interface ProjectContextDependencies {
  readFile?: (path: string, encoding: BufferEncoding) => string;
  readLink?: (path: string) => string;
  runGit?: (cwd: string) => GitMetadata | null;
  maxAncestors?: number;
}

export interface GitMetadata {
  projectRoot: string;
  gitDir: string;
  gitCommonDir: string;
}

const readFile = (path: string, encoding: BufferEncoding): string => readFileSync(path, encoding);
const readLink = (path: string): string => readlinkSync(path);

function errorStatus(error: unknown): ProjectContextStatus {
  const code = (error as NodeJS.ErrnoException)?.code;
  if (code === 'EACCES' || code === 'EPERM') return 'permission-denied';
  if (code === 'ENOENT' || code === 'ESRCH') return 'process-exited';
  return 'unavailable';
}

function processStat(pid: number, read: typeof readFile): { startTime: string; parentPid: number } {
  const stat = read(`/proc/${pid}/stat`, 'utf8');
  const close = stat.lastIndexOf(')');
  if (close < 0) throw new Error('Malformed process stat');
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const parentPid = Number(fields[1]);
  const startTime = fields[19];
  if (!Number.isInteger(parentPid) || !startTime) throw new Error('Malformed process stat');
  return { parentPid, startTime };
}

export function readProcessStartTime(
  pid: number,
  read: (path: string, encoding: BufferEncoding) => string = readFile,
): string | null {
  try {
    return processStat(pid, read).startTime;
  } catch {
    return null;
  }
}

function processName(pid: number, read: typeof readFile): string | null {
  try {
    return /^Name:\s*(.+)$/m.exec(read(`/proc/${pid}/status`, 'utf8'))?.[1]?.trim() ?? null;
  } catch {
    return null;
  }
}

function gitMetadata(cwd: string): GitMetadata | null {
  try {
    const output = execFileSync(
      'git',
      ['-C', cwd, 'rev-parse', '--path-format=absolute', '--show-toplevel', '--absolute-git-dir', '--git-common-dir'],
      { encoding: 'utf8', timeout: 1_000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const [projectRoot, gitDir, gitCommonDir] = output.trimEnd().split('\n');
    if (!projectRoot || !gitDir || !gitCommonDir) return null;
    return { projectRoot, gitDir, gitCommonDir };
  } catch {
    return null;
  }
}

export function resolveGitProject(directory: string): GitMetadata | null {
  try {
    return gitMetadata(realpathSync(directory));
  } catch {
    return null;
  }
}

function inspectProcess(pid: number, dependencies: ProjectContextDependencies): ProjectContext {
  const read = dependencies.readFile ?? readFile;
  const readlink = dependencies.readLink ?? readLink;
  let initial: ReturnType<typeof processStat>;
  try {
    initial = processStat(pid, read);
  } catch (error) {
    return {
      status: errorStatus(error),
      confidence: 'none',
      source: null,
      cwd: null,
      executable: null,
      projectRoot: null,
      gitDir: null,
      gitCommonDir: null,
      worktree: null,
      ancestors: [],
      evidence: [],
    };
  }

  let cwd: string | null = null;
  let executable: string | null = null;
  let cwdError: unknown;
  try {
    cwd = readlink(`/proc/${pid}/cwd`).replace(/ \(deleted\)$/, '');
  } catch (error) {
    cwdError = error;
    // The target may have exited or procfs may deny the link; the final identity check classifies races.
  }
  try {
    executable = readlink(`/proc/${pid}/exe`).replace(/ \(deleted\)$/, '');
  } catch {
    // Keep available evidence while recording the missing executable in the evidence list.
  }

  const ancestors: ProcessAncestor[] = [];
  const maxAncestors = Math.min(Math.max(dependencies.maxAncestors ?? 5, 0), 8);
  let nextPid = initial.parentPid;
  for (let depth = 0; depth < maxAncestors && nextPid > 1 && nextPid !== pid; depth += 1) {
    const ancestorPid = nextPid;
    let parentPid: number;
    try {
      parentPid = processStat(ancestorPid, read).parentPid;
    } catch {
      break;
    }
    let ancestorCwd: string | null = null;
    let ancestorExecutable: string | null = null;
    try {
      ancestorCwd = readlink(`/proc/${ancestorPid}/cwd`).replace(/ \(deleted\)$/, '');
    } catch {
      // Ancestor metadata is best effort.
    }
    try {
      ancestorExecutable = readlink(`/proc/${ancestorPid}/exe`).replace(/ \(deleted\)$/, '');
    } catch {
      // Ancestor metadata is best effort.
    }
    ancestors.push({
      pid: ancestorPid,
      name: processName(ancestorPid, read),
      cwd: ancestorCwd,
      executable: ancestorExecutable,
    });
    if (parentPid === ancestorPid) break;
    nextPid = parentPid;
  }

  let final: ReturnType<typeof processStat>;
  try {
    final = processStat(pid, read);
  } catch (error) {
    return {
      status: errorStatus(error),
      confidence: 'none',
      source: null,
      cwd,
      executable,
      projectRoot: null,
      gitDir: null,
      gitCommonDir: null,
      worktree: null,
      ancestors,
      evidence: ['The process exited or became inaccessible during inspection.'],
    };
  }
  if (final.startTime !== initial.startTime) {
    return {
      status: 'process-exited',
      confidence: 'none',
      source: null,
      cwd: null,
      executable: null,
      projectRoot: null,
      gitDir: null,
      gitCommonDir: null,
      worktree: null,
      ancestors: [],
      evidence: ['The PID changed during inspection; results were discarded.'],
    };
  }

  const runGit = dependencies.runGit ?? gitMetadata;
  const candidateCwds = [
    ...new Set([cwd, ...ancestors.map((ancestor) => ancestor.cwd)].filter((value): value is string => Boolean(value))),
  ];
  const repositories = candidateCwds
    .map((candidate) => ({
      metadata: runGit(candidate),
      source: candidate === cwd ? ('owner' as const) : ('ancestor' as const),
    }))
    .filter((entry): entry is { metadata: GitMetadata; source: 'owner' | 'ancestor' } => entry.metadata !== null);
  const repositoryMap = new Map<string, (typeof repositories)[number]>();
  for (const repository of repositories) {
    if (!repositoryMap.has(repository.metadata.projectRoot))
      repositoryMap.set(repository.metadata.projectRoot, repository);
  }
  const uniqueRepositories = [...repositoryMap.values()];
  const selected = uniqueRepositories[0] ?? null;
  const evidence = [
    ...(cwd ? ['Owner process working directory was read from /proc.'] : []),
    ...(executable ? ['Owner executable path was read from /proc.'] : []),
    ...(ancestors.length ? [`Inspected ${ancestors.length} parent process(es), up to the configured depth.`] : []),
    ...(selected
      ? ['Git reported the project root and worktree metadata for an owner or ancestor working directory.']
      : []),
    ...(!cwd
      ? [
          cwdError && errorStatus(cwdError) === 'permission-denied'
            ? 'Owner working directory was blocked by permissions.'
            : 'Owner working directory was unavailable.',
        ]
      : []),
    ...(!executable ? ['Owner executable path was unavailable.'] : []),
    ...(uniqueRepositories.length > 1
      ? ['Owner and ancestor working directories resolve to different Git projects.']
      : []),
  ];
  const status: ProjectContextStatus =
    uniqueRepositories.length > 1
      ? 'ambiguous'
      : selected
        ? 'identified'
        : cwdError && errorStatus(cwdError) === 'permission-denied'
          ? 'permission-denied'
          : cwd
            ? 'not-found'
            : 'unavailable';
  return {
    status,
    confidence: status === 'ambiguous' ? 'low' : selected?.source === 'owner' ? 'high' : selected ? 'medium' : 'none',
    source: selected?.source ?? null,
    cwd,
    executable,
    projectRoot: selected?.metadata.projectRoot ?? null,
    gitDir: selected?.metadata.gitDir ?? null,
    gitCommonDir: selected?.metadata.gitCommonDir ?? null,
    worktree: selected ? selected.metadata.gitDir !== selected.metadata.gitCommonDir : null,
    ancestors,
    evidence,
  };
}

export function inspectProjectContext(pid: number, dependencies: ProjectContextDependencies = {}): ProjectContext {
  if (!Number.isInteger(pid) || pid < 1) {
    return {
      status: 'unavailable',
      confidence: 'none',
      source: null,
      cwd: null,
      executable: null,
      projectRoot: null,
      gitDir: null,
      gitCommonDir: null,
      worktree: null,
      ancestors: [],
      evidence: ['The process ID is invalid.'],
    };
  }
  return inspectProcess(pid, dependencies);
}
