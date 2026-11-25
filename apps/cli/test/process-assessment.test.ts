import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAttribution } from '../src/commands/agent-attribution.js';
import {
  assessProcessOwnership,
  formatProcessAssessment,
  registerProcessAssessmentCommand,
} from '../src/commands/process-assessment.js';
import type { ProjectContext } from '../src/commands/project-context.js';

const project = (status: ProjectContext['status'] = 'identified', projectRoot = '/repo'): ProjectContext => ({
  status,
  confidence: status === 'identified' ? 'high' : 'none',
  source: status === 'identified' ? 'owner' : null,
  cwd: '/repo/apps/server',
  executable: '/usr/bin/node',
  projectRoot: status === 'identified' ? projectRoot : null,
  gitDir: '/repo/.git',
  gitCommonDir: '/repo/.git',
  checkoutBranch: 'main',
  checkoutCommit: 'abc123',
  worktree: false,
  ancestors: [{ pid: 10, name: 'shell', cwd: '/repo', executable: '/usr/bin/bash' }],
  evidence: ['Fixture project evidence.'],
});

const agent = (status: AgentAttribution['status'] = 'unknown', sessionId: string | null = null): AgentAttribution => ({
  status,
  confidence: status === 'associated' ? 'high' : status === 'ambiguous' ? 'low' : 'none',
  agentName: status === 'associated' ? 'codex' : null,
  sessionId,
  sourcePid: status === 'associated' ? 42 : null,
  source: status === 'associated' ? 'owner' : null,
  leftoverAssessment: 'unknown',
  observedAt: '2026-11-25T00:00:00.000Z',
  evidence: ['Fixture agent evidence.'],
});

function dependencies(options: { project?: ProjectContext; agent?: AgentAttribution; reused?: boolean } = {}) {
  let reads = 0;
  return {
    resolveProject: () => ({
      projectRoot: '/repo',
      gitDir: '/repo/.git',
      gitCommonDir: '/repo/.git',
      checkoutBranch: 'main',
      checkoutCommit: 'abc123',
    }),
    readStartTime: () => {
      reads += 1;
      return options.reused && reads > 1 ? 'new-process' : 'process-start-42';
    },
    inspectProject: () => options.project ?? project(),
    inspectAgent: () => options.agent ?? agent(),
    now: () => new Date('2026-11-25T00:00:00.000Z'),
    readPidNamespace: () => 'pid:[fixture]',
  };
}

describe('read-only process ownership assessment', () => {
  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('matches project and optional session with stable identity and evidence time', () => {
    const result = assessProcessOwnership(42, '/repo/apps/server', 'session-7', {
      ...dependencies({ agent: agent('associated', 'session-7') }),
    });
    expect(result).toMatchObject({
      status: 'matching',
      identity: { startTime: 'process-start-42', stable: true },
      expectedProject: '/repo',
      expectedSessionId: 'session-7',
      matchingEvidence: [
        'Git project root matches the supplied project (/repo) using owner directory evidence at high confidence.',
        'Opt-in agent session ID matches (session-7).',
      ],
      observedAt: '2026-11-25T00:00:00.000Z',
      pidNamespace: 'pid:[fixture]',
    });
    expect(formatProcessAssessment(result)).toContain('never authorizes stopping');
  });

  it('distinguishes different, ambiguous, and unknown evidence', () => {
    expect(
      assessProcessOwnership(42, '/repo', undefined, {
        ...dependencies({ project: project('identified', '/other') }),
      }).status,
    ).toBe('different');
    expect(
      assessProcessOwnership(42, '/repo', undefined, {
        ...dependencies({ project: project('ambiguous') }),
      }).status,
    ).toBe('ambiguous');
    expect(
      assessProcessOwnership(42, '/repo', 'session-7', {
        ...dependencies({ agent: agent('associated', 'session-8') }),
      }),
    ).toMatchObject({
      status: 'different',
      differentEvidence: ['Agent session ID differs: observed session-8; expected session-7.'],
    });
    expect(
      assessProcessOwnership(42, '/repo', 'session-7', {
        ...dependencies({ project: project('permission-denied') }),
      }).status,
    ).toBe('unknown');
    expect(
      assessProcessOwnership(42, '/repo', 'session-7', {
        ...dependencies({ agent: agent('ambiguous') }),
      }).status,
    ).toBe('ambiguous');
  });

  it('discards snapshots when a PID exits or is reused and validates inputs', () => {
    expect(assessProcessOwnership(42, '/repo', undefined, { ...dependencies({ reused: true }) })).toMatchObject({
      status: 'unknown',
      identity: { stable: false },
      processProject: null,
    });
    expect(() => assessProcessOwnership(0, '/repo', undefined, dependencies())).toThrow('positive integer');
    expect(() =>
      assessProcessOwnership(42, '/missing', undefined, { ...dependencies(), resolveProject: () => null }),
    ).toThrow('Git repository');
    expect(() => assessProcessOwnership(42, '/repo', 'unsafe session', dependencies())).toThrow('safe characters');
  });

  it('emits versioned JSON and stable invalid-input errors', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const program = new Command().name('portcn');
    registerProcessAssessmentCommand(program);
    await program.parseAsync([
      'node',
      'portcn',
      'assess',
      '42',
      '--project',
      '/repo',
      '--session',
      'bad value',
      '--json',
    ]);
    expect(JSON.parse(output.join(''))).toMatchObject({ schemaVersion: 1, error: { code: 'INVALID_INPUT' } });
    expect(process.exitCode).toBe(2);
  });
});
