/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { emptyLimits, governorLimits, LIMIT_METRICS, limitsOfBlock } from '../limits.js';

describe('LIMIT_METRICS', () => {
  it('lists every metric with its unit', () => {
    expect(Object.keys(LIMIT_METRICS)).toEqual(Object.keys(emptyLimits()));
    expect(LIMIT_METRICS.cpuTime).toBe('millisecond');
    expect(LIMIT_METRICS.heapSize).toBe('byte');
    expect(LIMIT_METRICS.soqlQueries).toBe('count');
    expect(Object.isFrozen(LIMIT_METRICS)).toBe(true);
  });
});

describe('governorLimits', () => {
  const block = (soql: number, heap: number) =>
    limitsOfBlock(
      `(ns)\nNumber of SOQL queries: ${soql}/100\nMaximum heap size: ${heap}/6000000\nUnknown: 1/2`,
    );

  it('sums the namespaces, takes the highest heap, and keeps each namespace last figure', () => {
    const limits = governorLimits(
      [
        { timestamp: 1, namespace: 'default', limits: block(5, 100) },
        { timestamp: 2, namespace: 'ns', limits: block(3, 400) },
        { timestamp: 3, namespace: 'default', limits: block(2, 50) },
      ],
      0,
    );
    expect(limits.final.soqlQueries).toEqual({ used: 5, limit: 100, percentUsed: 5 });
    expect(limits.final.heapSize.used).toBe(400);
    expect(limits.peak.soqlQueries.used).toBe(8);
    expect([...limits.byNamespace.keys()]).toEqual(['default', 'ns']);
    expect(limits.byNamespace.get('default')?.final.soqlQueries.used).toBe(2);
    expect(limits.byNamespace.get('default')?.peak.soqlQueries.used).toBe(5);
  });

  it('folds the heap events peak into the combined peak', () => {
    expect(governorLimits([], 900).peak.heapSize).toEqual({
      used: 900,
      limit: 0,
      percentUsed: null,
    });
  });
});
