import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkPortAvailability,
  formatPortAvailability,
  formatPortSuggestions,
  PortWatchCancelledError,
  PortWatchTimeoutError,
  registerAvailabilityCommands,
  suggestAvailablePorts,
  watchPortAvailability,
} from '../src/commands/availability.js';
import type { ListeningPort } from '../src/commands/list.js';

const loopbackListener: ListeningPort = {
  protocol: 'tcp',
  state: 'LISTEN',
  address: '127.0.0.1',
  port: 3000,
  pid: 42,
  processName: 'node',
};
const sockets: ListeningPort[] = [
  loopbackListener,
  { protocol: 'tcp', state: 'LISTEN', address: '0.0.0.0', port: 3002, pid: 43, processName: 'server' },
  { protocol: 'tcp', state: 'LISTEN', address: '[::]', port: 3004, pid: null, processName: null },
  { protocol: 'tcp', state: 'LISTEN', address: '[0:0:0:0:0:0:0:1]', port: 3005, pid: null, processName: null },
  { protocol: 'udp', state: 'UNCONN', address: '0.0.0.0', port: 3006, pid: null, processName: null },
];

describe('read-only port availability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
  });

  it('checks the requested protocol and concrete bind address', () => {
    const conflict = checkPortAvailability(3000, { discover: () => sockets, readNamespace: () => 'net:[1]' });
    expect(conflict.status).toBe('conflict-observed');
    expect(conflict.conflicts.map(({ address }) => address)).toEqual(['127.0.0.1']);
    expect(checkPortAvailability(3000, { protocol: 'udp', discover: () => sockets }).status).toBe(
      'no-conflict-observed',
    );
    expect(checkPortAvailability(3001, { discover: () => sockets }).status).toBe('no-conflict-observed');
    expect(conflict.limitations.join(' ')).toContain('does not bind or reserve');
  });

  it('describes macOS host-view scope without claiming a Linux namespace', () => {
    const result = checkPortAvailability(3000, { platform: 'darwin', discover: () => sockets });
    expect(result.namespace).toBeNull();
    expect(result.limitations.join('\n')).toContain('current macOS host process');
    expect(result.limitations.join('\n')).not.toContain('network namespace could not be identified');
  });

  it('orders multiple overlapping listeners deterministically', () => {
    const first = checkPortAvailability(3000, { discover: () => sockets });
    const second = checkPortAvailability(3000, {
      discover: () => [loopbackListener, { ...loopbackListener, address: '0.0.0.0' }],
    });
    expect(second.conflicts.map(({ address }) => address)).toEqual(['0.0.0.0', '127.0.0.1']);
    expect(first.status).toBe('conflict-observed');
  });

  it('detects wildcard overlap and reports ambiguous IPv6 dual-stack cases as unknown', () => {
    expect(checkPortAvailability(3002, { address: '127.0.0.1', discover: () => sockets }).status).toBe(
      'conflict-observed',
    );
    expect(checkPortAvailability(3002, { address: '::', discover: () => sockets }).status).toBe('unknown');
    const ambiguous = checkPortAvailability(3004, { address: '127.0.0.1', discover: () => sockets });
    expect(ambiguous.status).toBe('unknown');
    expect(ambiguous.conflicts).toEqual([]);
    expect(checkPortAvailability(3004, { address: '::1', discover: () => sockets }).status).toBe('conflict-observed');
    expect(checkPortAvailability(3005, { address: '::1', discover: () => sockets }).status).toBe('conflict-observed');
    expect(checkPortAvailability(3006, { protocol: 'udp', address: '0.0.0.0', discover: () => sockets }).status).toBe(
      'conflict-observed',
    );
  });

  it('validates protocol and address inputs without resolving hostnames', () => {
    expect(() => checkPortAvailability(3000, { protocol: 'sctp', discover: () => sockets })).toThrow('tcp or udp');
    expect(() => checkPortAvailability(3000, { address: 'localhost', discover: () => sockets })).toThrow(
      'hostnames are not resolved',
    );
    expect(() => checkPortAvailability(0, { discover: () => sockets })).toThrow('between 1 and 65535');
  });

  it('suggests only candidates without observed conflicts and bounds the range', () => {
    const result = suggestAvailablePorts({
      range: '3000-3006',
      from: '3000',
      limit: '4',
      discover: () => sockets,
      readNamespace: () => null,
    });
    expect(result.suggestions).toEqual([3001, 3003, 3005, 3006]);
    expect(formatPortSuggestions(result)).toContain('3001');
    expect(() => suggestAvailablePorts({ range: '1-2000', discover: () => [] })).toThrow('at most 1024 ports');
    expect(() => suggestAvailablePorts({ range: '3000-3010', from: '3011', discover: () => [] })).toThrow(
      'inside the requested range',
    );
    const noCandidates = suggestAvailablePorts({
      range: '3000-3000',
      discover: () => sockets.filter((socket) => socket.port === 3000),
    });
    expect(noCandidates.suggestions).toEqual([]);
    expect(formatPortSuggestions(noCandidates)).toContain('No candidate ports');
  });

  it('formats a beginner-readable point-in-time result', () => {
    expect(formatPortAvailability(checkPortAvailability(3000, { discover: () => sockets }))).toContain(
      'Listener overlap observed',
    );
    expect(formatPortAvailability(checkPortAvailability(3001, { discover: () => sockets }))).toContain(
      'No overlapping TCP listener was observed',
    );
  });

  it('watches until a listener disappears and emits only state changes', async () => {
    let calls = 0;
    const changes: string[] = [];
    const result = await watchPortAvailability(3000, {
      discover: () => (++calls < 2 ? [loopbackListener] : []),
      sleep: async () => {},
      onChange: ({ status }) => changes.push(status),
    });
    expect(result.status).toBe('no-conflict-observed');
    expect(changes).toEqual(['conflict-observed', 'no-conflict-observed']);
  });

  it('times out while availability remains uncertain or conflicting', async () => {
    await expect(
      watchPortAvailability(3000, {
        discover: () => [loopbackListener],
        intervalMs: 50,
        timeoutMs: 1,
        sleep: async () => {},
      }),
    ).rejects.toBeInstanceOf(PortWatchTimeoutError);
  });

  it('cancels promptly and validates watch bounds', async () => {
    const controller = new AbortController();
    await expect(
      watchPortAvailability(3000, {
        discover: () => [loopbackListener],
        signal: controller.signal,
        sleep: async (_ms, signal) => {
          controller.abort();
          if (signal?.aborted) throw new PortWatchCancelledError();
        },
      }),
    ).rejects.toBeInstanceOf(PortWatchCancelledError);
    await expect(watchPortAvailability(3000, { intervalMs: 1, discover: () => [] })).rejects.toThrow(
      'between 50 and 5000',
    );
    await expect(watchPortAvailability(3000, { timeoutMs: 0, discover: () => [] })).rejects.toThrow(
      'between 1 and 300000',
    );
  });

  it('emits stable versioned JSON for check and suggestions and structured errors', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const program = new Command().name('portcn');
    registerAvailabilityCommands(program, { discover: () => sockets, readNamespace: () => null });
    await program.parseAsync(['node', 'portcn', 'check', '3000', '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({
      schemaVersion: 1,
      port: 3000,
      status: 'conflict-observed',
    });
    output.length = 0;
    await program.parseAsync(['node', 'portcn', 'suggest', '--range', '3000-3002', '--json-version', '1']);
    expect(JSON.parse(output.join(''))).toMatchObject({ schemaVersion: 1, suggestions: [3001] });
    output.length = 0;
    await program.parseAsync(['node', 'portcn', 'check', '3000', '--protocol', 'sctp', '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({
      schemaVersion: 1,
      error: { code: 'INVALID_INPUT' },
    });
    expect(process.exitCode).toBe(2);
    process.exitCode = 0;
  });

  it('reports watch timeouts as timeout errors in JSON mode', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const program = new Command();
    registerAvailabilityCommands(program, { discover: () => [loopbackListener] });
    await program.parseAsync(['node', 'portcn', 'wait', '3000', '--timeout', '1', '--json']);
    expect(JSON.parse(output.at(-1) ?? '')).toMatchObject({
      schemaVersion: 1,
      event: 'timeout',
      error: { code: 'WATCH_TIMEOUT', port: '3000' },
    });
    expect(process.exitCode).toBe(1);
  });
});
