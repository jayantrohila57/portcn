import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function isValidSemver(version) {
  if (typeof version !== 'string') return false;

  const match = version.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );

  return match !== null;
}

function compareSemver(left, right) {
  const parse = (version) => {
    const [, major, minor, patch, prerelease = ''] = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-([^+]+))?(?:\+.*)?$/);
    return { core: [Number(major), Number(minor), Number(patch)], prerelease: prerelease.split('.').filter(Boolean) };
  };
  const a = parse(left);
  const b = parse(right);
  for (let index = 0; index < 3; index += 1) {
    if (a.core[index] !== b.core[index]) return a.core[index] - b.core[index];
  }
  if (!a.prerelease.length || !b.prerelease.length) {
    return a.prerelease.length === b.prerelease.length ? 0 : a.prerelease.length ? -1 : 1;
  }
  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index += 1) {
    const x = a.prerelease[index];
    const y = b.prerelease[index];
    if (x === undefined || y === undefined) return x === y ? 0 : x === undefined ? -1 : 1;
    if (x === y) continue;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) return Number(x) - Number(y);
    if (xn !== yn) return xn ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function nextSemver(current, change, breaking = false) {
  const [major, minor, patch] = current.split('.').map(Number);
  if (breaking) return major === 0 ? `0.${minor + 1}.0` : `${major + 1}.0.0`;
  if (change === 'feat') return major === 0 ? `0.${minor + 1}.0` : `${major}.${minor + 1}.0`;
  if (change === 'fix' || change === 'perf') return `${major}.${minor}.${patch + 1}`;
  return current;
}

for (const [left, right, expected] of [
  ['0.0.1', '0.0.2', -1],
  ['0.0.1', '0.1.0', -1],
  ['0.1.0', '0.0.9', 1],
  ['1.0.0-rc.1', '1.0.0', -1],
]) {
  if (Math.sign(compareSemver(left, right)) !== expected) {
    throw new Error(`SemVer comparison failed for ${left} and ${right}.`);
  }
}

for (const version of ['0.0.1', '1.2.3-alpha.1', '2.0.0+build.5', '3.4.5-rc.2+build.9']) {
  if (!isValidSemver(version)) throw new Error(`SemVer validator rejected valid version ${version}.`);
}

for (const version of ['01.0.0', '1.02.0', '1.2.03', '1.2', '1.2.3-01', '1.2.3+', 'v1.2.3']) {
  if (isValidSemver(version)) throw new Error(`SemVer validator accepted invalid version ${version}.`);
}

for (const [current, change, breaking, expected] of [
  ['0.0.1', 'fix', false, '0.0.2'],
  ['0.0.1', 'feat', false, '0.1.0'],
  ['0.0.1', 'feat', true, '0.1.0'],
  ['0.0.1', 'docs', false, '0.0.1'],
  ['0.0.1', 'chore', false, '0.0.1'],
  ['0.1.0', 'fix', false, '0.1.1'],
  ['0.1.0', 'feat', false, '0.2.0'],
  ['0.1.0', 'fix', true, '0.2.0'],
  ['1.0.0', 'fix', false, '1.0.1'],
  ['1.0.0', 'feat', false, '1.1.0'],
  ['1.0.0', 'fix', true, '2.0.0'],
]) {
  if (nextSemver(current, change, breaking) !== expected) {
    throw new Error(`SemVer bump for ${current} (${change}, breaking=${breaking}) must be ${expected}.`);
  }
}

const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../.release-please-manifest.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../release-please-config.json', import.meta.url), 'utf8'));
const releasePath = '.';
if (manifest['.'] === '0.0.1' && config['bootstrap-sha'] !== '846b45801d808bd728161ccc0e3bf4941c5d6756') {
  throw new Error('Release Please bootstrap boundary must match the proposed 0.0.1 baseline.');
}
const cliManifestPath = new URL('../apps/cli/package.json', import.meta.url);

if (!root.private || root.name !== '@portcn/workspace') {
  throw new Error('The root package must be private and named @portcn/workspace.');
}

if (!isValidSemver(manifest[releasePath])) {
  throw new Error(`Release manifest must contain ${releasePath} with a valid SemVer version.`);
}

if (!config.packages[releasePath]) {
  throw new Error(`Release Please must configure the ${releasePath} release unit.`);
}
if (Object.keys(config.packages).length !== 1) {
  throw new Error('Release Please must configure exactly one portcn release unit.');
}

const cliConfig = config.packages[releasePath];
if (
  cliConfig['release-type'] !== 'node' ||
  cliConfig['package-name'] !== 'portcn' ||
  cliConfig.component !== 'portcn' ||
  JSON.stringify(cliConfig['exclude-paths']) !== JSON.stringify(['apps/docs', '.github', 'docs', 'scripts']) ||
  cliConfig['initial-version'] !== '0.0.1' ||
  config['include-v-in-tag'] !== true ||
  config['include-component-in-tag'] !== false
) {
  throw new Error(
    'Release Please CLI package scope, bootstrap version, name, or v-prefixed tag configuration is invalid.',
  );
}

const changelogSections = new Map(
  config['changelog-sections'].map(({ type, section, hidden }) => [type, { section, hidden }]),
);
for (const [type, section] of [
  ['feat', 'Features'],
  ['fix', 'Fixes'],
  ['perf', 'Performance'],
  ['refactor', 'Improvements'],
  ['docs', 'Documentation'],
]) {
  if (changelogSections.get(type)?.section !== section || changelogSections.get(type)?.hidden !== false) {
    throw new Error(`Release changelog must show ${type} commits under ${section}.`);
  }
}
if (changelogSections.get('chore')?.hidden !== true) {
  throw new Error('Chore commits must stay out of user-facing release notes.');
}
if (
  'paths' in cliConfig ||
  !cliConfig['exclude-paths'].includes('apps/docs') ||
  !cliConfig['exclude-paths'].includes('docs')
) {
  throw new Error('Release Please must use supported exclude-paths for documentation-only changes.');
}
const extraVersionFiles = new Set(cliConfig['extra-files'].map(({ path }) => path));
for (const path of ['package.json', 'apps/cli/package.json']) {
  if (!extraVersionFiles.has(path)) throw new Error(`Release Please must update ${path}.`);
}

if (
  (cliConfig['bump-minor-pre-major'] ?? config['bump-minor-pre-major']) !== true ||
  (cliConfig['bump-patch-for-minor-pre-major'] ?? config['bump-patch-for-minor-pre-major'] ?? false) !== false
) {
  throw new Error('Pre-1.0 releases must use minor bumps for features and breaking changes.');
}

const isBreakingBump = cliConfig['bump-minor-pre-major'] ?? config['bump-minor-pre-major'];
const isFeaturePatchBump =
  (cliConfig['bump-patch-for-minor-pre-major'] ?? config['bump-patch-for-minor-pre-major']) === true;
const expectedBumps = {
  fix: '0.0.2',
  feature: isFeaturePatchBump ? '0.0.2' : '0.1.0',
  breaking: isBreakingBump ? '0.1.0' : '1.0.0',
};
if (JSON.stringify(expectedBumps) !== JSON.stringify({ fix: '0.0.2', feature: '0.1.0', breaking: '0.1.0' })) {
  throw new Error('SemVer behavior at the 0.0.1 bootstrap version is incorrect.');
}

if (existsSync(cliManifestPath)) {
  const cli = JSON.parse(readFileSync(cliManifestPath, 'utf8'));
  if (cli.name !== 'portcn') {
    throw new Error(`The future CLI package must use the unscoped npm name portcn; found ${cli.name}.`);
  }
  if (!isValidSemver(cli.version) || cli.version !== manifest[releasePath]) {
    throw new Error(
      `CLI package version ${cli.version} must be valid SemVer and match manifest ${manifest[releasePath]}.`,
    );
  }
}

const packageMetadata = JSON.parse(readFileSync(cliManifestPath, 'utf8'));
if (packageMetadata.version !== manifest[releasePath] || root.version !== manifest[releasePath]) {
  throw new Error(`CLI package version ${packageMetadata.version} must match manifest ${manifest[releasePath]}.`);
}
if (!isValidSemver(packageMetadata.version)) {
  throw new Error(`CLI package version ${packageMetadata.version} is not valid SemVer.`);
}

const prefixedTags = execFileSync('git', ['tag', '--list', 'portcn-v*'], { encoding: 'utf8' }).trim();
if (prefixedTags) throw new Error(`Component-prefixed release tags are not allowed: ${prefixedTags}`);

const tags = execFileSync('git', ['tag', '--list', 'v[0-9]*', '--sort=-version:refname'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
const latestTagVersion = tags[0]?.slice(1);

if (latestTagVersion && !isValidSemver(latestTagVersion)) {
  throw new Error(`Latest release tag ${tags[0]} is not valid v-prefixed SemVer.`);
}
if (latestTagVersion && compareSemver(latestTagVersion, manifest[releasePath]) > 0) {
  throw new Error(`Latest release tag v${latestTagVersion} is newer than manifest ${manifest[releasePath]}.`);
}

console.log(`Root package ${root.name} is private and synchronized with portcn ${packageMetadata.version}.`);
console.log('Release scope is the single portcn release unit; docs, workflows, and scripts are excluded.');
console.log(
  latestTagVersion
    ? `Latest release tag is v${latestTagVersion}; manifest ${manifest[releasePath]}${latestTagVersion === manifest[releasePath] ? ' matches it' : ' is a valid release candidate'}.`
    : 'No CLI release tag exists yet; initial release version is 0.0.1.',
);
