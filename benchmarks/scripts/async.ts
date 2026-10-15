// What the parser's async parse() costs against a direct build, and how long it holds the
// host, on the synthetic logs. Local only.
//   pnpm run bench:async [--runs=5] [--log=<name>]
// Gates (100 MB): no host turn over 10 ms; the total within 10% of a direct build; an abort
// rejects within 10 ms of the time it was asked for; a parse in a worker within 10% of a direct
// build; a log moved to another thread readable within 20 ms.

import process, { argv } from 'node:process';
import { Worker } from 'node:worker_threads';
import { flag, runIfMain } from '../../scripts/cli.js';
import { nodeEngine } from '../../src/engine/node.js';
import type { ApexLog } from '../../src/node.js';
import { fromBuffers, parse, toBuffers } from '../../src/node.js';
import { apexLog } from '../../src/views/log.js';
import { largeLogs, makeLog } from '../fixtures/fixtures.js';
import { median } from './large.js';
import { versus } from './versus.js';

const GATES = { turnMs: 10, overBuild: 0.1, abortMs: 10, reopenMs: 20 } as const;
const GATE_LOG = 'parse_100mb';
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

/**
 * Milliseconds to move `log` as another thread would get it, then read what a first screen shows:
 * the top level, one event's text, the issues and the limits. `log` is unreadable after.
 */
export function reopenMs(log: ApexLog): number {
  const start = performance.now();
  const { buffers, transfer } = toBuffers(log);
  const again = fromBuffers(structuredClone(buffers, { transfer }));
  void again.children.length;
  void again.event(1)?.text;
  void again.issues.length;
  void again.limits.final;
  return performance.now() - start;
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
  // One worker for every log, as a host keeps one; it runs the source, as tsx compiles it.
  const worker = new Worker(new URL('../../src/worker/node.ts', import.meta.url), {
    execArgv: ['--import', 'tsx'],
  });
  try {
    for (const name of names) failed = (await measureLog(name, runs, worker)) || failed;
  } finally {
    await worker.terminate();
  }
  if (failed) process.exitCode = 1;
}

/** Measures one log and prints its figures; true when a gate fails. */
async function measureLog(name: string, runs: number, worker: Worker): Promise<boolean> {
  let failed = false;
  const options = largeLogs[name];
  if (!options) throw new Error(`--log must be one of ${Object.keys(largeLogs).join(', ')}`);
  const bytes = new TextEncoder().encode(makeLog(options));
  const gated = name === GATE_LOG;

  // The first parse of the process is the cold one, which a host meets first, so it counts.
  let worstTurn = 0;
  const parses: number[] = [];
  const builds: number[] = [];
  const inWorker: number[] = [];
  const reopens: number[] = [];
  for (let run = 0; run <= runs; run++) {
    // Interleaved, so drift in the machine falls on each.
    let start = performance.now();
    worstTurn = Math.max(worstTurn, await longestTurn(() => parse(bytes)));
    const parsed = performance.now() - start;
    start = performance.now();
    apexLog(nodeEngine.build(bytes));
    const built = performance.now() - start;
    start = performance.now();
    // The caller's own bytes, so the copy that keeps them is part of the time, as for a host.
    const fromWorker = await parse(bytes, { worker });
    const worked = performance.now() - start;
    const reopened = reopenMs(fromWorker);
    // Run 0 compiles the code, so the medians leave it out.
    if (run === 0) continue;
    parses.push(parsed);
    builds.push(built);
    inWorker.push(worked);
    reopens.push(reopened);
  }
  const build = median(builds);
  const total = median(parses);
  const workerTotal = median(inWorker);
  const reopen = median(reopens);

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
  const workerPass = workerTotal <= build * (1 + GATES.overBuild);
  const reopenPass = reopen <= GATES.reopenMs;
  if (gated && !(turnPass && totalPass && abortPass && workerPass && reopenPass)) failed = true;
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
  console.log(
    `  parse() in a worker ${ms(workerTotal)} against a direct build of ${ms(build)}, ${versus(build, workerTotal, 'time')}${gated ? verdict(workerPass, `≤ +${GATES.overBuild * 100}%`) : ''}`,
  );
  console.log(
    `  reopen on another thread ${ms(reopen)}${gated ? verdict(reopenPass, `≤ ${GATES.reopenMs} ms`) : ''}`,
  );
  return failed;
}

runIfMain(import.meta.url, main);
