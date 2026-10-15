// What reading the parser's views adds to its build, on the synthetic logs. Local only.
//   pnpm run bench:views [--runs=5] [--log=<name>]
// Gates (100 MB): reading every column adds < 30 ms; an object for every event < 250 ms.

import process, { argv } from 'node:process';
import { flag, runIfMain } from '../../scripts/cli.js';
import { nodeEngine } from '../../src/engine/node.js';
import type { ApexLog } from '../../src/views/log.js';
import { apexLog } from '../../src/views/log.js';
import { largeLogs, makeLog } from '../fixtures/fixtures.js';
import { runsFlag, timedRuns } from './runs.js';
import { versus } from './versus.js';

/** The gates, in milliseconds over the build, for the 100 MB log. */
const GATES = { columns: 30, events: 250 } as const;
const GATE_LOG = 'parse_100mb';

/** Reads every column of every event row once, as a caller that reads them all does. */
export function readColumns(log: ApexLog): number {
  const { type, parent, depth, subtreeEnd, timestamp, exitStamp, durationSelf, durationTotal } =
    log.columns;
  // A sum of every read, so none is dead code the compiler can drop.
  let sum = 0;
  // Row 0 is the log, not an event. Every index is a row, so in range.
  for (let id = 1; id < type.length; id++) {
    sum += type[id]! + parent[id]! + depth[id]! + subtreeEnd[id]!;
    // A leaf's exitStamp is NaN, which would make the sum NaN.
    sum += timestamp[id]! + (exitStamp[id]! || 0) + durationSelf[id]! + durationTotal[id]!;
  }
  return sum;
}

/** Makes the object for every event, and reads one field from each so none is skipped. */
export function readEvents(log: ApexLog): number {
  let sum = 0;
  for (const event of log.events) sum += event.depth;
  return sum;
}

const ms = (n: number): string => `${n.toFixed(1)} ms`;
const mb = (n: number): string => `${(n / 1_000_000).toFixed(1)} MB`;

async function main(): Promise<void> {
  const args = argv.slice(2);
  const runs = runsFlag(args);
  // A renamed log would otherwise skip the gates and still pass.
  if (!(GATE_LOG in largeLogs)) throw new Error(`No log ${GATE_LOG} for the gates`);
  const only = flag(args, '--log');
  const names = only ? [only] : Object.keys(largeLogs);
  let failed = false;

  for (const name of names) {
    const options = largeLogs[name];
    if (!options) throw new Error(`--log must be one of ${Object.keys(largeLogs).join(', ')}`);
    const bytes = new TextEncoder().encode(makeLog(options));
    const build = await timedRuns(runs, () => nodeEngine.build(bytes));
    const built = nodeEngine.build(bytes);
    const rows = built.store.count - 1;
    console.log(`${name}: ${rows} events, build ${ms(build.ms)}, keeps ${mb(build.bytes)}`);

    const work: [keyof typeof GATES, (log: ApexLog) => unknown][] = [
      ['columns', readColumns],
      ['events', readEvents],
    ];
    for (const [what, run] of work) {
      // A new view each run, so no run reads another's memo; making it is part of the cost.
      const result = await timedRuns(runs, () => {
        const log = apexLog(built);
        return [log, run(log)];
      });
      const gate = name === GATE_LOG ? GATES[what] : null;
      const verdict =
        gate === null ? '' : `, gate < ${gate} ms: ${result.ms < gate ? 'pass' : 'FAIL'}`;
      if (gate !== null && result.ms >= gate) failed = true;
      console.log(
        `  ${what}: +${ms(result.ms)} over the build, ${versus(build.ms, build.ms + result.ms, 'time')}; keeps +${mb(result.bytes)}, ${versus(build.bytes, build.bytes + result.bytes, 'memory')}${verdict}`,
      );
    }
  }
  if (failed) process.exitCode = 1;
}

runIfMain(import.meta.url, main);
