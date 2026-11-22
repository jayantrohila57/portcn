import { chmodSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node24',
  platform: 'node',
  bundle: true,
  noExternal: [/^@portcn\//],
  sourcemap: true,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  onSuccess: async () => {
    chmodSync('dist/index.js', 0o755);
  },
});
