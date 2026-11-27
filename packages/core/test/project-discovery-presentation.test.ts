import { describe, expect, it } from 'vitest';
import {
  groupRuntimesByApplication,
  isPortcnInspectionProcess,
  isUnrelatedHostListener,
  listenerAttention,
} from '../src/project-discovery-presentation.js';

describe('project discovery presentation', () => {
  it('keeps ownerless multicast and bridge sockets unresolved', () => {
    expect(isUnrelatedHostListener({ protocol: 'udp', address: '239.255.255.250', port: 3702, state: 'UNCONN' })).toBe(
      false,
    );
    expect(isUnrelatedHostListener({ protocol: 'udp', address: '224.0.0.251', port: 5353, state: 'UNCONN' })).toBe(
      false,
    );
    expect(
      listenerAttention({ protocol: 'udp', address: '172.18.0.1', port: 3702, state: 'UNCONN' }, 'unidentified-owner'),
    ).toBe('unknown-ownership');
  });

  it('keeps unknown owners on common service ports unresolved', () => {
    expect(
      listenerAttention({ protocol: 'tcp', address: '0.0.0.0', port: 22, state: 'LISTEN' }, 'unidentified-owner'),
    ).toBe('unknown-ownership');
    expect(listenerAttention({ protocol: 'tcp', address: '*', port: 80, state: 'LISTEN' }, 'unidentified-owner')).toBe(
      'unknown-ownership',
    );
  });

  it('does not treat ownerless loopback listeners as project sockets', () => {
    expect(
      listenerAttention({ protocol: 'tcp', address: '127.0.0.1', port: 36449, state: 'LISTEN' }, 'unidentified-owner'),
    ).toBe('unknown-ownership');
  });

  it('excludes the inspecting PID and preserves lookalike command lines', () => {
    expect(
      isPortcnInspectionProcess('/usr/bin/node', 'node apps/cli/dist/index.js discover project', {
        pid: 42,
        selfPid: 42,
      }),
    ).toBe(true);
    expect(isPortcnInspectionProcess('/usr/local/bin/portcn', 'portcn list', { pid: 7 })).toBe(false);
    expect(isPortcnInspectionProcess('/usr/bin/node', 'node server.js', { pid: 7 })).toBe(false);
  });

  it('groups listeners and workers under application scope labels', () => {
    const groups = groupRuntimesByApplication([
      {
        role: 'application-listener',
        processRole: 'application-server',
        runtimeState: 'listening',
        application: 'apps/web',
        pid: 10,
        processName: 'node',
        executable: '/usr/bin/node',
        ports: [{ protocol: 'tcp', address: '127.0.0.1', port: 3000, state: 'LISTEN' }],
      },
      {
        role: 'application-process',
        processRole: 'application-worker',
        runtimeState: 'running',
        application: 'apps/web',
        pid: 11,
        processName: 'node',
        executable: '/usr/bin/node',
        ports: [],
      },
    ]);
    expect(groups.find((group) => group.scope === 'apps/web')?.listeners).toHaveLength(1);
    expect(groups.find((group) => group.scope === 'apps/web')?.workers).toHaveLength(1);
  });
});
