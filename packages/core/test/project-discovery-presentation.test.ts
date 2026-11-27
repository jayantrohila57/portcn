import { describe, expect, it } from 'vitest';
import {
  groupRuntimesByApplication,
  isPortcnInspectionProcess,
  isUnrelatedHostListener,
  listenerAttention,
  runtimeDisplayName,
} from '../src/project-discovery-presentation.js';

describe('project discovery presentation', () => {
  it('treats SSDP and mDNS UDP as unrelated host listeners', () => {
    expect(isUnrelatedHostListener({ protocol: 'udp', address: '239.255.255.250', port: 3702, state: 'UNCONN' })).toBe(
      true,
    );
    expect(isUnrelatedHostListener({ protocol: 'udp', address: '224.0.0.251', port: 5353, state: 'UNCONN' })).toBe(
      true,
    );
    expect(
      listenerAttention({ protocol: 'udp', address: '172.18.0.1', port: 3702, state: 'UNCONN' }, 'unidentified-owner'),
    ).toBe('unrelated-host');
  });

  it('treats common system listeners without project owners as unrelated host noise', () => {
    expect(
      listenerAttention({ protocol: 'tcp', address: '0.0.0.0', port: 22, state: 'LISTEN' }, 'unidentified-owner'),
    ).toBe('unrelated-host');
    expect(listenerAttention({ protocol: 'tcp', address: '*', port: 80, state: 'LISTEN' }, 'unidentified-owner')).toBe(
      'unrelated-host',
    );
  });

  it('flags loopback TCP listeners without owners as ambiguous project listeners', () => {
    expect(
      listenerAttention({ protocol: 'tcp', address: '127.0.0.1', port: 36449, state: 'LISTEN' }, 'unidentified-owner'),
    ).toBe('ambiguous-project');
  });

  it('detects Portcn inspection command lines', () => {
    expect(
      isPortcnInspectionProcess('/usr/bin/node', 'node apps/cli/dist/index.js discover project', {
        pid: 42,
        selfPid: 1,
      }),
    ).toBe(true);
    expect(isPortcnInspectionProcess('/usr/local/bin/portcn', 'portcn list', { pid: 7 })).toBe(true);
    expect(isPortcnInspectionProcess('/usr/bin/node', 'node server.js', { pid: 7 })).toBe(false);
  });

  it('groups listeners and workers under application scope labels', () => {
    const groups = groupRuntimesByApplication([
      {
        role: 'application-listener',
        application: 'apps/web',
        pid: 10,
        processName: 'node',
        executable: '/usr/bin/node',
        ports: [{ protocol: 'tcp', address: '127.0.0.1', port: 3000, state: 'LISTEN' }],
      },
      {
        role: 'application-process',
        application: 'apps/web',
        pid: 11,
        processName: 'node',
        executable: '/usr/bin/node',
        ports: [],
      },
      {
        role: 'supporting-process',
        application: null,
        pid: 12,
        processName: 'bash',
        executable: '/usr/bin/bash',
        ports: [],
      },
    ]);
    expect(groups.find((group) => group.scope === 'apps/web')?.listeners).toHaveLength(1);
    expect(groups.find((group) => group.scope === 'apps/web')?.workers).toHaveLength(1);
    expect(
      runtimeDisplayName({
        role: 'application-process',
        application: 'apps/api',
        pid: 1,
        processName: 'node',
        executable: null,
        ports: [],
      }),
    ).toBe('apps/api');
  });
});
