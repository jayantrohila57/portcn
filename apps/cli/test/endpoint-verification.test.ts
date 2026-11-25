import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseLocalEndpoint,
  registerEndpointVerificationCommand,
  verifyEndpointProject,
} from '../src/commands/endpoint-verification.js';
import type { ListeningPort } from '../src/commands/list.js';
import type { ProjectContext } from '../src/commands/project-context.js';

const expected = {
  projectRoot: '/workspace/app',
  gitDir: '/workspace/app/.git',
  gitCommonDir: '/workspace/app/.git',
  checkoutBranch: 'main',
  checkoutCommit: 'commit-main',
};

function context(
  pid: number,
  values: { status?: ProjectContext['status']; root?: string; branch?: string | null; commit?: string | null } = {},
): ProjectContext {
  const status = values.status ?? 'identified';
  return {
    status,
    confidence: status === 'identified' ? 'high' : 'none',
    source: status === 'identified' ? 'owner' : null,
    cwd: `/workspace/process-${pid}`,
    executable: '/usr/bin/node',
    projectRoot: status === 'identified' ? (values.root ?? expected.projectRoot) : null,
    gitDir: '/workspace/app/.git',
    gitCommonDir: '/workspace/app/.git',
    checkoutBranch: values.branch === undefined ? 'main' : values.branch,
    checkoutCommit: values.commit === undefined ? 'commit-main' : values.commit,
    worktree: false,
    ancestors: [],
    evidence: ['Fixture project evidence.'],
  };
}

function socket(address: string, port: number, pid: number | null, processName = 'node'): ListeningPort {
  const owners = pid === null ? [] : [{ pid, processName }];
  return {
    protocol: 'tcp',
    state: 'LISTEN',
    address,
    port,
    pid,
    processName: pid === null ? null : processName,
    owners,
  };
}

function dependencies(listeners: ListeningPort[], contexts: Record<number, ProjectContext>) {
  return {
    resolveProject: () => expected,
    discover: () => listeners,
    inspectProject: (pid: number) => contexts[pid] ?? context(pid, { status: 'unavailable' }),
    now: () => new Date('2026-11-25T00:00:00.000Z'),
  };
}

describe('local endpoint project verification', () => {
  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('parses only localhost and literal local IP endpoints without resolving DNS', () => {
    expect(parseLocalEndpoint('localhost:3000')).toMatchObject({
      scheme: 'http',
      host: 'localhost',
      port: 3000,
      addressesChecked: ['127.0.0.1', '::1'],
    });
    expect(parseLocalEndpoint('https://[0:0:0:0:0:0:0:1]:8443/health')).toMatchObject({
      scheme: 'https',
      host: '::1',
      port: 8443,
    });
    expect(() => parseLocalEndpoint('https://example.com:443')).toThrow('DNS is not used');
    expect(() => parseLocalEndpoint('http://user:pass@127.0.0.1:3000')).toThrow('credentials');
    expect(() => parseLocalEndpoint('127.0.0.1')).toThrow('explicit port');
  });

  it('matches the requested endpoint and expected checkout when owner evidence agrees', () => {
    const result = verifyEndpointProject(
      'http://127.0.0.1:3000',
      '/workspace/app',
      dependencies([socket('127.0.0.1', 3000, 42)], { 42: context(42) }),
    );
    expect(result).toMatchObject({
      status: 'matching',
      expectedProject: { root: '/workspace/app', branch: 'main', commit: 'commit-main' },
      listeners: [
        { ownerPid: 42, projectRoot: '/workspace/app', checkoutBranch: 'main', checkoutCommit: 'commit-main' },
      ],
      runtimeCode: 'unverified',
      observedAt: '2026-11-25T00:00:00.000Z',
    });
    expect(result.listeners[0]?.evidence.join(' ')).toContain('does not prove which source code');
  });

  it('marks multiple owners ambiguous and detects current checkout branch or commit changes', () => {
    const result = verifyEndpointProject(
      '127.0.0.1:3000',
      '/workspace/app',
      dependencies([socket('127.0.0.1', 3000, 42), socket('0.0.0.0', 3000, 43)], {
        42: context(42),
        43: context(43, { root: '/other/project' }),
      }),
    );
    expect(result.status).toBe('ambiguous');
    expect(result.listeners).toHaveLength(2);

    const changedBranch = verifyEndpointProject(
      '127.0.0.1:3000',
      '/workspace/app',
      dependencies([socket('127.0.0.1', 3000, 44)], {
        44: context(44, { branch: 'feature', commit: 'commit-feature' }),
      }),
    );
    expect(changedBranch.status).toBe('different');
    expect(changedBranch.listeners[0]?.evidence.join(' ')).toContain('Current checkout branch differs');
  });

  it('reports missing owner evidence and only suggests discovered matching owned endpoints', () => {
    const unavailable = verifyEndpointProject(
      '127.0.0.1:3000',
      '/workspace/app',
      dependencies([socket('127.0.0.1', 3000, null)], {}),
    );
    expect(unavailable.status).toBe('unavailable');

    const withSuggestion = verifyEndpointProject(
      '127.0.0.1:3000',
      '/workspace/app',
      dependencies([socket('127.0.0.1', 3001, 45)], { 45: context(45) }),
    );
    expect(withSuggestion.status).toBe('unavailable');
    expect(withSuggestion.suggestions).toMatchObject([
      { endpoint: 'http://127.0.0.1:3001', ownerPid: 45, projectRoot: '/workspace/app' },
    ]);
  });

  it('keeps mixed known and unknown listener ownership ambiguous', () => {
    const result = verifyEndpointProject(
      '127.0.0.1:3000',
      '/workspace/app',
      dependencies([socket('127.0.0.1', 3000, 46), socket('127.0.0.1', 3000, 47)], {
        46: context(46),
        47: context(47, { status: 'unavailable' }),
      }),
    );
    expect(result.status).toBe('ambiguous');
    expect(result.listeners.map(({ projectStatus }) => projectStatus)).toEqual(['identified', 'unavailable']);
  });

  it('emits structured versioned JSON errors for invalid endpoints', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const program = new Command().name('portcn');
    registerEndpointVerificationCommand(program);
    await program.parseAsync(['node', 'portcn', 'verify', 'example.com:3000', '--project', '/workspace/app', '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({ schemaVersion: 1, error: { code: 'INVALID_INPUT' } });
    expect(process.exitCode).toBe(2);
  });
});
