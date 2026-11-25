import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatInspectedPorts,
  formatProcessCommand,
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
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

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

  it('redacts sensitive command arguments and credentials', () => {
    expect(
      formatProcessCommand(
        'node\0server.js\0--api-key\0sensitive-value\0DATABASE_PASSWORD=hunter2\0https://user:pass@example.test/path\0',
      ),
    ).toBe(
      'node server.js --api-key [REDACTED] DATABASE_PASSWORD=[REDACTED] https://user:[REDACTED]@example.test/path',
    );
  });

  it('registers inspect in Commander help', () => {
    const command = new Command().name('portcn');
    registerInspectCommand(command);
    expect(command.commands[0]?.helpInformation()).toContain('inspect [options] <port>');
    expect(command.commands[0]?.helpInformation()).toContain('--json');
    expect(command.commands[0]?.helpInformation()).toContain('--json-version');
  });

  it('provides opt-in versioned JSON while preserving the legacy array shape', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const command = new Command().name('portcn');
    registerInspectCommand(command, (port) =>
      listeners.filter((listener) => listener.port === port).map((listener) => ({ ...listener, details: null })),
    );
    await command.parseAsync(['node', 'portcn', 'inspect', '8080', '--json-version', '1']);
    const versioned = JSON.parse(output.join('')) as {
      schemaVersion: number;
      port: number;
      listeners: Array<{ port: number }>;
    };
    expect(versioned.schemaVersion).toBe(1);
    expect(versioned.port).toBe(8080);
    expect(versioned.listeners.map(({ port }) => port)).toEqual([8080, 8080]);
    expect(output.join('').includes('\u001b')).toBe(false);
    output.length = 0;
    await command.parseAsync(['node', 'portcn', 'inspect', '8080', '--json']);
    expect(Array.isArray(JSON.parse(output.join('')))).toBe(true);
  });

  it('returns structured invalid-port errors with the documented exit status', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const command = new Command().name('portcn');
    registerInspectCommand(command);
    await command.parseAsync(['node', 'portcn', 'inspect', '0', '--json-version', '1']);
    expect(JSON.parse(output.join(''))).toMatchObject({
      schemaVersion: 1,
      error: { code: 'INVALID_PORT', port: '0' },
    });
    expect(process.exitCode).toBe(2);
  });
});
