export type CheckoutMatch = 'matching' | 'different' | 'sibling-worktree' | 'ambiguous' | 'unknown';

export interface CheckoutGitEvidence {
  status: 'identified' | 'ambiguous' | 'not-found' | 'permission-denied' | 'process-exited' | 'unavailable';
  projectRoot: string | null;
  gitDir: string | null;
  gitCommonDir: string | null;
  source: 'owner' | 'ancestor' | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface ExpectedCheckout {
  projectRoot: string;
  gitDir: string;
  gitCommonDir: string;
}

const SUPPORTING_EXECUTABLES = new Set([
  'bash',
  'zsh',
  'sh',
  'fish',
  'dash',
  'ksh',
  'code',
  'cursor',
  'nvim',
  'vim',
  'emacs',
  'nano',
  'less',
  'screen',
  'tmux',
]);

/** Match observed Git evidence to the selected checkout without treating siblings as members. */
export function matchCheckoutEvidence(expected: ExpectedCheckout, observed: CheckoutGitEvidence): CheckoutMatch {
  if (observed.status === 'ambiguous') return 'ambiguous';
  if (observed.status !== 'identified' || !observed.projectRoot || !observed.gitDir) return 'unknown';
  if (observed.projectRoot !== expected.projectRoot) {
    if (observed.gitCommonDir === expected.gitCommonDir) return 'sibling-worktree';
    return 'different';
  }
  if (observed.gitDir !== expected.gitDir) return 'sibling-worktree';
  return 'matching';
}

export function isSupportingExecutable(executable: string | null, processName: string | null): boolean {
  const base = (executable?.split('/').pop() ?? processName ?? '').toLowerCase();
  return Boolean(base && SUPPORTING_EXECUTABLES.has(base));
}

/** Infer a monorepo application label from a process working directory under the checkout root. */
export function applicationScopeFromCwd(projectRoot: string, cwd: string | null): string | null {
  if (!cwd) return null;
  const normalizedRoot = projectRoot.endsWith('/') ? projectRoot.slice(0, -1) : projectRoot;
  if (cwd !== normalizedRoot && !cwd.startsWith(`${normalizedRoot}/`)) return null;
  const relative = cwd === normalizedRoot ? '' : cwd.slice(normalizedRoot.length + 1);
  if (!relative) return null;
  const segments = relative.split('/');
  if ((segments[0] === 'apps' || segments[0] === 'packages') && segments[1]) return `${segments[0]}/${segments[1]}`;
  return segments.slice(0, 2).join('/') || segments[0] || null;
}
