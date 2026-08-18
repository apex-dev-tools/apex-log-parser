/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { parse } from '../index.js';

const CUMULATIVE_BLOCK =
  '09:18:22.6 (500)|CUMULATIVE_LIMIT_USAGE\n' +
  '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
  '  Number of SOQL queries: 8 out of 100\n' +
  '09:18:22.6 (500)|CUMULATIVE_LIMIT_USAGE_END\n';

const logWith = (body: string): string =>
  '09:18:22.6 (100)|EXECUTION_STARTED\n' + body + '09:18:22.6 (900)|EXECUTION_FINISHED\n';

describe('ApexLog.coverage', () => {
  it('reports both when the log holds cumulative limits and heap events', () => {
    const apexLog = parse(
      logWith('09:18:22.6 (200)|HEAP_ALLOCATE|[84]|Bytes:152\n' + CUMULATIVE_BLOCK),
    );
    expect(apexLog.coverage).toEqual({ hasCumulativeLimits: true, hasHeapEvents: true });
  });

  it('reports no heap events when the log states none', () => {
    const apexLog = parse(logWith(CUMULATIVE_BLOCK));
    expect(apexLog.coverage).toEqual({ hasCumulativeLimits: true, hasHeapEvents: false });
  });

  it('reports no cumulative limits when the log states none', () => {
    const apexLog = parse(logWith('09:18:22.6 (200)|HEAP_ALLOCATE|[84]|Bytes:152\n'));
    expect(apexLog.coverage).toEqual({ hasCumulativeLimits: false, hasHeapEvents: true });
  });
});
