/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { emptyLimits, LIMIT_METRICS } from '../limits.js';

describe('LIMIT_METRICS', () => {
  it('lists every metric with its unit', () => {
    expect(Object.keys(LIMIT_METRICS)).toEqual(Object.keys(emptyLimits()));
    expect(LIMIT_METRICS.cpuTime).toBe('millisecond');
    expect(LIMIT_METRICS.heapSize).toBe('byte');
    expect(LIMIT_METRICS.soqlQueries).toBe('count');
    expect(Object.isFrozen(LIMIT_METRICS)).toBe(true);
  });
});
