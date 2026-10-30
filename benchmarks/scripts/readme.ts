// The README's read table, on one real log, through the bench bundle. Local only.
//   pnpm run bench:readme <log> [--runs=5]
// Each cell is the median first read on a new log / the median repeat read on the same log.

import { readFileSync } from 'node:fs';
import { argv } from 'node:process';
import { runIfMain } from '../../scripts/cli.js';
import type { ApexEvent } from '../../src/views/events.js';
import type { ApexLog } from '../../src/views/log.js';
import { engineNamed, viewsFromBundle } from './engines.js';
import { median, runsFlag } from './runs.js';

type Read = (log: ApexLog) => number;

function walk(events: readonly ApexEvent[], visit: (event: ApexEvent) => void): void {
  for (const event of events) {
    visit(event);
    if (event.isFrame) walk(event.children, visit);
  }
}

/** Each row: its name, the read through event objects, the read through `log.columns`. */
const ROWS: readonly (readonly [string, Read, Read])[] = [
  [
    'Numbers only: depth, self time, SOQL count',
    (log) => {
      let sum = 0;
      for (const e of log.events) sum += e.depth + e.duration.self + (e.soqlCount?.total ?? 0);
      return sum;
    },
    ({ columns }) => {
      // Each column read once, as a consumer does: some are getters.
      const { count, depth, durationSelf, soqlCount } = columns;
      let sum = 0;
      // Every id from 1 to count is an event, so in range.
      for (let id = 1; id <= count; id++)
        sum += depth[id]! + durationSelf[id]! + (soqlCount?.total[id] ?? 0);
      return sum;
    },
  ],
  [
    'Flame chart: tree walk, a label per frame',
    (log) => {
      let sum = 0;
      walk(log.children, (e) => {
        sum += e.depth + (e.isFrame ? (e.text?.length ?? 0) : 0);
      });
      return sum;
    },
    ({ columns }) => {
      const { count, depth, isFrame, text } = columns;
      const { ids, values } = text;
      let sum = 0;
      // Ids are in tree order, so a pass by id is the walk; every id is in range.
      for (let id = 1; id <= count; id++)
        sum += depth[id]! + (isFrame[id] ? (values[ids[id]!]?.length ?? 0) : 0);
      return sum;
    },
  ],
  [
    'Call tree: self time per method',
    (log) => {
      const self = new Map<string | null, number>();
      for (const e of log.events)
        if (e.isFrame) self.set(e.text, (self.get(e.text) ?? 0) + e.duration.self);
      return self.size;
    },
    ({ columns }) => {
      const { count, durationSelf, isFrame, text } = columns;
      const { ids, values } = text;
      const self = new Float64Array(values.length);
      // A frame's text id indexes values; every id is in range.
      for (let id = 1; id <= count; id++) if (isFrame[id]) self[ids[id]!]! += durationSelf[id]!;
      return self.length;
    },
  ],
];

async function main(): Promise<void> {
  const args = argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) throw new Error('Usage: pnpm run bench:readme <log> [--runs=5]');
  const runs = runsFlag(args);
  const bytes = readFileSync(path);
  const engine = await engineNamed('node', 'bundle');
  const apexLog = await viewsFromBundle('node');
  const ms = (n: number): string => (n < 1 ? '<1' : n.toFixed(0));

  const log = apexLog(engine.build(bytes));
  console.log(
    `${(bytes.length / 2 ** 20).toFixed(0)} MB, ${log.columns.count} events, ${runs} runs`,
  );
  for (const [name, ...reads] of ROWS) {
    const cells = reads.map((read) => {
      const first: number[] = [];
      const repeat: number[] = [];
      for (let run = 0; run < runs; run++) {
        const fresh = apexLog(engine.build(bytes));
        let start = performance.now();
        read(fresh);
        first.push(performance.now() - start);
        start = performance.now();
        read(fresh);
        repeat.push(performance.now() - start);
      }
      return `${ms(median(first))} / ${ms(median(repeat))} ms`;
    });
    console.log(`| ${name} | ${cells.join(' | ')} |`);
  }
}

runIfMain(import.meta.url, main);
