/**
 * Times one engine on one log, in a process of its own, and prints the result as one JSON line.
 * `compare.ts` starts it once per log and engine, so no engine inherits another's heap or JIT state.
 *
 * Usage: node --expose-gc --import tsx benchmarks/scripts/compare/measure.ts --engine=<name> --file=<path> [--runs=5] [--bundle=<dir>]
 */

import { readFileSync } from 'node:fs';
import { argv } from 'node:process';
import { flag, runIfMain } from '../../../scripts/cli.js';
import { liveBytes } from '../memory.js';
import { loadEngine } from './engines.js';

export interface Measurement {
  /** The first parse in a fresh process, in milliseconds. The engine's module is already loaded. */
  coldMs: number;
  /** The steady state: each parse after the warm-up, in milliseconds, in run order. */
  warmRunsMs: number[];
  /** The parses the warm-up took. */
  warmupRuns: number;
  /** Heap plus array buffers the result keeps alive after a GC, in bytes. Excludes the input. */
  retainedBytes: number;
}

// Module scope keeps the result reachable while the GC runs; a local that is never read may not.
const held: { result: unknown } = { result: null };

// Enough parses for V8 to optimise the hot code, without minutes on the largest logs.
const WARMUP_MS = 1000;
const MIN_WARMUP = 2;
const MAX_WARMUP = 20;

// The tree is awaited only here, so no frame that measures the heap holds it in a register.
async function timedParse(
  parse: (bytes: Uint8Array) => unknown,
  bytes: Uint8Array,
): Promise<number> {
  const start = performance.now();
  held.result = await parse(bytes);
  return performance.now() - start;
}

/**
 * The cold parse, a warm-up, then `runs` steady parses; at least one, because the first measures
 * retention. `bundleDir` holds the engine's bundle; null loads its source.
 */
export async function measure(
  engineName: string,
  file: string,
  runs: number,
  bundleDir: string | null = null,
): Promise<Measurement> {
  const parse = await loadEngine(engineName, bundleDir);
  const bytes = readFileSync(file);

  const coldMs = await timedParse(parse, bytes);
  held.result = null;

  let warmupRuns = 0;
  const warmupStart = performance.now();
  while (
    warmupRuns < MIN_WARMUP ||
    (warmupRuns < MAX_WARMUP && performance.now() - warmupStart < WARMUP_MS)
  ) {
    await timedParse(parse, bytes);
    held.result = null;
    warmupRuns++;
  }

  const warmRunsMs: number[] = [];
  let retainedBytes = 0;
  for (let i = 0; i < Math.max(1, runs); i++) {
    const before = await liveBytes();
    warmRunsMs.push(await timedParse(parse, bytes));
    if (i === 0) retainedBytes = Math.max(0, (await liveBytes()) - before);
    held.result = null;
  }
  return { coldMs, warmRunsMs, warmupRuns, retainedBytes };
}

runIfMain(import.meta.url, async () => {
  const args = argv.slice(2);
  const name = flag(args, '--engine');
  const file = flag(args, '--file');
  if (!name || !file) {
    throw new Error('Usage: measure.ts --engine=<name> --file=<path> [--runs=5] [--bundle=<dir>]');
  }
  const runs = Number(flag(args, '--runs') ?? 5);
  console.log(JSON.stringify(await measure(name, file, runs, flag(args, '--bundle'))));
});
