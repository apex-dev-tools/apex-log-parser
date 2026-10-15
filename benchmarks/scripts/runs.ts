// The one way the scripts repeat a measurement and read its median.

import { flag } from '../../scripts/cli.js';
import { liveBytes } from './memory.js';

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return Number.isInteger(middle)
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[Math.floor(middle)] ?? 0);
}

/** `--runs`: a whole number of at least 1. */
export function runsFlag(args: string[], fallback = 5): number {
  const runs = Number(flag(args, '--runs') ?? fallback);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error('--runs must be a whole number of at least 1');
  return runs;
}

// Module-level, so optimised code cannot drop the result before the second reading.
let _held: unknown = null;

/**
 * The median time (ms) of `once`, and the median heap and array buffers its result keeps (bytes),
 * over `runs` calls. A first call compiles the code, so the runs measure neither the compile nor
 * its code.
 */
export async function timedRuns(
  runs: number,
  once: () => unknown,
): Promise<{ ms: number; heapBytes: number }> {
  once();
  const times: number[] = [];
  const heaps: number[] = [];
  for (let run = 0; run < runs; run++) {
    _held = null;
    const before = await liveBytes();
    const start = performance.now();
    _held = once();
    times.push(performance.now() - start);
    heaps.push((await liveBytes()) - before);
  }
  _held = null;
  return { ms: median(times), heapBytes: median(heaps) };
}
