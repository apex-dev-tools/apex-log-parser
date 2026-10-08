import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { MARKER } from '../scripts/deopt.js';

const script = fileURLToPath(new URL('../scripts/deopt.ts', import.meta.url));
// The two deopts a GC causes when the engine's object layouts die with the last parse.
const LOST_TO_GC = /reason: (weak objects|wrong map)/;
// Proof the trace is read at all, so a V8 that words it otherwise fails here, not passes.
const OPTIMISED = /completed \w+ .*\breadEvent\b/;

describe.each(['node', 'browser'])('the %s engine', (engine) => {
  it('keeps its optimised code across full GCs between parses', { timeout: 60_000 }, () => {
    const child = spawnSync(
      execPath,
      [
        '--expose-gc',
        '--trace-opt',
        '--trace-deopt',
        '--import',
        'tsx',
        script,
        `--engine=${engine}`,
      ],
      { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
    );
    expect(child.status, child.stderr).toBe(0);
    const [before = '', after] = child.stdout.split(MARKER);
    expect(after, 'the script printed no marker').toBeDefined();
    expect(before).toMatch(OPTIMISED);
    const lost = (after ?? '').split('\n').filter((line) => LOST_TO_GC.test(line));
    expect(lost).toEqual([]);
  });
});
