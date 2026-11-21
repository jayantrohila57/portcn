import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function isValidSemver(version) {
  if (typeof version !== 'string') return false;

  const match = version.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/,
  );

  return match !== null;
}

for (const version of ['0.0.1', '1.2.3-alpha.1', '2.0.0+build.5', '3.4.5-rc.2+build.9']) {
  if (!isValidSemver(version)) throw new Error(`SemVer validator rejected valid version ${version}.`);
}

for (const version of ['01.0.0', '1.02.0', '1.2.03', '1.2', '1.2.3-01', '1.2.3+', 'v1.2.3']) {
  if (isValidSemver(version)) throw new Error(`SemVer validator accepted invalid version ${version}.`);
}

const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const docs = JSON.parse(readFileSync(new URL('../apps/docs/package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../.release-please-manifest.json', import.meta.url), 'utf8'));
const config = JSON.parse(readFileSync(new URL('../release-please-config.json', import.meta.url), 'utf8'));
const cliPath = 'apps/cli';
const cliManifestPath = new URL('../apps/cli/package.json', import.meta.url);

if (!root.private || root.name !== '@portcn/monorepo') {
  throw new Error('The root package must be private and named @portcn/monorepo.');
}

if (!isValidSemver(docs.version)) {
  throw new Error(`Documentation version ${docs.version} is not valid SemVer.`);
}

if (Object.keys(manifest).length !== 1 || !isValidSemver(manifest[cliPath])) {
  throw new Error(`Release manifest must contain only ${cliPath} with a valid SemVer version.`);
}

if (Object.keys(config.packages).length !== 1 || !config.packages[cliPath]) {
  throw new Error(`Release Please must release only the ${cliPath} package.`);
}

const cliConfig = config.packages[cliPath];
if (
  cliConfig['release-type'] !== 'node' ||
  cliConfig['package-name'] !== 'portcn' ||
  cliConfig.component !== 'portcn' ||
  cliConfig['initial-version'] !== '0.0.1' ||
  config['include-v-in-tag'] !== true ||
  config['include-component-in-tag'] !== false
) {
  throw new Error(
    'Release Please CLI package scope, bootstrap version, name, or v-prefixed tag configuration is invalid.',
  );
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
  if (!isValidSemver(cli.version) || cli.version !== manifest[cliPath]) {
    throw new Error(`CLI package version ${cli.version} must be valid SemVer and match manifest ${manifest[cliPath]}.`);
  }
}

const tags = execFileSync('git', ['tag', '--list', 'v[0-9]*', '--sort=-version:refname'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
const latestTagVersion = tags[0]?.slice(1);

if (latestTagVersion && latestTagVersion !== manifest[cliPath]) {
  throw new Error(`Latest release tag v${latestTagVersion} does not match release manifest ${manifest[cliPath]}.`);
}

console.log(`Root package ${root.name} is private; docs ${docs.version} uses valid SemVer.`);
console.log(`Release scope is ${cliPath}, reserved for the unscoped npm package portcn.`);
console.log(latestTagVersion ? `Release manifest matches v${latestTagVersion}.` : 'No CLI release tag exists yet.');
