/**
 * The parsers the harness can run. Each one parses a file's bytes and projects its result, so the
 * harness times and compares them all the same way.
 */

import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { ApexLog } from '../../../src/index.js';
import type { Built } from '../../../src/next/engine/builder.js';
import { legacyFacts, nextFacts } from './facts.js';
import type { KnownDifference } from './known.js';
import { KNOWN } from './known.js';
import type { Projection } from './project.js';
import { projectLegacy } from './project.js';

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
  /** The facts it states differently from legacy on purpose. */
  readonly known?: readonly KnownDifference[];
}

const legacy: Engine = {
  name: 'legacy',
  entry: 'src/index.ts',
  // Every consumer decodes the whole file to a string before it calls parse().
  parse: (module, bytes) =>
    (module as typeof import('../../../src/index.js')).parse(new TextDecoder().decode(bytes)),
  project: (result) => projectLegacy(result as ApexLog),
  facts: (result) => legacyFacts(result as ApexLog),
};

// The engine and store only, until the views and the async driver exist (steps 5 and 6).
const next: Engine = {
  name: 'next',
  entry: 'src/next/node.ts',
  parse: (module, bytes) =>
    (module as typeof import('../../../src/next/node.js')).nodeEngine.build(bytes),
  // Until the views exist, the facts are its whole projection.
  project: (result) => nextFacts(result as Built),
  facts: (result) => nextFacts(result as Built),
  known: KNOWN,
};

const ENGINES: readonly Engine[] = [legacy, next];

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
