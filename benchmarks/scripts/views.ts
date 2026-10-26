// What reading the parser's views adds to its build, on the synthetic logs. Local only.
//   pnpm run bench:views [--runs=5] [--log=<name>]
// Gates (100 MB): reading every column adds < 120 ms; an object for every event < 25 ms; a walk of
// the tree through children < 50 ms; every event's text < 200 ms; every frame's text from the
// columns < 150 ms; the variables at every 1000th variable line, which indexes them all, < 50 ms.

import process, { argv } from 'node:process';
import { flag, runIfMain } from '../../scripts/cli.js';
import { idOfType } from '../../src/catalog/catalog.js';
import { nodeEngine } from '../../src/engine/node.js';
import type { ApexLog } from '../../src/views/log.js';
import { apexLog } from '../../src/views/log.js';
import { largeLogs, makeLog } from '../fixtures/fixtures.js';
import { READS } from './reads.js';
import { runsFlag, timedRuns } from './runs.js';
import { versus } from './versus.js';

/** The gates, in milliseconds over the build, for the 100 MB log. */
const GATES: Readonly<Record<string, number>> = {
  columns: 120,
  events: 25,
  tree: 50,
  text: 200,
  textColumn: 150,
  variables: 50,
};
const GATE_LOG = 'parse_100mb';

const ASSIGNMENT = idOfType('VARIABLE_ASSIGNMENT');

/** Reads the variables at every 1000th variable line: the first read indexes every line. */
export function readVariables(log: ApexLog): number {
  const { type } = log.columns;
  let sum = 0;
  // Every index is a row, so in range, and an event from 1.
  for (let id = 1, seen = 0; id < type.length; id++) {
    if (type[id] === ASSIGNMENT && seen++ % 1000 === 0)
      sum += log.event(id)?.variables?.locals.length ?? 0;
  }
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
    console.log(`${name}: ${rows} events, build ${ms(build.ms)}, keeps ${mb(build.heapBytes)}`);

    const work: (readonly [string, (log: ApexLog) => unknown])[] = [
      ...READS,
      ['variables', readVariables],
    ];
    for (const [what, run] of work) {
      // A new view each run, so no run reads another's memo; making it is part of the cost.
      const result = await timedRuns(runs, () => {
        const log = apexLog(built);
        return [log, run(log)];
      });
      if (!(what in GATES)) throw new Error(`No gate for ${what}`);
      const gate = name === GATE_LOG ? (GATES[what] ?? null) : null;
      const verdict =
        gate === null ? '' : `, gate < ${gate} ms: ${result.ms < gate ? 'pass' : 'FAIL'}`;
      if (gate !== null && result.ms >= gate) failed = true;
      console.log(
        `  ${what}: +${ms(result.ms)} over the build, ${versus(build.ms, build.ms + result.ms, 'time')}; keeps +${mb(result.heapBytes)}, ${versus(build.heapBytes, build.heapBytes + result.heapBytes, 'memory')}${verdict}`,
      );
    }
  }
  if (failed) process.exitCode = 1;
}

runIfMain(import.meta.url, main);
