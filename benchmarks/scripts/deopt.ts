/**
 * Parses the 8 MB log until V8 has optimised the engine, then parses it again after each of
 * several full GCs, and prints a marker line between the two phases. Run it with `--trace-deopt`:
 * a `weak objects` or `wrong map` deopt after the marker is the engine losing its optimised code
 * to a GC. `deopt.test.ts` runs it for each build.
 *
 * Usage: node --expose-gc --trace-deopt --import tsx benchmarks/scripts/deopt.ts --engine=node|browser
 */

import { writeSync } from 'node:fs';
import { flag, runIfMain } from '../../scripts/cli.js';
import type { LogEngine } from '../../src/next/engine/engine.js';
import { largeLogs, makeLog } from '../fixtures/fixtures.js';

export const MARKER = '--- after warm-up ---';
const WARMUP = 20;
const ROUNDS = 10;

// One build per process, as in production: each entry holds an idle builder over its own source.
async function engineNamed(name: string | null): Promise<LogEngine> {
  if (name === 'browser') return (await import('../../src/next/browser.js')).browserEngine;
  return (await import('../../src/next/node.js')).nodeEngine;
}

runIfMain(import.meta.url, async () => {
  const gc = (globalThis as { gc?: () => void }).gc;
  if (!gc) throw new Error('Run with node --expose-gc');
  const engine = await engineNamed(flag(process.argv.slice(2), '--engine'));
  // largeLogs always holds this log. Its times pass 2^30 ns, as those of any log over a second do.
  const bytes = new TextEncoder().encode(makeLog(largeLogs['medium 8 MB']!));
  // The fixture writer's code loses its layouts here, before the marker: only the engine's count.
  gc();
  for (let i = 0; i < WARMUP; i++) engine.build(bytes);
  // Synchronous, as V8's trace is, so no warm-up line can land after the marker.
  writeSync(1, `${MARKER}\n`);
  for (let i = 0; i < ROUNDS; i++) {
    gc();
    engine.build(bytes);
  }
});
