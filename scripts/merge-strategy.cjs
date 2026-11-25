const taskBranchPattern = /^(feat|fix|refactor|chore|docs|test|build|ci|perf)\/[a-z0-9][a-z0-9-]*$/;
const releaseBranch = 'release-please--branches--main--components--portcn';

function mergeStrategyFor({ baseRefName, headRefName }) {
  if (baseRefName === 'dev' && taskBranchPattern.test(headRefName)) return 'squash';
  if (baseRefName === 'dev' && headRefName === 'main-to-dev-sync') return 'merge';
  if (baseRefName === 'main' && (headRefName === 'dev' || headRefName === releaseBranch)) return 'merge';
  throw new Error(`Unsupported PR merge route: ${headRefName} -> ${baseRefName}.`);
}

function mergeArguments(number, pullRequest, { auto = false } = {}) {
  if (!Number.isInteger(number) || number < 1) throw new Error('A valid pull request number is required.');
  if (pullRequest.state && pullRequest.state !== 'OPEN') throw new Error('Pull request is not open.');
  if (pullRequest.mergeable === 'CONFLICTING') throw new Error('Pull request has merge conflicts.');
  if (
    (pullRequest.statusCheckRollup ?? []).some((check) =>
      ['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'ERROR'].includes(check.conclusion ?? check.state),
    )
  )
    throw new Error('Pull request has failing checks.');
  const strategy = mergeStrategyFor(pullRequest);
  if (auto && strategy !== 'squash') throw new Error('Auto-merge is reserved for squash-merged task PRs.');
  return ['pr', 'merge', String(number), ...(auto ? ['--auto'] : []), `--${strategy}`];
}

function requestMerge(run, number, pullRequest, options) {
  return run('gh', mergeArguments(number, pullRequest, options));
}

module.exports = { mergeArguments, mergeStrategyFor, requestMerge };
