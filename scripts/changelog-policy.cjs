const categories = ['Added', 'Changed', 'Fixed', 'Deprecated', 'Removed', 'Security'];
const commitCategory = { feat: 'Added', fix: 'Fixed', perf: 'Changed', refactor: 'Changed', revert: 'Changed' };
const issueUrl = (number) => `https://github.com/jayantrohila57/portcn/issues/${number}`;

function parseCategories(content) {
  const result = [];
  const headings = [...content.matchAll(/^### (.+)$/gm)];
  for (let index = 0; index < headings.length; index += 1) {
    const name = headings[index][1].trim();
    if (!categories.includes(name)) continue;
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? content.length;
    const entries = content
      .slice(start, end)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    result.push({ name, entries });
  }
  return result;
}

function parseChangelog(source) {
  const headings = [...source.matchAll(/^## (.+)$/gm)];
  const releases = [];
  let unreleased = null;
  let previousVersion = null;
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index][1].trim();
    const start = headings[index].index + headings[index][0].length;
    const end = headings[index + 1]?.index ?? source.length;
    const content = source.slice(start, end).trim();
    if (heading === 'Unreleased') {
      unreleased = { content, categories: parseCategories(content) };
      continue;
    }
    const match = /^\[(\d+\.\d+\.\d+)\] - (\d{4}-\d{2}-\d{2})$/.exec(heading);
    if (!match) continue;
    const [, version, date] = match;
    if (previousVersion && compareVersions(previousVersion, version) <= 0)
      throw new Error('Published changelog releases must be listed in descending semantic-version order.');
    previousVersion = version;
    releases.push({
      version,
      date,
      anchor: `v${version.replaceAll('.', '-')}`,
      title: /^\*\*Title:\*\* (.+)$/m.exec(content)?.[1] ?? null,
      demo: /^\*\*Terminal demo:\*\* (.+)$/m.exec(content)?.[1] ?? null,
      content,
      categories: parseCategories(content),
    });
  }
  return { releases, unreleased };
}

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function entry(title, branch, issue) {
  const match = /^(feat|fix|perf|refactor|docs|ci|build|test|chore|revert)(?:\([^)]+\))?(!)?: (.+)$/.exec(title);
  if (!match || !/^(feat|fix|refactor|chore|docs|test|build|ci|perf)\/[a-z0-9][a-z0-9-]*$/.test(branch))
    throw new Error('A Conventional title and task branch are required.');
  const heading = match[2] ? 'Changed' : commitCategory[match[1]];
  if (!heading) throw new Error('This change type does not produce a user-facing changelog entry.');
  const cleaned = match[3].replace(/[.!]$/, '');
  const ref = Number.isInteger(Number(issue)) && Number(issue) > 0 ? ` ([#${issue}](${issueUrl(issue)}))` : '';
  return { heading, line: `- ${cleaned}${ref} <!-- task:${branch} -->` };
}

function update(source, title, branch, issue) {
  const { heading, line } = entry(title, branch, issue);
  if (!source.includes('## Unreleased\n')) throw new Error('Missing Unreleased section.');
  const marker = `<!-- task:${branch} -->`;
  const occurrences = source.split(marker).length - 1;
  if (occurrences > 1) throw new Error('Duplicate changelog task marker.');
  if (occurrences === 1) {
    const previous = source.split('\n').find((row) => row.includes(marker));
    if (previous !== line) throw new Error('Existing changelog entry differs; reconcile it before retrying.');
    return source;
  }
  const start = source.indexOf('## Unreleased\n');
  const end = source.indexOf('\n## ', start + 1);
  const prefix = source.slice(0, start);
  let section = source.slice(start, end < 0 ? undefined : end);
  const suffix = end < 0 ? '' : source.slice(end);
  const header = `### ${heading}\n`;
  if (section.includes(header)) section = section.replace(header, `${header}\n${line}\n`);
  else section = `${section.trimEnd()}\n\n${header}\n${line}\n`;
  return `${prefix}${section}${suffix}`;
}

function validate(base, head, title, branch, issue) {
  try {
    const expected = update(base, title, branch, issue);
    if (expected === base) return { allowed: false, reason: 'Task changelog entry already exists in base.' };
    if (
      head !== expected &&
      !isCanonicalHistoryMigration(base, head, expected, branch) &&
      !isReleaseCandidateMigration(base, head, expected)
    )
      return {
        allowed: false,
        reason: 'Changelog must contain the generated task entry and preserve existing content.',
      };
    return { allowed: true };
  } catch (error) {
    return { allowed: false, reason: error.message };
  }
}

function isCanonicalHistoryMigration(base, head, expected, branch) {
  if (!/^# Changelog\n/m.test(base) || !/^# Changelog\n\nAll notable changes/m.test(head)) return false;
  const legacyVersions = [...base.matchAll(/^## \[(\d+\.\d+\.\d+)\]\(/gm)].map((match) => match[1]);
  const parsed = parseChangelog(head);
  if (legacyVersions.some((version) => !parsed.releases.some((release) => release.version === version))) return false;
  const expectedTask = expected.split('\n').find((line) => line.includes(`<!-- task:${branch} -->`));
  if (!expectedTask || !head.includes(expectedTask)) return false;
  return true;
}

function isReleaseCandidateMigration(base, head, expected) {
  if (
    !base.includes('## Proposed 0.0.1 baseline (not released)') ||
    !head.includes('## Proposed 0.0.1 release candidate (not released)')
  )
    return false;
  const migrated = expected
    .replace('## Proposed 0.0.1 baseline (not released)', '## Proposed 0.0.1 release candidate (not released)')
    .replace(
      /The proposed baseline is commit `[^`]+` on `main`\. It has not been tagged or published\./,
      'The corrected release candidate is commit `d495d5b0ce3b0e9fd5f9b4df4aec0f9ab7d204ee` on `dev`. It includes symlink-safe CLI execution and has not been tagged or published.',
    );
  return migrated.trimEnd() === head.trimEnd();
}

function validateRelease(source, version) {
  const { releases } = parseChangelog(source);
  const release = releases.find((item) => item.version === version);
  if (!release) return { allowed: false, reason: `Missing release changelog section for ${version}.` };
  if (!release.title?.trim()) return { allowed: false, reason: `Release ${version} is missing its title.` };
  if (!release.categories.length) return { allowed: false, reason: `Release ${version} has no categorized changes.` };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(release.date) || Number.isNaN(Date.parse(`${release.date}T00:00:00Z`)))
    return { allowed: false, reason: `Release ${version} has an invalid IST date.` };
  if (
    !new RegExp(
      `^\\[${version.replaceAll('.', '\\.')}\\]: https://github\\.com/jayantrohila57/portcn/(?:compare|releases/tag)/`,
      'm',
    ).test(source)
  )
    return { allowed: false, reason: `Release ${version} is missing its version link.` };
  const linkDefinition = source.split('\n').find((line) => line.startsWith(`[${version}]: `));
  if (linkDefinition.includes('/compare/')) {
    const match = /\/compare\/v(\d+\.\d+\.\d+)\.\.\.v(\d+\.\d+\.\d+)$/.exec(linkDefinition);
    const previousRelease = releases[releases.findIndex((item) => item.version === version) + 1];
    if (!match || match[2] !== version || previousRelease?.version !== match[1])
      return { allowed: false, reason: `Release ${version} has an invalid version comparison link.` };
  }
  return { allowed: true };
}

function reconcileRelease(source, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version.');
  const headings = [...source.matchAll(/^## (.+)$/gm)];
  const releaseIndex = headings.findIndex((match) =>
    new RegExp(`^\\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`).test(match[1].trim()),
  );
  if (releaseIndex < 0) throw new Error('Matching release section is missing.');
  const release = parseChangelog(source).releases.find((item) => item.version === version);
  if (!release) throw new Error('Matching release section is malformed.');
  const unreleasedIndex = headings.findIndex((match) => match[1].trim() === 'Unreleased');
  if (unreleasedIndex < 0) throw new Error('Unreleased section is missing.');
  const unreleasedStart = headings[unreleasedIndex].index;
  const unreleasedEnd = headings[unreleasedIndex + 1]?.index ?? source.length;
  const section = source.slice(unreleasedStart, unreleasedEnd);
  const contentLines = section
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean);
  if (
    contentLines.some(
      (line) => !/^### (Added|Changed|Fixed|Deprecated|Removed|Security)$/.test(line) && !/^- /.test(line),
    )
  )
    throw new Error('Unreleased section contains content that cannot be safely reconciled.');
  const canonicalItems = new Set(
    release.categories.flatMap(({ entries }) => entries.map((item) => normalizeItem(item))),
  );
  const oldItems = parseChangelog(source)
    .releases.filter((item) => item.version !== version)
    .flatMap((item) => item.categories.flatMap(({ entries }) => entries.map(normalizeItem)));
  for (const raw of contentLines.filter((line) => line.startsWith('- '))) {
    const normalized = normalizeItem(raw);
    if (!canonicalItems.has(normalized) && !oldItems.includes(normalized))
      throw new Error(`Release notes do not contain pending entry: ${raw.slice(2)}`);
  }
  if (version === '0.1.0' && source.includes('## Proposed 0.0.1 release candidate (not released)')) {
    const end = headings[releaseIndex + 1]?.index ?? source.length;
    const from = headings.findIndex((match) => match[1].trim() === 'Unreleased');
    const after = headings.findIndex(
      (match, index) => index > from && match[1].trim() === 'Proposed 0.0.1 release candidate (not released)',
    );
    if (after >= 0)
      return `${source.slice(0, headings[after].index).replace(/\n+$/, '\n')}${source.slice(headings[after].index).replace(/^## Proposed 0\.0\.1 release candidate \(not released\)[\s\S]*?(?=^## |\s*$)/m, '')}`;
    return `${source.slice(0, end)}${source.slice(end)}`;
  }
  return `${source.slice(0, unreleasedStart)}## Unreleased\n\n${source.slice(unreleasedEnd).replace(/^\n*/, '')}`;
}

function releaseBlock(source, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version.');
  const headings = [...source.matchAll(/^## (.+)$/gm)];
  const index = headings.findIndex((match) =>
    new RegExp(`^\\[${version.replaceAll('.', '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}$`).test(match[1].trim()),
  );
  if (index < 0) throw new Error(`Release ${version} is missing from CHANGELOG.md.`);
  const start = headings[index].index;
  const end = headings[index + 1]?.index ?? source.length;
  return source.slice(start, end).trim();
}

function normalizeItem(line) {
  return line
    .replace(/<!-- task:[^>]+ -->/g, '')
    .replace(/\s*\(\[#(\d+)\]\([^)]+\)\)/g, ' #$1')
    .replace(/^[-*]\s+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

module.exports = {
  categories,
  parseChangelog,
  parseCategories,
  entry,
  update,
  validate,
  validateRelease,
  reconcileRelease,
  releaseBlock,
};
