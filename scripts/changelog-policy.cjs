const headings = {
  feat: 'Features',
  fix: 'Fixes',
  perf: 'Performance',
  refactor: 'Improvements',
  docs: 'Documentation',
  ci: 'CI',
  build: 'Build system',
  test: 'Tests',
  chore: 'Maintenance',
  revert: 'Reverts',
};
function entry(title, branch) {
  const match = /^(feat|fix|perf|refactor|docs|ci|build|test|chore|revert)(?:\([a-z0-9-]+\))?(!)?: (.+)$/.exec(title);
  if (!match || !/^(feat|fix|perf|refactor|docs|ci|build|test|chore)\/[a-z0-9-]+$/.test(branch))
    throw new Error('A Conventional title and task branch are required.');
  return { heading: match[2] ? 'Breaking Changes' : headings[match[1]], line: `- ${match[3]} <!-- task:${branch} -->` };
}
function update(source, title, branch) {
  const { heading, line } = entry(title, branch);
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
function validate(base, head, title, branch) {
  try {
    const expected = update(base, title, branch);
    if (expected === base) return { allowed: false, reason: 'Task changelog entry already exists in base.' };
    if (head !== expected)
      return {
        allowed: false,
        reason: 'Changelog must contain the generated task entry and preserve existing content.',
      };
    return { allowed: true };
  } catch (error) {
    return { allowed: false, reason: error.message };
  }
}
module.exports = { entry, update, validate };
