import { defineConfig } from 'tsdown';
import { packageBuild } from './tsdown.config.ts';

// The package's entries as its build bundles them, shared chunk and all, so `pnpm run bench` times
// the code consumers run. Each entry in benchmarks/bundle/ also exports its engine.
export default defineConfig({
  ...packageBuild,
  entry: { node: 'benchmarks/bundle/node.ts', browser: 'benchmarks/bundle/browser.ts' },
  outDir: 'benchmarks/.bundle',
});
