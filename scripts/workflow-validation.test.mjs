import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const workflows = ['release-please.yml', 'github-packages.yml', 'ci.yml'];
const root = new URL('../.github/workflows/', import.meta.url);

function shellBlocks(source) {
  return [...source.matchAll(/^\s+run: \|\n((?:\s{10,}.*\n?)*)/gm)].map(([, block]) => {
    const lines = block.split('\n').filter(Boolean);
    const indent = Math.min(...lines.map((line) => line.match(/^\s*/)[0].length));
    return lines.map((line) => line.slice(indent)).join('\n');
  });
}

test('workflow YAML has required structure and every embedded shell block parses', () => {
  const temp = mkdtempSync(join(tmpdir(), 'portcn-workflows-'));
  try {
    for (const name of workflows) {
      const source = readFileSync(new URL(name, root), 'utf8');
      assert.match(source, /^name: .+$/m, `${name} needs a name`);
      assert.match(source, /^on:/m, `${name} needs triggers`);
      assert.match(source, /^jobs:/m, `${name} needs jobs`);
      for (const [index, block] of shellBlocks(source).entries()) {
        const path = join(temp, `${name}-${index}.sh`);
        writeFileSync(path, `${block}\n`);
        execFileSync('bash', ['-n', path], { stdio: 'pipe' });
      }
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});

test('Release Please candidate preparation is separate from package publication', () => {
  const source = readFileSync(new URL('release-please.yml', root), 'utf8');
  assert.match(source, /actions: write/);
  assert.match(source, /googleapis\/release-please-action@v4/);
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /publish-npm\.mjs/);
  assert.match(source, /gh workflow run github-packages\.yml --ref main -f "tag=\$RELEASE_TAG"/);
});

test('staged Biome checks include Markdown and exclude unsupported MDX', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const stagedPatterns = Object.keys(packageJson['lint-staged']);
  assert(stagedPatterns.some((pattern) => pattern.split(',').includes('md')));
  assert(stagedPatterns.every((pattern) => !pattern.split(',').includes('mdx')));
  assert.match(packageJson.scripts['precommit:check'], /pnpm docs:check/);
  assert.match(packageJson.scripts['precommit:check'], /pnpm build/);
});
