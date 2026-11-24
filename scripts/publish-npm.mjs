import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function publishNpm({ tag, version, run = execFileSync, root = process.cwd() }) {
  const expected = tag?.replace(/^v/, '');
  if (!/^\d+\.\d+\.\d+$/.test(expected ?? '') || version !== expected)
    throw new Error('npm version must match the exact verified release tag.');
  const temp = mkdtempSync(join(tmpdir(), 'portcn-npm-release-'));
  try {
    run('pnpm', ['--filter', '@portcn/core', 'build'], { cwd: root, stdio: 'inherit' });
    run('pnpm', ['--filter', 'portcn', 'build'], { cwd: root, stdio: 'inherit' });
    run('pnpm', ['--filter', 'portcn', 'pack', '--pack-destination', temp], { cwd: root, stdio: 'inherit' });
    const archive = join(temp, `portcn-${expected}.tgz`);
    if (!existsSync(archive)) throw new Error(`Packed npm archive was not created: ${archive}`);
    run('node', ['scripts/check-cli-package.mjs'], { cwd: root, stdio: 'inherit' });
    let existing;
    try {
      existing = run('npm', ['view', `portcn@${expected}`, 'version', '--json'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      })
        .trim()
        .replaceAll('"', '');
    } catch (error) {
      if (!String(error.stderr ?? '').includes('E404'))
        throw new Error('Unable to determine npm publication state; refusing to publish.');
    }
    if (existing) {
      if (existing !== expected) throw new Error(`Registry contains conflicting portcn@${existing}.`);
      return `portcn@${expected} already exists; skipped duplicate publication.`;
    }
    run('npm', ['publish', archive, '--access', 'public', '--provenance'], { cwd: root, stdio: 'inherit' });
    return `Published portcn@${expected}.`;
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const tag = process.argv[2];
    const cli = JSON.parse(readFileSync('apps/cli/package.json', 'utf8'));
    console.log(publishNpm({ tag, version: cli.version }));
  } catch (error) {
    console.error(`npm publication failed: ${error.message}`);
    process.exitCode = 1;
  }
}
