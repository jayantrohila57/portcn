import { describe, expect, it } from 'vitest';
import { discoverProjectRuntimes } from '../src/commands/discover-project.js';
import type { ListeningPort } from '../src/commands/list.js';
import type { ProjectContext } from '../src/commands/project-context.js';

const checkout = {
  projectRoot: '/work/acme',
  gitDir: '/work/acme/.git',
  gitCommonDir: '/work/acme/.git',
  checkoutBranch: 'main',
  checkoutCommit: 'deadbeef',
};

const multicastUdp: ListeningPort = {
  protocol: 'udp',
  state: 'UNCONN',
  address: '239.255.255.250',
  port: 3702,
  pid: null,
  processName: null,
  owners: [],
};

const loopbackTcp: ListeningPort = {
  protocol: 'tcp',
  state: 'LISTEN',
  address: '127.0.0.1',
  port: 8080,
  pid: null,
  processName: null,
  owners: [],
};

const listeners: ListeningPort[] = [
  {
    protocol: 'tcp',
    state: 'LISTEN',
    address: '127.0.0.1',
    port: 3000,
    pid: 3182,
    processName: 'node',
    owners: [{ pid: 3182, processName: 'node' }],
  },
  {
    protocol: 'tcp',
    state: 'LISTEN',
    address: '127.0.0.1',
    port: 4000,
    pid: 3182,
    processName: 'node',
    owners: [
      { pid: 3182, processName: 'node' },
      { pid: 999, processName: 'postgres' },
    ],
  },
  multicastUdp,
  loopbackTcp,
];

function projectContext(pid: number, cwd: string, gitDir = checkout.gitDir): ProjectContext {
  return {
    status: 'identified',
    confidence: 'high',
    source: 'owner',
    cwd,
    executable: pid === 3220 ? '/usr/bin/bash' : '/usr/bin/node',
    projectRoot: checkout.projectRoot,
    gitDir,
    gitCommonDir: checkout.gitCommonDir,
    checkoutBranch: checkout.checkoutBranch,
    checkoutCommit: checkout.checkoutCommit,
    worktree: false,
    ancestors: [],
    evidence: ['Owner process working directory was read from /proc.'],
  };
}

describe('discover project (Linux)', () => {
  it('attributes listeners and workers to one checkout with evidence and unresolved mixed owners', () => {
    const startTimes = new Map<number, string>([
      [3182, '100'],
      [3220, '200'],
    ]);
    const result = discoverProjectRuntimes('/work/acme', {
      platform: 'linux',
      resolveProject: () => checkout,
      discoverListeners: () => listeners,
      listPids: () => [3182, 3220],
      readStartTime: (pid) => startTimes.get(pid) ?? null,
      readComm: (pid) => (pid === 3220 ? 'bash' : 'node'),
      inspectProject: (pid) => projectContext(pid, pid === 3220 ? '/work/acme/apps/jobs' : '/work/acme/apps/web'),
      hostname: () => 'host-linux',
      now: () => new Date('2026-11-27T04:45:00.000Z'),
    });
    expect(result.project.root).toBe('/work/acme');
    expect(result.runtimes.map((runtime) => runtime.application)).toEqual(
      expect.arrayContaining(['apps/web', 'apps/jobs']),
    );
    expect(result.runtimes.find((runtime) => runtime.application === 'apps/web')?.ports).toHaveLength(2);
    expect(result.runtimes.find((runtime) => runtime.application === 'apps/jobs')?.role).toBe('supporting-process');
    expect(result.unresolved.some((item) => item.includes('4000') && item.includes('postgres'))).toBe(true);
    expect(result.listenerInventory.unrelated.count).toBeGreaterThanOrEqual(1);
    expect(result.listenerInventory.ambiguous.count).toBe(2);
    expect(result.unresolved.some((item) => item.includes('8080'))).toBe(true);
    expect(result.unresolved.some((item) => item.includes('3702'))).toBe(false);
    expect(result.summary.listenerProcesses).toBe(1);
    expect(result.schemaVersion).toBe(1);
  });

  it('excludes sibling worktree processes from runtimes', () => {
    const result = discoverProjectRuntimes('/work/acme', {
      platform: 'linux',
      resolveProject: () => checkout,
      discoverListeners: () => [],
      listPids: () => [3300],
      readStartTime: () => '50',
      readComm: () => 'node',
      inspectProject: () => projectContext(3300, '/work/acme-feature', '/work/acme-feature/.git'),
      hostname: () => 'host-linux',
    });
    expect(result.runtimes).toHaveLength(0);
  });

  it('discards evidence when PID start time changes during inspection', () => {
    let reads = 0;
    const result = discoverProjectRuntimes('/work/acme', {
      platform: 'linux',
      resolveProject: () => checkout,
      discoverListeners: () => listeners.slice(0, 1),
      listPids: () => [3182],
      readStartTime: () => {
        reads += 1;
        return reads === 1 ? '100' : '101';
      },
      readComm: () => 'node',
      inspectProject: (pid) => projectContext(pid, '/work/acme/apps/web'),
    });
    expect(result.runtimes).toHaveLength(0);
  });

  it('excludes Portcn discovery processes from runtimes', () => {
    const result = discoverProjectRuntimes('/work/acme', {
      platform: 'linux',
      resolveProject: () => checkout,
      discoverListeners: () => [],
      listPids: () => [5000],
      readStartTime: () => '100',
      readComm: () => 'node',
      readCmdline: () => 'node apps/cli/dist/index.js discover project',
      inspectProject: () => ({
        ...projectContext(5000, '/work/acme'),
        executable: '/usr/bin/node',
      }),
    });
    expect(result.runtimes).toHaveLength(0);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0]?.reason).toBe('portcn-inspection');
  });
});
