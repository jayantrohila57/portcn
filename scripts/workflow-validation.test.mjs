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

test('release workflow dispatches the exact successful tag and has no stray shell terminator', () => {
  const source = readFileSync(new URL('release-please.yml', root), 'utf8');
  assert.match(source, /actions: write/);
  assert.match(source, /gh workflow run github-packages\.yml --ref main -f tag="\$RELEASE_TAG"/);
  assert.doesNotMatch(source, /run: gh workflow run[\s\S]*\n\s+fi\s*$/);
});
