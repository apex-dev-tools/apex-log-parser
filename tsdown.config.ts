import { defineConfig } from 'tsdown';

const shared = {
  dts: false,
  target: 'es2022',
  // tsdown 0.22 defaults ESM output to .mjs; package.json exports ./dist/index.js.
  outExtensions: () => ({ js: '.js' }),
} as const;

export default defineConfig([
  {
    ...shared,
    // package.json's `node` condition picks the next parser's node build; every other host the browser one.
    entry: {
      index: 'src/index.ts',
      'next/node': 'src/next/node.ts',
      'next/browser': 'src/next/browser.ts',
    },
    format: 'esm',
    clean: true,
  },
  // Each worker is one file with no imports, so a caller can start it from a blob: URL.
  {
    ...shared,
    entry: { 'next/worker-node': 'src/next/worker/node.ts' },
    format: 'esm',
    clean: false,
  },
  {
    ...shared,
    entry: { 'next/worker-browser': 'src/next/worker/browser.ts' },
    // A classic script, as `new Worker(url)` starts one by default.
    format: 'iife',
    clean: false,
    // tsdown names IIFE output `.iife.js`; package.json exports the plain name.
    outputOptions: { entryFileNames: '[name].js' },
  },
]);
