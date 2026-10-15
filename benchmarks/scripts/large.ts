// For logs too large for CodSpeed. Compare branches: --json=<path> on one, --baseline=<path> on the other.
//   pnpm run bench:large [--runs=5] [--json=<path>] [--baseline=<path>] [--max-heap-growth=<percent>]
// --baseline matches logs by name. baselines/legacy-v0.3.json is the legacy parser's last run.
// --max-heap-growth fails the run when a log's heap grows past it. Time is not gated: CI runners are noisy.

import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { flag, runIfMain } from '../../scripts/cli.js';
import { nodeEngine } from '../../src/engine/node.js';
import { largeLogs, makeLog } from '../fixtures/fixtures.js';
import { liveBytes } from './memory.js';
import type { Measure } from './versus.js';
import { parts } from './versus.js';

interface LargeResult {
  name: string;
  /** Median parse time, in milliseconds. */
  ms: number;
  /** Heap and array buffers the parse result holds, in bytes. */
  heapBytes: number;
}

/** One line per log, with the change from the baseline when it has the same log. */
export function report(results: LargeResult[], baseline: LargeResult[] = []): string[] {
  const ms = (n: number): string => `${n.toFixed(0)} ms`;
  const mb = (n: number): string => `${(n / 1_000_000).toFixed(0)} MB`;
  const figure = (
    now: number,
    was: number | undefined,
    unit: (n: number) => string,
    measure: Measure,
  ): string => {
    const both = was ? parts(now / was, measure) : null;
    return both && was ? `${unit(now)} (was ${unit(was)}, ${both[0]}, ${both[1]})` : unit(now);
  };
  return results.map((result) => {
    const before = baseline.find((b) => b.name === result.name);
    // A renamed log would otherwise print as if no baseline had been given.
    const missing = baseline.length && !before ? ' (not in baseline)' : '';
    return `${result.name}: ${figure(result.ms, before?.ms, ms, 'time')}, heap ${figure(result.heapBytes, before?.heapBytes, mb, 'memory')}${missing}`;
  });
}

/** The logs whose heap grew by more than `percent` over the baseline's log of the same name. */
export function heapGrowth(
  results: LargeResult[],
  baseline: LargeResult[],
  percent: number,
): string[] {
  return results
    .filter((result) => {
      const before = baseline.find((b) => b.name === result.name);
      return before && result.heapBytes > before.heapBytes * (1 + percent / 100);
    })
    .map((result) => result.name);
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return Number.isInteger(middle)
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[Math.floor(middle)] ?? 0);
}

// Module-level, so optimised code cannot drop the result before the second reading.
let _held: unknown = null;

/**
 * The median parse time (ms), and the median heap and array buffers the result holds (bytes), over
 * `runs` parses of `log`. Its bytes are made before the timing starts, so neither figure counts
 * them. `parse-heap.test.ts` pins the bytes per character.
 */
export async function measureLog(
  log: string,
  runs: number,
): Promise<{ ms: number; heapBytes: number }> {
  const bytes = new TextEncoder().encode(log);
  // A first parse compiles the parser, so the runs measure neither the compile nor its code.
  nodeEngine.build(bytes);
  const times: number[] = [];
  const heaps: number[] = [];
  for (let run = 0; run < runs; run++) {
    _held = null;
    const before = await liveBytes();
    const start = performance.now();
    _held = nodeEngine.build(bytes);
    times.push(performance.now() - start);
    heaps.push((await liveBytes()) - before);
  }
  _held = null;
  return { ms: median(times), heapBytes: median(heaps) };
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const runs = Number(flag(args, '--runs') ?? 5);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error('--runs must be a whole number of at least 1');
  const json = flag(args, '--json');
  const baselinePath = flag(args, '--baseline');
  const maxGrowthFlag = flag(args, '--max-heap-growth');
  const maxGrowth = maxGrowthFlag === null ? null : Number(maxGrowthFlag);
  if (maxGrowth !== null && !(maxGrowth >= 0))
    throw new Error('--max-heap-growth must be a percent of at least 0');
  if (maxGrowth !== null && !baselinePath) throw new Error('--max-heap-growth needs --baseline');

  const results: LargeResult[] = [];
  for (const [name, options] of Object.entries(largeLogs)) {
    results.push({ name, ...(await measureLog(makeLog(options), runs)) });
  }

  const baseline: LargeResult[] = baselinePath
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : [];
  for (const line of report(results, baseline)) console.log(line);
  if (json) writeFileSync(json, `${JSON.stringify(results, null, 2)}\n`);
  if (maxGrowth === null) return;
  const grown = heapGrowth(results, baseline, maxGrowth);
  if (grown.length) throw new Error(`Heap grew more than ${maxGrowth}%: ${grown.join(', ')}`);
}

runIfMain(import.meta.url, main);
