import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  dts: false,
  clean: true,
  target: 'es2022',
  // tsdown 0.22 defaults ESM output to .mjs; package.json exports ./dist/index.js.
  outExtensions: () => ({ js: '.js' }),
});
