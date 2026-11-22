import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/release-please.yml', import.meta.url), 'utf8');

test('publishes only after Release Please creates a release', () => {
  assert.match(workflow, /id: release/);
  assert.match(workflow, /if: steps\.release\.outputs\.release_created == 'true'/);
  assert.match(workflow, /ref: \$\{\{ steps\.release\.outputs\.tag_name \}\}/);
});

test('uses npm trusted publishing and verifies the released CLI version', () => {
  assert.match(workflow, /uses: pnpm\/action-setup@v4/);
  assert.match(workflow, /version: 12\.3\.4/);
  assert.match(workflow, /run: pnpm install --frozen-lockfile/);
  assert.match(workflow, /id-token: write/);
  assert.match(workflow, /registry-url: https:\/\/registry\.npmjs\.org/);
  assert.match(workflow, /p\.version !== process\.env\.RELEASE_VERSION/);
  assert.match(workflow, /mkdir -p \/tmp\/portcn-release/);
  assert.match(workflow, /portcn-\$\{RELEASE_VERSION\}\.tgz/);
  assert.match(workflow, /npm publish .*--access public --provenance/);
  assert.match(workflow, /already published; skipping duplicate publication/);
  assert.match(workflow, /Unable to determine existing npm publication/);
});
