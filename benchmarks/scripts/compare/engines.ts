/**
 * The parsers the harness can run. Each one parses a file's bytes and projects its result, so the
 * harness times and compares them all the same way.
 */

import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Built } from '../../../src/next/engine/builder.js';
import { apexLog } from '../../../src/next/views/log.js';
import { nextFacts, nextProjection } from './facts.js';
import type { Projection } from './project.js';

export interface Engine {
  readonly name: string;
  /** The module `parse` takes, from the repository root. The harness times its bundle. */
  readonly entry: string;
  /** Timed from the bytes, so an engine that must decode them first pays for it. */
  parse(module: unknown, bytes: Uint8Array): unknown;
  /** Every field the result holds. Compares two runs of one engine. */
  project(result: unknown): Projection;
  /** The facts in `facts.ts`. Compares two engines. */
  facts(result: unknown): Projection;
}

// The build only: bench:async times parse()'s slices. The views read it lazily, so they are untimed.
const next: Engine = {
  name: 'next',
  entry: 'src/next/engine/node.ts',
  parse: (module, bytes) =>
    (module as typeof import('../../../src/next/engine/node.js')).nodeEngine.build(bytes),
  project: (result) => nextProjection(apexLog(result as Built)),
  facts: (result) => nextFacts(apexLog(result as Built)),
};

const ENGINES: readonly Engine[] = [next];

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

/** The engine's parse, from its bundle in `bundleDir`, or from its source when that is null. */
export async function loadEngine(
  name: string,
  bundleDir: string | null,
): Promise<(bytes: Uint8Array) => unknown> {
  const subject = engine(name);
  const path = bundleDir ? join(bundleDir, `${name}.mjs`) : join(ROOT, subject.entry);
  const module: unknown = await import(pathToFileURL(path).href);
  return (bytes) => subject.parse(module, bytes);
}

export function engine(name: string): Engine {
  const found = ENGINES.find((e) => e.name === name);
  if (!found) {
    throw new Error(`Unknown engine '${name}'. Known: ${ENGINES.map((e) => e.name).join(', ')}`);
  }
  return found;
}
