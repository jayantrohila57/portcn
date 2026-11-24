import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cliDirectory = fileURLToPath(new URL('../apps/cli/', import.meta.url));
const cliManifest = JSON.parse(readFileSync(new URL('../apps/cli/package.json', import.meta.url), 'utf8'));
const rootManifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const coreManifest = JSON.parse(readFileSync(new URL('../packages/core/package.json', import.meta.url), 'utf8'));
const releaseManifest = JSON.parse(readFileSync(new URL('../.release-please-manifest.json', import.meta.url), 'utf8'));
const executablePath = new URL('../apps/cli/dist/index.js', import.meta.url);

if (cliManifest.name !== 'portcn' || !cliManifest.bin?.portcn || cliManifest.private) {
  throw new Error('The public CLI package must use the unscoped npm name portcn and declare its executable.');
}
if (
  cliManifest.repository?.url !== 'git+https://github.com/jayantrohila57/portcn.git' ||
  cliManifest.repository?.directory !== 'apps/cli' ||
  cliManifest.homepage !== 'https://github.com/jayantrohila57/portcn#readme' ||
  cliManifest.bugs?.url !== 'https://github.com/jayantrohila57/portcn/issues'
) {
  throw new Error('The public CLI package must identify the Portcn repository and issue tracker.');
}
if (
  rootManifest.name !== '@portcn/workspace' ||
  !rootManifest.private ||
  coreManifest.name !== '@portcn/core' ||
  !coreManifest.private
) {
  throw new Error('The workspace root and @portcn/core must remain private with their reserved package names.');
}
if (cliManifest.version !== rootManifest.version || cliManifest.version !== releaseManifest['.']) {
  throw new Error('CLI, root workspace, and Release Please versions must match.');
}
if (cliManifest.bin.portcn !== './dist/index.js') {
  throw new Error('The portcn executable must point to ./dist/index.js.');
}
if (!existsSync(executablePath)) {
  throw new Error('The built CLI executable is missing. Run pnpm build first.');
}

const executable = readFileSync(executablePath, 'utf8');
if (
  !executable.startsWith('#!/usr/bin/env node') ||
  !existsSync(new URL('../apps/cli/dist/index.js.map', import.meta.url)) ||
  (statSync(executablePath).mode & 0o111) === 0
) {
  throw new Error('The built CLI must be executable and include a Node.js shebang and source map.');
}
if (/(?:from\s*|import\s*\()\s*['"]@portcn\//.test(executable)) {
  throw new Error('The built CLI must bundle private @portcn workspace dependencies.');
}

for (const [argument, expected] of [
  ['', 'Usage: portcn'],
  ['--help', 'p: portcn'],
  ['--version', cliManifest.version],
]) {
  const args = argument ? [argument] : [];
  const stdout = execFileSync(process.execPath, [fileURLToPath(executablePath), ...args], { encoding: 'utf8' });
  if (!stdout.includes(expected))
    throw new Error(`The built CLI did not print the expected ${argument || 'default'} output.`);
}

const packed = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: cliDirectory, encoding: 'utf8' }),
);
const files = new Set(packed[0]?.files?.map(({ path }) => path));
for (const expected of ['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.js.map']) {
  if (!files.has(expected)) throw new Error(`The npm package is missing ${expected}.`);
}
for (const path of files) {
  if (!['package.json', 'README.md', 'LICENSE', 'dist/index.js', 'dist/index.js.map'].includes(path)) {
    throw new Error(`Unexpected file in npm package: ${path}`);
  }
}
if (cliManifest.dependencies?.['@portcn/core']) {
  throw new Error('The private @portcn/core workspace package must not be a published runtime dependency.');
}

console.log(`CLI package ${cliManifest.name}@${cliManifest.version} executes and packs the expected files.`);
