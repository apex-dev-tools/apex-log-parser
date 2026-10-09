// What the next parser's async parse() costs against a direct build, and how long it holds the
// host, on the synthetic logs. Local only.
//   pnpm run bench:async [--runs=5] [--log=<name>]
// Gates (100 MB): no host turn over 10 ms; the total within 10% of a direct build; an abort
// rejects within 10 ms of the time it was asked for.

import process, { argv } from 'node:process';
import { flag, runIfMain } from '../../scripts/cli.js';
import { nodeEngine } from '../../src/next/engine/node.js';
import { parse } from '../../src/next/node.js';
import { apexLog } from '../../src/next/views/log.js';
import { largeLogs, makeLog } from '../fixtures/fixtures.js';
import { median } from './large.js';
import { versus } from './versus.js';

const GATES = { turnMs: 10, overBuild: 0.1, abortMs: 10 } as const;
const GATE_LOG = 'XL 100 MB';
/** Where in a parse each abort run asks to stop, as a fraction of the parse's median time. */
const ABORT_AT = [0.05, 0.25, 0.5, 0.75, 0.95] as const;

/** The longest gap between `setImmediate` turns while `work` runs: the longest task it held the host for. */
export async function longestTurn(work: () => Promise<unknown>): Promise<number> {
  let worst = 0;
  let last = performance.now();
  let running = true;
  const probe = (): void => {
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
    if (running) setImmediate(probe);
  };
  setImmediate(probe);
  try {
    await work();
  } finally {
    running = false;
  }
  // The gap from the last turn to the end of the work counts too.
  return Math.max(worst, performance.now() - last);
}

/**
 * Milliseconds from `atMs` after the parse starts, when the abort is asked for, to the rejection.
 * The timer waits for the slice that is running, so that wait is part of it. Null when the parse
 * ended first.
 */
export async function abortLatency(bytes: Uint8Array, atMs: number): Promise<number | null> {
  const controller = new AbortController();
  const due = performance.now() + atMs;
  const timer = setTimeout(() => controller.abort(), atMs);
  try {
    await parse(bytes, { signal: controller.signal });
    return null;
  } catch (error) {
    if (error !== controller.signal.reason) throw error;
    return performance.now() - due;
  } finally {
    clearTimeout(timer);
  }
}

const ms = (n: number): string => `${n.toFixed(1)} ms`;
const verdict = (pass: boolean, gate: string): string =>
  `, gate ${gate}: ${pass ? 'pass' : 'FAIL'}`;

async function main(): Promise<void> {
  const args = argv.slice(2);
  const runs = Number(flag(args, '--runs') ?? 5);
  if (!Number.isInteger(runs) || runs < 1)
    throw new Error('--runs must be a whole number of at least 1');
  // A renamed log would otherwise skip the gates and still pass.
  if (!(GATE_LOG in largeLogs)) throw new Error(`No log ${GATE_LOG} for the gates`);
  const only = flag(args, '--log');
  const names = only ? [only] : Object.keys(largeLogs);
  let failed = false;

  for (const name of names) {
    const options = largeLogs[name];
    if (!options) throw new Error(`--log must be one of ${Object.keys(largeLogs).join(', ')}`);
    const bytes = new TextEncoder().encode(makeLog(options));
    const gated = name === GATE_LOG;

    // The first parse of the process is the cold one, which a host meets first, so it counts.
    let worstTurn = 0;
    const parses: number[] = [];
    const builds: number[] = [];
    for (let run = 0; run <= runs; run++) {
      // Interleaved, so drift in the machine falls on both.
      let start = performance.now();
      worstTurn = Math.max(worstTurn, await longestTurn(() => parse(bytes)));
      const parsed = performance.now() - start;
      start = performance.now();
      apexLog(nodeEngine.build(bytes));
      const built = performance.now() - start;
      // Run 0 compiles the code, so the medians leave it out.
      if (run === 0) continue;
      parses.push(parsed);
      builds.push(built);
    }
    const build = median(builds);
    const total = median(parses);

    const latencies: number[] = [];
    for (const at of ABORT_AT) {
      const latency = await abortLatency(bytes, total * at);
      if (latency !== null) latencies.push(latency);
    }
    // A small log ends within a few slices, so a late abort can arrive after it; the gate log's
    // aborts are each asked for inside its median time, so most must land.
    if (gated && latencies.length < ABORT_AT.length - 1)
      throw new Error(`${name}: only ${latencies.length} of ${ABORT_AT.length} aborts landed`);
    const abort = latencies.length ? Math.max(...latencies) : 0;

    const turnPass = worstTurn <= GATES.turnMs;
    const totalPass = total <= build * (1 + GATES.overBuild);
    const abortPass = abort <= GATES.abortMs;
    if (gated && !(turnPass && totalPass && abortPass)) failed = true;
    console.log(`${name}:`);
    console.log(
      `  longest host turn ${ms(worstTurn)}${gated ? verdict(turnPass, `≤ ${GATES.turnMs} ms`) : ''}`,
    );
    console.log(
      `  parse() ${ms(total)} against a direct build of ${ms(build)}, ${versus(build, total, 'time')}${gated ? verdict(totalPass, `≤ +${GATES.overBuild * 100}%`) : ''}`,
    );
    console.log(
      `  abort rejects within ${ms(abort)} (${latencies.length} aborts)${gated ? verdict(abortPass, `≤ ${GATES.abortMs} ms`) : ''}`,
    );
  }
  if (failed) process.exitCode = 1;
}

runIfMain(import.meta.url, main);
