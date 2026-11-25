import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAttribution } from '../src/commands/agent-attribution.js';
import {
  diagnoseListeningPort,
  formatDiagnosis,
  type PortDiagnosis,
  registerDiagnoseCommand,
} from '../src/commands/diagnose.js';
import { inspectProcessDetails } from '../src/commands/inspect.js';
import type { ListeningPort } from '../src/commands/list.js';
import type { ProjectContext } from '../src/commands/project-context.js';

const sockets: ListeningPort[] = [
  {
    protocol: 'tcp',
    state: 'LISTEN',
    address: '0.0.0.0',
    port: 8080,
    pid: 321,
    processName: 'node',
    owners: [
      { pid: 321, processName: 'node' },
      { pid: 322, processName: 'worker' },
    ],
  },
  {
    protocol: 'tcp',
    state: 'LISTEN',
    address: '[::1]',
    port: 8080,
    pid: 654,
    processName: 'node',
    owners: [{ pid: 654, processName: 'node' }],
  },
  { protocol: 'tcp', state: 'LISTEN', address: '127.0.0.1', port: 8080, pid: null, processName: null },
  { protocol: 'udp', state: 'UNCONN', address: '0.0.0.0', port: 8080, pid: null, processName: null },
];

describe('port diagnose', () => {
  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('reports each TCP/UDP listener, bind address, IP family, and every visible owner', () => {
    const result = diagnoseListeningPort(8080, {
      discover: () => sockets,
      inspectProcess: (pid) => ({
        details: { command: `/usr/bin/process-${pid}`, user: 'uid:1000' },
        status: 'available',
      }),
      inspectProject: (pid) =>
        ({
          status: 'identified',
          confidence: 'high',
          source: 'owner',
          cwd: `/workspace/service-${pid}`,
          executable: '/usr/bin/node',
          projectRoot: `/workspace/service-${pid}`,
          gitDir: `/workspace/service-${pid}/.git`,
          gitCommonDir: `/workspace/service-${pid}/.git`,
          checkoutBranch: 'main',
          checkoutCommit: 'abc123',
          worktree: false,
          ancestors: [],
          evidence: ['Git reported the project root.'],
        }) satisfies ProjectContext,
      inspectAgent: () =>
        ({
          status: 'unknown',
          confidence: 'none',
          agentName: null,
          sessionId: null,
          sourcePid: null,
          source: null,
          leftoverAssessment: 'unknown',
          observedAt: '2026-11-25T00:00:00.000Z',
          evidence: ['No opt-in agent session marker.'],
        }) satisfies AgentAttribution,
      readNamespace: (namespace) => `${namespace}:[4026531840]`,
    });

    expect(result.listeners).toHaveLength(4);
    expect(result.listeners.map(({ addressFamily }) => addressFamily)).toEqual(['IPv4', 'IPv4', 'IPv6', 'IPv4']);
    expect(result.listeners[0]?.bindAddress).toBe('0.0.0.0');
    expect(result.listeners[1]?.bindAddress).toBe('127.0.0.1');
    expect(result.listeners[3]?.protocol).toBe('udp');
    expect(result.listeners[0]?.owners.map(({ pid }) => pid)).toEqual([321, 322]);
    expect(result.listeners[0]?.owners[1]).toMatchObject({
      processName: 'worker',
      command: '/usr/bin/process-322',
      user: 'uid:1000',
      detailsStatus: 'available',
      projectContext: {
        status: 'identified',
        projectRoot: '/workspace/service-322',
        worktree: false,
      },
      agentAttribution: { status: 'unknown', confidence: 'none', leftoverAssessment: 'unknown' },
    });
    expect(result.namespace).toEqual({ network: 'net:[4026531840]', pid: 'pid:[4026531840]' });
  });

  it('sorts listeners and shared owners deterministically', () => {
    const result = diagnoseListeningPort(8080, {
      discover: () => [
        {
          protocol: 'tcp',
          state: 'LISTEN',
          address: '127.0.0.1',
          port: 8080,
          pid: 9,
          processName: 'z',
          owners: [
            { pid: 9, processName: 'z' },
            { pid: 2, processName: 'a' },
          ],
        },
        { protocol: 'tcp', state: 'LISTEN', address: '[::1]', port: 8080, pid: null, processName: null },
      ],
      inspectProcess: () => ({ details: null, status: 'unavailable' }),
      readNamespace: () => null,
    });
    expect(result.listeners.map((listener) => listener.bindAddress)).toEqual(['127.0.0.1', '[::1]']);
    expect(result.listeners[0]?.owners.map((owner) => owner.pid)).toEqual([2, 9]);
  });

  it('explains hidden owners, permission limits, and the current namespace', () => {
    const result = diagnoseListeningPort(8080, {
      discover: () => sockets.slice(3, 4),
      readNamespace: (namespace) => `current-${namespace}`,
    });

    expect(result.listeners[0]?.owners).toEqual([]);
    expect(result.messages.join('\n')).toContain('No process owner is visible');
    expect(result.limitations.join('\n')).toContain('current network namespace');
    expect(result.limitations.join('\n')).toContain('current PID namespace');
    expect(formatDiagnosis(result)).toContain('owner hidden');

    const restricted = diagnoseListeningPort(8080, {
      discover: () => sockets.slice(0, 1),
      inspectProcess: () => ({ details: null, status: 'permission-denied' }),
      readNamespace: () => null,
    });
    expect(restricted.messages.join('\n')).toContain('blocked by permissions');
    expect(restricted.listeners[0]?.owners[0]?.processName).toBe('node');
  });

  it('describes macOS host discovery and unavailable Linux process metadata', () => {
    const readNamespace = vi.fn(() => 'unexpected');
    const result = diagnoseListeningPort(8080, { platform: 'darwin', discover: () => sockets, readNamespace });
    expect(readNamespace).not.toHaveBeenCalled();
    expect(result.namespace).toEqual({ network: null, pid: null });
    expect(result.limitations.join('\n')).toContain('current macOS host view');
    expect(result.limitations.join('\n')).toContain('unavailable on macOS');
    expect(result.listeners[0]?.owners[0]).toMatchObject({ detailsStatus: 'unavailable' });
    expect(result.listeners[0]?.owners[0]?.projectContext.status).toBe('unavailable');
    expect(result.listeners[0]?.owners[0]?.agentAttribution.status).toBe('unknown');
  });

  it('returns a successful empty result with a race-aware message', () => {
    const result = diagnoseListeningPort(9999, { discover: () => [], readNamespace: () => null });
    expect(result.listeners).toEqual([]);
    expect(result.messages[0]).toContain('No listeners are visible');
    expect(result.messages[0]).toContain('cannot guarantee a future bind');
    expect(result.limitations.some((item) => item.includes('could not be identified'))).toBe(true);
    expect(formatDiagnosis(result)).toContain('No visible listeners.');
  });

  it('classifies permission and process-exit races while reading procfs', () => {
    const permissionDenied = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    const processExited = Object.assign(new Error('not found'), { code: 'ENOENT' });

    expect(
      inspectProcessDetails(42, () => {
        throw permissionDenied;
      }),
    ).toEqual({ details: null, status: 'permission-denied' });
    expect(
      inspectProcessDetails(42, () => {
        throw processExited;
      }),
    ).toEqual({ details: null, status: 'process-exited' });
  });

  it('emits JSON with a stable schema and documented exit codes', async () => {
    const diagnosis: PortDiagnosis = diagnoseListeningPort(8080, {
      discover: () => [],
      readNamespace: () => null,
    });
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const program = new Command().name('portcn');
    registerDiagnoseCommand(program, () => diagnosis);

    await program.parseAsync(['node', 'portcn', 'diagnose', '8080', '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({ schemaVersion: 1, port: 8080, listeners: [] });
    expect(process.exitCode).toBe(0);
    output.length = 0;

    const versionedProgram = new Command().name('portcn');
    registerDiagnoseCommand(versionedProgram, () => diagnosis);
    await versionedProgram.parseAsync(['node', 'portcn', 'diagnose', '8080', '--json-version', '1']);
    expect(JSON.parse(output.join(''))).toMatchObject({ schemaVersion: 1, port: 8080, listeners: [] });
    expect(output.join('').includes('\u001b')).toBe(false);
    output.length = 0;

    const invalidProgram = new Command().name('portcn');
    registerDiagnoseCommand(invalidProgram, () => diagnosis);
    await invalidProgram.parseAsync(['node', 'portcn', 'diagnose', '0', '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({ error: { code: 'INVALID_PORT' } });
    expect(process.exitCode).toBe(2);
  });

  it('returns a structured discovery failure and registers branded help', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const program = new Command().name('portcn');
    registerDiagnoseCommand(program, () => {
      throw new Error('The ss command is missing. Install iproute2.');
    });

    await program.parseAsync(['node', 'portcn', 'diagnose', '8080', '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({ error: { code: 'DIAGNOSIS_FAILED' } });
    expect(process.exitCode).toBe(1);
    expect(program.commands[0]?.helpInformation()).toContain('diagnose [options] <port>');
    expect(program.commands[0]?.helpInformation()).toContain('--json');
    expect(program.commands[0]?.helpInformation()).toContain('--json-version');
  });
});
