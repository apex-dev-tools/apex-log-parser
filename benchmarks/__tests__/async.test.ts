import { parse } from '../../src/node.js';
import { abortLatency, longestTurn, reopenMs } from '../scripts/async.js';

/** Holds the host for `ms`, as one long task does. */
const block = (ms: number): void => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};

const LOG = [
  '64.0 APEX_CODE,FINE',
  '09:00:00.001 (1000)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.run()',
  '09:00:00.001 (4000)|METHOD_EXIT|[1]|01p000000000AAA|MyClass.run()',
].join('\n');

describe('longestTurn', () => {
  it('reads the longest task the work ran, not its whole time', async () => {
    const start = performance.now();
    const worst = await longestTurn(async () => {
      for (const ms of [15, 20, 15]) {
        block(ms);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });
    const total = performance.now() - start;
    expect(worst).toBeGreaterThanOrEqual(20);
    // Each block holds the wall clock in its own turn, so the two 15 ms ones stay outside the worst
    // under any load; a fixed bound fails when the OS pauses the process.
    expect(total - worst).toBeGreaterThanOrEqual(29);
  });
});

describe('reopenMs', () => {
  it('moves the log, so the one it timed is unreadable after', async () => {
    const log = await parse(LOG);
    expect(reopenMs(log)).toBeGreaterThanOrEqual(0);
    expect(log.columns.type.length).toBe(0);
  });
});

describe('abortLatency', () => {
  it('is null when the parse ends before the abort', async () => {
    expect(await abortLatency(new TextEncoder().encode(LOG), 1000)).toBeNull();
  });
});
