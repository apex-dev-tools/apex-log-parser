// For logs too large for CodSpeed. Compare branches: --json=<path> on one, --baseline=<path> on the other.
//   pnpm run bench:large [--runs=5] [--json=<path>] [--baseline=<path>] [--max-heap-growth=<percent>] [--peak]
// --baseline matches logs by name. baselines/legacy-v0.3.json is the legacy parser's last run.
// --max-heap-growth fails the run when a log's heap grows past it. Time is not gated: CI runners are noisy.
// --peak also states the median peak RSS growth of a cold parse, one fresh process per run (peak.ts).

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { runJsonChild } from '../../scripts/child.js';
import { flag, runIfMain } from '../../scripts/cli.js';
import { nodeEngine } from '../../src/engine/node.js';
import { largeLogs, makeLog } from '../fixtures/fixtures.js';
import type { PeakResult } from './peak.js';
import { median, runsFlag, timedRuns } from './runs.js';
import type { Measure } from './versus.js';
import { parts } from './versus.js';

const peakScript = fileURLToPath(new URL('./peak.ts', import.meta.url));

interface LargeResult {
  name: string;
  /** Median parse time, in milliseconds. */
  ms: number;
  /** Heap and array buffers the parse result holds, in bytes. */
  heapBytes: number;
  /** Median growth in resident memory (RSS) at the peak of a cold parse, in bytes; only with `--peak`. */
  peakBytes?: number;
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
    // A baseline from before --peak states none, which must not read as no change.
    const noPeak = before && before.peakBytes === undefined ? ' (no baseline peak)' : '';
    const peak =
      result.peakBytes === undefined
        ? ''
        : `, peak RSS ${figure(result.peakBytes, before?.peakBytes, mb, 'memory')}${noPeak}`;
    return `${result.name}: ${figure(result.ms, before?.ms, ms, 'time')}, heap ${figure(result.heapBytes, before?.heapBytes, mb, 'memory')}${peak}${missing}`;
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
  return timedRuns(runs, () => nodeEngine.build(bytes));
}

/** The median peak RSS growth of one cold parse of `log` (bytes), over `runs` fresh processes. */
export function measurePeak(log: string, runs: number): number {
  const dir = mkdtempSync(join(tmpdir(), 'bench-peak-'));
  try {
    const path = join(dir, 'log.log');
    writeFileSync(path, log);
    const peaks: number[] = [];
    for (let run = 0; run < runs; run++) {
      // The parent's heap limit, so GC runs as it does for the time and heap figures.
      const child = runJsonChild(peakScript, [path], ['--max-old-space-size=8192']);
      peaks.push((child as PeakResult).peakBytes);
    }
    return median(peaks);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const runs = runsFlag(args);
  const json = flag(args, '--json');
  const baselinePath = flag(args, '--baseline');
  const maxGrowthFlag = flag(args, '--max-heap-growth');
  const maxGrowth = maxGrowthFlag === null ? null : Number(maxGrowthFlag);
  if (maxGrowth !== null && !(maxGrowth >= 0))
    throw new Error('--max-heap-growth must be a percent of at least 0');
  if (maxGrowth !== null && !baselinePath) throw new Error('--max-heap-growth needs --baseline');
  const peak = args.includes('--peak');

  const results: LargeResult[] = [];
  for (const [name, options] of Object.entries(largeLogs)) {
    const log = makeLog(options);
    const result: LargeResult = { name, ...(await measureLog(log, runs)) };
    if (peak) result.peakBytes = measurePeak(log, runs);
    results.push(result);
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
