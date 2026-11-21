import { existsSync, readFileSync } from 'node:fs';

const manifestPath = new URL('../apps/cli/package.json', import.meta.url);

if (!existsSync(manifestPath)) {
  console.error(
    'CLI package is not implemented: apps/cli/package.json does not exist. Nothing can be packed or executed.',
  );
  process.exitCode = 1;
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== 'portcn' || !manifest.bin) {
    throw new Error(
      'The CLI package must use the unscoped npm name portcn and define at least one executable bin entry.',
    );
  }
  console.log(`CLI package ${manifest.name} declares executable entry points.`);
}
