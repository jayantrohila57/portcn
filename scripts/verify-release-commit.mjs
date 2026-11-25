import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { validateRelease, releaseBlock } = require('./changelog-policy.cjs');

export function verifyRelease({ tag, manifest, cliVersion, rootVersion, source, taggedCommit, checkedOutCommit }) {
  const version = tag?.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) throw new Error('Release tag must use v-prefixed stable SemVer.');
  if (taggedCommit !== checkedOutCommit)
    throw new Error(`Tag ${tag} does not point to the checked out release commit.`);
  if (manifest !== version || cliVersion !== version || rootVersion !== version)
    throw new Error(`Release ${version} package, root, and manifest versions must match the tag.`);
  const result = validateRelease(source, version);
  if (!result.allowed) throw new Error(result.reason);
  const body = releaseBlock(source, version);
  return { version, tag, commit: taggedCommit, body };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const tag = process.argv[2];
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
    const root = JSON.parse(readFileSync('package.json', 'utf8'));
    const cli = JSON.parse(readFileSync('apps/cli/package.json', 'utf8'));
    const manifest = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'))['.'];
    const result = verifyRelease({
      tag,
      manifest,
      cliVersion: cli.version,
      rootVersion: root.version,
      source: readFileSync('CHANGELOG.md', 'utf8'),
      taggedCommit: git('rev-parse', '--verify', `${tag}^{commit}`),
      checkedOutCommit: git('rev-parse', '--verify', 'HEAD^{commit}'),
    });
    process.stdout.write(`${result.commit}\n`);
  } catch (error) {
    console.error(`Release verification failed: ${error.message}`);
    process.exitCode = 1;
  }
}
