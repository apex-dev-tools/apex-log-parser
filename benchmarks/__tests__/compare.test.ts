import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from '../../src/index.js';
import { nodeEngine } from '../../src/next/node.js';
import { findLogs } from '../scripts/compare/compare.js';
import { compareKeys, diffProjections, same } from '../scripts/compare/diff.js';
import type { LogFact } from '../scripts/compare/facts.js';
import { legacyFacts, nextFacts } from '../scripts/compare/facts.js';
import type { Entry, KnownDifference } from '../scripts/compare/known.js';
import { explainer } from '../scripts/compare/known.js';
import type { Projection } from '../scripts/compare/project.js';
import { canonical, projectLegacy } from '../scripts/compare/project.js';
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

describe('legacyFacts', () => {
  it('gives one record per tree node, in pre-order, keyed like the full projection', () => {
    const out = records(legacyFacts(parse(log)));
    expect([...out.keys()]).toEqual(['log', '0', '0/0', '0/0/0', '0/0/0/0']);
    expect(out.get('0/0/0/0')).toMatchObject({
      type: 'SOQL_EXECUTE_BEGIN',
      lineNumber: 12,
      exitStamp: 5500000,
      counts: { soql: { self: 1, total: 1 }, soqlRows: { self: 10, total: 10 } },
    });
    expect(out.get('0/0')?.counts).toMatchObject({ soqlRows: { self: 0, total: 10 } });
  });

  it('refers to an event the tree does not hold by its type and time', () => {
    const skipped = log.replace(
      'METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.load()',
      'METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.load()\n*** Skipped 1,024 bytes of detailed log',
    );
    const facts = records(legacyFacts(parse(skipped))).get('log') as unknown as LogFact;
    expect(facts.entryPoints).toEqual([{ node: '0/0' }]);
    expect(facts.truncation.regions).toEqual([
      expect.objectContaining({ at: { offTree: 'METHOD_EXIT', at: 7000000 }, skippedBytes: 1024 }),
    ]);
  });

  it('states an empty namespace or line-number field as null', () => {
    const facts = records(
      legacyFacts(parse('64.0 APEX_CODE,FINE\n09:00:00.001 (1000000)|STATEMENT_EXECUTE|')),
    ).get('0');
    expect(facts).toMatchObject({ lineNumber: null, namespace: null });
  });

  it('keeps a stated line number 0, and states no namespace for today’s default', () => {
    const out = records(
      legacyFacts(
        parse(
          [
            '64.0 APEX_CODE,FINE',
            '09:00:00.001 (1000000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
            '09:00:00.002 (2000000)|STATEMENT_EXECUTE|[0]',
            '09:00:00.003 (3000000)|CODE_UNIT_FINISHED|execute_anonymous_apex',
          ].join('\n'),
        ),
      ),
    );
    expect(out.get('0')).toMatchObject({ namespace: null });
    expect(out.get('0/0')).toMatchObject({ lineNumber: 0, namespace: null });
    expect((out.get('log') as unknown as LogFact).namespaces).toEqual([]);
  });

  it('states an id no event has as missing, not as no reference', () => {
    const parsed = parse(log);
    parsed.logIssues.push({ type: 'unexpected', summary: 's', description: 'd', eventIndex: 999 });
    const facts = records(legacyFacts(parsed)).get('log') as unknown as LogFact;
    expect(facts.issues.at(-1)?.at).toEqual({ missing: 999 });
  });
});

describe('diffProjections', () => {
  const p = (entries: [string, unknown][]): Projection => entries;

  it('finds no difference between two parses of one log', () => {
    const result = diffProjections(projectLegacy(parse(log)), projectLegacy(parse(log)));
    expect(result).toEqual({ records: 5, differing: 0, differences: [], explained: {} });
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
      explained: {},
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
  const next = (text: string): Entry[] => [
    ...nextFacts(nodeEngine.build(new TextEncoder().encode(text))),
  ];
  const vsLegacy = (text: string) => {
    const left = [...legacyFacts(parse(text))];
    const right = next(text);
    return diffProjections(left, right, 20, explainer(left, right));
  };

  it('states the facts legacy states, apart from the known differences', () => {
    expect(vsLegacy(log)).toEqual({
      records: 5,
      differing: 0,
      differences: [],
      explained: { 'code-unit-line': 1 },
    });
  });

  it('explains a maximum-size marker inside an event line, which legacy misses', () => {
    const cut = [
      '64.0 APEX_CODE,FINE',
      '09:00:00.001 (1000000)|STATEMENT_EXECUTE|[1]',
      '09:00:00.002 (2000000)|STATEMENT_EXECUTE|[2*********** MAXIMUM DEBUG LOG SIZE REACHED ***********',
      '09:00:00.003 (3000000)|STATEMENT_EXECUTE|[3]',
    ].join('\n');
    expect(vsLegacy(cut)).toMatchObject({
      differing: 0,
      // The issue, the region, and the log's isTruncated.
      explained: { 'malformed-number': 2, 'max-size-in-line': 3 },
    });
  });

  it('states no duration for an exit at 0, as legacy does', () => {
    const zero = [
      '64.0 APEX_CODE,FINE',
      '09:00:00.001 (1000000)|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()',
      '09:00:00.000 (0)|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()',
    ].join('\n');
    expect(vsLegacy(zero)).toMatchObject({ differing: 0, explained: {} });
  });

  it('explains an issue on a merged package entry, and malformed rows', () => {
    const merged = [
      '64.0 APEX_CODE,FINE',
      '09:00:00.001 (1000000)|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()',
      '09:00:00.002 (2000000)|ENTERING_MANAGED_PKG|ns',
      '09:00:00.003 (3000000)|ENTERING_MANAGED_PKG|ns',
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********',
      '09:00:00.004 (4000000)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account',
      '09:00:00.005 (5000000)|SOQL_EXECUTE_END|[2]|Rows:abc',
      '09:00:00.006 (6000000)|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()',
    ].join('\n');
    const result = vsLegacy(merged);
    expect(result.differences).toEqual([]);
    // The issue and its region; the parsing error, and the rows on the query, its method and the log.
    expect(result.explained).toEqual({ 'merged-package-issue': 2, 'malformed-number': 4 });
  });
});

describe('explainer', () => {
  const half: KnownDifference = {
    name: 'half',
    undo: (_key, field, value) => (field === 'n' ? (value as number) / 2 : value),
  };
  const run = (left: number, right: number) => {
    const a: Entry[] = [['0', { n: left, m: 1 }]];
    const b: Entry[] = [['0', { n: right, m: 1 }]];
    return diffProjections(a, b, 20, explainer(a, b, [half]));
  };

  it('counts a field by rule when the rule undoes all of its difference', () => {
    expect(run(2, 4)).toEqual({
      records: 1,
      differing: 0,
      differences: [],
      explained: { half: 1 },
    });
  });

  it('reports the field with its own values when the rule does not', () => {
    expect(run(2, 6)).toMatchObject({
      differing: 1,
      differences: [{ key: '0', path: 'n', left: '2', right: '6' }],
      explained: {},
    });
  });

  it('gives a parent back the self time its package children gained', () => {
    const pkg = (total: number) => ({
      type: 'ENTERING_MANAGED_PKG',
      duration: { self: total, total },
    });
    const a: Entry[] = [
      ['0', { type: 'METHOD_ENTRY', duration: { self: 10, total: 10 } }],
      ['0/0', pkg(0)],
    ];
    const b: Entry[] = [
      ['0', { type: 'METHOD_ENTRY', duration: { self: 7, total: 10 } }],
      ['0/0', pkg(3)],
    ];
    expect(diffProjections(a, b, 20, explainer(a, b))).toMatchObject({
      differing: 0,
      explained: { 'package-duration': 2 },
    });
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

  it('counts the known differences by rule, and the log as identical', () => {
    const diff = { records: 3, differing: 0, differences: [], explained: { rule: 2 } };
    const results: FileResult[] = [
      { file: 'a.log', bytes: 100, runs: {}, diffs: { 'old→new (facts)': diff } },
    ];
    const report = renderReport(results, ['old', 'new']);
    expect(report).toContain('1 of 1 identical');
    expect(report).toContain('- `rule`: 2 fields in 1 logs');
  });
});
