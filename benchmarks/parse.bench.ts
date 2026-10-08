/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { bench, describe } from 'vitest';
import { parse } from '../src/index.js';
import { benchLogs, makeLog } from './fixtures/fixtures.js';

describe('parse', () => {
  for (const [name, options] of Object.entries(benchLogs)) {
    // Built outside the bench, so it measures the parse alone.
    const log = makeLog(options);
    bench(name, () => {
      parse(log);
    });
  }
});
