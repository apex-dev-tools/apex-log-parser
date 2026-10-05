/**
 * The parsers the harness can run. Each one parses a file's bytes and projects its result, so the
 * harness times and compares them all the same way.
 */

import type { ApexLog } from '../../src/index.js';
import type { Projection } from './project.js';
import { projectLegacy } from './project.js';

export interface Engine {
  readonly name: string;
  /** Timed from the bytes, so an engine that must decode them first pays for it. */
  parse(bytes: Uint8Array): Promise<unknown>;
  project(result: unknown): Projection;
}

const legacy: Engine = {
  name: 'legacy',
  // Every consumer decodes the whole file to a string before it calls parse().
  parse: async (bytes) => {
    const { parse } = await import('../../src/index.js');
    return parse(new TextDecoder().decode(bytes));
  },
  project: (result) => projectLegacy(result as ApexLog),
};

const ENGINES: readonly Engine[] = [legacy];

export function engine(name: string): Engine {
  const found = ENGINES.find((e) => e.name === name);
  if (!found) {
    throw new Error(`Unknown engine '${name}'. Known: ${ENGINES.map((e) => e.name).join(', ')}`);
  }
  return found;
}
