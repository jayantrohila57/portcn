import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { createLifecycle } from './task-lifecycle.mjs';

const require = createRequire(import.meta.url);
const { checkDocumentation } = require('./documentation-policy.cjs');
const { update } = require('./changelog-policy.cjs');
function fixture(overrides = {}) {
  const calls = [];
  const state = { branch: 'feat/example', dirty: false, prs: [], ...overrides };
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'git' && args[0] === 'status') return state.dirty ? ' M file' : '';
    if (cmd === 'git' && args[0] === 'branch' && args[1] === '--show-current') return state.branch;
    if (cmd === 'git' && args[0] === 'for-each-ref') return state.branches ?? '';
    if (cmd === 'git' && args[0] === 'branch' && args[1] === '--list')
      return state.branchDeleted ? '' : '  feat/example';
    if (cmd === 'git' && args[0] === 'log') return 'abc';
    if (cmd === 'git' && args[0] === 'show')
      return args[1].startsWith('origin/')
        ? '# Changelog\n\n## Unreleased\n\n### Added\n\n### Changed\n\n### Fixed\n\n### Deprecated\n\n### Removed\n\n### Security\n'
        : update(
            '# Changelog\n\n## Unreleased\n\n### Added\n\n### Changed\n\n### Fixed\n\n### Deprecated\n\n### Removed\n\n### Security\n',
            'feat(cli): example',
            'feat/example',
          );
    if (cmd === 'gh' && args[0] === 'pr' && args[1] === 'list') return JSON.stringify(state.prs);
    if (cmd === 'gh' && args[1] === 'create') state.prs = [pr()];
    return '';
  };
  return { lifecycle: createLifecycle(run), state, calls };
}
function pr(overrides = {}) {
  return {
    number: 1,
    title: 'feat(cli): example',
    state: 'OPEN',
    baseRefName: 'dev',
    headRefName: 'feat/example',
    isCrossRepository: false,
    isDraft: false,
    mergeable: 'MERGEABLE',
    statusCheckRollup: [],
    ...overrides,
  };
}
test('start rejects dirty and unfinished tasks', () => {
  assert.throws(() => fixture({ dirty: true }).lifecycle.start('feat/new'), /not clean/);
  assert.throws(() => fixture({ branch: 'dev', branches: 'feat/old' }).lifecycle.start('feat/new'), /reconciliation/);
});
test('submit creates or reuses a PR and requests auto merge', () => {
  const f = fixture();
  f.lifecycle.submit('feat(cli): example', 'body.md');
  assert.equal(f.calls.filter((call) => call[1] === 'pr' && call[2] === 'create').length, 1);
  f.lifecycle.submit('feat(cli): example', 'body.md');
  assert.equal(f.calls.filter((call) => call[1] === 'pr' && call[2] === 'create').length, 1);
  assert(f.calls.some((call) => call.includes('--auto')));
  assert.deepEqual(
    f.calls.find((call) => call[1] === 'pr' && call[2] === 'merge'),
    ['gh', 'pr', 'merge', '1', '--auto', '--squash'],
  );
});
test('submit refuses draft, conflicts, failed checks and duplicate PRs', () => {
  for (const [prs, pattern] of [
    [[pr({ isDraft: true })], /draft/],
    [[pr({ mergeable: 'CONFLICTING' })], /conflicts/],
    [[pr({ statusCheckRollup: [{ conclusion: 'FAILURE' }] })], /failing/],
    [[pr(), pr({ number: 2 })], /Multiple/],
  ]) {
    assert.throws(() => fixture({ prs }).lifecycle.submit('feat(cli): example', 'body.md'), pattern);
  }
});
test('finish requires verified merge including squash merge', () => {
  assert.throws(() => fixture().lifecycle.finish(), /No matching PR/);
  assert.throws(() => fixture({ prs: [pr()] }).lifecycle.finish(), /not merged/);
  const f = fixture({ prs: [pr({ state: 'MERGED', mergeCommit: { oid: 'merge-sha' } })] });
  f.lifecycle.finish();
  assert(f.calls.some((call) => call.includes('merge-sha')));
  assert(f.calls.some((call) => call.includes('-D')));
});
test('documentation policy accepts docs or a specific justification', () => {
  const base = { base: 'dev', head: 'feat/example', files: ['apps/cli/src/index.ts'] };
  assert.equal(checkDocumentation(base).allowed, false);
  assert.equal(
    checkDocumentation({
      ...base,
      body: 'No documentation change required: Internal test fixture only; behavior is unchanged.',
    }).allowed,
    true,
  );
  assert.equal(
    checkDocumentation({ ...base, files: [...base.files, 'apps/docs/content/docs/cli-reference/index.mdx'] }).allowed,
    true,
  );
});

test('finish resumes cleanup from dev after interruption', () => {
  const f = fixture({ branch: 'dev', prs: [pr({ state: 'MERGED', mergeCommit: { oid: 'merge-sha' } })] });
  assert.throws(() => f.lifecycle.finish(), /supply the merged task branch/);
  f.lifecycle.finish('feat/example');
  assert(!f.calls.some((call) => call[1] === 'switch'));
  assert(f.calls.some((call) => call.includes('-D')));
});

test('finish retries promotion after local branch was already deleted', () => {
  const f = fixture({
    branch: 'dev',
    branchDeleted: true,
    prs: [pr({ state: 'MERGED', mergeCommit: { oid: 'merge-sha' } })],
  });
  f.lifecycle.finish('feat/example');
  assert(!f.calls.some((call) => call.includes('-D')));
  assert(f.calls.some((call) => call.includes('scripts/prepare-promotion.mjs')));
});

test('submit rejects a matching PR with a different title', () => {
  assert.throws(
    () => fixture({ prs: [pr({ title: 'feat: different' })] }).lifecycle.submit('feat(cli): example', 'body.md'),
    /title differs/,
  );
});
