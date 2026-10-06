import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from '../../src/index.js';
import { findLogs } from '../compare/compare.js';
import { compareKeys, diffProjections, same } from '../compare/diff.js';
import type { Projection } from '../compare/project.js';
import { canonical, projectLegacy } from '../compare/project.js';
import type { FileResult } from '../compare/report.js';
import { percentile, renderReport } from '../compare/report.js';

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

describe('projectLegacy', () => {
  it('gives one record per tree node, in pre-order, with no exit lines', () => {
    const out = records(projectLegacy(parse(log)));
    expect([...out.keys()]).toEqual(['log', '0', '0/0', '0/0/0', '0/0/0/0']);
    expect([...out.values()].map((r) => r.type)).toEqual([
      null,
      'EXECUTION_STARTED',
      'CODE_UNIT_STARTED',
      'METHOD_ENTRY',
      'SOQL_EXECUTE_BEGIN',
    ]);
  });

  it('states every reference to an event as its tree path', () => {
    const out = records(projectLegacy(parse(log)));
    expect(out.get('log')?.entryPoints).toEqual([{ node: '0/0' }]);
    expect(out.get('0/0/0')?.children).toEqual([{ node: '0/0/0/0' }]);
  });

  it('keeps the subclass fields and leaves out parser state', () => {
    const soql = records(projectLegacy(parse(log))).get('0/0/0/0');
    expect(soql?.aggregations).toBe(0);
    expect(soql?.soqlRowCount).toEqual({ self: 10, total: 10 });
    expect(soql).not.toHaveProperty('logParser');
    expect(soql).not.toHaveProperty('eventIndex');
    expect(soql).not.toHaveProperty('parent');
  });
});

describe('diffProjections', () => {
  const p = (entries: [string, unknown][]): Projection => entries;

  it('finds no difference between two parses of one log', () => {
    const result = diffProjections(projectLegacy(parse(log)), projectLegacy(parse(log)));
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
      retainedBytes,
    });
    const results: FileResult[] = [
      { file: 'a.log', bytes: 100, runs: { old: run(100, 1000), new: run(10, 100) }, diffs: {} },
    ];
    expect(renderReport(results, ['old', 'new'])).toMatch(/\| new \|.*\| 10\.0× \| 10\.0× less \|/);
  });

  it('states each engine against its own figures in a baseline run, for the logs both timed', () => {
    const run = (ms: number, retainedBytes: number) => ({
      coldMs: ms,
      warmRunsMs: [ms],
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
      '| < 1 MB | old | 1 | -10.0% | -10.0% | +100.0% |',
    );
    expect(renderReport(now, ['old'])).not.toContain('baseline run');
  });
});
