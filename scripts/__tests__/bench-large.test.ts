import { report } from '../bench-large.js';

describe('bench-large', () => {
  it('reports each log, with its change from the baseline', () => {
    const results = [
      { name: 'large 40 MB', ms: 1100, heapBytes: 330_000_000 },
      { name: 'large 80 MB', ms: 2000, heapBytes: 600_000_000 },
    ];

    expect(report(results, [{ name: 'large 40 MB', ms: 1000, heapBytes: 300_000_000 }])).toEqual([
      'large 40 MB: 1100 ms (+10.0%), heap 330 MB (+10.0%)',
      'large 80 MB: 2000 ms, heap 600 MB',
    ]);
  });
});
