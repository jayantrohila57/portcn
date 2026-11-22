import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync(new URL('./check-commit-messages.mjs', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('commit validation documents exact immutable legacy exceptions', () => {
  assert.match(source, /48df94e8d0f4493bc8faf161ae405f97fb146b34/);
  assert.match(source, /bbe6d540bdd62df245cd48e1b2402b8fc45cb508/);
  assert.match(source, /pending = commits\.filter/);
  assert.match(workflow, /node scripts\/check-commit-messages\.mjs/);
});
