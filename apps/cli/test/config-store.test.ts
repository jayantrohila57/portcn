import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readConfig, type ServiceConfig, serviceId, writeConfig } from '../src/commands/config-store.js';

const temporary: string[] = [];
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'portcn-config-'));
  temporary.push(dir);
  return join(dir, 'config.json');
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('saved service config', () => {
  it('persists favorites and group membership across reloads with private file permissions', async () => {
    const file = await fixture();
    const id = serviceId('tcp', '127.0.0.1', 3000);
    const config: ServiceConfig = {
      version: 1,
      groups: ['web', 'local'],
      services: [
        {
          id,
          protocol: 'tcp',
          address: '127.0.0.1',
          port: 3000,
          favorite: true,
          alias: 'site',
          note: null,
          groups: ['web', 'local'],
        },
      ],
    };
    await writeConfig(config, file);
    expect((await readConfig(file)).config).toEqual(config);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('keeps same port identities distinct by protocol and bind address', async () => {
    const file = await fixture();
    const services = [
      { id: 'tcp://127.0.0.1:80', protocol: 'tcp' as const, address: '127.0.0.1', port: 80 },
      { id: 'udp://127.0.0.1:80', protocol: 'udp' as const, address: '127.0.0.1', port: 80 },
      { id: 'tcp://0.0.0.0:80', protocol: 'tcp' as const, address: '0.0.0.0', port: 80 },
    ];
    const config: ServiceConfig = {
      version: 1,
      groups: [],
      services: services.map(({ id, protocol, address, port }) => {
        return {
          id,
          protocol,
          address,
          port,
          favorite: false,
          alias: null,
          note: null,
          groups: [],
        };
      }),
    };
    await writeConfig(config, file);
    expect((await readConfig(file)).config.services).toHaveLength(3);
  });

  it('migrates version zero favorites to version one', async () => {
    const file = await fixture();
    await writeFile(file, JSON.stringify({ version: 0, favorites: [{ protocol: 'udp', address: '::1', port: 53 }] }));
    expect((await readConfig(file)).config).toEqual({
      version: 1,
      groups: [],
      services: [
        {
          id: 'udp://::1:53',
          protocol: 'udp',
          address: '::1',
          port: 53,
          favorite: true,
          alias: null,
          note: null,
          groups: [],
        },
      ],
    });
  });

  it('recovers a corrupt primary from its validated backup and rejects corrupt-only data', async () => {
    const file = await fixture();
    const config: ServiceConfig = { version: 1, services: [], groups: [] };
    await writeConfig(config, file);
    await writeConfig({ ...config, groups: ['saved'] }, file);
    await writeFile(file, '{bad');
    expect(await readConfig(file)).toEqual({ config: { ...config, groups: [] }, recovered: true });
    await writeConfig({ ...config, groups: ['updated'] }, file);
    expect(JSON.parse(await readFile(`${file}.bak`, 'utf8'))).toEqual({ ...config, groups: [] });
    const corrupt = await fixture();
    await writeFile(corrupt, '{bad');
    await expect(readConfig(corrupt)).rejects.toThrow('Config and backup are invalid');
  });
});
