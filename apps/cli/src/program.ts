import { Command } from 'commander';
import packageJson from '../package.json' with { type: 'json' };

/** Create the configured CLI without parsing argv or producing output. */
export function createProgram(): Command {
  return new Command()
    .name('portcn')
    .description("Know what's running.")
    .usage('[options]')
    .version(packageJson.version, '-V, --version', 'output the version number')
    .addHelpText('before', `p: portcn — Know what's running.\n\n`);
}
