/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { test } from 'vitest';
import type { ApexLog } from '../src/views/log.js';
import { benchLogs, makeLog } from './fixtures/fixtures.js';
import { engineNamed, viewsFromBundle } from './scripts/engines.js';
import { readColumns, readText, readTextColumn, readTree } from './scripts/reads.js';

// Built by `pnpm run bench` first (tsdown.bench.config.ts): the code consumers run.
const nodeEngine = await engineNamed('node', 'bundle');
const apexLog = await viewsFromBundle('node');

// One test, so each CodSpeed id reads `parse.bench.ts::build::<log>`.
test('build', async ({ bench }) => {
  for (const [name, options] of Object.entries(benchLogs)) {
    // Built outside the bench, so it measures the build alone; bench:async times parse()'s slices.
    const bytes = new TextEncoder().encode(makeLog(options));
    await bench(name, () => {
      nodeEngine.build(bytes);
    }).run();
  }
});

const READ_LOG = 'parse_2mb';

// Two cases, as each runs in two CodSpeed modes; bench:views times each read alone.
const READS: readonly (readonly [string, (log: ApexLog) => number])[] = [
  // Every column, its text included, then again on one view, as a redraw does
  [
    'columns',
    (log) => readColumns(log) + readTextColumn(log) + readColumns(log) + readTextColumn(log),
  ],
  // Each event's object and text through the loop, then the tree through children
  ['events', (log) => readText(log) + readTree(log)],
];

/** The build the reads run on. */
function readLog(): ReturnType<typeof nodeEngine.build> {
  const options = benchLogs[READ_LOG];
  if (!options) throw new Error(`No bench log ${READ_LOG}`);
  return nodeEngine.build(new TextEncoder().encode(makeLog(options)));
}

// Each id reads `parse.bench.ts::read::<what>_2mb`: what a read adds after the build.
test('read', async ({ bench }) => {
  const built = readLog();
  for (const [what, read] of READS) {
    // A new view each run, so no run reads another's memo.
    await bench(`${what}_2mb`, () => {
      read(apexLog(built));
    }).run();
  }
});
