/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { test } from 'vitest';
import { nodeEngine } from '../src/engine/node.js';
import { benchLogs, makeLog } from './fixtures/fixtures.js';

for (const [name, options] of Object.entries(benchLogs)) {
  test(name, async ({ bench }) => {
    // Built outside the bench, so it measures the build alone; bench:async times parse()'s slices.
    const bytes = new TextEncoder().encode(makeLog(options));
    await bench(name, () => {
      nodeEngine.build(bytes);
    }).run();
  });
}
