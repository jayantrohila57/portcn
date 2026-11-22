import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { update, validate } = createRequire(import.meta.url)('./changelog-policy.cjs');
const base = '# Changelog\n\n## Unreleased\n\n### Features\n\n- Previous feature\n\n## 0.0.1\n\nOld release\n';
test('generates one deterministic entry and preserves versioned history', () => {
  const next = update(base, 'feat(cli): add example', 'feat/example');
  assert.match(next, /add example <!-- task:feat\/example -->/);
  assert.match(next, /## 0\.0\.1\n\nOld release/);
  assert.equal(update(next, 'feat(cli): add example', 'feat/example'), next);
  assert.equal(validate(base, next, 'feat(cli): add example', 'feat/example').allowed, true);
  assert.equal(validate(base, base, 'feat(cli): add example', 'feat/example').allowed, false);
  assert.equal(validate(base, `${next}\nextra`, 'feat(cli): add example', 'feat/example').allowed, false);
});
test('rejects duplicate or changed task entries and supports breaking changes', () => {
  const next = update(base, 'fix!: change behavior', 'fix/example');
  assert.match(next, /### Breaking Changes/);
  assert.throws(() => update(next, 'fix: different', 'fix/example'), /differs/);
  assert.throws(
    () => update(`${next}\n<!-- task:fix/example -->`, 'fix!: change behavior', 'fix/example'),
    /Duplicate/,
  );
});
