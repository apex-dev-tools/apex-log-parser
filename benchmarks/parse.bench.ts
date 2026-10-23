/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { test } from 'vitest';
import type { LogEngine } from '../src/engine/engine.js';
import { benchLogs, makeLog } from './fixtures/fixtures.js';

// Built by `pnpm run bench` first (tsdown.bench.config.ts): the code consumers run.
const bundle = new URL('./.bundle/node.js', import.meta.url).href;
const { nodeEngine } = (await import(bundle).catch((cause: unknown) => {
  throw new Error('No bench bundle: run `pnpm run bench`, not `bench:run` alone.', { cause });
})) as { nodeEngine: LogEngine };

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
