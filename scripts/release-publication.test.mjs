import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { publishNpm } from './publish-npm.mjs';
import { releaseNotesBody } from './release-notes-body.mjs';
import { verifyRelease } from './verify-release-commit.mjs';

const changelog =
  '# Changelog\n\n## Unreleased\n\n### Added\n\n### Changed\n\n### Fixed\n\n### Deprecated\n\n### Removed\n\n### Security\n\n## [0.1.2] - 2026-11-24\n\n[0.1.2]: https://github.com/jayantrohila57/portcn/compare/v0.1.1...v0.1.2\n\n**Title:** A tested feature\n\n### Added\n\n- Add a tested feature.\n\n## [0.1.1] - 2026-11-24\n\n[0.1.1]: https://github.com/example\n';

test('verifies exact tag commit, synchronized package versions, and canonical release section', () => {
  const verified = verifyRelease({
    tag: 'v0.1.2',
    manifest: '0.1.2',
    cliVersion: '0.1.2',
    rootVersion: '0.1.2',
    source: changelog,
    taggedCommit: 'sha',
    checkedOutCommit: 'sha',
  });
  assert.equal(verified.commit, 'sha');
  assert.match(verified.body, /- Add a tested feature\./);
  assert.match(releaseNotesBody(changelog, 'v0.1.2'), /## \[0\.1\.2\] - 2026-11-24/);
  assert.doesNotMatch(releaseNotesBody(changelog, 'v0.1.2'), /\[0\.1\.1\]/);
  assert.throws(
    () =>
      verifyRelease({
        tag: 'v0.1.2',
        manifest: '0.1.1',
        cliVersion: '0.1.2',
        rootVersion: '0.1.2',
        source: changelog,
        taggedCommit: 'sha',
        checkedOutCommit: 'sha',
      }),
    /must match/,
  );
  assert.throws(
    () =>
      verifyRelease({
        tag: 'v0.1.2',
        manifest: '0.1.2',
        cliVersion: '0.1.2',
        rootVersion: '0.1.2',
        source: changelog,
        taggedCommit: 'other',
        checkedOutCommit: 'sha',
      }),
    /does not point/,
  );
});

test('npm publication skips exact retries and refuses unknown registry state', () => {
  const dir = mkdtempSync(join(tmpdir(), 'portcn-publish-test-'));
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    if (command === 'pnpm' && args.includes('pack'))
      writeFileSync(join(args[args.indexOf('--pack-destination') + 1], 'portcn-0.1.2.tgz'), 'archive');
    if (command === 'npm' && args[0] === 'view') return '"0.1.2"';
    return '';
  };
  try {
    assert.match(publishNpm({ tag: 'v0.1.2', version: '0.1.2', root: dir, run }), /already exists/);
    assert.equal(
      calls.some((call) => call[0] === 'npm' && call[1] === 'publish'),
      false,
    );
    assert.throws(() => publishNpm({ tag: 'v0.1.2', version: '0.1.1', root: dir, run }), /must match/);
    const unknown = (command, args) => {
      if (command === 'pnpm' && args.includes('pack'))
        writeFileSync(join(args[args.indexOf('--pack-destination') + 1], 'portcn-0.1.2.tgz'), 'archive');
      if (command === 'npm' && args[0] === 'view') throw Object.assign(new Error('network'), { stderr: 'ECONNRESET' });
      return '';
    };
    assert.throws(
      () => publishNpm({ tag: 'v0.1.2', version: '0.1.2', root: dir, run: unknown }),
      /refusing to publish/,
    );
    const recover = (command, args) => {
      calls.push([command, ...args]);
      if (command === 'pnpm' && args.includes('pack'))
        writeFileSync(join(args[args.indexOf('--pack-destination') + 1], 'portcn-0.1.2.tgz'), 'archive');
      if (command === 'npm' && args[0] === 'view') throw Object.assign(new Error('not published'), { stderr: 'E404' });
      return '';
    };
    assert.match(publishNpm({ tag: 'v0.1.2', version: '0.1.2', root: dir, run: recover }), /Published portcn/);
    assert(calls.some((call) => call[0] === 'npm' && call[1] === 'publish'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
