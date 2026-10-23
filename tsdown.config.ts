import { defineConfig } from 'tsdown';

const shared = {
  dts: false,
  target: 'es2022',
  // tsdown 0.23 defaults ESM output to .mjs; package.json exports ./dist/node.js.
  outExtensions: () => ({ js: '.js' }),
} as const;

// One file per entry, no shared chunk: V8 reads a binding one chunk imports from another slowly.
// Exported for tsdown.bench.config.ts, which may change only the entries and the output folder.
export const packageBuilds = [
  // package.json's `node` condition picks the node build; every other host the browser one.
  { ...shared, entry: { node: 'src/node.ts' }, format: 'esm', clean: true },
  { ...shared, entry: { browser: 'src/browser.ts' }, format: 'esm', clean: false },
] as const;

export default defineConfig([
  ...packageBuilds,
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
