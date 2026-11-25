import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { parseChangelog } = createRequire(import.meta.url)('./changelog-policy.cjs');
const source = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');

test('approval-gated GitHub Release drafts match canonical historical notes', () => {
  const { releases } = parseChangelog(source);
  for (const release of releases) {
    const draft = readFileSync(
      new URL(`../RELEASE-DESCRIPTION-DRAFTS/v${release.version}.md`, import.meta.url),
      'utf8',
    );
    assert.ok(draft.startsWith(`# ${release.title}\n`), `v${release.version} draft title must match CHANGELOG.md`);
    for (const { entries } of release.categories) {
      for (const entry of entries) {
        const content = entry.replace(/^-\s+/, '').replace(/\s*<!-- task:[^>]+ -->$/, '');
        const text = content.replace(/\[([^\]]+)\]\(https:\/\/github\.com\/[^)]+\)/g, '$1');
        const plain = text
          .replace(/\s*\(#[\d, ]+\)\.?$/, '')
          .replace(/\s*<!-- task:[^>]+ -->$/, '')
          .replace(/\s*Port discovery and process or service management were not part of this release\.$/, '');
        const normalizedDraft = draft.replace(/\[([^\]]+)\]\(https:\/\/github\.com\/[^)]+\)/g, '$1');
        assert.ok(normalizedDraft.includes(plain), `v${release.version} draft must include: ${plain}`);
      }
    }
    const compareLink = source.match(new RegExp(`^\\[${release.version.replaceAll('.', '\\.')}\\]: (.+)$`, 'm'))?.[1];
    assert.ok(compareLink, `v${release.version} needs a canonical release link`);
    const releaseUrl = compareLink.match(/https?:[^\s|]+/)?.[0];
    assert.ok(
      releaseUrl && draft.includes(releaseUrl),
      `v${release.version} draft must link the same release boundary`,
    );
    if (release.demo) {
      for (const command of release.demo.match(/`([^`]+)`/g) ?? [])
        assert.ok(draft.includes(command.slice(1, -1)), `v${release.version} demo must include ${command}`);
    }
  }
});
