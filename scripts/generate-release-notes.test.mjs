import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { dateInIst, renderRelease, summarize } from './generate-release-notes.mjs';

const { parseChangelog } = createRequire(import.meta.url)('./changelog-policy.cjs');
const source = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8')
  .split(/(?=^## \[\d+\.\d+\.\d+\] - )/m)
  .filter((section) => {
    const version = /^## \[(\d+\.\d+\.\d+)\] - /m.exec(section)?.[1];
    return !version || Boolean(execFileSync('git', ['tag', '--list', `v${version}`], { encoding: 'utf8' }).trim());
  })
  .join('');
const previousVersion = parseChangelog(source).releases[0]?.version;
if (!previousVersion) throw new Error('The changelog test needs a published release.');
const [major, minor, patch] = previousVersion.split('.').map(Number);
const version = `${major}.${minor}.${patch + 1}`;
const commit = (sha, subject, message = subject) => ({ sha, subject, message });
test('calculates IST calendar date across UTC midnight', () => {
  assert.equal(dateInIst(new Date('2026-11-23T20:00:00Z')), '2026-11-24');
});
test('creates concise categorized release notes with issue, PR, and compare links', () => {
  const result = renderRelease({
    source,
    version,
    previousVersion,
    title: 'Dashboard improvements',
    date: '2026-11-24',
    commits: [
      commit('a', 'feat(cli): add grouped filter (#120)', 'feat(cli): add grouped filter (#120)\n\nCloses #117'),
      commit('b', 'fix(cli): avoid empty table rows'),
      commit('c', 'chore: update package cache'),
    ],
  });
  assert.ok(result.includes(`## [${version}] - 2026-11-24`));
  assert.match(
    result,
    /- add grouped filter \(\[#120\]\(https:\/\/github\.com\/jayantrohila57\/portcn\/pull\/120\), \[#117\]\(https:\/\/github\.com\/jayantrohila57\/portcn\/issues\/117\)\)/,
  );
  assert.match(result, /### Fixed[\s\S]*- avoid empty table rows/);
  assert.doesNotMatch(result, /update package cache/);
  assert.ok(
    result.includes(`[${version}]: https://github.com/jayantrohila57/portcn/compare/v${previousVersion}...v${version}`),
  );
  assert.ok(result.includes(`**Title:** Dashboard improvements`));
  assert.ok(result.includes(`\n\n## [${previousVersion}]`));
  assert.match(result, /## Unreleased\n\n### Added\n### Changed\n### Fixed/);
});
test('handles breaking changes and refuses duplicates or empty releases', () => {
  assert.equal(summarize('feat!: remove old config').category, 'Changed');
  assert.throws(
    () =>
      renderRelease({
        source,
        version,
        previousVersion,
        title: 'Dashboard improvements',
        commits: [commit('a', 'chore: housekeeping'), commit('a', 'chore: housekeeping')],
      }),
    /No user-facing/,
  );
  const release = renderRelease({
    source,
    version,
    previousVersion,
    title: 'Dashboard improvements',
    commits: [commit('a', 'fix(cli): avoid empty table rows')],
  });
  assert.throws(
    () =>
      renderRelease({
        source: release,
        version,
        previousVersion: version,
        title: 'Duplicate',
        commits: [commit('b', 'fix(cli): another change')],
      }),
    /already exists/,
  );
});
