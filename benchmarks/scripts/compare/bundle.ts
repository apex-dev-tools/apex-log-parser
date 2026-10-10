/**
 * Builds each engine's entry as the package ships: tsdown, ES2022, one ESM file per engine. The
 * harness times these bundles, not the tsx-compiled source.
 */

import { fileURLToPath } from 'node:url';
import { build } from 'tsdown';
import { engine } from './engines.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** Writes `<outDir>/<name>.mjs` for each engine. */
export async function bundleEngines(names: readonly string[], outDir: string): Promise<void> {
  await build({
    config: false,
    cwd: ROOT,
    entry: Object.fromEntries(names.map((name) => [name, engine(name).entry])),
    outDir,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    dts: false,
    clean: true,
    fixedExtension: true,
    logLevel: 'silent',
  });
}
