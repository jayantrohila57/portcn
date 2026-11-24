import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { test } from 'node:test';

function runInPty(columns, rows) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'script',
      ['-qec', `stty cols ${columns} rows ${rows}; node apps/cli/dist/index.js list --interactive`, '/dev/null'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Interactive dashboard did not exit after PTY input.'));
    }, 8_000);
    child.stdout.setEncoding('utf8').on('data', (chunk) => (output += chunk));
    child.once('error', reject);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve(output);
    });
    setTimeout(() => child.stdin.write('q'), 200);
  });
}

test('interactive dashboard starts and exits cleanly across terminal sizes', { timeout: 20_000 }, async () => {
  for (const [columns, rows] of [
    [40, 12],
    [80, 24],
    [140, 40],
  ]) {
    const output = await runInPty(columns, rows);
    assert.match(output, /PORTCN/);
    assert.equal(output.includes('\u001b[?25h'), true);
  }
});
