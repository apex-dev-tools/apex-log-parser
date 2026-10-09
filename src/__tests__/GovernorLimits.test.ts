/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LimitMetric, Limits } from '../limits.js';
import { parse } from './helpers.js';

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

// Parsed values on single lines (heap bytes, LIMIT_USAGE and the flow reports) wait for their own piece.
describe('the cumulative limit block', () => {
  const apexLog = parse(
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      CUMULATIVE_BLOCK +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n',
  );

  it('parses the whole cumulative LIMIT_USAGE_FOR_NS block (shared parser)', () => {
    const snapshot = apexLog.limits.snapshots.at(-1);
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
    const limits = partial.limits.byNamespace.get('default')?.final;
    expect(limits?.soqlQueries).toEqual({ used: 25, limit: 100, percentUsed: 25 });
    expect(limits?.cpuTime).toEqual({ used: 0, limit: 0, percentUsed: null });
  });
});

describe('every metric across namespaces', () => {
  // In log order: the line's name, the metric and the limit.
  const METRICS: [string, LimitMetric, number][] = [
    ['Number of SOQL queries', 'soqlQueries', 100],
    ['Number of query rows', 'queryRows', 50000],
    ['Number of SOSL queries', 'soslQueries', 20],
    ['Number of DML statements', 'dmlStatements', 150],
    ['Number of Publish Immediate DML', 'publishImmediateDml', 150],
    ['Number of DML rows', 'dmlRows', 10000],
    ['Maximum CPU time', 'cpuTime', 10000],
    ['Maximum heap size', 'heapSize', 6000000],
    ['Number of callouts', 'callouts', 100],
    ['Number of Email Invocations', 'emailInvocations', 10],
    ['Number of future calls', 'futureCalls', 50],
    ['Number of queueable jobs added to the queue', 'queueableJobsAddedToQueue', 50],
    ['Number of Mobile Apex push calls', 'mobileApexPushCalls', 10],
  ];
  const metrics = (figures: number[]): string =>
    METRICS.map(([name, , limit], i) => `  ${name}: ${figures[i]} out of ${limit}\n`).join('');
  const used = (limits: Limits | undefined) =>
    limits && METRICS.map(([, metric]) => [limits[metric].used, limits[metric].limit]);
  const pairs = (figures: number[]) => figures.map((n, i) => [n, METRICS[i]?.[2]]);
  const apexLog = parse(
    '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
      '12:43:02.105 (48105827767)|LIMIT_USAGE_FOR_NS|(default)|\n' +
      metrics([17, 121, 3, 8, 5, 113, 15008, 300, 2, 1, 2, 6, 1]) +
      '12:43:02.105 (48105827768)|LIMIT_USAGE_FOR_NS|myNS|\n' +
      metrics([2, 10, 1, 1, 0, 5, 2000, 100, 1, 5, 2, 3, 0]) +
      '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n',
  );

  it('reads every metric of each namespace', () => {
    expect([...apexLog.limits.byNamespace.keys()]).toEqual(['default', 'myNS']);
    expect(used(apexLog.limits.byNamespace.get('default')?.final)).toEqual(
      pairs([17, 121, 3, 8, 5, 113, 15008, 300, 2, 1, 2, 6, 1]),
    );
    expect(used(apexLog.limits.byNamespace.get('myNS')?.final)).toEqual(
      pairs([2, 10, 1, 1, 0, 5, 2000, 100, 1, 5, 2, 3, 0]),
    );
  });

  it('sums each metric for the log, but takes the highest heap', () => {
    // Heap is shared across namespaces, so max(300, 100), never the sum (#862).
    expect(used(apexLog.limits.final)).toEqual(
      pairs([19, 131, 4, 9, 5, 118, 17008, 300, 3, 6, 4, 9, 1]),
    );
  });
});

describe('derived governor limit figures', () => {
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
    const { final, peak, byNamespace } = apexLog.limits;
    // The combined peak (14) is at the timepoint myNS reported, when default still stood at 10.
    expect(final.soqlQueries.used).toBe(10);
    expect(peak.soqlQueries.used).toBe(14);
    expect(byNamespace.get('default')?.final.soqlQueries.used).toBe(6);
    expect(byNamespace.get('default')?.peak.soqlQueries.used).toBe(10);
    expect(byNamespace.get('myNS')?.final.soqlQueries.used).toBe(4);
    expect(byNamespace.get('myNS')?.peak.soqlQueries.used).toBe(4);
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
    const snapshot = apexLog.limits.snapshots.at(-1);
    expect(apexLog.limits.snapshots).toHaveLength(1);
    expect(snapshot?.namespace).toBe('default');
    expect(snapshot?.limits.soqlQueries).toEqual({ used: 8, limit: 100, percentUsed: 8 });
    expect([...apexLog.events].at(-1)?.text).toBe('(default)\nNumber of SOQL queries: 8/100');
  });
});

describe('LIMIT_USAGE_FOR_NS namespace', () => {
  const apexLog = parse(
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
      '  Number of SOQL queries: 1 out of 100\n' +
      '09:18:22.6 (700)|LIMIT_USAGE_FOR_NS|(myNS)|\n' +
      '  Number of SOQL queries: 2 out of 100\n' +
      '09:18:22.6 (900)|LIMIT_USAGE_FOR_NS|otherNS|\n' +
      '  Number of SOQL queries: 3 out of 100\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
  );
  const events = [...apexLog.events].filter((e) => e.type === 'LIMIT_USAGE_FOR_NS');

  // `(default)` is no namespace: null on the event, and not in the log's list.
  it('strips the parentheses, with or without them in the log', () => {
    expect(events.map((e) => e.namespace)).toEqual([null, 'myNS', 'otherNS']);
    expect(apexLog.limits.snapshots.map((s) => s.namespace)).toEqual([
      'default',
      'myNS',
      'otherNS',
    ]);
  });

  it('adds each one but the default to the namespaces of the log', () => {
    expect(apexLog.namespaces).toEqual(['myNS', 'otherNS']);
  });
});
