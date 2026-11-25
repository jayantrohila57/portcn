import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { evaluateBranchPolicy } = require('./branch-policy.cjs');
const repository = 'jayantrohila57/portcn';
const user = { login: 'jayantrohila57', type: 'User' };
const bot = { login: 'github-actions[bot]', type: 'Bot' };

function pr({ base, head, title = 'fix(core): correct port validation', actor = user, headRepository = repository }) {
  return {
    base: { ref: base, repo: { full_name: repository } },
    head: { ref: head, repo: { full_name: headRepository } },
    title,
    user: actor,
  };
}

function commit(message, parents = [{}]) {
  return [{ commit: { message }, parents }];
}

const cases = [
  ['push skips branch policy', { eventName: 'push', pullRequest: null }, true, true],
  [
    'valid task PR to dev',
    {
      eventName: 'pull_request',
      pullRequest: pr({ base: 'dev', head: 'fix/port-validation' }),
      commits: commit('fix(core): correct port validation'),
    },
    true,
  ],
  [
    'reject task PR targeting main',
    {
      eventName: 'pull_request',
      pullRequest: pr({ base: 'main', head: 'fix/port-validation' }),
      commits: commit('fix(core): correct port validation'),
    },
    false,
  ],
  [
    'reject invalid task branch',
    {
      eventName: 'pull_request',
      pullRequest: pr({ base: 'dev', head: 'work/port-validation' }),
      commits: commit('fix(core): correct port validation'),
    },
    false,
  ],
  [
    'allow fork task PR to dev',
    {
      eventName: 'pull_request',
      pullRequest: pr({ base: 'dev', head: 'fix/port-validation', headRepository: 'contributor/portcn' }),
      commits: commit('fix(core): correct port validation'),
    },
    true,
  ],
  [
    'reject non Conventional PR title',
    {
      eventName: 'pull_request',
      pullRequest: pr({ base: 'dev', head: 'fix/port-validation', title: 'Fix port validation.' }),
      commits: commit('fix(core): correct port validation'),
    },
    false,
  ],
  [
    'reject non Conventional commit',
    {
      eventName: 'pull_request',
      pullRequest: pr({ base: 'dev', head: 'fix/port-validation' }),
      commits: commit('Fix port validation.'),
    },
    false,
  ],
  [
    'valid dev promotion',
    {
      eventName: 'pull_request',
      pullRequest: pr({ base: 'main', head: 'dev', title: 'chore(main): promote validated changes' }),
      commits: commit('fix(core): correct port validation'),
    },
    true,
  ],
  [
    'valid dev promotion with synchronization merge commit',
    {
      eventName: 'pull_request',
      pullRequest: pr({ base: 'main', head: 'dev', title: 'chore(main): promote validated changes' }),
      commits: [
        ...commit('Merge pull request #73 from jayantrohila57/main-to-dev-sync', [{}, {}]),
        ...commit('fix(core): correct port validation'),
      ],
    },
    true,
  ],
  [
    'valid main to dev synchronization',
    {
      eventName: 'pull_request',
      pullRequest: pr({ base: 'dev', head: 'main-to-dev-sync', title: 'chore(main): sync main into dev' }),
      commits: commit('fix(ci): correct workflow policy'),
    },
    true,
  ],
  [
    'valid Release Please PR',
    {
      eventName: 'pull_request',
      pullRequest: pr({
        base: 'main',
        head: 'release-please--branches--main--components--portcn',
        title: 'chore(main): release 0.0.2',
        actor: bot,
      }),
      commits: commit('chore(main): release 0.0.2'),
    },
    true,
  ],
  [
    'valid Release Please PR with reviewed release notes commit',
    {
      eventName: 'pull_request',
      pullRequest: pr({
        base: 'main',
        head: 'release-please--branches--main--components--portcn',
        title: 'chore(main): release 0.0.2',
        actor: bot,
      }),
      commits: [...commit('chore(main): release 0.0.2'), ...commit('docs(release): review canonical release notes')],
    },
    true,
  ],
  [
    'reject non Conventional release review commit',
    {
      eventName: 'pull_request',
      pullRequest: pr({
        base: 'main',
        head: 'release-please--branches--main--components--portcn',
        title: 'chore(main): release 0.0.2',
        actor: bot,
      }),
      commits: [...commit('chore(main): release 0.0.2'), ...commit('Update release notes')],
    },
    false,
  ],
  [
    'reject wrong release bot identity',
    {
      eventName: 'pull_request',
      pullRequest: pr({
        base: 'main',
        head: 'release-please--branches--main--components--portcn',
        title: 'chore(main): release 0.0.2',
        actor: { login: 'release-please[bot]', type: 'Bot' },
      }),
      commits: commit('chore(main): release 0.0.2'),
    },
    false,
  ],
  [
    'reject wrong release source',
    {
      eventName: 'pull_request',
      pullRequest: pr({
        base: 'main',
        head: 'release-please--branches--main--components--other',
        title: 'chore(main): release 0.0.2',
        actor: bot,
      }),
      commits: commit('chore(main): release 0.0.2'),
    },
    false,
  ],
  [
    'reject malformed release commit',
    {
      eventName: 'pull_request',
      pullRequest: pr({
        base: 'main',
        head: 'release-please--branches--main--components--portcn',
        title: 'chore(main): release 0.0.2',
        actor: bot,
      }),
      commits: commit('chore(main): release latest'),
    },
    false,
  ],
];

for (const [name, input, expected, skipped] of cases) {
  const result = evaluateBranchPolicy(input);
  assert.equal(result.allowed, expected, `${name}: ${result.reason}`);
  if (skipped !== undefined) assert.equal(result.skipped, skipped, `${name}: skip state`);
}

const workflow = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
assert.match(workflow, /pull_request:\s*\n\s+types: \[[^\]]+\]\s*\n\s+branches: \[dev, main\]/);
assert.match(workflow, /push:\s*\n\s+branches: \[dev, main\]/);
assert.match(workflow, /if: github\.event_name == 'pull_request'/);

console.log(`Branch policy passed ${cases.length} route and event cases.`);
