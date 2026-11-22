import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { update } = require('./changelog-policy.cjs');
try {
  const title = process.argv.slice(2).join(' ');
  const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
  const path = 'CHANGELOG.md';
  const before = readFileSync(path, 'utf8');
  const after = update(before, title, branch);
  if (before !== after) writeFileSync(path, after);
  console.log(
    before === after ? 'Changelog entry already present.' : 'Updated Unreleased; review and commit CHANGELOG.md.',
  );
} catch (error) {
  console.error(`Changelog update stopped: ${error.message}`);
  process.exitCode = 1;
}
