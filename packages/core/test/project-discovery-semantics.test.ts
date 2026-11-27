import { describe, expect, it } from 'vitest';
import { classifyProcessRole, classifyProjectProcess, listenerAttention } from '../src/project-discovery-semantics.js';

describe('project discovery semantics', () => {
  it('classifies observed host process names from portcn checkout', () => {
    expect(
      classifyProcessRole({
        comm: 'node_repl',
        executable: '/usr/bin/node',
        cmdline: 'node',
        applicationScope: null,
        checkoutMatch: 'matching',
        projectListenerBindings: 0,
      }).processRole,
    ).toBe('development-tooling');
    expect(
      classifyProcessRole({
        comm: 'biome',
        executable: '/home/x/personal/portcn/node_modules/@biomejs/biome/bin/biome',
        cmdline: 'biome check',
        applicationScope: null,
        checkoutMatch: 'matching',
        projectListenerBindings: 0,
      }).processRole,
    ).toBe('development-tooling');
    expect(
      classifyProcessRole({
        comm: 'cursor',
        executable: null,
        cmdline: null,
        applicationScope: null,
        checkoutMatch: 'matching',
        projectListenerBindings: 0,
      }).processRole,
    ).toBe('editor');
    expect(
      classifyProcessRole({
        comm: 'conmon',
        executable: null,
        cmdline: null,
        applicationScope: null,
        checkoutMatch: 'matching',
        projectListenerBindings: 0,
      }).processRole,
    ).toBe('container-infrastructure');
    expect(
      classifyProcessRole({
        comm: 'rootlessport',
        executable: '/usr/bin/rootlessport',
        cmdline: 'rootlessport',
        applicationScope: null,
        checkoutMatch: 'matching',
        projectListenerBindings: 1,
      }),
    ).toMatchObject({ processRole: 'network-forwarding' });
    expect(
      classifyProcessRole({
        comm: 'exe',
        executable: null,
        cmdline: null,
        applicationScope: null,
        checkoutMatch: 'matching',
        projectListenerBindings: 0,
      }).processRole,
    ).toBe('unknown');
    expect(
      classifyProcessRole({
        comm: 'nginx',
        executable: '/usr/sbin/nginx',
        cmdline: 'nginx',
        applicationScope: 'apps/api',
        checkoutMatch: 'matching',
        projectListenerBindings: 0,
      }).processRole,
    ).toBe('unknown');
  });

  it('treats Next.js under apps/docs as application server when listening', () => {
    const next = classifyProjectProcess({
      comm: 'node',
      executable: '/usr/bin/node',
      cmdline: 'node apps/docs/node_modules/.bin/next dev --port 3333',
      applicationScope: 'apps/docs',
      checkoutMatch: 'matching',
      projectListenerBindings: 1,
    });
    expect(next.processRole).toBe('application-server');
    expect(next.runtimeState).toBe('listening');
    expect(next.role).toBe('application-listener');
  });

  it('does not label node_repl as an application worker', () => {
    const repl = classifyProjectProcess({
      comm: 'node_repl',
      executable: '/usr/bin/node',
      cmdline: 'node',
      applicationScope: 'apps/web',
      checkoutMatch: 'matching',
      projectListenerBindings: 0,
    });
    expect(repl.processRole).toBe('development-tooling');
    expect(repl.role).toBe('supporting-process');
  });

  it('keeps ownerless loopback listeners as unknown ownership, not project ambiguous', () => {
    expect(
      listenerAttention({ protocol: 'tcp', address: '127.0.0.1', port: 3100, state: 'LISTEN' }, 'unidentified-owner'),
    ).toBe('unknown-ownership');
    expect(
      listenerAttention({ protocol: 'tcp', address: '127.0.0.1', port: 36449, state: 'LISTEN' }, 'project-owner'),
    ).toBe('project');
  });

  it('uses positive evidence before unrelated-host, not default for unknown UDP', () => {
    expect(
      listenerAttention({ protocol: 'udp', address: '10.0.0.5', port: 12345, state: 'UNCONN' }, 'unidentified-owner'),
    ).toBe('unknown-ownership');
    expect(
      listenerAttention(
        { protocol: 'udp', address: '239.255.255.250', port: 3702, state: 'UNCONN' },
        'unidentified-owner',
      ),
    ).toBe('unknown-ownership');
  });
});
