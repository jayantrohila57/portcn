import { Command } from 'commander';
import { describe, expect, it, vi } from 'vitest';
import type { SavedService } from '../src/commands/config-store.js';
import type { ListeningPort } from '../src/commands/list.js';
import { checkReadiness, registerReadinessCommands } from '../src/commands/readiness.js';

const service: SavedService = {
  id: 'tcp://127.0.0.1:3000',
  protocol: 'tcp',
  address: '127.0.0.1',
  port: 3000,
  favorite: false,
  alias: null,
  note: null,
  groups: [],
  url: null,
};
const explicitHttp = { ...service, url: 'http://127.0.0.1:3000/health' };
const listener: ListeningPort = {
  protocol: 'tcp',
  state: 'LISTEN',
  address: '127.0.0.1',
  port: 3000,
  pid: null,
  processName: null,
  owners: [],
};

describe('readiness checks', () => {
  it('does not infer readiness from a listener and reports a successful TCP connection as reachable', async () => {
    const result = await checkReadiness(service, true, {}, { connect: vi.fn(async () => {}) });
    expect(result.status).toBe('reachable');
    expect(result.detail).toContain('readiness was not assessed');
  });

  it('returns stopped without probing when no listener was observed', async () => {
    const connect = vi.fn();
    const result = await checkReadiness(service, false, {}, { connect });
    expect(result.status).toBe('stopped');
    expect(connect).not.toHaveBeenCalled();
  });

  it('retries an explicit HTTP health URL until it succeeds', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await checkReadiness(
      explicitHttp,
      true,
      { retries: 2 },
      { fetch: fetcher as typeof fetch, sleep: async () => {} },
    );
    expect(result).toMatchObject({ status: 'ready', attempts: 2, statusCode: 204, endpoint: explicitHttp.url });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('marks persistent non-success HTTP responses unhealthy and failed connection attempts unknown', async () => {
    const http = await checkReadiness(
      explicitHttp,
      true,
      { retries: 1 },
      { fetch: vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch, sleep: async () => {} },
    );
    expect(http).toMatchObject({ status: 'unhealthy', attempts: 2, statusCode: 503 });
    const tcp = await checkReadiness(
      service,
      true,
      {},
      {
        connect: async () => {
          throw new Error('timed out');
        },
      },
    );
    expect(tcp.status).toBe('unknown');
  });

  it('supports cancellation during retry delay', async () => {
    const controller = new AbortController();
    const pending = checkReadiness(
      explicitHttp,
      true,
      { retries: 1, signal: controller.signal },
      {
        fetch: vi.fn(async () => new Response(null, { status: 503 })) as typeof fetch,
        sleep: async (_ms, signal) => {
          controller.abort();
          if (signal.aborted) throw Object.assign(new Error('cancelled'), { name: 'AbortError' });
        },
      },
    );
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('registers readiness commands and emits versioned state JSON', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const program = new Command().name('portcn');
    registerReadinessCommands(program, {
      loadConfig: async () => ({ version: 2, services: [explicitHttp], groups: [] }),
      discover: () => [listener],
      fetch: vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch,
    });
    await program.parseAsync(['node', 'portcn', 'readiness', 'check', service.id, '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({ schemaVersion: 1, status: 'ready', serviceId: service.id });
  });
});
