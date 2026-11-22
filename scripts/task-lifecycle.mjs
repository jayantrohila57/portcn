import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const { validate } = createRequire(import.meta.url)('./changelog-policy.cjs');

export const namePattern = /^(feat|fix|refactor|chore|docs|test|build|ci|perf)\/[a-z0-9][a-z0-9-]*$/;
export function createLifecycle(run) {
  const git = (...args) => run('git', args);
  const gh = (...args) => run('gh', args);
  const json = (...args) => JSON.parse(gh(...args));
  const clean = () => {
    if (git('status', '--porcelain'))
      throw new Error('Working tree is not clean; preserve or finish existing work first.');
  };
  const current = () => git('branch', '--show-current');
  const task = () => {
    const name = current();
    if (!namePattern.test(name)) throw new Error('A task branch is required.');
    return name;
  };
  const prs = (branch) =>
    json(
      'pr',
      'list',
      '--state',
      'all',
      '--head',
      branch,
      '--base',
      'dev',
      '--limit',
      '100',
      '--json',
      'number,state,baseRefName,headRefName,isCrossRepository,isDraft,mergeable,mergeStateStatus,statusCheckRollup,mergeCommit,url',
    );
  const getPr = (branch) => {
    const found = prs(branch);
    const open = found.filter((pr) => pr.state === 'OPEN');
    if (open.length > 1) throw new Error('Multiple open PRs match this task branch.');
    return open[0] ?? found.find((pr) => pr.state === 'MERGED');
  };
  const validatePr = (pr, branch) => {
    if (pr.baseRefName !== 'dev' || pr.headRefName !== branch || pr.isCrossRepository)
      throw new Error('PR must be the matching same-repository task PR targeting dev.');
  };
  function start(name) {
    if (!namePattern.test(name ?? '')) throw new Error('Supply a valid task branch, for example feat/example.');
    clean();
    if (current() !== 'dev') throw new Error('Finish the current branch and return to dev first.');
    const branches = git('for-each-ref', '--format=%(refname:short)', 'refs/heads')
      .split('\n')
      .filter((value) => namePattern.test(value));
    if (branches.length) throw new Error(`Existing task branches require reconciliation: ${branches.join(', ')}`);
    run('git', ['fetch', 'origin', 'dev']);
    run('git', ['merge', '--ff-only', 'origin/dev']);
    run('git', ['switch', '-c', name]);
  }
  function submit(title, bodyFile) {
    clean();
    const branch = task();
    if (!title || !bodyFile) throw new Error('Usage: submit <conventional-title> <PR-body-file>');
    if (!/^(feat|fix|refactor|chore|docs|test|build|ci|perf)(\([a-z0-9-]+\))?!?: .+/.test(title))
      throw new Error('PR title must be Conventional.');
    run('git', ['fetch', 'origin', 'dev']);
    git('merge-base', '--is-ancestor', 'origin/dev', 'HEAD');
    if (!git('log', '--format=%H', 'origin/dev..HEAD')) throw new Error('No task commits to submit.');
    const check = validate(git('show', 'origin/dev:CHANGELOG.md'), git('show', 'HEAD:CHANGELOG.md'), title, branch);
    if (!check.allowed) throw new Error(check.reason);
    let pr = getPr(branch);
    if (pr?.state === 'MERGED') throw new Error('Branch already merged; run finish.');
    if (pr) {
      validatePr(pr, branch);
      if (pr.isDraft) throw new Error('PR is a draft; preserve it for review.');
    }
    run('git', ['push', '-u', 'origin', branch]);
    if (!pr) {
      run('gh', ['pr', 'create', '--base', 'dev', '--head', branch, '--title', title, '--body-file', bodyFile]);
      pr = getPr(branch);
      if (!pr) throw new Error('PR creation could not be verified; retry safely.');
    }
    validatePr(pr, branch);
    if (pr.isDraft) throw new Error('PR is a draft; preserve it for review.');
    if (pr.mergeable === 'CONFLICTING') throw new Error('PR has merge conflicts; resolve before retrying.');
    const checks = pr.statusCheckRollup ?? [];
    if (
      checks.some((check) =>
        ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'ERROR'].includes(check.conclusion ?? check.state),
      )
    )
      throw new Error('PR has failing checks; fix them before retrying.');
    run('gh', ['pr', 'merge', String(pr.number), '--auto', '--squash']);
    return 'Auto-merge requested; run finish after GitHub reports the PR merged.';
  }
  function changelog(title) {
    task();
    if (!title) throw new Error('Usage: changelog <conventional-title>');
    return run('node', ['scripts/changelog.mjs', title]);
  }
  function finish() {
    clean();
    const branch = task();
    const pr = getPr(branch);
    if (!pr) throw new Error('No matching PR found; preserve the task branch.');
    validatePr(pr, branch);
    if (pr.state !== 'MERGED')
      throw new Error('PR is not merged; preserve the branch until checks and merge complete.');
    run('git', ['fetch', 'origin', 'dev']);
    if (!pr.mergeCommit?.oid) throw new Error('Merged PR has no merge commit.');
    git('merge-base', '--is-ancestor', pr.mergeCommit.oid, 'origin/dev');
    run('git', ['switch', 'dev']);
    run('git', ['merge', '--ff-only', 'origin/dev']);
    run('git', ['branch', '-D', branch]);
    return 'Merged task verified and local dev updated.';
  }
  return { start, changelog, submit, finish };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const run = (command, args) =>
      execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
    const lifecycle = createLifecycle(run);
    const [action, ...args] = process.argv.slice(2);
    if (!Object.hasOwn(lifecycle, action))
      throw new Error(
        'Usage: task-lifecycle.mjs start <branch> | changelog <title> | submit <title> <body-file> | finish',
      );
    console.log(lifecycle[action](...args) ?? 'Task branch created.');
  } catch (error) {
    console.error(`Task lifecycle stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
