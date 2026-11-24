import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';

test('interactive dashboard starts and exits cleanly across terminal sizes', { timeout: 20_000 }, () => {
  for (const [columns, rows] of [
    [40, 12],
    [80, 24],
    [140, 40],
  ]) {
    const output = execFileSync(
      'sh',
      [
        '-c',
        `(sleep 0.2; printf q) | script -qec "stty cols ${columns} rows ${rows}; node apps/cli/dist/index.js list --interactive" /dev/null`,
      ],
      { encoding: 'utf8', timeout: 8_000 },
    );
    assert.match(output, /PORTCN/);
    assert.equal(output.includes('\u001b[?25h'), true);
  }
});
