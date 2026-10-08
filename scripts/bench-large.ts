// For logs too large for CodSpeed. Compare branches: --json=<path> on one, --baseline=<path> on the other.
//   pnpm run bench:large [--engine=legacy|next] [--runs=5] [--json=<path>] [--baseline=<path>]
// --baseline matches logs by name, so one engine's --json is the other's baseline.

import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { largeLogs, makeLog } from '../src/__bench__/fixtures.js';
import { parse } from '../src/index.js';
import { NodeSource } from '../src/next/bytes/node.js';
import { LogBuilder } from '../src/next/engine/builder.js';
import { flag, runIfMain } from './cli.js';
import type { Measure } from './versus.js';
import { parts } from './versus.js';

interface LargeResult {
  name: string;
  /** Median parse time, in milliseconds. */
  ms: number;
  /** Heap and array buffers the parse result holds, in bytes. */
  heapBytes: number;
}

// Each engine parses from the input it takes, made before the timing starts.
const ENGINES: Readonly<Record<string, (log: string) => () => unknown>> = {
  legacy: (log) => () => parse(log),
  next: (log) => {
    const bytes = new TextEncoder().encode(log);
    return () => new LogBuilder(new NodeSource(bytes)).build();
  },
};

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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length / 2;
  return Number.isInteger(middle)
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[Math.floor(middle)] ?? 0);
}

// The next engine's columns are array buffers, which heapUsed leaves out.
function held(): number {
  const { heapUsed, arrayBuffers } = process.memoryUsage();
  return heapUsed + arrayBuffers;
}

function main(): void {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error('Run with node --expose-gc, as pnpm run bench:large does');
  const args = argv.slice(2);
  const runs = Number(flag(args, '--runs') ?? 5);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error('--runs must be a whole number of at least 1');
  const engineName = flag(args, '--engine') ?? 'legacy';
  const engine = ENGINES[engineName];
  if (!engine) throw new Error(`--engine must be one of ${Object.keys(ENGINES).join(', ')}`);
  const json = flag(args, '--json');
  const baselinePath = flag(args, '--baseline');

  const results = Object.entries(largeLogs).map(([name, options]): LargeResult => {
    const parseOnce = engine(makeLog(options));
    const times: number[] = [];
    const heaps: number[] = [];
    // A first parse compiles the parser, so the runs measure neither the compile nor its code.
    parseOnce();
    // Holds the tree across the collection, so the heap reading includes it.
    let tree: unknown = null;
    for (let run = 0; run < runs; run++) {
      tree = null;
      gc();
      const before = held();
      const start = performance.now();
      tree = parseOnce();
      times.push(performance.now() - start);
      gc();
      heaps.push(held() - before);
    }
    void tree;
    return { name, ms: median(times), heapBytes: median(heaps) };
  });

  const baseline: LargeResult[] = baselinePath
    ? JSON.parse(readFileSync(baselinePath, 'utf8'))
    : [];
  for (const line of report(results, baseline)) console.log(line);
  if (json) writeFileSync(json, `${JSON.stringify(results, null, 2)}\n`);
}

runIfMain(import.meta.url, main);
