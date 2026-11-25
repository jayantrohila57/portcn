import { describe, expect, it } from 'vitest';
import { inspectProjectContext } from '../src/commands/project-context.js';

function fakeProc(options: { reused?: boolean; denied?: boolean; gone?: boolean } = {}) {
  const statReads = new Map<number, number>();
  const stat = (pid: number, parent: number, startTime: number) => {
    const fields = Array.from({ length: 19 }, () => '0');
    fields[0] = String(parent);
    fields[18] = String(startTime);
    return `${pid} (process-${pid}) S ${fields.join(' ')}`;
  };
  return {
    readFile: (path: string) => {
      const match = /^\/proc\/(\d+)\/stat$/.exec(path);
      if (match) {
        const pid = Number(match[1]);
        if (options.gone && pid === 42) throw Object.assign(new Error('gone'), { code: 'ENOENT' });
        const reads = (statReads.get(pid) ?? 0) + 1;
        statReads.set(pid, reads);
        return stat(pid, pid === 42 ? 10 : 1, options.reused && pid === 42 && reads > 1 ? 999 : 123);
      }
      const status = /^\/proc\/(\d+)\/status$/.exec(path);
      if (status) return `Name:\tprocess-${status[1]}\n`;
      throw new Error(`Unexpected read: ${path}`);
    },
    readLink: (path: string) => {
      if (options.denied && path === '/proc/42/cwd') throw Object.assign(new Error('denied'), { code: 'EACCES' });
      if (path === '/proc/42/cwd') return '/repo/packages/app';
      if (path === '/proc/42/exe') return '/usr/bin/node';
      if (path === '/proc/10/cwd') return '/repo';
      if (path === '/proc/10/exe') return '/usr/bin/bash';
      throw new Error('missing');
    },
  };
}

describe('process project context', () => {
  it('identifies project and worktree evidence from owner and parent directories', () => {
    const proc = fakeProc();
    const result = inspectProjectContext(42, {
      ...proc,
      runGit: (cwd) =>
        cwd.startsWith('/repo')
          ? { projectRoot: '/repo', gitDir: '/repo/.git/worktrees/feature', gitCommonDir: '/repo/.git' }
          : null,
    });
    expect(result).toMatchObject({
      status: 'identified',
      confidence: 'high',
      source: 'owner',
      cwd: '/repo/packages/app',
      executable: '/usr/bin/node',
      projectRoot: '/repo',
      worktree: true,
      ancestors: [{ pid: 10, name: 'process-10', cwd: '/repo', executable: '/usr/bin/bash' }],
    });
    expect(result.evidence.join(' ')).toContain('Git reported the project root');
  });

  it('discards results when the PID changes and reports exits and permission limits', () => {
    expect(inspectProjectContext(42, { ...fakeProc({ reused: true }), runGit: () => null })).toMatchObject({
      status: 'process-exited',
      cwd: null,
    });
    expect(inspectProjectContext(42, { ...fakeProc({ gone: true }) }).status).toBe('process-exited');
    expect(inspectProjectContext(42, { ...fakeProc({ denied: true }), runGit: () => null }).status).toBe(
      'permission-denied',
    );
  });

  it('does not claim a project when no Git metadata is found and marks conflicting projects ambiguous', () => {
    expect(inspectProjectContext(42, { ...fakeProc(), runGit: () => null }).status).toBe('not-found');
    expect(
      inspectProjectContext(42, {
        ...fakeProc(),
        runGit: (cwd) =>
          cwd === '/repo' ? { projectRoot: '/repo', gitDir: '/repo/.git', gitCommonDir: '/repo/.git' } : null,
      }),
    ).toMatchObject({ status: 'identified', confidence: 'medium', source: 'ancestor' });
    let index = 0;
    expect(
      inspectProjectContext(42, {
        ...fakeProc(),
        runGit: () => ({
          projectRoot: index++ === 0 ? '/repo-a' : '/repo-b',
          gitDir: '/repo/.git',
          gitCommonDir: '/repo/.git',
        }),
      }),
    ).toMatchObject({ status: 'ambiguous', confidence: 'low' });
  });
});
