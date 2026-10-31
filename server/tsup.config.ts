import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  clean: true,
  // Bundle the shared workspace package (it ships TypeScript source).
  noExternal: ['@support-box/shared'],
});
