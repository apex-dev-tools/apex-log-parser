import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { nodeEngine } from '../../src/engine/node.js';
import { apexLog } from '../../src/views/log.js';
import { findLogs } from '../scripts/compare/compare.js';
import { compareKeys, diffProjections, same } from '../scripts/compare/diff.js';
import type { LogFact } from '../scripts/compare/facts.js';
import { nextFacts, nextProjection } from '../scripts/compare/facts.js';
import type { Entry, Projection } from '../scripts/compare/project.js';
import { canonical } from '../scripts/compare/project.js';
import type { FileResult } from '../scripts/compare/report.js';
import { percentile, renderReport } from '../scripts/compare/report.js';

const log = [
  '64.0 APEX_CODE,FINE;DB,INFO',
  '09:00:00.001 (1000000)|EXECUTION_STARTED',
  '09:00:00.001 (1200000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
  '09:00:00.002 (2000000)|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.load()',
  '09:00:00.003 (3000000)|SOQL_EXECUTE_BEGIN|[12]|Aggregations:0|SELECT Id FROM Account',
  '09:00:00.005 (5500000)|SOQL_EXECUTE_END|[12]|Rows:10',
  '09:00:00.007 (7000000)|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.load()',
  '09:00:00.008 (8000000)|CODE_UNIT_FINISHED|execute_anonymous_apex',
  '09:00:00.008 (8100000)|EXECUTION_FINISHED',
].join('\n');

const records = (p: Projection): Map<string, Record<string, unknown>> =>
  new Map([...p].map(([k, v]) => [k, v as Record<string, unknown>]));

const built = (text: string) => apexLog(nodeEngine.build(new TextEncoder().encode(text)));
const facts = (text: string): Entry[] => [...nextFacts(built(text))];

describe('canonical', () => {
  it('sorts keys, so field order does not count', () => {
    expect(canonical({ b: 1, a: 2 })).toBe(canonical({ a: 2, b: 1 }));
  });

  it('keeps undefined, NaN and -0 apart from null and 0', () => {
    expect(canonical({ a: undefined })).not.toBe(canonical({ a: null }));
    expect(canonical(Number.NaN)).not.toBe(canonical(null));
    expect(canonical(-0)).not.toBe(canonical(0));
  });
});

describe('diffProjections', () => {
  const p = (entries: [string, unknown][]): Projection => entries;

  it('finds no difference between two parses of one log', () => {
    const result = diffProjections(nextProjection(built(log)), nextProjection(built(log)));
    expect(result).toEqual({ records: 5, differing: 0, differences: [] });
  });

  it('names the path of a changed field', () => {
    const result = diffProjections(
      p([['0', { duration: { self: 1, total: 2 } }]]),
      p([['0', { duration: { self: 1, total: 3 } }]]),
    );
    expect(result.differences).toEqual([
      { key: '0', path: 'duration.total', left: '2', right: '3' },
    ]);
  });

  it('reports a field or a record only one side has', () => {
    const result = diffProjections(
      p([['log', { a: 1 }]]),
      p([
        ['log', { a: 1, b: 2 }],
        ['0', {}],
      ]),
    );
    expect(result.differing).toBe(2);
    expect(result.differences).toEqual([
      { key: 'log', path: 'b', left: '<absent>', right: '2' },
      { key: '0', path: '', left: '<absent>', right: '0' },
    ]);
  });

  it('reports a node only one side has once, and lines up the nodes after it', () => {
    const result = diffProjections(
      p([
        ['log', {}],
        ['0', 1],
        ['0/0', 2],
        ['1', 3],
      ]),
      p([
        ['log', {}],
        ['0', 1],
        ['1', 3],
      ]),
    );
    expect(result).toEqual({
      records: 4,
      differing: 1,
      differences: [{ key: '0/0', path: '', left: '0/0', right: '<absent>' }],
    });
  });

  it('counts every differing record past the limit, but lists only the limit', () => {
    const many = (n: number): Projection => [
      ['0', n],
      ['1', n],
      ['2', n],
    ];
    const result = diffProjections(many(1), many(2), 2);
    expect(result.differing).toBe(3);
    expect(result.differences).toHaveLength(2);
  });
});

describe('nextFacts', () => {
  it('gives one record per tree node, in pre-order, with no exit lines', () => {
    const out = records(facts(log));
    expect([...out.keys()]).toEqual(['log', '0', '0/0', '0/0/0', '0/0/0/0']);
    expect(out.get('0/0/0/0')).toMatchObject({
      type: 'SOQL_EXECUTE_BEGIN',
      lineNumber: 12,
      exitStamp: 5500000,
      counts: { soql: { self: 1, total: 1 }, soqlRows: { self: 10, total: 10 } },
    });
    expect(out.get('0/0')?.counts).toMatchObject({ soqlRows: { self: 0, total: 10 } });
  });

  it('states every reference to an event as its tree path, and an exit line by its type and time', () => {
    const skipped = log.replace(
      'METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.load()',
      'METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.load()\n*** Skipped 1,024 bytes of detailed log',
    );
    const fact = records(facts(skipped)).get('log') as unknown as LogFact;
    expect(fact.entryPoints).toEqual([{ node: '0/0' }]);
    expect(fact.truncation.regions).toEqual([
      expect.objectContaining({ at: { offTree: 'METHOD_EXIT', at: 7000000 }, skippedBytes: 1024 }),
    ]);
  });

  it('states an empty line-number field as null, and keeps a stated 0', () => {
    const out = records(
      facts(
        [
          '64.0 APEX_CODE,FINE',
          '09:00:00.001 (1000000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
          '09:00:00.002 (2000000)|STATEMENT_EXECUTE|[0]',
          '09:00:00.003 (3000000)|STATEMENT_EXECUTE|',
          '09:00:00.004 (4000000)|CODE_UNIT_FINISHED|execute_anonymous_apex',
        ].join('\n'),
      ),
    );
    expect(out.get('0/0')).toMatchObject({ lineNumber: 0, namespace: null });
    expect(out.get('0/1')).toMatchObject({ lineNumber: null, namespace: null });
    expect((out.get('log') as unknown as LogFact).namespaces).toEqual([]);
  });
});

describe('nextProjection', () => {
  it('states each facts record, and adds each event its text figures', () => {
    const parsed = built(log);
    const stated = [...nextFacts(parsed)];
    const full = [...nextProjection(parsed)];
    const events = [...parsed.events];

    expect(full.map(([key]) => key)).toEqual(stated.map(([key]) => key));
    expect(full[0]).toEqual(stated[0]);
    expect(full.slice(1)).toEqual(
      stated.slice(1).map(([key, node], i) => {
        const event = events[i];
        return [
          key,
          {
            ...(node as object),
            text: event?.text,
            logLine: event?.logLine,
            suffix: event?.suffix,
            cpuType: event?.cpuType,
            hasValidSymbols: event?.hasValidSymbols,
          },
        ];
      }),
    );
    expect(full).toHaveLength(parsed.eventCount + 1);
  });
});

describe('compareKeys', () => {
  it('orders keys as a pre-order walk: the log, then parents before children', () => {
    const keys = ['1', '0/10', 'log', '0', '0/2', '0/2/0'];
    expect(keys.sort(compareKeys)).toEqual(['log', '0', '0/2', '0/2/0', '0/10', '1']);
  });
});

describe('same', () => {
  it('ignores key order, and keeps undefined apart from absent', () => {
    expect(same({ a: 1, b: [2] }, { b: [2], a: 1 })).toBe(true);
    expect(same({ a: undefined }, {})).toBe(false);
    expect(same(Number.NaN, Number.NaN)).toBe(true);
    expect(same([1], { 0: 1 })).toBe(false);
  });
});

describe('findLogs', () => {
  it('finds .log and .txt files in any case, and skips dot entries', () => {
    const dir = mkdtempSync(join(tmpdir(), 'compare-'));
    mkdirSync(join(dir, 'sub'));
    mkdirSync(join(dir, '.hidden'));
    for (const f of ['a.log', 'sub/b.TXT', 'c.Log', 'd.csv', '.e.log', '.hidden/f.log']) {
      writeFileSync(join(dir, f), '');
    }
    expect(findLogs(dir).map((f) => f.slice(dir.length + 1))).toEqual([
      'a.log',
      'c.Log',
      'sub/b.TXT',
    ]);
  });
});

describe('report', () => {
  it('takes the nearest-rank percentile', () => {
    expect(percentile([5, 1, 3, 2, 4], 50)).toBe(3);
    expect(percentile([5, 1, 3, 2, 4], 95)).toBe(5);
    expect(percentile([], 50)).toBeNaN();
  });

  it('states the speed-up and memory ratio against the first engine', () => {
    const run = (warmMs: number, retainedBytes: number) => ({
      coldMs: warmMs,
      warmRunsMs: [warmMs],
      warmupRuns: 2,
      retainedBytes,
    });
    const results: FileResult[] = [
      { file: 'a.log', bytes: 100, runs: { old: run(100, 1000), new: run(10, 100) }, diffs: {} },
    ];
    expect(renderReport(results, ['old', 'new'])).toMatch(
      /\| new \|.*\| 10\.0× faster \(-90\.0%\) \| 10\.0× less \(-90\.0%\) \|/,
    );
  });

  it('states each engine against its own figures in a baseline run, for the logs both timed', () => {
    const run = (ms: number, retainedBytes: number) => ({
      coldMs: ms,
      warmRunsMs: [ms],
      warmupRuns: 2,
      retainedBytes,
    });
    const now: FileResult[] = [
      { file: 'a.log', bytes: 100, runs: { old: run(90, 2000) }, diffs: {} },
      { file: 'new.log', bytes: 100, runs: { old: run(1, 1) }, diffs: {} },
    ];
    const before: FileResult[] = [
      { file: 'a.log', bytes: 100, runs: { old: run(100, 1000) }, diffs: {} },
    ];
    expect(renderReport(now, ['old'], before)).toContain(
      '| < 1 MB | old | 1 | 100 ms → 90 ms, 1.1× faster (-10.0%) | 100 ms → 90 ms, 1.1× faster (-10.0%) | 1 KB → 2 KB, 2.0× more (+100.0%) |',
    );
    expect(renderReport(now, ['old'])).not.toContain('baseline run');
  });

  it('gives each log over 20 MB a row, by size only', () => {
    const run = (warmMs: number, retainedBytes: number) => ({
      coldMs: warmMs,
      warmRunsMs: [warmMs],
      warmupRuns: 2,
      retainedBytes,
    });
    const MB = 1024 * 1024;
    const results: FileResult[] = [
      {
        file: 'big.log',
        bytes: 30 * MB,
        runs: { old: run(400, 300 * MB), new: run(100, 10 * MB) },
        diffs: {},
      },
      {
        file: 'mid.log',
        bytes: 10 * MB,
        runs: { old: run(100, 80 * MB), new: run(30, 3 * MB) },
        diffs: {},
      },
    ];
    const report = renderReport(results, ['old', 'new']);
    expect(report).toContain('### 20–50 MB (1 logs)');
    expect(report).toContain(
      '| 30.0 MB | 400 ms | 400 ms | 300.0 MB | 100 ms | 100 ms | 10.0 MB | 4.0× faster (-75.0%) | 4.0× faster (-75.0%) | 30.0× less (-96.7%) |',
    );
    expect(report).not.toContain('| 10.0 MB | 100 ms | 100 ms |');
    expect(report).not.toContain('big.log');
  });
});
