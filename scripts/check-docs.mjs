import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsRoot = path.join(root, 'apps/docs/content/docs');
const cliSource = path.join(root, 'apps/cli/src');
const cliReference = path.join(docsRoot, 'cli-reference/index.mdx');

async function filesIn(directory, extension) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...(await filesIn(fullPath, extension)));
    else if (entry.name.endsWith(extension)) result.push(fullPath);
  }
  return result;
}

function headingIds(source) {
  return new Set(
    source
      .split('\n')
      .filter((line) => /^#{1,6}\s/.test(line))
      .map((line) =>
        line
          .replace(/^#{1,6}\s+/, '')
          .replace(/\s+\[[^\]]+\]$/, '')
          .replace(/`([^`]+)`/g, '$1')
          .toLowerCase()
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .trim()
          .replace(/\s+/g, '-'),
      ),
  );
}

const docs = await filesIn(docsRoot, '.mdx');
const errors = [];
for (const docPath of docs) {
  const source = await readFile(docPath, 'utf8');
  const linkPattern = /\[[^\]]*\]\(([^)]+)\)/g;
  for (const match of source.matchAll(linkPattern)) {
    const target = match[1].split(/[?#]/, 1)[0];
    if (!target || /^(?:[a-z]+:|\/\/)/i.test(target)) continue;
    const decoded = decodeURIComponent(target);
    const resolved = decoded.startsWith('/docs/')
      ? path.join(docsRoot, decoded.slice('/docs/'.length))
      : path.resolve(path.dirname(docPath), decoded);
    const candidates = [resolved, `${resolved}.mdx`, path.join(resolved, 'index.mdx')];
    let existing;
    for (const candidate of candidates) {
      try {
        if ((await stat(candidate)).isFile()) {
          existing = candidate;
          break;
        }
      } catch {}
    }
    if (!existing) {
      errors.push(`${path.relative(root, docPath)}: missing internal link target ${target}`);
      continue;
    }
    const fragment = match[1].split('#')[1]?.split('?')[0];
    if (fragment) {
      const targetSource = await readFile(existing, 'utf8');
      if (!headingIds(targetSource).has(decodeURIComponent(fragment))) {
        errors.push(
          `${path.relative(root, docPath)}: missing heading #${fragment} in ${path.relative(docsRoot, existing)}`,
        );
      }
    }
  }
}

const sourceFiles = await filesIn(cliSource, '.ts');
const registeredCommands = new Set();
const registeredOptions = new Set(['-h', '--help']);
for (const sourcePath of sourceFiles) {
  const source = await readFile(sourcePath, 'utf8');
  for (const match of source.matchAll(/\.command\(\s*['"]([^'" ]+)/g)) registeredCommands.add(match[1]);
  for (const match of source.matchAll(/\.(?:option|requiredOption|version)\([^,]+,?\s*['"]([^'"]+)['"]/g)) {
    for (const option of match[1].split(/[,\s]+/)) {
      if (/^--?[\w-]+$/.test(option)) registeredOptions.add(option);
    }
  }
}
const reference = await readFile(cliReference, 'utf8');
for (const command of registeredCommands) {
  if (!reference.includes(`\`${command}\``)) errors.push(`CLI reference is missing registered command: ${command}`);
}
if (registeredCommands.size === 0 && !/no subcommands/i.test(reference)) {
  errors.push('CLI reference must state that no subcommands are currently registered.');
}
for (const option of registeredOptions) {
  if (!reference.includes(option)) errors.push(`CLI reference is missing registered option: ${option}`);
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Documentation checks passed (${docs.length} MDX pages, ${registeredCommands.size} CLI subcommands, ${registeredOptions.size} options).`,
  );
}
