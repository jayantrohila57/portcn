import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('interactive dashboard starts and exits cleanly in a real pseudo-terminal', { timeout: 10_000 }, () => {
  const output = execFileSync(
    'sh',
    [
      '-c',
      '(sleep 0.2; printf q) | script -qec "COLUMNS=80 LINES=24 node apps/cli/dist/index.js list --interactive" /dev/null',
    ],
    { encoding: 'utf8', timeout: 8_000 },
  );
  assert.match(output, /PORTCN/);
  assert.equal(output.includes('\u001b[?25h'), true);
});
