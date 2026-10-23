import { defineConfig } from 'tsdown';
import { packageBuild } from './tsdown.config.ts';

// The package's entries as its build bundles them, shared chunk and all, so `pnpm run bench` times
// the code consumers run. benchmarks/bundle/node.ts also exports the node engine.
export default defineConfig({
  ...packageBuild,
  entry: { node: 'benchmarks/bundle/node.ts', browser: 'src/browser.ts' },
  outDir: 'benchmarks/.bundle',
});
