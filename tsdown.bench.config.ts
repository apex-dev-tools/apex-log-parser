import { defineConfig } from 'tsdown';
import { packageBuilds } from './tsdown.config.ts';

// The package's entries as its build bundles them, so `pnpm run bench` times the code consumers
// run. Each entry in benchmarks/bundle/ also exports its engine.
const [node, browser] = packageBuilds;
const outDir = 'benchmarks/.bundle';
export default defineConfig([
  { ...node, entry: { node: 'benchmarks/bundle/node.ts' }, outDir },
  { ...browser, entry: { browser: 'benchmarks/bundle/browser.ts' }, outDir },
]);
