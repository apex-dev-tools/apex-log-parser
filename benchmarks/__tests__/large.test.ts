import { makeLog, profileLog } from '../fixtures/fixtures.js';
import { engineNamed } from '../scripts/engines.js';
import { heapGrowth, measurePeak, report } from '../scripts/large.js';

describe('bench-large', () => {
  it('measures the build each engine name states, and no other', async () => {
    const log = makeLog(profileLog('small', 1, 20_000));
    const bytes = new TextEncoder().encode(log);
    const node = await engineNamed('node');
    const browser = await engineNamed('browser');
    expect(await engineNamed(null)).toBe(node);
    expect(browser).not.toBe(node);
    expect(browser.build(bytes).store.count).toBe(node.build(bytes).store.count);
    await expect(engineNamed('deno')).rejects.toThrow('No engine is named deno');
  });

  it('adds the peak, with its change when the baseline states one', () => {
    const results = [
      { name: 'parse_20mb', ms: 1000, heapBytes: 300_000_000, peakBytes: 900_000_000 },
      { name: 'parse_100mb', ms: 2000, heapBytes: 600_000_000, peakBytes: 1_500_000_000 },
    ];
    const baseline = [
      { name: 'parse_20mb', ms: 1000, heapBytes: 300_000_000, peakBytes: 1_000_000_000 },
      { name: 'parse_100mb', ms: 2000, heapBytes: 600_000_000 },
    ];

    // The time and heap wording belongs to the test below.
    expect(report(results, baseline).map((line) => line.slice(line.indexOf(', peak')))).toEqual([
      ', peak RSS 900 MB (was 1000 MB, 1.1× less, -10.0%)',
      ', peak RSS 1500 MB (no baseline peak)',
    ]);
  });

  it('measures the peak of a parse in a fresh process', () => {
    // Large enough to raise the process's high-water mark, which a tiny log does not.
    const log = makeLog(profileLog('developer', 2, 4_000_000));
    expect(measurePeak(log, 1)).toBeGreaterThan(0);
  }, 60_000);

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
