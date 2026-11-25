import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const { mergeStrategyFor, requestMerge } = createRequire(import.meta.url)('./merge-strategy.cjs');

export function mergePullRequest(run, number, pullRequest, options) {
  return requestMerge(run, number, pullRequest, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [numberText, option] = process.argv.slice(2);
    const number = Number(numberText);
    if (!Number.isInteger(number) || number < 1 || (option && option !== '--auto'))
      throw new Error('Usage: merge-pr.mjs <open-pr-number> [--auto]');
    if (option === '--auto' && numberText === undefined)
      throw new Error('Usage: merge-pr.mjs <open-pr-number> [--auto]');

    const run = (command, args) =>
      execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
    const pullRequest = JSON.parse(
      run('gh', [
        'pr',
        'view',
        String(number),
        '--json',
        'number,baseRefName,headRefName,state,mergeable,statusCheckRollup',
      ]),
    );
    const strategy = mergeStrategyFor(pullRequest);
    requestMerge((cmd, argv) => run(cmd, argv), number, pullRequest, { auto: option === '--auto' });
    console.log(`Requested ${strategy === 'merge' ? 'merge-commit' : 'squash'} merge for PR #${number}.`);
  } catch (error) {
    console.error(`Pull request merge stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
