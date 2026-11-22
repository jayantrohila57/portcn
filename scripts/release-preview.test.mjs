import assert from 'node:assert/strict';
import { test } from 'node:test';
import { calculateNextVersion, initialBaseline, parseCommit, preview, validateBaseline } from './release-preview.mjs';

const change = (type, breaking = false, releaseRelevant = true) => ({ type, breaking, releaseRelevant });
test('aggregates changes into one pre-1.0 version bump', () => {
  assert.equal(calculateNextVersion('0.0.1', [change('fix'), change('fix')]), '0.0.2');
  assert.equal(calculateNextVersion('0.0.2', [change('feat'), change('fix')]), '0.1.0');
  assert.equal(calculateNextVersion('0.1.0', [change('perf')]), '0.1.1');
  assert.equal(calculateNextVersion('0.1.1', [change('fix', true)]), '0.2.0');
  assert.equal(calculateNextVersion('0.1.0', [change('docs'), change('feat', false, false)]), '0.1.0');
  assert.equal(calculateNextVersion('1.0.0', [change('fix', true)]), '2.0.0');
});
test('uses paths and breaking footers, and deduplicates by commit', () => {
  const commit = {
    sha: 'a',
    message: 'fix(cli): improve output\n\nBREAKING CHANGE: output changed',
    files: ['apps/cli/src/index.ts'],
  };
  assert.equal(parseCommit(commit).breaking, true);
  assert.equal(parseCommit({ ...commit, files: ['apps/docs/content/docs/index.mdx'] }).releaseRelevant, false);
  const result = preview({ version: '0.0.1', commits: [commit, commit] });
  assert.equal(result.proposedVersion, '0.1.0');
  assert.equal(result.changes.length, 1);
});

test('rejects an initial tag pointing away from the proposed baseline', () => {
  assert.doesNotThrow(() => validateBaseline('0.0.1', initialBaseline));
  assert.throws(() => validateBaseline('0.0.1', 'different'), /does not point/);
  assert.doesNotThrow(() => validateBaseline('0.1.0', 'different'));
});
