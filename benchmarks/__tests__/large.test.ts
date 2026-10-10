import { heapGrowth, report } from '../scripts/large.js';

describe('bench-large', () => {
  it('reports each log, with its change from the baseline', () => {
    const results = [
      { name: 'parse_20mb', ms: 1100, heapBytes: 330_000_000 },
      { name: 'parse_100mb', ms: 2000, heapBytes: 600_000_000 },
    ];

    expect(report(results, [{ name: 'parse_20mb', ms: 1000, heapBytes: 300_000_000 }])).toEqual([
      'parse_20mb: 1100 ms (was 1000 ms, 1.1× slower, +10.0%), heap 330 MB (was 300 MB, 1.1× more, +10.0%)',
      'parse_100mb: 2000 ms, heap 600 MB (not in baseline)',
    ]);
  });

  it('flags nothing when no baseline is given', () => {
    expect(report([{ name: 'parse_100mb', ms: 2000, heapBytes: 600_000_000 }])).toEqual([
      'parse_100mb: 2000 ms, heap 600 MB',
    ]);
  });

  it('names each log whose heap grew past the limit, and only those', () => {
    const baseline = [
      { name: 'parse_8mb', ms: 100, heapBytes: 100_000_000 },
      { name: 'parse_20mb', ms: 200, heapBytes: 200_000_000 },
    ];
    const results = [
      // +2.5%: past a 2% limit, although its time fell.
      { name: 'parse_8mb', ms: 50, heapBytes: 102_500_000 },
      // +2% exactly: at the limit, not past it.
      { name: 'parse_20mb', ms: 900, heapBytes: 204_000_000 },
      { name: 'parse_100mb', ms: 2000, heapBytes: 999_000_000 },
    ];

    expect(heapGrowth(results, baseline, 2)).toEqual(['parse_8mb']);
  });
});
