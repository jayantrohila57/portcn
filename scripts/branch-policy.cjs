const branchPattern = /^(feat|fix|refactor|chore|docs|test|build|ci|perf)\/[a-z0-9][a-z0-9-]*$/;
const conventionalHeader = /^(feat|fix|refactor|chore|docs|test|build|ci|perf|revert)(\([a-z0-9][a-z0-9-]*\))?!?: .+$/;
const releaseHeader = /^chore\(main\): release (0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;

function headerOf(message) {
  return (message ?? '').split(/\r?\n/, 1)[0].trim();
}

function evaluateBranchPolicy({ eventName, pullRequest, commits = [] }) {
  if (eventName !== 'pull_request') {
    return { allowed: true, skipped: true, reason: 'Branch policy runs only for pull request events.' };
  }

  if (!pullRequest) return { allowed: false, reason: 'Pull request payload is missing.' };

  const base = pullRequest.base?.ref;
  const head = pullRequest.head?.ref;
  const baseRepository = pullRequest.base?.repo?.full_name;
  const headRepository = pullRequest.head?.repo?.full_name;
  const repositoriesPresent = Boolean(baseRepository && headRepository);
  const titleIsConventional = conventionalHeader.test(pullRequest.title ?? '');
  const commitHeaders = commits.map(({ commit }) => headerOf(commit?.message));
  const authoredCommitHeaders = commits
    .filter(({ parents }) => (parents?.length ?? 1) < 2)
    .map(({ commit }) => headerOf(commit?.message));
  const commitsAreConventional =
    head === 'main-to-dev-sync' ||
    (authoredCommitHeaders.length > 0 && authoredCommitHeaders.every((header) => conventionalHeader.test(header)));

  if (!repositoriesPresent) {
    return {
      allowed: false,
      reason: 'PR base and head repositories are required.',
    };
  }
  if (!titleIsConventional) {
    return { allowed: false, reason: `PR title must use Conventional Commits: ${pullRequest.title ?? '(missing)'}` };
  }
  if (!commitsAreConventional) {
    return { allowed: false, reason: 'Every commit in the PR must use a Conventional Commit header.' };
  }

  if (base === 'dev') {
    if (branchPattern.test(head) || head === 'main-to-dev-sync') {
      return {
        allowed: true,
        reason:
          headRepository === baseRepository
            ? 'Task or documented synchronization PR to dev.'
            : 'Verified fork task PR to dev.',
      };
    }
  }

  if (base === 'main' && head === 'dev' && headRepository === baseRepository) {
    return { allowed: true, reason: 'Release promotion PR from dev to main.' };
  }

  const user = pullRequest.user;
  const releaseBranch = 'release-please--branches--main--components--portcn';
  const isReleaseBot = user?.type === 'Bot' && ['github-actions[bot]', 'app/github-actions'].includes(user?.login);
  const hasOneReleaseCommit = commitHeaders.length === 1 && releaseHeader.test(commitHeaders[0]);
  if (base === 'main' && head === releaseBranch && isReleaseBot && hasOneReleaseCommit) {
    return { allowed: true, reason: 'Verified Release Please PR from the configured release branch.' };
  }

  return {
    allowed: false,
    reason: `Rejected PR route: ${headRepository}:${head} -> ${baseRepository}:${base} (actor ${user?.login ?? '(missing)'}, type=${user?.type ?? '(missing)'}).`,
  };
}

module.exports = { evaluateBranchPolicy };
