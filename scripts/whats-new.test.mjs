import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { parseChangelog } = require('./changelog-policy.cjs');
const source = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
const page = readFileSync(new URL('../apps/docs/app/whats-new/page.tsx', import.meta.url), 'utf8');

test("What's New renders dated release sections from CHANGELOG.md and omits Unreleased", () => {
  const { releases } = parseChangelog(source);
  const history = new Map(releases.map(({ version, title }) => [version, title]));
  for (const [version, title] of [
    ['0.3.0', 'Port conflict diagnosis'],
    ['0.2.0', 'A steadier terminal dashboard'],
    ['0.1.1', 'More reliable package publishing'],
    ['0.1.0', 'Port discovery and an interactive dashboard'],
    ['0.0.1', 'Portcn CLI foundation'],
  ])
    assert.equal(history.get(version), title);
  assert.equal(releases.find(({ version }) => version === '0.3.0')?.demo, '`portcn diagnose 3000 --json`');
  assert.equal(
    releases.find(({ version }) => version === '0.1.0')?.demo,
    '`portcn list --interactive` · `portcn list --json` · `portcn inspect 3000`',
  );
  assert.equal(
    releases.some(({ version }) => version === 'Unreleased'),
    false,
  );
  assert.match(page, /CHANGELOG\.md/);
  assert.match(page, /Filter by year/);
  assert.match(page, /name="year"/);
  assert.match(page, /searchParams/);
  assert.match(page, /parseChangelog\(changelog\)/);
});

test("What's New page exposes accessible navigation, SEO, anchors, and GitHub links", () => {
  assert.match(page, /export const metadata/);
  assert.match(page, /aria-label="Release versions"/);
  assert.match(page, /id=\{`release-\$\{release\.anchor\}`\}/);
  assert.match(page, /releases\/tag\/v/);
  assert.match(page, /compare\/v/);
  assert.match(page, /Latest release/);
  assert.match(page, /Terminal demo/);
});
