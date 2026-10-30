// The README's read table and its heap figures, on one real log, through the bench bundle.
// Local only.
//   pnpm run bench:readme <log> [--runs=5]
// Each cell is the median first read on a new log / the median repeat read on the same log.

import { readFileSync } from 'node:fs';
import { argv } from 'node:process';
import { runIfMain } from '../../scripts/cli.js';
import type { ApexEvent } from '../../src/views/events.js';
import type { ApexLog } from '../../src/views/log.js';
import { engineNamed, viewsFromBundle } from './engines.js';
import { liveBytes } from './memory.js';
import { readColumns } from './reads.js';
import { median, runsFlag } from './runs.js';

type Read = (log: ApexLog) => number;

/** Each row: its name, the read through event objects, the read through `log.columns`. */
export const ROWS: [string, Read, Read][] = [
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
      const walk = (events: readonly ApexEvent[]): void => {
        for (const e of events) {
          sum += e.depth;
          if (e.isFrame) {
            sum += e.text?.length ?? 0;
            walk(e.children);
          }
        }
      };
      walk(log.children);
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

// Module-level, so optimised code cannot drop a read's result.
let _held = 0;

const mb = (n: number): string => `${(n / 1_000_000).toFixed(1)} MB`;

/** The heap the parse holds, and what every column adds; the log is garbage on return. */
async function parseHeap(build: () => ApexLog): Promise<string> {
  const base = await liveBytes();
  const log = build();
  const parsed = await liveBytes();
  readColumns(log);
  const columns = (await liveBytes()) - parsed;
  const holds = `The parse holds ${mb(parsed - base)}; every column adds ${mb(columns)}.`;
  return `${log.columns.count} events. ${holds}`;
}

async function main(): Promise<void> {
  const args = argv.slice(2);
  const path = args.find((a) => !a.startsWith('--'));
  if (!path) throw new Error('Usage: pnpm run bench:readme <log> [--runs=5]');
  const runs = runsFlag(args);
  const bytes = readFileSync(path);
  const engine = await engineNamed('node', 'bundle');
  const apexLog = await viewsFromBundle('node');
  const build = (): ApexLog => apexLog(engine.build(bytes));
  const ms = (n: number): string => (n < 1 ? '<1' : n.toFixed(0));
  const time = (read: Read, log: ApexLog): number => {
    const start = performance.now();
    _held += read(log);
    return performance.now() - start;
  };

  console.log(`${mb(bytes.length)}, ${runs} runs. ${await parseHeap(build)}`);
  const heaps: string[] = [];
  for (const [name, ...reads] of ROWS) {
    const cells: string[] = [];
    const added: string[] = [];
    for (const read of reads) {
      // Untimed, so run 0 does not include the read's compile.
      read(build());
      const first: number[] = [];
      const repeat: number[] = [];
      const heap: number[] = [];
      for (let run = 0; run < runs; run++) {
        const fresh = build();
        // Each timed read starts after a full GC, so no collection of earlier garbage lands in it.
        const before = await liveBytes();
        first.push(time(read, fresh));
        heap.push((await liveBytes()) - before);
        repeat.push(time(read, fresh));
      }
      cells.push(`${ms(median(first))} / ${ms(median(repeat))} ms`);
      added.push(mb(median(heap)));
    }
    console.log(`| ${name} | ${cells.join(' | ')} |`);
    heaps.push(`${name}: the first read adds ${added.join(' / ')}`);
  }
  console.log(heaps.join('\n'));
}

runIfMain(import.meta.url, main);
