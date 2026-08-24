/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { emptyLimits } from '../limits.js';
import { ALL_LIMIT_METRICS, LIMIT_METRIC } from '../publicTypes.js';

describe('governor metric metadata', () => {
  // Membership is compile-enforced; the array compare is here for the declaration order.
  it('covers every metric the parser tracks, in the same order', () => {
    expect(Object.keys(LIMIT_METRIC)).toEqual(Object.keys(emptyLimits()));
  });

  it('states a label for every metric', () => {
    for (const metric of ALL_LIMIT_METRICS) {
      expect(metric.label).not.toBe('');
    }
  });

  // The point of the CLDR identifiers: a consumer formats without a table of its own.
  it('states units Intl.NumberFormat accepts', () => {
    for (const metric of ALL_LIMIT_METRICS) {
      if (metric.unit === 'count') {
        continue;
      }
      expect(() =>
        new Intl.NumberFormat('en', { style: 'unit', unit: metric.unit }).format(1),
      ).not.toThrow();
    }
  });

  it('names the metrics the log states in a different unit', () => {
    expect(LIMIT_METRIC.cpuTime).toEqual({
      key: 'cpuTime',
      label: 'CPU time',
      unit: 'millisecond',
    });
    expect(LIMIT_METRIC.heapSize).toEqual({ key: 'heapSize', label: 'Heap size', unit: 'byte' });
  });
});
