import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const workflow = readFileSync(new URL('../.github/workflows/release-please.yml', import.meta.url), 'utf8');
const githubWorkflow = readFileSync(new URL('../.github/workflows/github-packages.yml', import.meta.url), 'utf8');

test('Release Please prepares a reviewed version PR and synchronizes approved release notes', () => {
  const config = JSON.parse(readFileSync(new URL('../release-please-config.json', import.meta.url), 'utf8'));
  assert.match(workflow, /googleapis\/release-please-action@v4/);
  assert.equal(config.packages['.']['skip-changelog'], true);
  assert.match(workflow, /release-notes-body\.mjs/);
  assert.match(workflow, /verify-release-commit\.mjs/);
  assert.match(workflow, /publish-npm\.mjs/);
  assert.match(workflow, /gh workflow run github-packages\.yml --ref main -f "tag=\$RELEASE_TAG"/);
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  assert.match(ci, /version comparison link/);
});

test('GitHub Packages publication is independently recoverable and exact-tag guarded', () => {
  assert.match(githubWorkflow, /types: \[published\]/);
  assert.match(githubWorkflow, /workflow_dispatch:/);
  assert.match(githubWorkflow, /git rev-parse --verify "\$RELEASE_TAG\^\{commit\}"/);
  assert.match(githubWorkflow, /tagged_commit.*checked_out_commit.*test "\$tagged_commit" = "\$checked_out_commit"/s);
  assert.match(githubWorkflow, /PACKAGE_NAME: ["']@jayantrohila57\/portcn["']/);
  assert.match(githubWorkflow, /already exists; skipping duplicate publication/);
  assert.match(githubWorkflow, /Unable to determine|E404/);
  assert.ok(
    githubWorkflow.indexOf('pnpm --filter @portcn/core build') < githubWorkflow.indexOf('pnpm --filter portcn build'),
  );
});
