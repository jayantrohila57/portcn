import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SavedService, ServiceConfig } from '../src/commands/config-store.js';
import { endpointCandidate, validateServiceUrl } from '../src/commands/endpoint-url.js';
import {
  openLocalUrl,
  probeEndpoint,
  registerEndpointCommands,
  terminalEndpointLink,
} from '../src/commands/endpoints.js';
import type { ListeningPort } from '../src/commands/list.js';

const base: SavedService = {
  id: 'tcp://0.0.0.0:3000',
  protocol: 'tcp',
  address: '0.0.0.0',
  port: 3000,
  favorite: false,
  alias: null,
  note: null,
  groups: [],
  url: null,
};
const config: ServiceConfig = { version: 2, services: [base], groups: [] };
const listener: ListeningPort = {
  protocol: 'tcp',
  state: 'LISTEN',
  address: '0.0.0.0',
  port: 3000,
  pid: null,
  processName: null,
  owners: [],
};

describe('local service endpoints', () => {
  afterEach(() => {
    process.exitCode = 0;
    vi.restoreAllMocks();
  });

  it('constructs loopback URLs from IPv4 and IPv6 wildcard bindings and marks them unverified', () => {
    expect(endpointCandidate(base)).toEqual({ status: 'unverified', url: 'http://127.0.0.1:3000/' });
    expect(endpointCandidate({ ...base, address: '*' })).toEqual({
      status: 'unverified',
      url: 'http://localhost:3000/',
    });
    expect(endpointCandidate({ ...base, address: '::' })).toEqual({
      status: 'unverified',
      url: 'http://[::1]:3000/',
    });
  });

  it('keeps UDP as non-web and validates user overrides against the saved local bind and port', () => {
    expect(endpointCandidate({ ...base, protocol: 'udp' })).toMatchObject({ status: 'non-web', url: null });
    expect(validateServiceUrl('https://localhost:3000/health', base)).toBe('https://localhost:3000/health');
    expect(() => validateServiceUrl('http://example.com:3000', base)).toThrow('service bind address');
    expect(() => validateServiceUrl('http://localhost:3001', base)).toThrow('saved service port');
    expect(() => validateServiceUrl('http://user:pass@localhost:3000', base)).toThrow('credentials');
    expect(endpointCandidate({ ...base, address: '203.0.113.45' })).toMatchObject({ status: 'non-web', url: null });
  });

  it('checks only the selected endpoint, does not follow redirects, and does not claim readiness', async () => {
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method).toBe('HEAD');
      expect(init?.redirect).toBe('manual');
      return new Response(null, { status: 302, headers: { location: 'http://example.com/' } });
    });
    const result = await probeEndpoint(base.id, 'http://127.0.0.1:3000/', 500, {
      fetch: fetcher as typeof fetch,
      now: () => new Date('2026-11-25T00:00:00Z'),
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      status: 'responded',
      statusCode: 302,
      observedAt: '2026-11-25T00:00:00.000Z',
    });
    expect(result.detail).toContain('did not follow');
    expect(result.detail).not.toContain('ready');
  });

  it('reports strict HTTPS certificate failures without disabling TLS checks', async () => {
    const error = new TypeError('fetch failed', {
      cause: Object.assign(new Error('certificate rejected'), { code: 'CERT_HAS_EXPIRED' }),
    });
    const result = await probeEndpoint(base.id, 'https://localhost:3000/', 500, {
      fetch: vi.fn().mockRejectedValue(error),
    });
    expect(result.status).toBe('tls-error');
    expect(result.detail).toContain('not bypassed');
  });

  it('marks the URL unverified in JSON and passes only the explicit local URL to the browser opener', async () => {
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    const open = vi.fn(async (_url: string) => {});
    const program = new Command().name('portcn');
    registerEndpointCommands(program, { loadConfig: async () => config, discover: () => [listener], open });
    await program.parseAsync(['node', 'portcn', 'endpoint', 'list', '--json']);
    expect(JSON.parse(output.join(''))).toMatchObject({
      services: [{ status: 'unverified', verificationStatus: 'unverified', url: 'http://127.0.0.1:3000/' }],
    });
    output.length = 0;
    await program.parseAsync(['node', 'portcn', 'open', base.id]);
    expect(open).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:3000/');
  });

  it('uses terminal hyperlinks only when output is a TTY', () => {
    expect(terminalEndpointLink('http://localhost:3000/', 'web', false)).toBe('web (http://localhost:3000/)');
    expect(terminalEndpointLink('http://localhost:3000/', 'web', true)).toContain('\u001b]8;;');
    expect(terminalEndpointLink('http://localhost:3000/', 'web\u001b]8;;', true)).not.toContain('web\u001b]8;;');
  });

  it('passes the browser URL as one argument to xdg-open without shell parsing', async () => {
    const launch = vi.fn(async (_executable: string, _args: string[]) => {});
    await openLocalUrl('http://127.0.0.1:3000/?q=$(touch%20/tmp/nope)', launch);
    expect(launch).toHaveBeenCalledExactlyOnceWith('xdg-open', ['http://127.0.0.1:3000/?q=$(touch%20/tmp/nope)']);
  });
});
