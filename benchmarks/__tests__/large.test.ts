import { heapGrowth, report } from '../scripts/large.js';

describe('bench-large', () => {
  it('reports each log, with its change from the baseline', () => {
    const results = [
      { name: 'large 20 MB', ms: 1100, heapBytes: 330_000_000 },
      { name: 'XL 100 MB', ms: 2000, heapBytes: 600_000_000 },
    ];

    expect(report(results, [{ name: 'large 20 MB', ms: 1000, heapBytes: 300_000_000 }])).toEqual([
      'large 20 MB: 1100 ms (was 1000 ms, 1.1× slower, +10.0%), heap 330 MB (was 300 MB, 1.1× more, +10.0%)',
      'XL 100 MB: 2000 ms, heap 600 MB (not in baseline)',
    ]);
  });

  it('flags nothing when no baseline is given', () => {
    expect(report([{ name: 'XL 100 MB', ms: 2000, heapBytes: 600_000_000 }])).toEqual([
      'XL 100 MB: 2000 ms, heap 600 MB',
    ]);
  });

  it('names each log whose heap grew past the limit, and only those', () => {
    const baseline = [
      { name: 'medium 8 MB', ms: 100, heapBytes: 100_000_000 },
      { name: 'large 20 MB', ms: 200, heapBytes: 200_000_000 },
    ];
    const results = [
      // +2.5%: past a 2% limit, although its time fell.
      { name: 'medium 8 MB', ms: 50, heapBytes: 102_500_000 },
      // +2% exactly: at the limit, not past it.
      { name: 'large 20 MB', ms: 900, heapBytes: 204_000_000 },
      { name: 'XL 100 MB', ms: 2000, heapBytes: 999_000_000 },
    ];

    expect(heapGrowth(results, baseline, 2)).toEqual(['medium 8 MB']);
  });
});
