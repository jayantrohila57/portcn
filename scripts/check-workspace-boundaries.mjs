import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const applications = new Map();
const packages = new Map();
const workspaceNames = new Map();
const errors = [];
const coreForbidden = new Set([
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  'commander',
  'react',
  'react-dom',
  'ink',
  'next',
  '@portcn/linux',
  '@portcn/terminal',
  '@portcn/tui',
]);

function readManifest(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function collectPackages(directory, collection) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = join(root, directory, entry.name, 'package.json');
    try {
      const manifest = readManifest(path);
      collection.set(manifest.name, { directory: join(root, directory, entry.name), manifest });
      workspaceNames.set(manifest.name, directory);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

collectPackages('apps', applications);
collectPackages('packages', packages);

for (const [name, application] of applications) {
  const dependencyNames = Object.keys({
    ...application.manifest.dependencies,
    ...application.manifest.devDependencies,
    ...application.manifest.optionalDependencies,
    ...application.manifest.peerDependencies,
  });
  for (const dependency of dependencyNames) {
    if (applications.has(dependency)) errors.push(`${name} must not depend on application ${dependency}.`);
  }
}

for (const [name, reusablePackage] of packages) {
  const dependencyNames = Object.keys({
    ...reusablePackage.manifest.dependencies,
    ...reusablePackage.manifest.devDependencies,
    ...reusablePackage.manifest.optionalDependencies,
    ...reusablePackage.manifest.peerDependencies,
  });
  for (const dependency of dependencyNames) {
    if (applications.has(dependency)) errors.push(`${name} must not depend on application ${dependency}.`);
  }
}

const core = packages.get('@portcn/core');
if (!core) errors.push('The required @portcn/core package is missing.');
else {
  const forbiddenDependencies = /^(?:commander|react|react-dom|ink|next)(?:\/|$)/;
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const dependency of Object.keys(core.manifest[section] ?? {})) {
      if (forbiddenDependencies.test(dependency)) {
        errors.push(`@portcn/core must not declare ${dependency} in ${section}.`);
      }
    }
  }
  const exportTarget = core.manifest.exports?.['.']?.import;
  if (!exportTarget?.startsWith('./dist/')) {
    errors.push('@portcn/core must expose its built ESM entry through the package exports map.');
  }
}

function scanSource(directory, relativeDirectory = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const absolutePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      scanSource(absolutePath, join(relativeDirectory, entry.name));
      continue;
    }
    if (!/\.(?:[cm]?js|tsx?)$/.test(entry.name)) continue;
    const source = readFileSync(absolutePath, 'utf8');
    for (const match of source.matchAll(/(?:from\s*|import\s*\(|require\s*\()\s*['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      const workspaceName = [...workspaceNames.keys()].find(
        (candidate) => specifier === candidate || specifier.startsWith(`${candidate}/`),
      );
      if (workspaceName && workspaceNames.get(workspaceName) === 'apps') {
        errors.push(`${relative(root, absolutePath)} imports application package ${workspaceName}.`);
      }
      if (
        core &&
        absolutePath.startsWith(core.directory) &&
        [...coreForbidden].some((moduleName) => specifier === moduleName || specifier.startsWith(`${moduleName}/`))
      ) {
        errors.push(`${relative(root, absolutePath)} imports platform or application dependency ${specifier}.`);
      }
    }
  }
}

for (const reusablePackage of packages.values()) scanSource(join(reusablePackage.directory, 'src'));

if (errors.length) {
  throw new Error(`Workspace dependency boundary violations:\n- ${errors.join('\n- ')}`);
}

console.log(`Workspace boundaries are valid (${applications.size} apps, ${packages.size} packages).`);
