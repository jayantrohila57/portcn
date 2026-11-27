import { describe, expect, it } from 'vitest';
import { applicationScopeFromCwd, isSupportingExecutable, matchCheckoutEvidence } from '../src/project-discovery.js';

const expected = {
  projectRoot: '/work/acme',
  gitDir: '/work/acme/.git',
  gitCommonDir: '/work/acme/.git',
};

describe('project discovery rules', () => {
  it('matches only the selected worktree checkout', () => {
    expect(
      matchCheckoutEvidence(expected, {
        status: 'identified',
        projectRoot: '/work/acme',
        gitDir: '/work/acme/.git',
        gitCommonDir: '/work/acme/.git',
        source: 'owner',
        confidence: 'high',
      }),
    ).toBe('matching');
    expect(
      matchCheckoutEvidence(expected, {
        status: 'identified',
        projectRoot: '/work/acme-feature',
        gitDir: '/work/acme-feature/.git',
        gitCommonDir: '/work/acme/.git',
        source: 'owner',
        confidence: 'high',
      }),
    ).toBe('sibling-worktree');
  });

  it('labels supporting shells separately from application scopes', () => {
    expect(isSupportingExecutable('/usr/bin/bash', null)).toBe(true);
    expect(isSupportingExecutable('/usr/bin/node', 'node')).toBe(false);
    expect(applicationScopeFromCwd('/work/acme', '/work/acme/apps/web')).toBe('apps/web');
  });
});
