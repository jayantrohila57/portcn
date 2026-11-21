import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command } from 'commander';
import packageJson from '../package.json' with { type: 'json' };

export function createProgram(): Command {
  return new Command()
    .name('portcn')
    .description("Know what's running.")
    .usage('[options]')
    .version(packageJson.version, '-V, --version', 'output the version number')
    .addHelpText('before', `p: portcn — Know what's running.\n\n`);
}

const program = createProgram();

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  program.parse();
}
