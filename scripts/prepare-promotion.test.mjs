import assert from 'node:assert/strict';
import { test } from 'node:test';
import { preparePromotion } from './prepare-promotion.mjs';

function fixture({ count = 3, open = [] } = {}) {
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
    if (command === 'node') return JSON.stringify({ proposedVersion: '0.1.0' });
    if (command === 'gh' && args.includes('create')) return 'https://example.test/pr/1';
    return '';
  };
  return { calls, run };
}
test('prepares or updates a promotion only after three integrated tasks', () => {
  const small = fixture({ count: 2 });
  assert.match(preparePromotion(small.run), /threshold/);
  assert(!small.calls.some((call) => call.includes('create')));
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
