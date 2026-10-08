/**
 * The parsers the harness can run. Each one parses a file's bytes and projects its result, so the
 * harness times and compares them all the same way.
 */

import type { ApexLog } from '../../../src/index.js';
import type { Built } from '../../../src/next/engine/builder.js';
import { legacyFacts, nextFacts } from './facts.js';
import type { KnownDifference } from './known.js';
import { KNOWN } from './known.js';
import type { Projection } from './project.js';
import { projectLegacy } from './project.js';

export interface Engine {
  readonly name: string;
  /** Timed from the bytes, so an engine that must decode them first pays for it. */
  parse(bytes: Uint8Array): Promise<unknown>;
  /** Every field the result holds. Compares two runs of one engine. */
  project(result: unknown): Projection;
  /** The facts in `facts.ts`. Compares two engines. */
  facts(result: unknown): Projection;
  /** The facts it states differently from legacy on purpose. */
  readonly known?: readonly KnownDifference[];
}

const legacy: Engine = {
  name: 'legacy',
  // Every consumer decodes the whole file to a string before it calls parse().
  parse: async (bytes) => {
    const { parse } = await import('../../../src/index.js');
    return parse(new TextDecoder().decode(bytes));
  },
  project: (result) => projectLegacy(result as ApexLog),
  facts: (result) => legacyFacts(result as ApexLog),
};

// The engine and store only, until the views and the async driver exist (steps 5 and 6).
const next: Engine = {
  name: 'next',
  parse: async (bytes) => {
    const [{ NodeSource }, { LogBuilder }] = await Promise.all([
      import('../../../src/next/bytes/node.js'),
      import('../../../src/next/engine/builder.js'),
    ]);
    return new LogBuilder(new NodeSource(bytes)).build();
  },
  // Until the views exist, the facts are its whole projection.
  project: (result) => nextFacts(result as Built),
  facts: (result) => nextFacts(result as Built),
  known: KNOWN,
};

const ENGINES: readonly Engine[] = [legacy, next];

export function engine(name: string): Engine {
  const found = ENGINES.find((e) => e.name === name);
  if (!found) {
    throw new Error(`Unknown engine '${name}'. Known: ${ENGINES.map((e) => e.name).join(', ')}`);
  }
  return found;
}
