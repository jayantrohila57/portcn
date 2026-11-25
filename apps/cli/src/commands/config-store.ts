import { randomUUID } from 'node:crypto';
import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { validateServiceUrl } from './endpoint-url.js';

export interface SavedService {
  id: string;
  protocol: 'tcp' | 'udp';
  address: string;
  port: number;
  favorite: boolean;
  alias: string | null;
  note: string | null;
  groups: string[];
  url: string | null;
}
export interface ServiceConfig {
  version: 2;
  services: SavedService[];
  groups: string[];
}

export function serviceId(protocol: string, address: string, port: number): string {
  return `${protocol}://${address}:${port}`;
}

export function configPath(env: NodeJS.ProcessEnv = process.env): string {
  return join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'portcn', 'config.json');
}

function validate(input: unknown): ServiceConfig {
  if (!input || typeof input !== 'object') throw new Error('Config must be a JSON object.');
  const data = input as Record<string, unknown>;
  if (data.version !== 0 && data.version !== 1 && data.version !== 2) throw new Error('Unsupported config version.');
  if (data.version === 0) {
    if (!Array.isArray(data.favorites)) throw new Error('Version 0 config requires a favorites array.');
    const services = data.favorites.map((item) => {
      const entry = item as Record<string, unknown>;
      if (
        !entry ||
        (entry.protocol !== 'tcp' && entry.protocol !== 'udp') ||
        typeof entry.address !== 'string' ||
        !Number.isInteger(entry.port) ||
        Number(entry.port) < 1 ||
        Number(entry.port) > 65535
      )
        throw new Error('Invalid version 0 favorite.');
      const id = serviceId(entry.protocol, entry.address, Number(entry.port));
      return {
        id,
        protocol: entry.protocol,
        address: entry.address,
        port: Number(entry.port),
        favorite: true,
        alias: null,
        note: null,
        groups: [],
        url: null,
      } as SavedService;
    });
    return { version: 2, services, groups: [] };
  }
  if (
    !Array.isArray(data.services) ||
    !Array.isArray(data.groups) ||
    data.services.length > 5000 ||
    data.groups.length > 500
  )
    throw new Error('Config services or groups are invalid.');
  const groups = data.groups;
  if (
    groups.some((group) => typeof group !== 'string' || group.length < 1 || group.length > 80) ||
    new Set(groups).size !== groups.length
  )
    throw new Error('Config group names are invalid.');
  const seen = new Set<string>();
  const services = data.services.map((raw) => {
    if (!raw || typeof raw !== 'object') throw new Error('Config service entry is invalid.');
    const item = raw as Record<string, unknown>;
    const { protocol, address, port, favorite, alias, note, groups: members } = item;
    const url = data.version === 2 ? item.url : null;
    if (
      (protocol !== 'tcp' && protocol !== 'udp') ||
      typeof address !== 'string' ||
      !address ||
      !Number.isInteger(port) ||
      Number(port) < 1 ||
      Number(port) > 65535 ||
      typeof favorite !== 'boolean' ||
      (alias !== null && (typeof alias !== 'string' || alias.length > 120)) ||
      (note !== null && (typeof note !== 'string' || note.length > 1000)) ||
      (url !== null && typeof url !== 'string') ||
      !Array.isArray(members) ||
      members.some((name) => typeof name !== 'string' || !groups.includes(name))
    )
      throw new Error('Config service entry is invalid.');
    const id = serviceId(protocol, address, Number(port));
    if (item.id !== id || seen.has(id)) throw new Error('Config service identity is invalid or duplicated.');
    seen.add(id);
    const normalizedUrl =
      typeof url === 'string' ? validateServiceUrl(url, { protocol, address, port: Number(port) }) : null;
    return {
      id,
      protocol,
      address,
      port: Number(port),
      favorite,
      alias,
      note,
      groups: [...new Set(members as string[])],
      url: normalizedUrl,
    } as SavedService;
  });
  return { version: 2, services, groups: [...groups] as string[] };
}

export async function readConfig(file = configPath()): Promise<{ config: ServiceConfig; recovered: boolean }> {
  async function parse(path: string): Promise<ServiceConfig> {
    return validate(JSON.parse(await readFile(path, 'utf8')));
  }
  try {
    return { config: await parse(file), recovered: false };
  } catch (primaryError) {
    try {
      return { config: await parse(`${file}.bak`), recovered: true };
    } catch {
      if ((primaryError as NodeJS.ErrnoException).code === 'ENOENT')
        return { config: { version: 2, services: [], groups: [] }, recovered: false };
      throw new Error('Config and backup are invalid. Run "portcn config recover" after restoring a valid backup.');
    }
  }
}

export async function writeConfig(
  config: ServiceConfig,
  file = configPath(),
  options: { preserveBackup?: boolean } = {},
): Promise<void> {
  const valid = validate(config);
  const directory = dirname(file);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  if (!options.preserveBackup) {
    let existing: string | null = null;
    try {
      existing = await readFile(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    if (existing !== null) {
      try {
        validate(JSON.parse(existing));
        await rename(file, `${file}.bak`);
      } catch (error) {
        if (error instanceof SyntaxError || (error instanceof Error && /config/i.test(error.message))) {
          // Keep the last validated backup when replacing a corrupt primary.
        } else throw error;
      }
    }
  }
  const temporary = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(valid, null, 2)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, file);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
