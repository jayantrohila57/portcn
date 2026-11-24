import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
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
  it('parses TCP, UDP, IPv6 and visible process owners, sorted by port', () => {
    expect(parseSsOutput(SAMPLE)).toEqual([
      { protocol: 'tcp', state: 'LISTEN', address: '[::]', port: 22, pid: 12, processName: 'sshd' },
      { protocol: 'tcp', state: 'LISTEN', address: '127.0.0.1', port: 3000, pid: 321, processName: 'node' },
      { protocol: 'udp', state: 'UNCONN', address: '0.0.0.0', port: 5353, pid: null, processName: null },
    ]);
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
  });
});
