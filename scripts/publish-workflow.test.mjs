import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/release-please.yml', import.meta.url), 'utf8');
const githubWorkflow = readFileSync(new URL('../.github/workflows/github-packages.yml', import.meta.url), 'utf8');

test('publishes only after Release Please creates a release', () => {
  assert.match(workflow, /id: release/);
  assert.match(workflow, /if: steps\.release\.outputs\.release_created == 'true'/);
  assert.match(workflow, /ref: \$\{\{ (?:inputs\.tag \|\| )?steps\.release\.outputs\.tag_name \}\}/);
  assert.match(workflow, /actions: write/);
  assert.match(workflow, /gh workflow run github-packages\.yml --ref main -f tag=/);
  assert.match(workflow, /Verify changelog reconciliation/);
  assert.match(workflow, /reconcileRelease/);
  assert.ok(workflow.indexOf('Verify changelog reconciliation') < workflow.indexOf('Verify and publish CLI package'));
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /reconcileRelease/);
});

test('GitHub Packages workflow publishes only the scoped CLI from a verified release tag', () => {
  assert.match(githubWorkflow, /types: \[published\]/);
  assert.match(githubWorkflow, /workflow_dispatch:/);
  assert.match(githubWorkflow, /contents: read/);
  assert.match(githubWorkflow, /packages: write/);
  assert.match(githubWorkflow, /git cat-file -t "\$RELEASE_TAG"/);
  assert.match(githubWorkflow, /git rev-parse "\$RELEASE_TAG\^\{commit\}".*git rev-parse HEAD\^\{commit\}/s);
  assert.match(githubWorkflow, /PACKAGE_NAME: ["']@jayantrohila57\/portcn["']/);
  assert.match(githubWorkflow, /npm\.pkg\.github\.com/);
  assert.match(githubWorkflow, /registry-url: https:\/\/npm\.pkg\.github\.com/);
  assert.match(githubWorkflow, /scope: ['"]@jayantrohila57['"]/);
  assert.match(githubWorkflow, /NODE_AUTH_TOKEN: \$\{\{ secrets\.GITHUB_TOKEN \}\}/);
  assert.match(githubWorkflow, /already exists; skipping duplicate publication/);
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
