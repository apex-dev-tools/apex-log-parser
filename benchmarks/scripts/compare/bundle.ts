/**
 * Builds each engine's entry as the package ships: tsdown, ES2022, one ESM file per engine. The
 * harness times these bundles, not the tsx-compiled source.
 */

import { build } from 'tsdown';
import { packageBuilds } from '../../../tsdown.config.js';
import { engine, ROOT } from './engines.js';

/** Writes `<outDir>/<name>.mjs` for each engine. */
export async function bundleEngines(names: readonly string[], outDir: string): Promise<void> {
  const [node] = packageBuilds;
  await build({
    ...node,
    config: false,
    cwd: ROOT,
    entry: Object.fromEntries(names.map((name) => [name, engine(name).entry])),
    outDir,
    // `outDir` can be outside the package, where Node reads a `.js` file as CommonJS.
    outExtensions: () => ({ js: '.mjs' }),
    logLevel: 'silent',
  });
}
