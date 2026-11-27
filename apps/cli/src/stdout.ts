function isBrokenPipeError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'EPIPE'
  );
}

function ignoreBrokenPipeOnStream(stream: NodeJS.WriteStream): void {
  stream.on('error', (error: unknown) => {
    if (isBrokenPipeError(error)) process.exit(0);
  });
}

/** Exit cleanly when a pipe consumer closes early (e.g. `discover snapshot --json | head`). */
export function installBrokenPipeHandling(): void {
  ignoreBrokenPipeOnStream(process.stdout);
  ignoreBrokenPipeOnStream(process.stderr);
}
