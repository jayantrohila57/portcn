import { execFileSync } from 'node:child_process';

const run = (command, args, options = {}) =>
  execFileSync(command, args, { encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit' }).trim();
const git = (...args) => run('git', args, { capture: true });
const branch = () => git('branch', '--show-current');
const clean = () => {
  if (git('status', '--porcelain'))
    throw new Error('Working tree is not clean; preserve or finish existing work first.');
};
const namePattern = /^(feat|fix|refactor|chore|docs|test|build|ci|perf)\/[a-z0-9][a-z0-9-]*$/;

try {
  const [action, name] = process.argv.slice(2);
  if (action === 'start') {
    if (!namePattern.test(name ?? '')) throw new Error('Supply a valid task branch, for example feat/example.');
    clean();
    if (branch() !== 'dev') throw new Error('Finish the current branch and return to dev first.');
    run('git', ['fetch', 'origin', 'dev']);
    run('git', ['merge', '--ff-only', 'origin/dev']);
    run('git', ['switch', '-c', name]);
  } else if (action === 'finish') {
    clean();
    const current = branch();
    if (!namePattern.test(current)) throw new Error('Finish requires a task branch.');
    const pr = JSON.parse(
      run('gh', ['pr', 'view', current, '--json', 'state,baseRefName,headRefName,isCrossRepository,mergeCommit'], {
        capture: true,
      }),
    );
    if (pr.baseRefName !== 'dev' || pr.headRefName !== current || pr.isCrossRepository)
      throw new Error('PR must be the matching same-repository task PR targeting dev.');
    if (pr.state !== 'MERGED')
      throw new Error('PR is not merged; preserve the branch until checks and merge complete.');
    run('git', ['fetch', 'origin', 'dev']);
    if (!pr.mergeCommit?.oid) throw new Error('Merged PR has no merge commit.');
    git('merge-base', '--is-ancestor', pr.mergeCommit.oid, 'origin/dev');
    run('git', ['switch', 'dev']);
    run('git', ['merge', '--ff-only', 'origin/dev']);
    // Squash merges do not make the task branch an ancestor; verify the PR merge above before deletion.
    run('git', ['branch', '-D', current]);
  } else {
    throw new Error('Usage: node scripts/task-lifecycle.mjs start <type/name> | finish');
  }
} catch (error) {
  console.error(`Task lifecycle stopped: ${error.message}`);
  process.exitCode = 1;
}
