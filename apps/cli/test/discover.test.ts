import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const executable = fileURLToPath(new URL('../dist/index.js', import.meta.url));

describe('discover snapshot CLI', () => {
  beforeAll(() => {
    const build = spawnSync('pnpm', ['--filter', 'portcn', 'build'], { encoding: 'utf8' });
    expect(build.status, build.stderr).toBe(0);
  });

  it.skipIf(process.platform !== 'linux')(
    'exits cleanly when --json output is truncated by head',
    () => {
      const result = spawnSync(
        'sh',
        ['-c', `${JSON.stringify(process.execPath)} ${JSON.stringify(executable)} list --json | head -c 400`],
        { encoding: 'utf8' },
      );
      expect(result.stderr).not.toContain('EPIPE');
      expect(result.status).toBe(0);
      expect(result.stdout.length).toBeGreaterThan(0);
    },
    30_000,
  );
});
