/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { parse } from '../index.js';
import type { HeapAllocateLine, LimitUsageLine } from '../index.js';
import { flatten } from './helpers.js';

const CUMULATIVE_BLOCK =
  '09:18:22.6 (500)|CUMULATIVE_LIMIT_USAGE\n' +
  '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
  '  Number of SOQL queries: 8 out of 100\n' +
  '  Number of query rows: 26 out of 50000\n' +
  '  Number of SOSL queries: 0 out of 20\n' +
  '  Number of DML statements: 3 out of 150\n' +
  '  Number of Publish Immediate DML: 0 out of 150\n' +
  '  Number of DML rows: 12 out of 10000\n' +
  '  Maximum CPU time: 4564 out of 10000\n' +
  '  Maximum heap size: 1234 out of 6000000\n' + // format matches real logs (no thousands separators)
  '  Number of callouts: 0 out of 100\n' +
  '  Number of Email Invocations: 0 out of 10\n' +
  '  Number of future calls: 0 out of 50\n' +
  '  Number of queueable jobs added to the queue: 0 out of 50\n' +
  '  Number of Mobile Apex push calls: 0 out of 10\n' +
  '09:18:22.6 (500)|CUMULATIVE_LIMIT_USAGE_END\n';

describe('granular limit parsing (via parse)', () => {
  const log =
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    '09:18:22.6 (200)|HEAP_ALLOCATE|[84]|Bytes:152\n' +
    '09:18:22.6 (250)|HEAP_ALLOCATE|[EXTERNAL]|Bytes:-4\n' +
    '09:18:22.6 (300)|LIMIT_USAGE|[89]|SOQL|1|100\n' +
    '09:18:22.6 (350)|LIMIT_USAGE|[89]|FIELDS_DESCRIBES|1|100\n' +
    '09:18:22.6 (400)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 SOQL queries, total 5 out of 100\n' +
    '09:18:22.6 (410)|FLOW_BULK_ELEMENT_LIMIT_USAGE|SOQL queries, total 6 out of 100\n' +
    '09:18:22.6 (420)|FLOW_ELEMENT_LIMIT_USAGE|2 ms CPU time, total 10 out of 15000\n' +
    '09:18:22.6 (450)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|DML statements: 3 out of 150\n' +
    CUMULATIVE_BLOCK +
    '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n';
  const apexLog = parse(log);
  const events = flatten(apexLog);
  const byType = (type: string): LimitUsageLine[] =>
    events.filter((e) => e.type === type) as LimitUsageLine[];

  it('parses heap allocation bytes, including negatives', () => {
    const heap = events.filter((e) => e.type === 'HEAP_ALLOCATE') as HeapAllocateLine[];
    expect(heap.map((h) => h.bytes)).toEqual([152, -4]);
  });

  it('parses governor LIMIT_USAGE records and ignores non-governor codes', () => {
    const [soql, describes] = byType('LIMIT_USAGE');
    expect(soql?.limitUsage).toEqual({ metric: 'soqlQueries', used: 1, limit: 100 });
    expect(describes?.limitUsage).toBeNull();
  });

  it('parses flow running-total reports (uses the total as used, the leading count as delta)', () => {
    expect(byType('FLOW_BULK_ELEMENT_LIMIT_USAGE')[0]?.limitUsage).toEqual({
      metric: 'soqlQueries',
      used: 5,
      limit: 100,
      delta: 1,
    });
    expect(byType('FLOW_ELEMENT_LIMIT_USAGE')[0]?.limitUsage).toEqual({
      metric: 'cpuTime',
      used: 10,
      limit: 15000,
      delta: 2,
    });
  });

  it('keeps a running-total report whose head has no leading count, with a zero delta', () => {
    expect(byType('FLOW_BULK_ELEMENT_LIMIT_USAGE')[1]?.limitUsage).toEqual({
      metric: 'soqlQueries',
      used: 6,
      limit: 100,
      delta: 0,
    });
  });

  it('parses flow colon reports', () => {
    expect(byType('FLOW_INTERVIEW_FINISHED_LIMIT_USAGE')[0]?.limitUsage).toEqual({
      metric: 'dmlStatements',
      used: 3,
      limit: 150,
    });
  });

  it('parses the whole cumulative LIMIT_USAGE_FOR_NS block (shared parser)', () => {
    const snapshot = apexLog.governorLimits.snapshots.at(-1);
    expect(snapshot?.namespace).toBe('default');
    expect(snapshot?.limits.soqlQueries).toEqual({ used: 8, limit: 100, percentUsed: 8 });
    expect(snapshot?.limits.cpuTime).toEqual({ used: 4564, limit: 10000, percentUsed: 45.64 });
    expect(snapshot?.limits.heapSize).toEqual({
      used: 1234,
      limit: 6000000,
      percentUsed: (1234 / 6000000) * 100,
    });
    expect(snapshot?.limits.dmlRows).toEqual({ used: 12, limit: 10000, percentUsed: 0.12 });
    expect(snapshot?.limits.mobileApexPushCalls).toEqual({ used: 0, limit: 10, percentUsed: 0 });
  });

  it('percentUsed is null for a metric the block never stated', () => {
    // A block that states only SOQL: every other metric has no ceiling, so it has no percentage.
    const partial = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 25 out of 100\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );
    const limits = partial.governorLimits.byNamespace.get('default')?.final;
    expect(limits?.soqlQueries).toEqual({ used: 25, limit: 100, percentUsed: 25 });
    expect(limits?.cpuTime).toEqual({ used: 0, limit: 0, percentUsed: null });
  });
});

describe('derived governor limit figures', () => {
  it('peak keeps the high-water mark when a counter falls', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 11 out of 100\n' +
        '09:18:22.6 (900)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 8 out of 100\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );
    expect(apexLog.governorLimits.final.soqlQueries).toEqual({
      used: 8,
      limit: 100,
      percentUsed: 8,
    });
    expect(apexLog.governorLimits.peak.soqlQueries).toEqual({
      used: 11,
      limit: 100,
      percentUsed: 11,
    });
  });

  it('combines namespaces by carrying each namespace last value forward', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 10 out of 100\n' +
        '09:18:22.6 (700)|LIMIT_USAGE_FOR_NS|(myNS)|\n' +
        '  Number of SOQL queries: 4 out of 100\n' +
        '09:18:22.6 (900)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 6 out of 100\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );
    const { final, peak, byNamespace } = apexLog.governorLimits;
    // The combined peak (14) is at the timepoint myNS reported, when default still stood at 10.
    expect(final.soqlQueries.used).toBe(10);
    expect(peak.soqlQueries.used).toBe(14);
    expect(byNamespace.get('default')?.final.soqlQueries.used).toBe(6);
    expect(byNamespace.get('default')?.peak.soqlQueries.used).toBe(10);
    expect(byNamespace.get('myNS')?.final.soqlQueries.used).toBe(4);
    expect(byNamespace.get('myNS')?.peak.soqlQueries.used).toBe(4);
  });

  it('takes the heap peak from HEAP_ALLOCATE, leaving final as the block stated it', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|HEAP_ALLOCATE|[84]|Bytes:152\n' +
        '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Maximum heap size: 0 out of 6000000\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );
    expect(apexLog.heapPeak).toBe(152);
    expect(apexLog.governorLimits.final.heapSize.used).toBe(0);
    expect(apexLog.governorLimits.peak.heapSize).toEqual({
      used: 152,
      limit: 6000000,
      percentUsed: (152 / 6000000) * 100,
    });
  });
});

describe('end of log closes the last event', () => {
  const tail =
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
    '  Number of SOQL queries: 8 out of 100';

  it.each([
    ['no trailing newline', tail],
    ['a trailing newline', `${tail}\n`],
    ['a trailing CRLF', `${tail.replaceAll('\n', '\r\n')}\r\n`],
  ])('records the final block when the log ends with %s', (_name, log) => {
    const apexLog = parse(log);
    const snapshot = apexLog.governorLimits.snapshots.at(-1);
    expect(apexLog.governorLimits.snapshots).toHaveLength(1);
    expect(snapshot?.namespace).toBe('default');
    expect(snapshot?.limits.soqlQueries).toEqual({ used: 8, limit: 100, percentUsed: 8 });
    expect(flatten(apexLog).at(-1)?.text).toBe('(default)\nNumber of SOQL queries: 8/100');
  });
});
