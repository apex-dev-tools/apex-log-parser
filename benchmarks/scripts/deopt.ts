/**
 * Parses the 8 MB log until V8 has optimised the engine, then again in a plain loop, then again
 * after each of several full GCs, with a marker line before each of the last two phases. Run it
 * with `--trace-deopt`: any deopt in the plain loop, or a `weak objects` or `wrong map` deopt after
 * a GC, is the engine losing its optimised code. `deopt.test.ts` runs it for each build.
 *
 * Usage: node --expose-gc --trace-deopt --import tsx benchmarks/scripts/deopt.ts --engine=node|browser
 */

import { writeSync } from 'node:fs';
import { flag, runIfMain } from '../../scripts/cli.js';
import type { LogEngine } from '../../src/next/engine/engine.js';
import { largeLogs, makeLog } from '../fixtures/fixtures.js';

export const PLAIN_MARKER = '--- plain loop ---';
export const GC_MARKER = '--- after full GCs ---';
const WARMUP = 20;
const ROUNDS = 10;

// One build per process, as in production: each entry holds an idle builder over its own source.
async function engineNamed(name: string | null): Promise<LogEngine> {
  if (name === 'browser') return (await import('../../src/next/engine/browser.js')).browserEngine;
  return (await import('../../src/next/engine/node.js')).nodeEngine;
}

// Synchronous, as V8's trace is, so no line of one phase can land after the next one's marker.
const mark = (marker: string): void => {
  writeSync(1, `${marker}\n`);
};

runIfMain(import.meta.url, async () => {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error('Run with node --expose-gc');
  const engine = await engineNamed(flag(process.argv.slice(2), '--engine'));
  // largeLogs always holds this log. Its times pass 2^30 ns, as those of any log over a second do.
  const bytes = new TextEncoder().encode(makeLog(largeLogs['medium 8 MB']!));
  // The fixture writer's code loses its layouts here, before the markers: only the engine's count.
  gc();
  for (let i = 0; i < WARMUP; i++) engine.build(bytes);
  mark(PLAIN_MARKER);
  for (let i = 0; i < ROUNDS; i++) engine.build(bytes);
  mark(GC_MARKER);
  for (let i = 0; i < ROUNDS; i++) {
    gc();
    engine.build(bytes);
  }
});
