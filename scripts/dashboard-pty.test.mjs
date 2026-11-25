import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { test } from 'node:test';

function runInPty(
  columns,
  rows,
  input = 'q',
  env = {},
  resizeTo = null,
  dashboardCommand = 'node apps/cli/dist/index.js list --interactive',
  inputDelay = 200,
  inputAfterFirstFrame = false,
) {
  return new Promise((resolve, reject) => {
    const command = resizeTo
      ? `stty cols ${columns} rows ${rows}; ${dashboardCommand} & app=$!; sleep 0.05; stty cols ${resizeTo[0]} rows ${resizeTo[1]}; kill -WINCH "$app"; wait "$app"`
      : `stty cols ${columns} rows ${rows}; ${dashboardCommand}`;
    const child = spawn('script', ['-qec', command, '/dev/null'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });
    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error('Interactive dashboard did not exit after PTY input.'));
    }, 18_000);
    let sentInput = false;
    const sendInput = () => {
      if (sentInput) return;
      sentInput = true;
      [...input].forEach((key, index) => {
        setTimeout(() => child.stdin.write(key), index * 80);
      });
    };
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      output += chunk;
      if (inputAfterFirstFrame && output.includes('PORTCN')) sendInput();
    });
    child.once('error', reject);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve({ output, code: child.exitCode });
    });
    if (!inputAfterFirstFrame) {
      [...input].forEach((key, index) => {
        setTimeout(() => child.stdin.write(key), inputDelay + index * 80);
      });
    }
  });
}

function stripAnsi(value) {
  const escChar = String.fromCharCode(27);
  const sequence = new RegExp(`${escChar}\\[[0-?]*[ -/]*[@-~]`, 'g');
  return value.replace(sequence, '').replaceAll('\r', '');
}

test('interactive dashboard starts and exits cleanly across terminal sizes', { timeout: 20_000 }, async () => {
  for (const [columns, rows] of [
    [40, 12],
    [80, 24],
    [140, 40],
  ]) {
    const { output } = await runInPty(columns, rows);
    assert.match(output, /PORTCN/);
    assert.equal(output.includes('\u001b[?25h'), true);
  }
});

test('Linux unified service dashboard opens through the services tab and exits cleanly', {
  timeout: 15_000,
}, async () => {
  const { output, code } = await runInPty(120, 40, '5q', {}, null, 'node apps/cli/dist/index.js', 200, true);
  assert.equal(code, 0);
  assert.match(stripAnsi(output), /DISCOVERED SERVICES/);
  assert.equal(output.includes('\u001b[?25h'), true);
});

test('interactive dashboard restores terminal state on Ctrl+C', { timeout: 10_000 }, async () => {
  const { output, code } = await runInPty(40, 12, '\u0003');
  assert.match(output, /PORTCN/);
  assert.equal(output.includes('\u001b[?25h'), true);
  assert.equal(code, 130);
});

test('interactive dashboard accepts Unicode search input in a narrow PTY', { timeout: 10_000 }, async () => {
  const { output, code } = await runInPty(40, 12, '/界\rq');
  assert.match(output, /PORTCN/);
  assert.equal(output.includes('\u001b[?25h'), true);
  assert.equal(code, 0);
});

test('interactive dashboard honors NO_COLOR and marks selection in monochrome', { timeout: 10_000 }, async () => {
  const { output, code } = await runInPty(40, 12, 'q', { NO_COLOR: '1' });
  assert.equal(code, 0);
  assert.match(output, /> TCP/);
  assert.equal(output.includes('\u001b[1;36m'), false);
});

test('interactive dashboard redraws within the resized viewport', { timeout: 10_000 }, async () => {
  const { output, code } = await runInPty(80, 24, 'q', {}, [40, 12]);
  assert.equal(code, 0);
  const escChar = String.fromCharCode(27);
  const finalFrame = stripAnsi(output.slice(output.lastIndexOf(`${escChar}[2J`))).trim();
  const lines = finalFrame.split('\n');
  assert.ok(lines.length <= 12, `Expected at most 12 lines, got ${lines.length}`);
  assert.ok(Math.max(...lines.map((line) => [...line].length)) <= 40);
});

test('interactive dashboard follows selection with live project details', { timeout: 15_000 }, async () => {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The listener fixture did not bind a TCP port.');
  try {
    const { output, code } = await runInPty(120, 30, `/${address.port}\rq`);
    assert.equal(code, 0);
    const text = stripAnsi(output);
    assert.match(text, new RegExp(`Bind: TCP 127\\.0\\.0\\.1:${address.port}`));
    assert.ok(text.includes(`PID: ${process.pid}`));
    assert.ok(text.includes(`Project root: ${process.cwd()}`));
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve(undefined))));
  }
});
