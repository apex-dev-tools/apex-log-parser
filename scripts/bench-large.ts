// For logs too large for CodSpeed. Compare branches: --json=<path> on one, --baseline=<path> on the other.
//   pnpm run bench:large [--runs=5] [--json=<path>] [--baseline=<path>]

import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { largeLogs, makeLog } from '../src/__bench__/fixtures.js';
import { parse } from '../src/index.js';
import { flag, runIfMain } from './cli.js';

interface LargeResult {
  name: string;
  /** Median parse time, in milliseconds. */
  ms: number;
  /** Heap the parsed tree holds, in bytes. */
  heapBytes: number;
}

/** One line per log, with the change from the baseline when it has the same log. */
export function report(results: LargeResult[], baseline: LargeResult[] = []): string[] {
  const change = (now: number, before: number | undefined) =>
    before
      ? ` (${now >= before ? '+' : ''}${(((now - before) / Math.abs(before)) * 100).toFixed(1)}%)`
      : '';
  return results.map(({ name, ms, heapBytes }) => {
    const before = baseline.find((result) => result.name === name);
    const heap = heapBytes / 1_000_000;
    // A renamed log would otherwise print as if no baseline had been given.
    const missing = baseline.length && !before ? ' (not in baseline)' : '';
    return `${name}: ${ms.toFixed(0)} ms${change(ms, before?.ms)}, heap ${heap.toFixed(0)} MB${change(heapBytes, before?.heapBytes)}${missing}`;
  });
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return Number.isInteger(middle)
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[Math.floor(middle)] ?? 0);
}

// Module-level, so optimised code cannot drop the tree before the second collection.
let _held: unknown = null;

/** Median parse time (ms) and median heap the tree holds after a collection (bytes), over `runs` parses. */
export function measureLog(
  log: string,
  gc: () => void,
  runs: number,
): { ms: number; heapBytes: number } {
  // A first parse compiles the parser, so the runs measure neither the compile nor its code.
  parse(log);
  const times: number[] = [];
  const heaps: number[] = [];
  for (let run = 0; run < runs; run++) {
    _held = null;
    gc();
    const before = process.memoryUsage().heapUsed;
    const start = performance.now();
    _held = parse(log);
    times.push(performance.now() - start);
    gc();
    heaps.push(process.memoryUsage().heapUsed - before);
  }
  _held = null;
  return { ms: median(times), heapBytes: median(heaps) };
}

function main(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error('Run with node --expose-gc, as pnpm run bench:large does');
  const args = argv.slice(2);
  const runs = Number(flag(args, '--runs') ?? 5);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error('--runs must be a whole number of at least 1');
  const json = flag(args, '--json');
  const baselinePath = flag(args, '--baseline');

  const results = Object.entries(largeLogs).map(
    ([name, options]): LargeResult => ({ name, ...measureLog(makeLog(options), gc, runs) }),
  );

  const baseline: LargeResult[] = baselinePath
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : [];
  for (const line of report(results, baseline)) console.log(line);
  if (json) writeFileSync(json, `${JSON.stringify(results, null, 2)}\n`);
}

runIfMain(import.meta.url, main);
