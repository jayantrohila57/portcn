import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import packageJson from '../package.json' with { type: 'json' };
import { registerCommands } from './commands/index.js';

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
    program.outputHelp();
  } else {
    program.parse(process.argv);
  }
}
