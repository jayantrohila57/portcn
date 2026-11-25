import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedService, ServiceConfig } from '../src/commands/config-store.js';
import { diagnoseConnection, registerConnectionCommands } from '../src/commands/connection.js';
import { type DockerInventory, parseDockerInspect } from '../src/commands/docker.js';
import type { ListeningPort } from '../src/commands/list.js';

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
const httpService = { ...service, url: 'https://127.0.0.1:3000/health' };
const config: ServiceConfig = { version: 2, services: [service], groups: [] };
const listener: ListeningPort = {
  protocol: 'tcp',
  state: 'LISTEN',
  address: service.address,
  port: service.port,
  pid: null,
  processName: null,
  owners: [],
};
const dockerFixture = readFileSync(fileURLToPath(new URL('./fixtures/docker-inspect.json', import.meta.url)), 'utf8');
const dockerInventory: DockerInventory = {
  schemaVersion: 1,
  availability: 'available',
  hostListenerDiscovery: 'available',
  limitations: [],
  containers: parseDockerInspect(dockerFixture),
};

const dependencies = {
  resolve: async () => [{ address: '127.0.0.1', family: 4 }],
  connect: async () => {},
  docker: () => dockerInventory,
  hostname: () => 'test-host',
  networkNamespace: () => 'net:[123]',
  now: () => new Date('2026-11-25T00:00:00Z'),
};

describe('local connection diagnostics', () => {
  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('reports DNS, bind family/scope, TCP reachability, vantage, and Docker mapping evidence', async () => {
    const result = await diagnoseConnection({ ...service, address: '0.0.0.0', port: 8080 }, {}, dependencies);
    expect(result).toMatchObject({
      schemaVersion: 1,
      vantage: { hostname: 'test-host', networkNamespace: 'net:[123]' },
      stages: {
        resolution: { status: 'success', addresses: [{ address: '127.0.0.1', family: 'IPv4' }] },
        bind: { status: 'warning', family: 'IPv4', scope: 'all-interfaces' },
        tcp: { status: 'reachable' },
        http: { status: 'skipped' },
        docker: {
          status: 'available',
          matches: [
            { container: 'web-1', hostAddress: '0.0.0.0', hostPort: 8080 },
            { container: 'web-1', hostAddress: '::', hostPort: 8080 },
          ],
        },
      },
    });
  });

  it('preserves IPv4 and IPv6 resolution evidence for wildcard services', async () => {
    const result = await diagnoseConnection(
      { ...service, address: '*' },
      {},
      {
        ...dependencies,
        resolve: async () => [
          { address: '127.0.0.1', family: 4 },
          { address: '::1', family: 6 },
        ],
      },
    );
    expect(result.stages.resolution.addresses).toEqual([
      { address: '127.0.0.1', family: 'IPv4' },
      { address: '::1', family: 'IPv6' },
    ]);
    expect(result.stages.tcp.attempts.map((attempt) => attempt.family)).toEqual(['IPv4', 'IPv6']);
  });

  it('distinguishes refusal, timeout, and DNS failure while preserving per-address evidence', async () => {
    const refused = await diagnoseConnection(
      service,
      {},
      {
        ...dependencies,
        connect: async () => {
          throw Object.assign(new Error('refused'), { code: 'ECONNREFUSED' });
        },
      },
    );
    expect(refused.stages.tcp).toMatchObject({ status: 'refused', attempts: [{ code: 'ECONNREFUSED' }] });
    const timedOut = await diagnoseConnection(
      service,
      {},
      {
        ...dependencies,
        connect: async () => {
          throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' });
        },
      },
    );
    expect(timedOut.stages.tcp.status).toBe('timeout');
    const failedDns = await diagnoseConnection(
      service,
      {},
      {
        ...dependencies,
        resolve: async () => {
          throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
        },
      },
    );
    expect(failedDns.stages.resolution).toMatchObject({ status: 'failure', addresses: [] });
    expect(failedDns.stages.tcp.status).toBe('skipped');
  });

  it('records strict TLS failures and does not follow HTTP redirects', async () => {
    const tls = await diagnoseConnection(
      httpService,
      {},
      {
        ...dependencies,
        fetch: vi.fn().mockRejectedValue(
          new TypeError('fetch failed', {
            cause: Object.assign(new Error('certificate rejected'), { code: 'CERT_HAS_EXPIRED' }),
          }),
        ) as typeof fetch,
      },
    );
    expect(tls.stages.http.status).toBe('tls-error');
    const redirect = await diagnoseConnection(
      httpService,
      {},
      {
        ...dependencies,
        fetch: vi.fn(async (_url, init) => {
          expect(init?.method).toBe('HEAD');
          expect(init?.redirect).toBe('manual');
          return new Response(null, { status: 302 });
        }) as typeof fetch,
      },
    );
    expect(redirect.stages.http).toMatchObject({ status: 'redirect', statusCode: 302 });
  });

  it('connects to an actual local TCP fixture', async () => {
    const server: Server = createServer((socket) => socket.end());
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Local test server did not bind a TCP port.');
    const local = { ...service, id: `tcp://127.0.0.1:${address.port}`, port: address.port };
    try {
      const result = await diagnoseConnection(
        local,
        { timeoutMs: 500 },
        { ...dependencies, docker: () => ({ ...dockerInventory, containers: [] }) },
      );
      expect(result.stages.tcp.status).toBe('reachable');
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });

  it('registers a versioned JSON command for an observed service', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const program = new Command().name('portcn');
    registerConnectionCommands(program, {
      loadConfig: async () => config,
      discover: () => [listener],
      ...dependencies,
    });
    await program.parseAsync(['node', 'portcn', 'connection', 'check', service.id, '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({
      schemaVersion: 1,
      serviceId: service.id,
      stages: { tcp: { status: 'reachable' } },
    });
  });

  it('does not probe a saved service without a current local listener', async () => {
    const errors: string[] = [];
    const resolve = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
      errors.push(String(chunk));
      return true;
    });
    const program = new Command().name('portcn');
    registerConnectionCommands(program, {
      loadConfig: async () => config,
      discover: () => [],
      ...dependencies,
      resolve,
    });
    await program.parseAsync(['node', 'portcn', 'connection', 'check', service.id]);
    expect(resolve).not.toHaveBeenCalled();
    expect(errors.join('')).toContain('No saved or observed service matches');
  });
});
