// In benchmarks/, not src/, because reading the V8 heap needs node APIs.
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { largeLogs, makeLog } from '../fixtures/fixtures.js';
import { measureLog } from '../scripts/large.js';

// Retained heap per log character. A deliberate change updates it, as for a pinned log hash.
const pinnedBytesPerChar = 0.547;

setFlagsFromString('--expose-gc');
// liveBytes reads the global gc, which the flag does not add to a running process.
(globalThis as { gc?: () => void }).gc ??= runInNewContext('gc') as () => void;

describe('parse heap', () => {
  it('keeps the result of an 8 MB log within 5% of its pinned bytes per character', async () => {
    const options = largeLogs.parse_8mb;
    if (!options) throw new Error('largeLogs has no parse_8mb log');
    const log = makeLog(options);
    const bytesPerChar = (await measureLog(log, 3)).heapBytes / log.length;
    expect(bytesPerChar).toBeGreaterThan(pinnedBytesPerChar * 0.95);
    expect(bytesPerChar).toBeLessThan(pinnedBytesPerChar * 1.05);
  });
});
