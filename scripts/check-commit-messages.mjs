import { execFileSync } from 'node:child_process';

const [base, head] = process.argv.slice(2);
if (!base || !head) throw new Error('Usage: check-commit-messages.mjs <base> <head>');

// These are immutable commits that predate the repository's current 100-column
// body rule. They remain auditable history; every new commit is still checked.
const legacyExceptions = new Set([
  '48df94e8d0f4493bc8faf161ae405f97fb146b34',
  'bbe6d540bdd62df245cd48e1b2402b8fc45cb508',
]);
const commits = execFileSync('git', ['rev-list', '--reverse', `${base}..${head}`], { encoding: 'utf8' })
  .trim()
  .split(/\s+/)
  .filter(Boolean);
const pending = commits.filter((sha) => !legacyExceptions.has(sha));
if (!pending.length) {
  console.log('Commit messages passed (only documented legacy exceptions in range).');
  process.exit(0);
}
for (const sha of pending) {
  execFileSync('pnpm', ['exec', 'commitlint', '--from', `${sha}^`, '--to', sha], { stdio: 'inherit' });
}
console.log(`Commit messages passed (${pending.length} checked).`);
