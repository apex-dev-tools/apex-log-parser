/**
 * Times one engine on one log, in a process of its own, and prints the result as one JSON line.
 * `compare.ts` starts it once per log and engine, so no engine inherits another's heap or JIT state.
 *
 * Usage: node --expose-gc --import tsx benchmarks/scripts/compare/measure.ts --engine=<name> --file=<path> [--runs=5]
 */

import { readFileSync } from 'node:fs';
import { argv } from 'node:process';
import { flag, runIfMain } from '../../../scripts/cli.js';
import { liveBytes } from '../memory.js';
import type { Engine } from './engines.js';
import { engine } from './engines.js';

export interface Measurement {
  /** The first parse in a fresh process, in milliseconds. Includes loading the engine's modules. */
  coldMs: number;
  /** Every warm parse, in milliseconds, in run order. */
  warmRunsMs: number[];
  /** Heap plus array buffers the result keeps alive after a GC, in bytes. Excludes the input. */
  retainedBytes: number;
}

// Module scope keeps the result reachable while the GC runs; a local that is never read may not.
const held: { result: unknown } = { result: null };

// The tree is awaited only here, so no frame that measures the heap holds it in a register.
async function timedParse(subject: Engine, bytes: Uint8Array): Promise<number> {
  const start = performance.now();
  held.result = await subject.parse(bytes);
  return performance.now() - start;
}

/** `runs` warm parses after the cold one; at least one, because the first measures retention. */
export async function measure(
  engineName: string,
  file: string,
  runs: number,
): Promise<Measurement> {
  const subject = engine(engineName);
  const bytes = readFileSync(file);

  const coldMs = await timedParse(subject, bytes);
  held.result = null;

  const warmRunsMs: number[] = [];
  let retainedBytes = 0;
  for (let i = 0; i < Math.max(1, runs); i++) {
    const before = await liveBytes();
    warmRunsMs.push(await timedParse(subject, bytes));
    // The engine's modules loaded during the cold parse, so the first warm one leaves them out.
    if (i === 0) retainedBytes = Math.max(0, (await liveBytes()) - before);
    held.result = null;
  }
  return { coldMs, warmRunsMs, retainedBytes };
}

runIfMain(import.meta.url, async () => {
  const args = argv.slice(2);
  const name = flag(args, '--engine');
  const file = flag(args, '--file');
  if (!name || !file) throw new Error('Usage: measure.ts --engine=<name> --file=<path> [--runs=5]');
  console.log(JSON.stringify(await measure(name, file, Number(flag(args, '--runs') ?? 5))));
});
