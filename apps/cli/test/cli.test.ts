import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isValidPortNumber } from '@portcn/core';
import { beforeAll, describe, expect, it } from 'vitest';

describe('portcn CLI foundation', () => {
  beforeAll(() => {
    const coreBuild = spawnSync('pnpm', ['--filter', '@portcn/core', 'build'], { encoding: 'utf8' });
    expect(coreBuild.status, coreBuild.stderr).toBe(0);
    const build = spawnSync('pnpm', ['build'], { encoding: 'utf8' });
    expect(build.status, build.stderr).toBe(0);
  });

  it('shows branded help', () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../dist/index.js', import.meta.url)), '--help'],
      { encoding: 'utf8' },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('p: portcn');
    expect(result.stdout).toContain('Usage: portcn');
    expect(result.stdout).toContain("Know what's running.");
  });

  it('shows its version', () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../dist/index.js', import.meta.url)), '--version'],
      {
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('executes and prints help', () => {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../dist/index.js', import.meta.url)), '--help'],
      {
        encoding: 'utf8',
      },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Usage: portcn');
  });

  it('imports shared core validation through the workspace package', () => {
    expect(isValidPortNumber(8080)).toBe(true);
    expect(isValidPortNumber(65_536)).toBe(false);
  });
});
