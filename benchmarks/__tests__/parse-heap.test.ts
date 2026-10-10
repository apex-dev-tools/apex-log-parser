// In benchmarks/, not src/, because reading the V8 heap needs node APIs.
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { largeLogs, makeLog } from '../fixtures/fixtures.js';
import { measureLog } from '../scripts/large.js';

// Retained heap per log character. A deliberate change updates it, as for a pinned log hash.
const pinnedBytesPerChar = 9.55;

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

describe('parse heap', () => {
  // Its log time passes 2^31 ns, so V8 boxes the times, as in a real log of this size.
  it('keeps the tree of an 8 MB log within 5% of its pinned bytes per character', () => {
    const options = largeLogs['parse_8mb'];
    if (!options) throw new Error('largeLogs has no parse_8mb log');
    const log = makeLog(options);
    const bytesPerChar = measureLog(log, gc, 3).heapBytes / log.length;
    expect(bytesPerChar).toBeGreaterThan(pinnedBytesPerChar * 0.95);
    expect(bytesPerChar).toBeLessThan(pinnedBytesPerChar * 1.05);
  });
});
