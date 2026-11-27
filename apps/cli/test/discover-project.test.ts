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

const otherCheckout = {
  projectRoot: '/work/other',
  gitDir: '/work/other/.git',
  gitCommonDir: '/work/other/.git',
  checkoutBranch: 'dev',
  checkoutCommit: 'cafebabe',
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

const ownerlessLoopback: ListeningPort = {
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
  ownerlessLoopback,
];

function projectContext(
  pid: number,
  cwd: string,
  gitDir = checkout.gitDir,
  root = checkout.projectRoot,
): ProjectContext {
  return {
    status: 'identified',
    confidence: 'high',
    source: 'owner',
    cwd,
    executable: pid === 3220 ? '/usr/bin/bash' : '/usr/bin/node',
    projectRoot: root,
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
  it('attributes listeners and workers with role semantics and mixed-owner unresolved items', () => {
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
    const web = result.runtimes.find((runtime) => runtime.application === 'apps/web');
    expect(web?.processRole).toBe('application-server');
    const jobs = result.runtimes.find((runtime) => runtime.application === 'apps/jobs');
    expect(jobs?.processRole).toBe('shell');
    expect(result.unresolved.some((item) => item.includes('4000') && item.includes('postgres'))).toBe(true);
    expect(result.listenerInventory.unrelated.count).toBeGreaterThanOrEqual(1);
    expect(result.listenerInventory.unknownOwnership.count).toBe(1);
    expect(result.unresolved.some((item) => item.includes('8080'))).toBe(false);
    expect(result.applications.length).toBe(result.summary.applicationGroups);
    expect(result.schemaVersion).toBe(1);
  });

  it('excludes sibling worktree processes and attributes only the selected checkout across two projects', () => {
    const sharedListeners: ListeningPort[] = [
      {
        protocol: 'tcp',
        state: 'LISTEN',
        address: '127.0.0.1',
        port: 3333,
        pid: 4100,
        processName: 'node',
        owners: [{ pid: 4100, processName: 'node' }],
      },
      {
        protocol: 'tcp',
        state: 'LISTEN',
        address: '127.0.0.1',
        port: 4444,
        pid: 4200,
        processName: 'node',
        owners: [{ pid: 4200, processName: 'node' }],
      },
    ];
    const acme = discoverProjectRuntimes('/work/acme', {
      platform: 'linux',
      resolveProject: () => checkout,
      discoverListeners: () => sharedListeners,
      listPids: () => [4100, 4200],
      readStartTime: () => '50',
      readComm: () => 'node',
      readCmdline: (pid) =>
        pid === 4100
          ? 'node apps/web/node_modules/.bin/next dev'
          : 'node /work/other/apps/api/node_modules/.bin/next dev',
      inspectProject: (pid) =>
        pid === 4100
          ? projectContext(4100, '/work/acme/apps/web', checkout.gitDir, checkout.projectRoot)
          : projectContext(4200, '/work/other/apps/api', otherCheckout.gitDir, otherCheckout.projectRoot),
    });
    expect(acme.runtimes.map((runtime) => runtime.pid)).toEqual([4100]);
    expect(acme.runtimes[0]?.application).toBe('apps/web');
    expect(acme.runtimes[0]?.processRole).toBe('application-server');

    const other = discoverProjectRuntimes('/work/other', {
      platform: 'linux',
      resolveProject: () => otherCheckout,
      discoverListeners: () => sharedListeners,
      listPids: () => [4100, 4200],
      readStartTime: () => '50',
      readComm: () => 'node',
      readCmdline: (pid) =>
        pid === 4200
          ? 'node /work/other/apps/api/node_modules/.bin/next dev'
          : 'node apps/web/node_modules/.bin/next dev',
      inspectProject: (pid) =>
        pid === 4200
          ? projectContext(4200, '/work/other/apps/api', otherCheckout.gitDir, otherCheckout.projectRoot)
          : projectContext(4100, '/work/acme/apps/web', checkout.gitDir, checkout.projectRoot),
    });
    expect(other.runtimes.map((runtime) => runtime.pid)).toEqual([4200]);
    expect(other.runtimes[0]?.application).toBe('apps/api');
  });

  it('uses direct owner checkout evidence even when launcher ancestry conflicts', () => {
    const result = discoverProjectRuntimes('/work/acme', {
      platform: 'linux',
      resolveProject: () => checkout,
      discoverListeners: () => listeners.slice(0, 1),
      listPids: () => [],
      readStartTime: () => '50',
      readComm: () => 'node',
      readCmdline: () => 'node server.js',
      inspectProject: (pid) => ({
        ...projectContext(pid, '/work/acme/apps/web'),
        status: 'ambiguous',
        confidence: 'low',
        evidence: ['Owner and ancestor working directories resolve to different Git projects.'],
      }),
    });
    expect(result.runtimes.map((runtime) => runtime.pid)).toEqual([3182]);
    expect(result.runtimes[0]?.ports.map((binding) => binding.port)).toEqual([3000]);
    expect(result.runtimes[0]?.evidence).toContain(
      'Owner and ancestor working directories resolve to different Git projects.',
    );
  });

  it('keeps an ancestor-only process and its listener outside direct checkout counts', () => {
    const result = discoverProjectRuntimes('/work/acme', {
      platform: 'linux',
      resolveProject: () => checkout,
      discoverListeners: () => listeners.slice(0, 1),
      listPids: () => [],
      readStartTime: () => '50',
      readComm: () => 'node',
      readCmdline: () => 'node app.js',
      inspectProject: (pid) => ({ ...projectContext(pid, '/tmp'), source: 'ancestor', confidence: 'medium' }),
    });
    expect(result.tentativeProcesses.map((process) => process.pid)).toEqual([3182]);
    expect(result.listenerInventory.tentative.bindings.map((binding) => binding.port)).toEqual([3000]);
    expect(result.summary.projectListenerBindings).toBe(0);
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

  it('classifies a running Next.js docs app from realistic process metadata', () => {
    const result = discoverProjectRuntimes('/home/x/personal/portcn', {
      platform: 'linux',
      resolveProject: () => ({
        projectRoot: '/home/x/personal/portcn',
        gitDir: '/home/x/personal/portcn/.git',
        gitCommonDir: '/home/x/personal/portcn/.git',
        checkoutBranch: 'dev',
        checkoutCommit: 'abcd1234',
      }),
      discoverListeners: () => [
        {
          protocol: 'tcp',
          state: 'LISTEN',
          address: '127.0.0.1',
          port: 3333,
          pid: 102224,
          processName: 'node',
          owners: [{ pid: 102224, processName: 'node' }],
        },
      ],
      listPids: () => [102224],
      readStartTime: () => '900',
      readComm: () => 'node',
      readCmdline: () => 'node apps/docs/node_modules/.bin/next dev',
      inspectProject: () => ({
        status: 'identified',
        confidence: 'high',
        source: 'owner',
        cwd: '/home/x/personal/portcn/apps/docs',
        executable: '/usr/bin/node',
        projectRoot: '/home/x/personal/portcn',
        gitDir: '/home/x/personal/portcn/.git',
        gitCommonDir: '/home/x/personal/portcn/.git',
        checkoutBranch: 'dev',
        checkoutCommit: 'abcd1234',
        worktree: false,
        ancestors: [],
        evidence: ['Owner process working directory was read from /proc.'],
      }),
    });
    expect(result.runtimes).toHaveLength(1);
    expect(result.runtimes[0]?.processRole).toBe('application-server');
    expect(result.runtimes[0]?.application).toBe('apps/docs');
    expect(result.summary.applicationServers).toBe(1);
    expect(result.applications[0]?.scope).toBe('apps/docs');
  });
});
