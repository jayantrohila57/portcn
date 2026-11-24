import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { releaseBlock } = require('./changelog-policy.cjs');

export function releaseNotesBody(source, tag) {
  const version = tag?.replace(/^v/, '');
  try {
    return releaseBlock(source, version);
  } catch {
    throw new Error(`Canonical changelog has no published entry for ${tag}.`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(releaseNotesBody(readFileSync('CHANGELOG.md', 'utf8'), process.argv[2]));
  } catch (error) {
    console.error(`Release notes failed: ${error.message}`);
    process.exitCode = 1;
  }
}
