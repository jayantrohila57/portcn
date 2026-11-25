import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

export function preparePromotion(run) {
  const git = (...args) => run('git', args);
  const gh = (...args) => run('gh', args);
  git('fetch', 'origin', 'dev', 'main');
  try {
    git('merge-base', '--is-ancestor', 'origin/main', 'origin/dev');
  } catch {
    throw new Error(
      'main and dev have diverged; merge main into dev through the protected main-to-dev-sync PR before preparing promotion.',
    );
  }
  const integrated = new Set(git('rev-list', '--first-parent', 'origin/main..origin/dev').split('\n').filter(Boolean));
  const merged = JSON.parse(
    gh(
      'pr',
      'list',
      '--state',
      'merged',
      '--base',
      'dev',
      '--limit',
      '100',
      '--json',
      'number,headRefName,mergeCommit',
    ),
  );
  const tasks = merged.filter(
    (pr) =>
      /^(feat|fix|refactor|chore|docs|test|build|ci|perf)\//.test(pr.headRefName) &&
      integrated.has(pr.mergeCommit?.oid),
  );
  const open = JSON.parse(
    gh('pr', 'list', '--state', 'open', '--base', 'main', '--head', 'dev', '--limit', '100', '--json', 'number,url'),
  );
  if (open.length > 1) throw new Error('Multiple promotion PRs exist; resolve them before continuing.');
  const changelog = git('show', 'origin/dev:CHANGELOG.md');
  const unreleased = changelog.split('## Unreleased\n')[1]?.split(/\n## /)[0]?.trim();
  const candidate = JSON.parse(run('node', ['scripts/release-preview.mjs', 'origin/dev']));
  if (candidate.proposedVersion === candidate.currentVersion)
    return `Promotion not prepared: ${tasks.length} task PRs are integrated, but none changes shipped CLI or core behavior with a feature, fix, performance improvement, or breaking change.`;
  if (!unreleased) throw new Error('Unreleased changelog is missing or empty.');
  const body = `## Promotion summary\n\nProposed version: ${candidate.proposedVersion} (calculated from Conventional Commits; Release Please remains authoritative).\n\nIntegrated task PRs: ${tasks.map((pr) => `#${pr.number}`).join(', ')}.\n\n## Unreleased\n\n${unreleased}\n\n## Documentation\n\nSee the [release guide](https://github.com/jayantrohila57/portcn/blob/dev/apps/docs/content/docs/releases/index.mdx). Before the Release Please PR is approved, run \`node scripts/generate-release-notes.mjs ${candidate.proposedVersion} ${candidate.currentVersion} "<meaningful release title>"\` in that PR branch, review the categorized dated output, and commit it there so the Release Please candidate receives normal protected CI checks.\n\nDo not merge without explicit authorization. Preserve task commits.\n`;
  if (open.length) {
    gh('pr', 'edit', String(open[0].number), '--body', body);
    return `Updated promotion PR ${open[0].url}.`;
  }
  const url = gh(
    'pr',
    'create',
    '--base',
    'main',
    '--head',
    'dev',
    '--title',
    'chore(main): promote validated changes',
    '--body',
    body,
  );
  return `Prepared promotion PR ${url}; merge requires explicit authorization.`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const run = (command, args) =>
      execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
    console.log(preparePromotion(run));
  } catch (error) {
    console.error(`Promotion preparation stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
