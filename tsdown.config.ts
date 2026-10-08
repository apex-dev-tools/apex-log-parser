import { defineConfig } from 'tsdown';

export default defineConfig({
  // package.json's `node` condition picks the next parser's node build; every other host the browser one.
  entry: {
    index: 'src/index.ts',
    'next/node': 'src/next/node.ts',
    'next/browser': 'src/next/browser.ts',
  },
  format: 'esm',
  dts: false,
  clean: true,
  target: 'es2022',
  // tsdown 0.22 defaults ESM output to .mjs; package.json exports ./dist/index.js.
  outExtensions: () => ({ js: '.js' }),
});
