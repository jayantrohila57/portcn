import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const initialBaseline = 'd495d5b0ce3b0e9fd5f9b4df4aec0f9ab7d204ee';
export function validateBaseline(version, baseline) {
  if (version === '0.0.1' && baseline !== initialBaseline)
    throw new Error('v0.0.1 does not point to the proposed bootstrap commit.');
}
export function calculateNextVersion(version, changes) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (!match) throw new Error('Expected a stable SemVer version.');
  const [major, minor, patch] = match.slice(1).map(Number);
  const relevant = changes.filter((change) => change.releaseRelevant);
  const breaking = relevant.some((change) => change.breaking);
  if (breaking && major > 0) return `${major + 1}.0.0`;
  if (breaking || relevant.some((change) => change.type === 'feat')) return `${major}.${minor + 1}.0`;
  if (relevant.some((change) => ['fix', 'perf'].includes(change.type))) return `${major}.${minor}.${patch + 1}`;
  return version;
}
export function parseCommit({ sha, message, files }) {
  const [header] = message.split('\n');
  const match = /^(feat|fix|perf|refactor|docs|build|ci|test|chore|revert)(?:\([^)]+\))?(!)?: (.+)$/.exec(header);
  if (!match) return null;
  return {
    sha,
    type: match[1],
    breaking: Boolean(match[2]) || /^BREAKING[ -]CHANGE:/m.test(message),
    description: match[3],
    releaseRelevant: files.some((file) => /^(apps\/cli\/|packages\/core\/)/.test(file)),
  };
}
export function preview({ version, commits }) {
  const seen = new Set();
  const changes = commits.map(parseCommit).filter((change) => {
    if (!change || seen.has(change.sha)) return false;
    seen.add(change.sha);
    return true;
  });
  return { currentVersion: version, proposedVersion: calculateNextVersion(version, changes), changes };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const target = process.argv[2] ?? 'origin/dev';
    const version = JSON.parse(readFileSync('.release-please-manifest.json', 'utf8'))['.'];
    const tag = `v${version}`;
    let baseline;
    try {
      baseline = git('rev-parse', '--verify', `${tag}^{commit}`);
    } catch {
      if (version !== '0.0.1') throw new Error(`Missing release tag ${tag}; cannot determine the release boundary.`);
      baseline = initialBaseline;
    }
    validateBaseline(version, baseline);
    git('merge-base', '--is-ancestor', baseline, target);
    const hashes = git('rev-list', '--reverse', '--first-parent', `${baseline}..${target}`).split('\n').filter(Boolean);
    const commits = hashes.map((sha) => ({
      sha,
      message: git('show', '-s', '--format=%B', sha),
      files: git('diff-tree', '--first-parent', '--root', '--no-commit-id', '--name-only', '-r', '-m', sha)
        .split('\n')
        .filter(Boolean),
    }));
    console.log(JSON.stringify({ baseline, ...preview({ version, commits }) }, null, 2));
  } catch (error) {
    console.error(`Release preview failed: ${error.message}`);
    process.exitCode = 1;
  }
}
