import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { update, validate, validateRelease, reconcileRelease, parseChangelog } = createRequire(import.meta.url)(
  './changelog-policy.cjs',
);
const base =
  '# Changelog\n\n## Unreleased\n\n### Added\n\n### Changed\n\n### Fixed\n\n### Deprecated\n\n### Removed\n\n### Security\n\n## [0.0.1] - 2026-11-22\n\n[0.0.1]: https://github.com/jayantrohila57/portcn/releases/tag/v0.0.1\n\n**Title:** First release\n\n### Added\n\n- Existing release\n';
test('generates one categorized user-facing entry, includes issue refs, and preserves history', () => {
  const next = update(base, 'feat(cli): add example', 'feat/example', '119');
  assert.match(
    next,
    /### Added[\s\S]*- add example \(\[#119\]\(https:\/\/github.com\/jayantrohila57\/portcn\/issues\/119\)\) <!-- task:feat\/example -->/,
  );
  assert.match(next, /## \[0\.0\.1\] - 2026-11-22[\s\S]*- Existing release/);
  assert.equal(update(next, 'feat(cli): add example', 'feat/example', '119'), next);
  assert.equal(validate(base, next, 'feat(cli): add example', 'feat/example', '119').allowed, true);
  assert.equal(validate(base, base, 'feat(cli): add example', 'feat/example').allowed, false);
});
test('allows documentation-only PRs to leave the release changelog unchanged', () => {
  const files = ['apps/docs/content/docs/releases/index.mdx', 'RELEASE-MANAGEMENT-PLAN.md'];
  assert.equal(
    validate(base, base, 'docs(release): record verified lifecycle status', 'docs/release-status', undefined, files)
      .allowed,
    true,
  );
  assert.equal(
    validate(base, base, 'docs(release): record verified lifecycle status', 'docs/release-status', undefined, [
      ...files,
      'scripts/task-lifecycle.mjs',
    ]).allowed,
    false,
  );
  assert.equal(
    validate(base, base, 'docs(release): record verified lifecycle status', 'docs/release-status', undefined, [
      'CHANGELOG.md',
    ]).allowed,
    false,
  );
});
test('categorizes fixes and breaking commits and rejects duplicate task entries', () => {
  assert.match(update(base, 'fix(cli): handle empty input', 'fix/example'), /### Fixed/);
  assert.match(update(base, 'fix!: change behavior', 'fix/example'), /### Changed/);
  assert.throws(
    () =>
      update(
        `${update(base, 'fix!: change behavior', 'fix/example')}\n<!-- task:fix/example -->`,
        'fix!: change behavior',
        'fix/example',
      ),
    /Duplicate/,
  );
});
test('parses only canonical dated release headings and recognized sections', () => {
  const parsed = parseChangelog(base);
  assert.equal(parsed.releases.length, 1);
  assert.equal(parsed.releases[0].version, '0.0.1');
  assert.deepEqual(parsed.releases[0].categories[0].entries, ['- Existing release']);
  assert.equal(
    validateRelease(
      base.replace('https://example.test/release', 'https://github.com/jayantrohila57/portcn/releases/tag/v0.0.1'),
      '0.0.1',
    ).allowed,
    true,
  );
  assert.equal(validateRelease(base, '0.1.0').allowed, false);
});
test('rejects out-of-order history and requires release dates and version links', () => {
  const olderFirst = base.replace(
    '## [0.0.1] - 2026-11-22',
    '## [0.0.1] - 2026-11-22\n\n### Added\n\n- Existing release\n\n## [0.0.2] - 2026-11-23',
  );
  assert.throws(() => parseChangelog(olderFirst), /descending semantic-version order/);
  assert.equal(
    validateRelease(
      base.replace('[0.0.1]: https://github.com/jayantrohila57/portcn/releases/tag/v0.0.1\n', ''),
      '0.0.1',
    ).allowed,
    false,
  );
  assert.equal(
    validateRelease(
      base.replace(
        'https://github.com/jayantrohila57/portcn/releases/tag/v0.0.1',
        'https://github.com/jayantrohila57/portcn/compare/v0.0.2...v0.0.1',
      ),
      '0.0.1',
    ).allowed,
    false,
  );
});
test('reconciles only entries represented in the exact release and is idempotent', () => {
  const source =
    '# Changelog\n\n## Unreleased\n\n### Added\n\n- add tool <!-- task:feat/tool -->\n\n## [0.1.0] - 2026-11-24\n\n### Added\n\n- add tool\n';
  const result = reconcileRelease(source, '0.1.0');
  assert.match(result, /## Unreleased\n\n## \[0\.1\.0\]/);
  assert.equal(reconcileRelease(result, '0.1.0'), result);
  assert.throws(() => reconcileRelease(source.replace('add tool <!--', 'other <!--'), '0.1.0'), /do not contain/);
  assert.throws(() => reconcileRelease(source, '0.2.0'), /missing/);
});
test('rejects prose that cannot be safely reconciled', () => {
  const source = '# Changelog\n\n## Unreleased\n\nPending context\n\n## [0.1.0] - 2026-11-24\n\n### Added\n\n- item\n';
  assert.throws(() => reconcileRelease(source, '0.1.0'), /cannot be safely reconciled/);
});
test('permits a canonical history migration only when published versions remain', () => {
  const legacy =
    '# Changelog\n\n## Unreleased\n\n## [0.1.0](https://github.com/jayantrohila57/portcn/compare/v0.0.1...v0.1.0) (2026-11-24)\n\n- feature ([#8](https://github.com/jayantrohila57/portcn/issues/8))\n';
  let migrated = update(base, 'feat(cli): add example', 'feat/example', '119');
  migrated = migrated.replace('# Changelog\n', '# Changelog\n\nAll notable changes are listed here.\n');
  migrated = migrated.replace(
    '## [0.0.1] - 2026-11-22',
    '## [0.1.0] - 2026-11-24\n\n[0.1.0]: https://github.com/jayantrohila57/portcn/compare/v0.0.1...v0.1.0\n\n**Title:** Feature release\n\n### Added\n\n- feature ([#8](https://github.com/jayantrohila57/portcn/issues/8))\n\n## [0.0.1] - 2026-11-22',
  );
  assert.equal(validate(legacy, migrated, 'feat(cli): add example', 'feat/example', '119').allowed, true);
  assert.equal(
    validate(legacy, migrated.replace('## [0.1.0]', '## [0.2.0]'), 'feat(cli): add example', 'feat/example', '119')
      .allowed,
    false,
  );
});
