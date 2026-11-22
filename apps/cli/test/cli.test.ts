import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isValidPortNumber } from '@portcn/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { createProgram } from '../src/program.js';

const executable = fileURLToPath(new URL('../dist/index.js', import.meta.url));

function run(command: string, args: string[] = []) {
  return spawnSync(command, args, { encoding: 'utf8' });
}

function expectBrandedHelp(stdout: string): void {
  expect(stdout).toContain('p: portcn');
  expect(stdout).toContain('Usage: portcn');
  expect(stdout).toContain("Know what's running.");
}

describe('portcn CLI foundation', () => {
  beforeAll(() => {
    const coreBuild = spawnSync('pnpm', ['--filter', '@portcn/core', 'build'], { encoding: 'utf8' });
    expect(coreBuild.status, coreBuild.stderr).toBe(0);
    const build = spawnSync('pnpm', ['build'], { encoding: 'utf8' });
    expect(build.status, build.stderr).toBe(0);
  });

  it('keeps program creation side-effect-free', () => {
    const program = createProgram();
    expect(program.name()).toBe('portcn');
  });

  it('builds an executable Node.js entry point with a shebang', () => {
    expect(readFileSync(executable, 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
    expect(statSync(executable).mode & 0o111).not.toBe(0);
  });

  it('runs help through direct Node.js execution', () => {
    const result = run(process.execPath, [executable, '--help']);
    expect(result.status).toBe(0);
    expectBrandedHelp(result.stdout);
  });

  it('shows its version through direct Node.js execution', () => {
    const result = run(process.execPath, [executable, '--version']);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('0.0.1');
  });

  it('prints branded output without arguments', () => {
    const result = run(process.execPath, [executable]);
    expect(result.status).toBe(0);
    expectBrandedHelp(result.stdout);
  });

  it('executes through a symlink with help, version, and default arguments', () => {
    const directory = mkdtempSync(join(tmpdir(), 'portcn-symlink-'));
    const symlink = join(directory, 'portcn');

    try {
      symlinkSync(executable, symlink);
      for (const args of [['--help'], ['--version'], []]) {
        const result = run(symlink, args);
        expect(result.status, result.stderr).toBe(0);
        if (args[0] === '--version') expect(result.stdout.trim()).toBe('0.0.1');
        else expectBrandedHelp(result.stdout);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('executes the globally installed binary from a packed npm artifact', () => {
    const directory = mkdtempSync(join(tmpdir(), 'portcn-packed-install-'));

    try {
      const pack = spawnSync('npm', ['pack', '--json', '--pack-destination', directory], {
        cwd: fileURLToPath(new URL('..', import.meta.url)),
        encoding: 'utf8',
      });
      expect(pack.status, pack.stderr).toBe(0);
      const [{ filename }] = JSON.parse(pack.stdout) as Array<{ filename: string }>;
      const artifact = join(directory, filename);
      const prefix = join(directory, 'global');
      const install = run('npm', ['install', '--global', '--prefix', prefix, artifact]);
      expect(install.status, install.stderr).toBe(0);

      const installedExecutable = join(prefix, 'bin', 'portcn');
      for (const args of [[], ['--help'], ['--version']]) {
        const result = run(installedExecutable, args);
        expect(result.status, result.stderr).toBe(0);
        if (args[0] === '--version') expect(result.stdout.trim()).toBe('0.0.1');
        else expectBrandedHelp(result.stdout);
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('prints useful default output without arguments', () => {
    const result = run(process.execPath, [executable]);
    expect(result.status).toBe(0);
    expectBrandedHelp(result.stdout);
  });

  it('imports shared core validation through the workspace package', () => {
    expect(isValidPortNumber(8080)).toBe(true);
    expect(isValidPortNumber(65_536)).toBe(false);
  });
});
