import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type DockerInventory, parseDockerInspect } from '../src/commands/docker.js';
import {
  classifyBindScope,
  createExposureReport,
  formatExposureReport,
  registerExposureCommand,
} from '../src/commands/exposure.js';
import type { ListeningPort } from '../src/commands/list.js';

const DOCKER_FIXTURE = readFileSync(fileURLToPath(new URL('./fixtures/docker-inspect.json', import.meta.url)), 'utf8');
const LISTENERS = readFileSync(
  fileURLToPath(new URL('./fixtures/exposure-listeners.json', import.meta.url)),
  'utf8',
) as string;
const parsedListeners = JSON.parse(LISTENERS) as ListeningPort[];
const dockerInventory: DockerInventory = {
  schemaVersion: 1,
  availability: 'available',
  containers: parseDockerInspect(DOCKER_FIXTURE, parsedListeners),
  hostListenerDiscovery: 'available',
  limitations: [],
};

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

describe('potential service exposure', () => {
  it('classifies IPv4 and IPv6 loopback, interface-specific, wildcard, and unknown binds', () => {
    for (const address of ['127.0.0.1', '127.42.0.1', '[::1]', '[0:0:0:0:0:0:0:1]']) {
      expect(classifyBindScope(address)).toBe('loopback');
    }
    for (const address of ['0.0.0.0', '[::]']) {
      expect(classifyBindScope(address)).toBe('all-interfaces');
    }
    expect(classifyBindScope('192.168.1.25')).toBe('interface-specific');
    expect(classifyBindScope('[fe80::1%eth0]')).toBe('interface-specific');
    expect(classifyBindScope('not-an-address')).toBe('unknown');
  });

  it('reports native listeners and Docker published, direct, and exposed ports with family-specific scope', () => {
    const report = createExposureReport({
      listeners: parsedListeners,
      docker: dockerInventory,
      observedAt: new Date('2026-01-02T03:04:05.000Z'),
    });
    expect(report).toMatchObject({
      schemaVersion: 1,
      observedAt: '2026-01-02T03:04:05.000Z',
      listenerAvailability: 'available',
      dockerAvailability: 'available',
    });
    expect(
      report.findings.find(({ source, hostPort }) => source === 'host-listener' && hostPort === 3000),
    ).toMatchObject({
      addressFamily: 'IPv4',
      scope: 'loopback',
      assessment: expect.stringContaining('Loopback bind'),
    });
    const webPublished = report.findings.filter(
      ({ source, container, containerPort }) =>
        source === 'docker-published' && container === 'web-1' && containerPort === 80,
    );
    expect(webPublished).toHaveLength(2);
    expect(
      webPublished
        .map(({ addressFamily, scope }) => ({ addressFamily, scope }))
        .sort((a, b) => a.addressFamily.localeCompare(b.addressFamily)),
    ).toEqual([
      { addressFamily: 'IPv4', scope: 'all-interfaces' },
      { addressFamily: 'IPv6', scope: 'all-interfaces' },
    ]);
    expect(
      report.findings.find(({ source, containerPort }) => source === 'docker-direct' && containerPort === 8443),
    ).toMatchObject({
      scope: 'direct-routed',
      hostPort: null,
      addressFamily: 'IPv6',
    });
    expect(
      report.findings.find(({ source, containerPort }) => source === 'docker-exposed' && containerPort === 443),
    ).toMatchObject({
      scope: 'container-only',
      hostPort: null,
    });
    expect(
      report.findings.find(
        ({ source, containerPort, bindingState }) =>
          source === 'docker-published' && containerPort === 9000 && bindingState === 'configured',
      ),
    ).toMatchObject({
      scope: 'all-interfaces',
      hostPort: 9001,
      bindingState: 'configured',
      assessment: expect.stringContaining('no active host binding was observed'),
    });
    expect(report.findings.some(({ container }) => container === 'host-service')).toBe(false);
  });

  it('keeps native findings when Docker is unavailable and reports unknown host evidence', () => {
    const report = createExposureReport({
      listeners: parsedListeners,
      docker: {
        schemaVersion: 1,
        availability: 'permission-denied',
        containers: [],
        hostListenerDiscovery: 'unavailable',
        limitations: [],
        error: { code: 'DOCKER_PERMISSION_DENIED', message: 'denied' },
      },
    });
    expect(report.dockerAvailability).toBe('permission-denied');
    expect(report.dockerError?.code).toBe('DOCKER_PERMISSION_DENIED');
    expect(report.findings.filter(({ source }) => source === 'host-listener')).toHaveLength(4);
  });

  it('does not infer public reachability from wildcard binds and reports incomplete firewall evidence', () => {
    const report = createExposureReport({ listeners: parsedListeners, docker: dockerInventory });
    const wildcard = report.findings.find(
      ({ source, hostPort, scope }) => source === 'host-listener' && hostPort === 8080 && scope === 'all-interfaces',
    );
    expect(wildcard?.assessment).toContain('firewall and reachability are unknown');
    expect(report.limitations.join(' ')).toContain('does not establish that traffic can reach the service');
    expect(report.limitations.join(' ')).toContain('firewall rules');
  });

  it('renders potential exposure warnings and writes versioned JSON from the command', async () => {
    const report = createExposureReport({ listeners: parsedListeners, docker: dockerInventory });
    expect(formatExposureReport(report)).toContain('Wildcard bind may accept traffic');
    const program = new Command();
    registerExposureCommand(program, { createReport: () => report });
    const output: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation(((chunk: string | Uint8Array) => {
      output.push(String(chunk));
      return true;
    }) as typeof process.stdout.write);
    await program.parseAsync(['node', 'portcn', 'exposure', '--json']);
    expect(JSON.parse(output.join(''))).toEqual(report);
  });
});
