import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
const { parseChangelog } = require('./changelog-policy.cjs');
const repo = 'https://github.com/jayantrohila57/portcn';
const order = ['Added', 'Changed', 'Fixed', 'Deprecated', 'Removed', 'Security'];
const userTypes = new Set(['feat', 'fix', 'perf']);

export function dateInIst(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function summarize(subject) {
  const match = /^(feat|fix|perf|refactor)(?:\([^)]+\))?(!)?: (.+)$/.exec(subject);
  if (!match) return null;
  const text = match[3].replace(/\s*\(#\d+\)$/, '').replace(/[.!]$/, '');
  const normalized = text.charAt(0).toLowerCase() + text.slice(1);
  const prefix = match[2] ? 'Changed' : match[1] === 'feat' ? 'Added' : match[1] === 'fix' ? 'Fixed' : 'Changed';
  return { category: prefix, summary: normalized, type: match[1], breaking: Boolean(match[2]) };
}

function relatedRefs(commit) {
  const pr = /\(#(\d+)\)$/.exec(commit.subject)?.[1];
  const issueMatches = [...commit.message.matchAll(/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi)].map(
    (match) => match[1],
  );
  const issue = issueMatches[0];
  const refs = [];
  if (pr) refs.push(`[#${pr}](${repo}/pull/${pr})`);
  if (issue && issue !== pr) refs.push(`[#${issue}](${repo}/issues/${issue})`);
  return refs.length ? ` (${refs.join(', ')})` : '';
}

function normalizedSummary(entry) {
  return entry
    .replace(/^-\s+/, '')
    .replace(/\s*<!-- task:[^>]+ -->$/, '')
    .replace(/\s+\((?:\[#\d+\]\([^)]+\)(?:,\s*)?)+\)$/, '')
    .trim()
    .toLocaleLowerCase();
}

export function renderRelease({ source, version, previousVersion, title, commits, date = dateInIst() }) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version.');
  if (typeof title !== 'string' || !title.trim()) throw new Error('A meaningful release title is required.');
  const { releases, unreleased } = parseChangelog(source);
  if (!unreleased) throw new Error('Missing Unreleased section.');
  if (releases.length && releases[0].version !== previousVersion)
    throw new Error(`Previous version ${previousVersion} must match the latest published changelog version.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Release date must use YYYY-MM-DD.');
  const groups = new Map(order.map((category) => [category, []]));
  const seen = new Set();
  const authored = parseCategories(unreleased.content);
  const authoredSummaries = new Set(authored.flatMap(({ entries }) => entries.map(normalizedSummary)));
  const summaries = new Set();
  for (const commit of commits) {
    if (seen.has(commit.sha)) continue;
    seen.add(commit.sha);
    const item = summarize(commit.subject);
    if (!item) continue;
    if (!userTypes.has(item.type) && !item.breaking) continue;
    const summary = item.breaking ? { ...item, category: 'Changed' } : item;
    const markdown = `- ${summary.summary}${relatedRefs(commit)}`;
    const key = normalizedSummary(markdown);
    if (authoredSummaries.has(key) || summaries.has(key)) continue;
    summaries.add(key);
    groups.get(summary.category).push(markdown);
  }
  for (const { name, entries } of authored) {
    for (const entry of entries) {
      const key = normalizedSummary(entry);
      if (summaries.has(key)) continue;
      summaries.add(key);
      if (!groups.get(name).includes(entry)) groups.get(name).push(entry);
    }
  }
  const sections = order
    .filter((name) => groups.get(name).length)
    .map((name) => `### ${name}\n\n${groups.get(name).join('\n')}`)
    .join('\n\n');
  if (!sections || !order.some((name) => groups.get(name).length))
    throw new Error('No user-facing release notes were generated.');
  if (releases.some((item) => item.version === version))
    throw new Error(`Release ${version} already exists in CHANGELOG.md.`);
  const from = previousVersion ? `v${previousVersion}` : `v${version}`;
  const header = `## [${version}] - ${date}`;
  const unreleasedStart = source.indexOf('## Unreleased\n');
  const releaseStart = source.indexOf('\n## ', unreleasedStart + 1);
  const oldUnreleased = source.slice(unreleasedStart, releaseStart < 0 ? source.length : releaseStart);
  const suffix = source.slice(releaseStart < 0 ? source.length : releaseStart);
  const clear = oldUnreleased
    .split('\n')
    .filter((line) => /^### (Added|Changed|Fixed|Deprecated|Removed|Security)$/.test(line))
    .join('\n');
  const versionBlock = `${header}\n\n[${version}]: ${repo}/compare/${from}...v${version}\n\n**Title:** ${title.trim()}\n\n${sections}\n`;
  const historical = `${versionBlock}\n${suffix.trimStart()}`;
  return `${source.slice(0, unreleasedStart)}## Unreleased\n\n${clear}\n\n${historical}`.replace(/\n{3,}/g, '\n\n');
}

function parseCategories(content) {
  const headings = [...content.matchAll(/^### (Added|Changed|Fixed|Deprecated|Removed|Security)$/gm)];
  return headings.map((heading, index) => {
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? content.length;
    return {
      name: heading[1],
      entries: content
        .slice(start, end)
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('- ')),
    };
  });
}

export function commitsFromGit({ execFileSync, from, to }) {
  const raw = execFileSync(
    'git',
    ['log', '--first-parent', '--no-merges', '--format=%H%x1f%s%x1f%b', `${from}..${to}`],
    { encoding: 'utf8' },
  );
  return raw
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, subject, ...body] = line.split('\x1f');
      return { sha, subject, message: body.join('\x1f') };
    })
    .reverse();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const version = process.argv[2];
    const previousVersion = process.argv[3];
    const title = process.argv[4];
    if (!version || !previousVersion || !title)
      throw new Error('Usage: generate-release-notes.mjs <version> <previous-version> "<release title>"');
    const execFileSync = (command, args, options) => require('node:child_process').execFileSync(command, args, options);
    const commits = commitsFromGit({ execFileSync, from: `v${previousVersion}`, to: 'HEAD' });
    const path = 'CHANGELOG.md';
    const source = readFileSync(path, 'utf8');
    const result = renderRelease({ source, version, previousVersion, title, commits });
    writeFileSync(path, result);
    console.log(`Generated user-facing release notes for ${version}; review before approval.`);
  } catch (error) {
    console.error(`Release notes stopped: ${error.message}`);
    process.exitCode = 1;
  }
}
