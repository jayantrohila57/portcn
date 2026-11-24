import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import {
  formatInspectedPorts,
  inspectListeningPort,
  parsePort,
  readProcessDetails,
  registerInspectCommand,
} from '../src/commands/inspect.js';
import type { ListeningPort } from '../src/commands/list.js';

const listeners: ListeningPort[] = [
  { protocol: 'tcp', state: 'LISTEN', address: '127.0.0.1', port: 8080, pid: 321, processName: 'node' },
  { protocol: 'tcp', state: 'LISTEN', address: '[::1]', port: 8080, pid: 654, processName: 'node' },
  { protocol: 'udp', state: 'UNCONN', address: '0.0.0.0', port: 5353, pid: null, processName: null },
];

describe('port inspect', () => {
  it('validates inclusive port boundaries', () => {
    expect(parsePort('1')).toBe(1);
    expect(parsePort('65535')).toBe(65535);
    expect(() => parsePort('0')).toThrow('between 1 and 65535');
    expect(() => parsePort('65536')).toThrow('between 1 and 65535');
    expect(() => parsePort('1.5')).toThrow('between 1 and 65535');
  });

  it('filters multiple IPv4, IPv6, TCP and UDP listeners and reads details', () => {
    const result = inspectListeningPort(parsePort('8080'), {
      discover: () => listeners,
      readDetails: (pid) => ({ command: `/usr/bin/process-${pid}`, user: 'uid:1000' }),
    });
    expect(result).toHaveLength(2);
    expect(formatInspectedPorts(result)).toContain('127.0.0.1');
    expect(formatInspectedPorts(result)).toContain('/usr/bin/process-654');
  });

  it('handles no listeners and unavailable process information', () => {
    expect(formatInspectedPorts(inspectListeningPort(parsePort('9999'), { discover: () => listeners }))).toBe(
      'No listeners found for the requested port.',
    );
    const result = inspectListeningPort(parsePort('5353'), { discover: () => listeners, readDetails: () => null });
    expect(formatInspectedPorts(result)).toMatch(
      /UDP\s+\|\s+UNCONN\s+\|\s+0\.0\.0\.0\s+\|\s+-\s+\|\s+-\s+\|\s+unavailable/,
    );
  });

  it('reads proc details without requiring permissions and tolerates missing files', () => {
    const read = vi.fn((path: string) =>
      path.endsWith('status') ? 'Name:\tserver\nUid:\t1000\t1000\t1000\t1000\n' : 'node\0server\0',
    );
    expect(readProcessDetails(42, read)).toEqual({ command: 'node server', user: 'uid:1000' });
    expect(
      readProcessDetails(42, () => {
        throw new Error('permission denied');
      }),
    ).toBeNull();
  });

  it('registers inspect in Commander help', () => {
    const command = new Command().name('portcn');
    registerInspectCommand(command);
    expect(command.helpInformation()).toContain('inspect <port>');
  });
});
