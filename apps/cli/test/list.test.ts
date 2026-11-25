import { createServer } from 'node:net';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  discoverListeningPorts,
  formatListeningPorts,
  parseLsofOutput,
  parseSsOutput,
  registerListCommand,
} from '../src/commands/list.js';

const SAMPLE = [
  'tcp LISTEN 0 128 127.0.0.1:3000 0.0.0.0:* users:(("node",pid=321,fd=15))',
  'udp UNCONN 0 0 0.0.0.0:5353 0.0.0.0:*',
  'tcp LISTEN 0 4096 [::]:22 [::]:* users:(("sshd",pid=12,fd=4))',
].join('\n');

describe('read-only port listing', () => {
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

  it('uses lsof for macOS TCP and UDP discovery', () => {
    const runLsof = vi.fn((args: string[]) =>
      args.includes('-iUDP') ? 'p654\0cpython\0\nPUDP\0n*:5353\0\n' : 'p321\0cnode\0\nPTCP\0n127.0.0.1:3000\0\n',
    );
    expect(discoverListeningPorts({ platform: 'darwin', runLsof })).toEqual([
      {
        protocol: 'tcp',
        state: 'LISTEN',
        address: '127.0.0.1',
        port: 3000,
        pid: 321,
        processName: 'node',
        owners: [{ pid: 321, processName: 'node' }],
      },
      {
        protocol: 'udp',
        state: 'UNCONN',
        address: '*',
        port: 5353,
        pid: 654,
        processName: 'python',
        owners: [{ pid: 654, processName: 'python' }],
      },
    ]);
    expect(runLsof).toHaveBeenNthCalledWith(1, ['-nP', '-iTCP', '-sTCP:LISTEN', '-F0pcPn']);
    expect(runLsof).toHaveBeenNthCalledWith(2, ['-nP', '-iUDP', '-F0pcPn']);
  });

  it('parses shared lsof owners and skips connected UDP endpoints', () => {
    expect(
      parseLsofOutput(
        'p321\0cnode\0\nPTCP\0n[::1]:3000\0\np654\0cworker\0\nPTCP\0n[::1]:3000\0\nPUDP\0n127.0.0.1:5000->127.0.0.1:5001\0',
      ),
    ).toEqual([
      {
        protocol: 'tcp',
        state: 'LISTEN',
        address: '[::1]',
        port: 3000,
        pid: 321,
        processName: 'node',
        owners: [
          { pid: 321, processName: 'node' },
          { pid: 654, processName: 'worker' },
        ],
      },
    ]);
  });

  it('explains unsupported platforms without inspecting host tools', () => {
    const runSs = vi.fn(() => '');
    expect(() => discoverListeningPorts({ platform: 'win32', runSs })).toThrow('Linux and macOS');
    expect(runSs).not.toHaveBeenCalled();
  });

  it.skipIf(process.platform !== 'darwin')('discovers a real macOS listener owned by this process', async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    try {
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected an ephemeral TCP port.');
      expect(discoverListeningPorts({ platform: 'darwin' })).toEqual(
        expect.arrayContaining([expect.objectContaining({ protocol: 'tcp', port: address.port, pid: process.pid })]),
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
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
        message: 'Port discovery failed. Check platform tooling and process permissions.',
      },
    });
    expect(output.join('')).not.toContain('private detail');
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });
});
