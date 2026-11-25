import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverListeningPorts,
  formatListeningPorts,
  parseSsOutput,
  registerListCommand,
} from '../src/commands/list.js';

const SAMPLE = [
  'tcp LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=321,fd=15))',
  'udp UNCONN 0 0 0.0.0.0:5353 0.0.0.0:*',
  'tcp LISTEN 0 4096 [::]:22 [::]:* users:(("sshd",pid=12,fd=4))',
].join('\n');

describe('read-only Linux port listing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('parses TCP, UDP, IPv6 and visible process owners, sorted by port', () => {
    expect(parseSsOutput(SAMPLE)).toEqual([
      {
        protocol: 'tcp',
        state: 'LISTEN',
        address: '[::]',
        port: 22,
        pid: 12,
        processName: 'sshd',
        owners: [{ processName: 'sshd', pid: 12 }],
      },
      {
        protocol: 'tcp',
        state: 'LISTEN',
        address: '127.0.0.1',
        port: 3000,
        pid: 321,
        processName: 'node',
        owners: [{ processName: 'node', pid: 321 }],
      },
      { protocol: 'udp', state: 'UNCONN', address: '0.0.0.0', port: 5353, pid: null, processName: null, owners: [] },
    ]);
  });

  it('retains every process owner reported for a shared listening socket', () => {
    const result = parseSsOutput(
      'tcp LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=321,fd=15),("worker",pid=654,fd=6))',
    );
    expect(result[0]?.owners).toEqual([
      { processName: 'node', pid: 321 },
      { processName: 'worker', pid: 654 },
    ]);
    expect(result[0]?.pid).toBe(321);
    const reversed = parseSsOutput(
      'tcp LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("worker",pid=654,fd=6),("node",pid=321,fd=15))',
    );
    expect(reversed[0]?.owners).toEqual(result[0]?.owners);
    expect(reversed[0]?.pid).toBe(321);
  });

  it('does not assume missing PID and process data are visible', () => {
    const result = formatListeningPorts(parseSsOutput(SAMPLE));
    expect(result).toContain('PROTO');
    expect(result).toContain('PORT');
    expect(result).toContain('LOCAL ADDRESS');
    expect(result).toContain('3000');
    expect(result).toContain('321');
    expect(result).toContain('node');
    expect(result).toMatch(/5353\s+\|\s+0\.0\.0\.0\s+\|\s+-\s+\|\s+-/);
  });

  it('shows an informative empty state', () => {
    expect(parseSsOutput(' \n')).toEqual([]);
    expect(formatListeningPorts([])).toBe('No listening TCP or UDP ports found.');
  });

  it('runs ss without a shell and with read-only, numeric socket flags', () => {
    const runSs = vi.fn(() => SAMPLE);
    expect(discoverListeningPorts({ platform: 'linux', runSs })).toHaveLength(3);
    expect(runSs).toHaveBeenCalledWith(['--no-header', '--listening', '--tcp', '--udp', '--numeric', '--processes']);
  });

  it('explains unsupported platforms without inspecting the host', () => {
    const runSs = vi.fn(() => '');
    expect(() => discoverListeningPorts({ platform: 'darwin', runSs })).toThrow('Linux only');
    expect(runSs).not.toHaveBeenCalled();
  });

  it('explains the missing system dependency', () => {
    const failure = Object.assign(new Error('spawn ss ENOENT'), { code: 'ENOENT' });
    expect(() =>
      discoverListeningPorts({
        platform: 'linux',
        runSs: () => {
          throw failure;
        },
      }),
    ).toThrow('Install iproute2');
  });

  it('surfaces command failures and rejects malformed socket output', () => {
    expect(() =>
      discoverListeningPorts({
        platform: 'linux',
        runSs: () => {
          throw new Error('permission denied');
        },
      }),
    ).toThrow('permission denied');
    expect(() => parseSsOutput('tcp LISTEN 0 128 invalid 0.0.0.0:*')).toThrow('Unexpected local port');
  });

  it('registers list in Commander help', () => {
    const command = new Command().name('portcn');
    registerListCommand(command);
    expect(command.helpInformation()).toContain('list');
    expect(command.commands[0]?.helpInformation()).toContain('--json');
    expect(command.commands[0]?.helpInformation()).toContain('--json-version');
  });

  it('adds an opt-in versioned JSON envelope and keeps legacy JSON unchanged', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const command = new Command().name('portcn');
    registerListCommand(command, () => parseSsOutput(SAMPLE));
    await command.parseAsync(['node', 'portcn', 'list', '--json-version', '1']);
    const versioned = JSON.parse(output.join('')) as { schemaVersion: number; listeners: Array<{ port: number }> };
    expect(versioned.schemaVersion).toBe(1);
    expect(versioned.listeners.map(({ port }) => port)).toEqual([22, 3000, 5353]);
    expect(output.join('').includes('\u001b')).toBe(false);
    output.length = 0;
    await command.parseAsync(['node', 'portcn', 'list', '--json']);
    expect(Array.isArray(JSON.parse(output.join('')))).toBe(true);
  });

  it('emits sanitized structured JSON errors for the versioned contract', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const command = new Command().name('portcn');
    registerListCommand(command, () => {
      throw new Error('Unable to list ports using ss: private detail');
    });
    await command.parseAsync(['node', 'portcn', 'list', '--json-version', '1']);
    expect(JSON.parse(output.join(''))).toEqual({
      schemaVersion: 1,
      error: {
        code: 'DISCOVERY_FAILED',
        message: 'Port discovery failed. Check permissions, iproute2, and namespace visibility.',
      },
    });
    expect(output.join('')).not.toContain('private detail');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
