import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preparePromotion } from './prepare-promotion.mjs';

function fixture({ count = 1, open = [], proposedVersion = '0.1.0' } = {}) {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'git' && args[0] === 'rev-list') return 'a\nb\nc';
    if (command === 'git' && args[0] === 'show') return '# Changelog\n\n## Unreleased\n\n### Features\n\n- Example\n';
    if (command === 'gh' && args.includes('merged'))
      return JSON.stringify(
        ['a', 'b', 'c']
          .slice(0, count)
          .map((oid, index) => ({ number: index + 1, headRefName: `feat/task-${index}`, mergeCommit: { oid } })),
      );
    if (command === 'gh' && args.includes('open')) return JSON.stringify(open);
    if (command === 'node') return JSON.stringify({ currentVersion: '0.0.1', proposedVersion });
    if (command === 'gh' && args.includes('create')) return 'https://example.test/pr/1';
    return '';
  };
  return { calls, run };
}
test('prepares a promotion for one meaningful task and skips changes without a version bump', () => {
  const one = fixture({ count: 1 });
  const body = preparePromotion(one.run);
  assert.match(body, /Prepared promotion/);
  assert(one.calls.some((call) => call.includes('create')));
  assert(
    one.calls.some((call) => call.some((arg) => typeof arg === 'string' && arg.includes('generate-release-notes.mjs'))),
  );
  assert(one.calls.some((call) => call.includes('create')));
  const docsOnly = fixture({ count: 1, proposedVersion: '0.0.1' });
  assert.match(preparePromotion(docsOnly.run), /none contains a release-relevant/);
  assert(!docsOnly.calls.some((call) => call.includes('create')));
  const first = fixture();
  assert.match(preparePromotion(first.run), /Prepared promotion/);
  assert(first.calls.some((call) => call.includes('create')));
  const retry = fixture({ open: [{ number: 7, url: 'https://example.test/pr/7' }] });
  assert.match(preparePromotion(retry.run), /Updated promotion/);
  assert(retry.calls.some((call) => call.includes('edit')));
  assert(!retry.calls.some((call) => call.includes('create')));
  const duplicate = fixture({ open: [{ number: 1 }, { number: 2 }] });
  assert.throws(() => preparePromotion(duplicate.run), /Multiple/);
});

test('explains how to recover when main and dev diverge', () => {
  const { run } = fixture();
  assert.throws(
    () =>
      preparePromotion((command, args) => {
        if (command === 'git' && args[0] === 'merge-base') throw new Error('not an ancestor');
        return run(command, args);
      }),
    /main and dev have diverged.*main-to-dev-sync/,
  );
});
