import { readFile } from 'node:fs/promises';
import type { Command } from 'commander';
import { configPath, readConfig, type SavedService, serviceId, writeConfig } from './config-store.js';
import { discoverListeningPorts } from './list.js';

function requiredText(value: string, label: string, maximum: number): string {
  const clean = value.trim();
  if (!clean || clean.length > maximum) throw new Error(`${label} must contain 1 to ${maximum} characters.`);
  return clean;
}

function service(protocol: string, address: string, portText: string): SavedService {
  if (protocol !== 'tcp' && protocol !== 'udp') throw new Error('Protocol must be tcp or udp.');
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('Port must be an integer between 1 and 65535.');
  if (!address || /\s/.test(address)) throw new Error('Address must be a non-empty bind address.');
  return {
    id: serviceId(protocol, address, port),
    protocol,
    address,
    port,
    favorite: false,
    alias: null,
    note: null,
    groups: [],
  };
}

function report(error: unknown): void {
  process.stderr.write(`portcn config: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

async function current(file: string) {
  const loaded = await readConfig(file);
  if (loaded.recovered) process.stderr.write('portcn config: primary config is invalid; using validated backup.\n');
  return loaded.config;
}

export function registerConfigCommand(program: Command): void {
  const config = program.command('config').description('Manage locally saved service details.');
  config
    .command('list')
    .description('List saved services and current online status.')
    .option('--json', 'Emit JSON')
    .action(async (options: { json?: boolean }) => {
      try {
        const saved = await current(configPath());
        let live: ReturnType<typeof discoverListeningPorts> | null = null;
        try {
          live = discoverListeningPorts();
        } catch {
          /* saved state remains useful when discovery is unavailable */
        }
        const services = saved.services.map((entry) => ({
          ...entry,
          status:
            live === null
              ? 'unknown'
              : live.some(
                    (item) =>
                      item.protocol === entry.protocol && item.address === entry.address && item.port === entry.port,
                  )
                ? 'online'
                : 'offline',
        }));
        if (options.json)
          process.stdout.write(`${JSON.stringify({ schemaVersion: 1, services, groups: saved.groups }, null, 2)}\n`);
        else if (!services.length) process.stdout.write('No saved services. Add one with "portcn config add".\n');
        else
          for (const item of services)
            process.stdout.write(
              `${item.favorite ? '★' : ' '} ${item.status.padEnd(7)} ${item.id}${item.alias ? `  ${item.alias}` : ''}${item.groups.length ? `  [${item.groups.join(', ')}]` : ''}\n`,
            );
      } catch (error) {
        report(error);
      }
    });

  config
    .command('add <protocol> <address> <port>')
    .description('Save a service identity.')
    .option('--favorite', 'Mark as favorite')
    .option('--alias <text>', 'Set an alias')
    .option('--note <text>', 'Set a note')
    .option('--group <name...>', 'Add to groups')
    .action(
      async (
        protocol: string,
        address: string,
        portText: string,
        options: { favorite?: boolean; alias?: string; note?: string; group?: string[] },
      ) => {
        try {
          const entry = service(protocol, address, portText);
          entry.favorite = options.favorite ?? false;
          entry.alias = options.alias ? requiredText(options.alias, 'Alias', 120) : null;
          entry.note = options.note ? requiredText(options.note, 'Note', 1000) : null;
          entry.groups = (options.group ?? []).map((name) => requiredText(name, 'Group', 80));
          const config = await current(configPath());
          const existing = config.services.find((item) => item.id === entry.id);
          if (existing) throw new Error(`Service already exists: ${entry.id}`);
          config.services.push(entry);
          config.groups = [...new Set([...config.groups, ...entry.groups])];
          await writeConfig(config);
          process.stdout.write(`Saved ${entry.id}\n`);
        } catch (error) {
          report(error);
        }
      },
    );

  config
    .command('edit <service-id>')
    .description('Edit saved service details.')
    .option('--favorite <value>', 'Set favorite to true or false')
    .option('--alias <text>', 'Set alias')
    .option('--clear-alias', 'Clear alias')
    .option('--note <text>', 'Set note')
    .option('--clear-note', 'Clear note')
    .option('--add-group <name...>', 'Add group memberships')
    .option('--remove-group <name...>', 'Remove group memberships')
    .action(
      async (
        id: string,
        options: {
          favorite?: string;
          alias?: string;
          clearAlias?: boolean;
          note?: string;
          clearNote?: boolean;
          addGroup?: string[];
          removeGroup?: string[];
        },
      ) => {
        try {
          const config = await current(configPath());
          const item = config.services.find((entry) => entry.id === id);
          if (!item) throw new Error(`Saved service not found: ${id}`);
          if (options.favorite !== undefined) {
            if (options.favorite !== 'true' && options.favorite !== 'false')
              throw new Error('--favorite must be true or false.');
            item.favorite = options.favorite === 'true';
          }
          if (options.alias !== undefined) item.alias = requiredText(options.alias, 'Alias', 120);
          if (options.clearAlias) item.alias = null;
          if (options.note !== undefined) item.note = requiredText(options.note, 'Note', 1000);
          if (options.clearNote) item.note = null;
          for (const name of options.addGroup ?? []) {
            const clean = requiredText(name, 'Group', 80);
            config.groups.push(clean);
            item.groups.push(clean);
          }
          item.groups = item.groups.filter((name) => !(options.removeGroup ?? []).includes(name));
          config.groups = [...new Set(config.groups)];
          await writeConfig(config);
          process.stdout.write(`Updated ${id}\n`);
        } catch (error) {
          report(error);
        }
      },
    );

  config
    .command('remove <service-id>')
    .description('Remove a saved service.')
    .action(async (id: string) => {
      try {
        const state = await current(configPath());
        const next = state.services.filter((item) => item.id !== id);
        if (next.length === state.services.length) throw new Error(`Saved service not found: ${id}`);
        state.services = next;
        await writeConfig(state);
        process.stdout.write(`Removed ${id}\n`);
      } catch (error) {
        report(error);
      }
    });

  const group = config.command('group').description('Manage saved service groups.');
  group
    .command('add <name>')
    .description('Create a group.')
    .action(async (name: string) => {
      try {
        const state = await current(configPath());
        const clean = requiredText(name, 'Group', 80);
        if (state.groups.includes(clean)) throw new Error(`Group already exists: ${clean}`);
        state.groups.push(clean);
        await writeConfig(state);
        process.stdout.write(`Created group ${clean}\n`);
      } catch (error) {
        report(error);
      }
    });
  group
    .command('remove <name>')
    .description('Remove a group and its memberships.')
    .action(async (name: string) => {
      try {
        const state = await current(configPath());
        if (!state.groups.includes(name)) throw new Error(`Group not found: ${name}`);
        state.groups = state.groups.filter((item) => item !== name);
        for (const item of state.services) item.groups = item.groups.filter((member) => member !== name);
        await writeConfig(state);
        process.stdout.write(`Removed group ${name}\n`);
      } catch (error) {
        report(error);
      }
    });

  config
    .command('recover')
    .description('Restore the validated backup config.')
    .action(async () => {
      try {
        const file = configPath();
        const backup = JSON.parse(await readFile(`${file}.bak`, 'utf8'));
        await writeConfig(backup, file, { preserveBackup: true });
        process.stdout.write('Restored config backup.\n');
      } catch (error) {
        report(error);
      }
    });
}
