import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';
import { fileURLToPath } from 'node:url';
import { GC_MARKER, PLAIN_MARKER } from '../scripts/deopt.js';

const script = fileURLToPath(new URL('../scripts/deopt.ts', import.meta.url));
const DEOPT = /bailout \(kind/;
// Maglev code leaving a hot loop to enter TurboFan's: a tier up, which lands in any phase as the machine times it.
const TIER_UP = /reason: prepare for on stack replacement/;
// Code compiled before one path had feedback: it learns the path and optimises again. Node 26 does
// this once, at a random parse, so once per function is a tier up and twice is a deopt loop.
const SOFT = /reason: Insufficient type feedback/;
const functionOf = (line: string): string => /<JSFunction (\S*)/.exec(line)?.[1] ?? line;
// The two deopts a GC causes when the engine's object layouts die with the last parse.
const LOST_TO_GC = /reason: (weak objects|wrong map)/;
// Proof the trace is read at all, so a V8 that words it otherwise fails here, not passes.
const OPTIMISED = /completed \w+ .*\breadEvent\b/;

const linesOf = (text: string, pattern: RegExp): string[] =>
  text.split('\n').filter((line) => pattern.test(line));

describe.each(['node', 'browser'])('the %s engine', (engine) => {
  const run = (): { warmUp: string; plain: string; afterGc: string } => {
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
    const [warmUp = '', rest = ''] = child.stdout.split(PLAIN_MARKER);
    const [plain = '', afterGc] = rest.split(GC_MARKER);
    expect(afterGc, 'the script printed no markers').toBeDefined();
    return { warmUp, plain, afterGc: afterGc ?? '' };
  };

  it('keeps its optimised code in a loop of parses, and across full GCs between them', {
    timeout: 60_000,
  }, () => {
    const { warmUp, plain, afterGc } = run();
    expect(warmUp).toMatch(OPTIMISED);
    const deopts = linesOf(plain, DEOPT).filter((line) => !TIER_UP.test(line));
    expect(deopts.filter((line) => !SOFT.test(line))).toEqual([]);
    const soft = deopts.filter((line) => SOFT.test(line)).map(functionOf);
    expect(soft).toEqual([...new Set(soft)]);
    expect(linesOf(afterGc, LOST_TO_GC)).toEqual([]);
  });
});
