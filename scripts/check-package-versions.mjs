import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const root = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const docs = JSON.parse(readFileSync(new URL('../apps/docs/package.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../.release-please-manifest.json', import.meta.url), 'utf8'));
const semver = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

if (!semver.test(root.version) || !semver.test(docs.version) || !semver.test(manifest['.'])) {
  throw new Error('Root, docs, and release manifest versions must use SemVer.');
}

if (root.version !== docs.version) {
  throw new Error(`Package versions must match: root=${root.version}, docs=${docs.version}.`);
}

const tags = execFileSync('git', ['tag', '--list', 'v[0-9]*', '--sort=-version:refname'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
const latestTagVersion = tags[0]?.slice(1);

if (latestTagVersion && latestTagVersion !== manifest['.']) {
  throw new Error(`Latest release tag v${latestTagVersion} does not match release manifest ${manifest['.']}.`);
}

console.log(`portcn ${root.version} and docs ${docs.version} use valid SemVer.`);
console.log(latestTagVersion ? `Release manifest matches v${latestTagVersion}.` : 'No release tag exists yet.');
