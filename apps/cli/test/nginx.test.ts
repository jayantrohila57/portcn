import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import type { ListeningPort } from '../src/commands/list.js';
import { discoverNginxInventory, type NginxDependencies, registerNginxCommand } from '../src/commands/nginx.js';

const files: Record<string, string> = {
  '/etc/nginx/nginx.conf':
    'http { include sites-enabled/*.conf; server { listen 80; server_name example.test www.example.test; } }',
  '/etc/nginx/sites-enabled/api.conf': 'server { listen [::]:8443 ssl; server_name api.example.test; }',
};
const listeners: ListeningPort[] = [
  { protocol: 'tcp', state: 'LISTEN', address: '0.0.0.0', port: 80, pid: 2, processName: 'nginx' },
];
function setup(overrides: Partial<NginxDependencies> = {}): NginxDependencies {
  return {
    platform: 'linux',
    configPath: '/etc/nginx/nginx.conf',
    readFile: (path) => {
      const data = files[path];
      if (!data) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      return data;
    },
    readDirectory: (path) => (path === '/etc/nginx/sites-enabled' ? ['api.conf'] : []),
    realpath: (path) => path,
    stat: () => ({ isFile: () => true }),
    processIds: () => [123],
    executable: () => '/usr/sbin/nginx',
    listeners: () => listeners,
    ...overrides,
  };
}

describe('Nginx configuration discovery', () => {
  it('reads server blocks and included files, keeping config separate from socket observations', () => {
    const result = discoverNginxInventory(setup());
    expect(result).toMatchObject({
      availability: 'available',
      processes: [{ pid: 123 }],
      servers: [
        { serverNames: ['api.example.test'], listeners: [{ address: '::', port: 8443, state: 'not-observed' }] },
        {
          serverNames: ['example.test', 'www.example.test'],
          listeners: [{ address: '0.0.0.0', port: 80, state: 'observed' }],
        },
      ],
    });
  });

  it('reports unreadable or missing files as partial when some configuration remains', () => {
    const result = discoverNginxInventory(
      setup({
        readFile: (path) =>
          path.includes('sites-enabled')
            ? 'server { listen 8080; }'
            : 'http { include sites-enabled/*.conf; include missing/*.conf; }',
      }),
    );
    expect(result.availability).toBe('partial');
    expect(result.servers).toHaveLength(1);
  });

  it('does not traverse include cycles or beyond the file bound', () => {
    const result = discoverNginxInventory(setup({ readFile: () => 'include nginx.conf; server { listen 8080; }' }));
    expect(result.servers).toHaveLength(1);
  });

  it('returns no Linux config evidence on other platforms', () => {
    expect(discoverNginxInventory({ platform: 'darwin' })).toMatchObject({ availability: 'unavailable', servers: [] });
  });

  it('registers a named nginx command with config and JSON options', () => {
    const program = new Command();
    registerNginxCommand(program, setup());
    expect(program.commands.map((command) => command.name())).toContain('nginx');
  });
});
