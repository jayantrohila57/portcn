import { describe, expect, it } from 'vitest';
import type { ListeningPort } from '../src/commands/list.js';
import { discoverSystemdInventory, type SystemdDependencies, type SystemdScope } from '../src/commands/systemd.js';

const LIST = [
  'web.service loaded active running Web server',
  'web.socket loaded active listening Web socket',
  'old.service loaded inactive dead Old service',
  'broken.service loaded failed failed Broken service',
].join('\n');
const SHOW: Record<string, string> = {
  'web.service': 'MainPID=700\nListen=',
  'web.socket': 'MainPID=0\nListen=Stream 127.0.0.1:8080\nListen=Stream [::]:8443',
  'old.service': 'MainPID=0\nListen=',
  'broken.service': 'MainPID=0\nListen=',
};
const listeners: ListeningPort[] = [
  { protocol: 'tcp', state: 'LISTEN', address: '127.0.0.1', port: 8080, pid: 700, processName: 'web' },
];
function fixture(overrides: Partial<SystemdDependencies> = {}): SystemdDependencies {
  return {
    platform: 'linux',
    run: (_scope: SystemdScope, args: string[]) => (args[0] === 'list-units' ? LIST : (SHOW[args.at(-1) ?? ''] ?? '')),
    listeners: () => listeners,
    now: () => new Date('2026-11-25T12:00:00.000Z'),
    ...overrides,
  };
}

describe('systemd unit discovery', () => {
  it('reports user/system units and correlates only MainPID to its observed listeners', () => {
    const result = discoverSystemdInventory(fixture());
    expect(result).toMatchObject({
      availability: 'available',
      managers: { user: { status: 'available' }, system: { status: 'available' } },
      observationTime: '2026-11-25T12:00:00.000Z',
    });
    expect(result.units).toHaveLength(8);
    expect(result.units.find(({ name, scope }) => name === 'web.service' && scope === 'user')).toMatchObject({
      mainPid: 700,
      processListenerPorts: [8080],
    });
    expect(result.units.find(({ name, scope }) => name === 'web.socket' && scope === 'system')).toMatchObject({
      active: 'active',
      sub: 'listening',
      mainPid: null,
      configuredSockets: [
        { port: 8080, observed: true },
        { port: 8443, observed: false },
      ],
    });
    expect(result.units.find(({ name }) => name === 'old.service')?.active).toBe('inactive');
    expect(result.units.find(({ name }) => name === 'broken.service')?.active).toBe('failed');
  });

  it('retains user-manager unavailability when system scope remains visible', () => {
    const result = discoverSystemdInventory(
      fixture({
        run: (scope, args) => {
          if (scope === 'user') throw new Error('Failed to connect to bus');
          return args[0] === 'list-units' ? LIST : (SHOW[args.at(-1) ?? ''] ?? '');
        },
      }),
    );
    expect(result).toMatchObject({
      availability: 'partial',
      managers: { user: { status: 'user-manager-unavailable' }, system: { status: 'available' } },
    });
  });

  it('distinguishes missing systemctl and permission denial', () => {
    expect(
      discoverSystemdInventory(
        fixture({
          run: () => {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
          },
        }),
      ).availability,
    ).toBe('not-installed');
    expect(
      discoverSystemdInventory(
        fixture({
          run: () => {
            throw Object.assign(new Error('denied'), { code: 'EACCES' });
          },
        }),
      ).availability,
    ).toBe('permission-denied');
  });

  it('returns unavailable outside Linux and partial when listener visibility fails', () => {
    expect(discoverSystemdInventory({ platform: 'darwin' })).toMatchObject({ availability: 'unavailable', units: [] });
    expect(
      discoverSystemdInventory(
        fixture({
          listeners: () => {
            throw new Error('ss unavailable');
          },
        }),
      ).availability,
    ).toBe('partial');
  });
});
