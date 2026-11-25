const assert = require('node:assert/strict');
const { test } = require('node:test');
const { mergeArguments, mergeStrategyFor, requestMerge } = require('./merge-strategy.cjs');

test('task PRs use squash merges into dev', () => {
  assert.equal(mergeStrategyFor({ baseRefName: 'dev', headRefName: 'feat/example' }), 'squash');
  assert.deepEqual(mergeArguments(42, { baseRefName: 'dev', headRefName: 'fix/example' }, { auto: true }), [
    'pr',
    'merge',
    '42',
    '--auto',
    '--squash',
  ]);
});

test('production promotions and release candidates use true merge commits', () => {
  assert.equal(mergeStrategyFor({ baseRefName: 'main', headRefName: 'dev' }), 'merge');
  assert.equal(
    mergeStrategyFor({
      baseRefName: 'main',
      headRefName: 'release-please--branches--main--components--portcn',
    }),
    'merge',
  );
  assert.deepEqual(mergeArguments(43, { baseRefName: 'main', headRefName: 'dev' }), ['pr', 'merge', '43', '--merge']);
});

test('main-to-dev synchronization uses a true merge commit', () => {
  assert.equal(mergeStrategyFor({ baseRefName: 'dev', headRefName: 'main-to-dev-sync' }), 'merge');
  assert.deepEqual(mergeArguments(44, { baseRefName: 'dev', headRefName: 'main-to-dev-sync' }), [
    'pr',
    'merge',
    '44',
    '--merge',
  ]);
});

test('unknown routes and invalid PR numbers cannot select a merge strategy', () => {
  assert.throws(() => mergeStrategyFor({ baseRefName: 'main', headRefName: 'feat/example' }), /Unsupported/);
  assert.throws(() => mergeStrategyFor({ baseRefName: 'dev', headRefName: 'main' }), /Unsupported/);
  assert.throws(() => mergeArguments(0, { baseRefName: 'dev', headRefName: 'feat/example' }), /valid pull request/);
});

test('merge requests reject closed, conflicting, or failed-check PRs', () => {
  const run = () => assert.fail('Must not invoke GitHub for a rejected PR.');
  assert.throws(
    () => requestMerge(run, 45, { baseRefName: 'dev', headRefName: 'feat/example', state: 'MERGED' }),
    /not open/,
  );
  assert.throws(
    () =>
      requestMerge(run, 45, {
        baseRefName: 'dev',
        headRefName: 'feat/example',
        state: 'OPEN',
        mergeable: 'CONFLICTING',
      }),
    /conflicts/,
  );
  assert.throws(
    () =>
      requestMerge(run, 45, {
        baseRefName: 'dev',
        headRefName: 'feat/example',
        state: 'OPEN',
        statusCheckRollup: [{ conclusion: 'FAILURE' }],
      }),
    /failing checks/,
  );
});

test('automatic merge is restricted to task PRs', () => {
  assert.throws(
    () => requestMerge(() => {}, 46, { baseRefName: 'main', headRefName: 'dev', state: 'OPEN' }, { auto: true }),
    /reserved for squash-merged task PRs/,
  );
});
