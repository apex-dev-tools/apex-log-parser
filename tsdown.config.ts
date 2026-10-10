import { defineConfig } from 'tsdown';

const shared = {
  dts: false,
  target: 'es2022',
  // tsdown 0.23 defaults ESM output to .mjs; package.json exports ./dist/node.js.
  outExtensions: () => ({ js: '.js' }),
} as const;

export default defineConfig([
  {
    ...shared,
    // package.json's `node` condition picks the node build; every other host the browser one.
    entry: {
      node: 'src/node.ts',
      browser: 'src/browser.ts',
    },
    format: 'esm',
    clean: true,
  },
  // Each worker is one file with no imports, so a caller can start it from a blob: URL.
  {
    ...shared,
    entry: { 'worker-node': 'src/worker/node.ts' },
    format: 'esm',
    clean: false,
  },
  {
    ...shared,
    entry: { 'worker-browser': 'src/worker/browser.ts' },
    // A classic script, as `new Worker(url)` starts one by default.
    format: 'iife',
    clean: false,
    // tsdown names IIFE output `.iife.js`; package.json exports the plain name.
    outputOptions: { entryFileNames: '[name].js' },
  },
]);
