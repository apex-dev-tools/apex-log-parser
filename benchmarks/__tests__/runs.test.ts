import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { median, runsFlag, timedRuns } from '../scripts/runs.js';

setFlagsFromString('--expose-gc');
// liveBytes reads the global gc, which the flag does not add to a running process.
(globalThis as { gc?: () => void }).gc ??= runInNewContext('gc') as () => void;

describe('median', () => {
  it('takes the middle of an odd list, and the mean of the middle two of an even one', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('leaves its argument unsorted', () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('runsFlag', () => {
  it('reads --runs, and gives the fallback without it', () => {
    expect(runsFlag(['--runs=3'])).toBe(3);
    expect(runsFlag([])).toBe(5);
    expect(runsFlag([], 7)).toBe(7);
  });

  it.each(['0', '1.5', 'abc'])('rejects --runs=%s', (value) => {
    expect(() => runsFlag([`--runs=${value}`])).toThrow('whole number of at least 1');
  });
});

describe('timedRuns', () => {
  it('calls once to warm up and once per run, and reports finite figures', async () => {
    let calls = 0;
    const result = await timedRuns(3, () => ++calls);
    expect(calls).toBe(4);
    expect(Number.isFinite(result.ms)).toBe(true);
    expect(Number.isFinite(result.heapBytes)).toBe(true);
  });
});
