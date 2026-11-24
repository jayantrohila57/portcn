import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import packageJson from '../package.json' with { type: 'json' };
import { registerCommands } from './commands/index.js';
import { discoverListeningPorts } from './commands/list.js';
import { runTabbedList } from './commands/tabs.js';

export function createProgram(): Command {
  const program = new Command()
    .name('portcn')
    .description("Know what's running.")
    .version(packageJson.version, '-V, --version', 'output the version number')
    .addHelpText('before', `p: portcn — Know what's running.\n\n`);

  registerCommands(program);

  return program;
}

const program = createProgram();

if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]))) {
  if (process.argv.length === 2) {
    if (process.stdin.isTTY && process.stdout.isTTY) {
      try {
        await runTabbedList(discoverListeningPorts());
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stderr.write(`portcn: ${message}\n`);
        process.exitCode = 1;
      }
    } else {
      program.outputHelp();
    }
  } else {
    await program.parseAsync(process.argv);
  }
}
