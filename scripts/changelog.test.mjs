import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { update, validate, validateRelease, reconcileRelease } = createRequire(import.meta.url)(
  './changelog-policy.cjs',
);
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

test('release validation accepts pending notes and requires a version section', () => {
  assert.equal(
    validateRelease('# Changelog\n\n## Unreleased\n\n- pending\n\n## 0.1.0\n\n- released\n', '0.1.0').allowed,
    true,
  );
  assert.equal(
    validateRelease('# Changelog\n\n## Unreleased\n\n## [0.1.0](https://example.test)\n\n- released\n', '0.1.0')
      .allowed,
    true,
  );
  assert.equal(validateRelease('# Changelog\n\n## Unreleased\n', '0.1.0').allowed, false);
});

test('reconciliation preserves versioned notes and refuses unrepresented pending notes', () => {
  const source =
    '# Changelog\n\n## Unreleased\n\n### Features\n\n- add example <!-- task:feat/example -->\n\n## [0.1.0](https://example.test)\n\n### Features\n\n- add example\n';
  const result = reconcileRelease(source, '0.1.0');
  assert.equal((result.match(/add example/g) ?? []).length, 1);
  assert.equal(reconcileRelease(result, '0.1.0'), result);
  assert.throws(() => reconcileRelease(source.replace('- add example\n', '- other\n'), '0.1.0'), /do not contain/);
  assert.throws(() => reconcileRelease(source, '0.2.0'), /missing/);
});

test('reconciliation does not accept a pending entry as a substring of another entry', () => {
  const source = '# Changelog\n\n## Unreleased\n\n- fix issue\n\n## 0.1.0\n\n- fix issues\n';
  assert.throws(() => reconcileRelease(source, '0.1.0'), /do not contain/);
});

test('reconciliation refuses to discard prose or unsupported list entries', () => {
  const source = '# Changelog\n\n## Unreleased\n\nPending context\n\n## 0.1.0\n\n- item\n';
  assert.throws(() => reconcileRelease(source, '0.1.0'), /cannot be safely reconciled/);
  assert.throws(
    () => reconcileRelease(source.replace('Pending context', '* item'), '0.1.0'),
    /cannot be safely reconciled/,
  );
});
