import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { dateInIst, renderRelease, summarize } from './generate-release-notes.mjs';

const source = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const commit = (sha, subject, message = subject) => ({ sha, subject, message });
test('calculates IST calendar date across UTC midnight', () => {
  assert.equal(dateInIst(new Date('2026-11-23T20:00:00Z')), '2026-11-24');
});
test('creates concise categorized release notes with issue, PR, and compare links', () => {
  const result = renderRelease({
    source,
    version: '0.1.2',
    previousVersion: '0.1.1',
    title: 'Dashboard improvements',
    date: '2026-11-24',
    commits: [
      commit('a', 'feat(cli): add grouped filter (#120)', 'feat(cli): add grouped filter (#120)\n\nCloses #117'),
      commit('b', 'fix(cli): avoid empty table rows'),
      commit('c', 'chore: update package cache'),
    ],
  });
  assert.match(result, /## \[0\.1\.2\] - 2026-11-24/);
  assert.match(
    result,
    /- add grouped filter \(\[#120\]\(https:\/\/github.com\/jayantrohila57\/portcn\/pull\/120\), \[#117\]\(https:\/\/github.com\/jayantrohila57\/portcn\/issues\/117\)\)/,
  );
  assert.match(result, /### Fixed[\s\S]*- avoid empty table rows/);
  assert.doesNotMatch(result, /update package cache/);
  assert.match(result, /\[0\.1\.2\]: https:\/\/github.com\/jayantrohila57\/portcn\/compare\/v0\.1\.1\.\.\.v0\.1\.2/);
  assert.match(
    result,
    /\[0\.1\.2\]:[^\n]*\n\n\*\*Title:\*\* Dashboard improvements\n\n### Added[\s\S]*\n\n## \[0\.1\.1\]/,
  );
  assert.match(result, /## Unreleased\n\n### Added\n### Changed\n### Fixed/);
});
test('handles breaking changes and refuses duplicates or empty releases', () => {
  assert.equal(summarize('feat!: remove old config').category, 'Changed');
  assert.throws(
    () =>
      renderRelease({
        source: source
          .replace(/- modernize release management and changelog[^\n]*\n/, '')
          .replace(/- exclude tooling from release eligibility[^\n]*\n/, '')
          .replace(/- allow documentation-only task PRs[^\n]*\n/, ''),
        version: '0.1.2',
        previousVersion: '0.1.1',
        title: 'Dashboard improvements',
        commits: [commit('a', 'chore: housekeeping'), commit('a', 'chore: housekeeping')],
      }),
    /No user-facing/,
  );
  assert.throws(
    () =>
      renderRelease({
        source: source
          .replace(/- modernize release management and changelog[^\n]*\n/, '')
          .replace(/- exclude tooling from release eligibility[^\n]*\n/, '')
          .replace(/- allow documentation-only task PRs[^\n]*\n/, ''),
        version: '0.2.0',
        previousVersion: '0.1.1',
        title: 'Dashboard improvements',
        commits: [commit('x', 'chore: maintenance')],
      }),
    /No user-facing/,
  );
});
