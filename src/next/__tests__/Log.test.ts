/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { idOfType } from '../catalog/catalog.js';
import { nodeEngine } from '../node.js';
import type { ApexLog } from '../views/log.js';
import { apexLog } from '../views/log.js';
import { encode } from './helpers.js';

const HEADER = '64.0 APEX_CODE,FINE;APEX_PROFILING,INFO;DB,INFO';
const at = (ns: number): string => `09:00:00.0 (${ns})`;
const logOf = (...lines: string[]): ApexLog =>
  apexLog(nodeEngine.build(encode([HEADER, ...lines].join('\n'))));
const ids = (events: Iterable<{ id: number }>): number[] => [...events].map((e) => e.id);

const method = [
  `${at(10)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
  `${at(20)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
  `${at(30)}|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account`,
  `${at(50)}|SOQL_EXECUTE_END|[2]|Rows:4`,
  `${at(60)}|STATEMENT_EXECUTE|[3]`,
  `${at(90)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
  `${at(100)}|CODE_UNIT_FINISHED|execute_anonymous_apex`,
];

describe('ApexLog', () => {
  it('holds every event, its top level as children, and the same object as event()', () => {
    const log = logOf(...method, `${at(110)}|STATEMENT_EXECUTE|[9]`);
    expect([log.eventCount, ids(log.events), ids(log.children)]).toEqual([
      5,
      [1, 2, 3, 4, 5],
      [1, 5],
    ]);
    expect(log.children).toBe(log.children);
    expect(log.children[0]).toBe(log.event(1));
    expect([...log.events][1]).toBe(log.event(2));
    expect([log.event(0), log.event(6)]).toEqual([null, null]);
    expect(log.children.every((e) => e.parent === null)).toBe(true);
  });

  it('states its own time and rollups, as row 0', () => {
    const log = logOf(...method);
    expect([log.timestamp, log.exitStamp, log.duration]).toEqual([10, 100, { self: 0, total: 90 }]);
    expect([log.soqlCount, log.soqlRowCount]).toEqual([
      { self: 0, total: 1 },
      { self: 0, total: 4 },
    ]);
    expect(log.executionEndTime).toBe(100);
  });

  it('lists the events of the given types in id order, once each', () => {
    const log = logOf(...method);
    expect(ids(log.ofType('STATEMENT_EXECUTE', 'METHOD_ENTRY', 'METHOD_ENTRY'))).toEqual([2, 4]);
    expect(ids(log.ofType('SOQL_EXECUTE_BEGIN'))).toEqual([3]);
    expect(log.ofType('DML_BEGIN')).toEqual([]);
    expect(log.ofType()).toEqual([]);
    expect(() => log.ofType('NOT_A_TYPE' as never)).toThrow('No event type NOT_A_TYPE');
  });

  it('finds the deepest frame running at a time, and never a leaf', () => {
    const log = logOf(...method, `${at(120)}|METHOD_ENTRY|[9]|01p000000000AAA|ns.MyClass.go()`);
    const at_ = (ns: number): number | null => log.at(ns)?.id ?? null;
    // A frame runs from its timestamp up to, not including, its exitStamp.
    expect([5, 10, 20, 35, 50, 60, 89, 90, 100, 110, 120].map(at_)).toEqual([
      null,
      1,
      2,
      3,
      2,
      2,
      2,
      1,
      null,
      null,
      null,
    ]);
    expect(at_(Number.NaN)).toBeNull();
  });

  it('finds a merged package run over the leaves after it, which stay its siblings', () => {
    const log = logOf(
      `${at(1)}|ENTERING_MANAGED_PKG|ns`,
      `${at(2)}|HEAP_ALLOCATE|[1]|Bytes:10`,
      `${at(3)}|ENTERING_MANAGED_PKG|ns`,
      `${at(5)}|STATEMENT_EXECUTE|[2]`,
    );
    expect(log.children.map((e) => [e.type, e.timestamp, e.exitStamp])).toEqual([
      ['ENTERING_MANAGED_PKG', 1, 5],
      ['HEAP_ALLOCATE', 2, null],
      ['STATEMENT_EXECUTE', 5, null],
    ]);
    expect([2, 4, 5].map((ns) => log.at(ns)?.id ?? null)).toEqual([1, 1, null]);
  });

  it('gives the columns in id order, with row 0 the log, the same object on each read', () => {
    const log = logOf(...method);
    const { columns } = log;
    expect(columns).toBe(log.columns);
    expect(Object.isFrozen(columns)).toBe(true);
    expect([...columns.parent]).toEqual([-1, 0, 1, 2, 2]);
    expect([...columns.depth]).toEqual([0, 1, 2, 3, 3]);
    expect([...columns.subtreeEnd]).toEqual([5, 5, 5, 4, 5]);
    expect([...columns.type.subarray(1)]).toEqual(
      ['CODE_UNIT_STARTED', 'METHOD_ENTRY', 'SOQL_EXECUTE_BEGIN', 'STATEMENT_EXECUTE'].map(
        idOfType,
      ),
    );
    expect([...columns.timestamp]).toEqual([10, 10, 20, 30, 60]);
    expect([...columns.exitStamp].slice(1)).toEqual([100, 90, 50, Number.NaN]);
    expect([...columns.durationTotal]).toEqual([90, 90, 70, 20, 0]);
    expect([...columns.durationSelf]).toEqual([0, 20, 50, 20, 0]);
  });

  it('points each issue at its event and the exit line it is on', () => {
    const log = logOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
      '*** Skipped 1,024 bytes of detailed log',
      `${at(3)}|METHOD_ENTRY|[2]|01p000000000AAA|ns.MyClass.go()`,
      `${at(4)}|STATEMENT_EXECUTE|[3]`,
    );
    const [skipped, end] = log.issues;
    expect([skipped?.summary, skipped?.event, skipped?.exitType, skipped?.skippedBytes]).toEqual([
      'Skipped-Lines',
      log.event(1),
      'METHOD_EXIT',
      1024,
    ]);
    expect([end?.summary, end?.event, end?.exitType, end?.skippedBytes]).toEqual([
      'Unexpected-End',
      log.event(2),
      null,
      null,
    ]);
    expect(log.issues).toBe(log.issues);
    expect(Object.isFrozen(log.issues[0])).toBe(true);
    expect(log.truncatedEvents).toEqual([log.event(2)]);
  });

  it('reports the parts the platform did not write as truncation, apart from open frames', () => {
    const log = logOf(
      `${at(1)}|STATEMENT_EXECUTE|[1]`,
      '*** Skipped 2,048 bytes of detailed log',
      `${at(3)}|METHOD_ENTRY|[3]|01p000000000AAA|ns.MyClass.run()`,
      `${at(4)}|METHOD_EXIT|[3]|01p000000000AAA|ns.MyClass.run()`,
    );
    expect([log.isTruncated, log.truncatedEvents]).toEqual([true, []]);
    expect(log.truncation).toEqual({
      regions: [
        {
          kind: 'skipped-lines',
          startTime: 1,
          endTime: 3,
          event: log.event(1),
          exitType: null,
          skippedBytes: 2048,
        },
      ],
      totalSkippedBytes: 2048,
    });
    expect(logOf(...method).isTruncated).toBe(false);
  });

  it('states the limits, namespaces, exceptions and entry points', () => {
    const log = logOf(
      `${at(1)}|EXECUTION_STARTED`,
      `${at(2)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
      `${at(3)}|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000AAA|MyTrigger on Account trigger event BeforeInsert`,
      `${at(4)}|EXCEPTION_THROWN|[1]|System.NullPointerException`,
      `${at(5)}|CODE_UNIT_FINISHED|MyTrigger on Account trigger event BeforeInsert`,
      `${at(6)}|LIMIT_USAGE_FOR_NS|(default)|`,
      '  Number of SOQL queries: 2 out of 100',
      `${at(7)}|ENTERING_MANAGED_PKG|ns`,
      `${at(8)}|CODE_UNIT_FINISHED|execute_anonymous_apex`,
      `${at(9)}|EXECUTION_FINISHED`,
      `${at(10)}|FATAL_ERROR|System.LimitException: Too many SOQL queries: 101`,
    );
    expect(log.entryPoints.map((e) => e.timestamp)).toEqual([2]);
    expect(log.exceptions.map((e) => e.type)).toEqual(['EXCEPTION_THROWN', 'FATAL_ERROR']);
    // `(default)` is no namespace, by today's rule.
    expect(log.namespaces).toEqual(['ns']);
    expect(log.limits.snapshots).toHaveLength(1);
    expect(log.limits.byNamespace.get('default')?.final.soqlQueries.used).toBe(2);
    expect(log.limits).toBe(log.limits);
  });

  it('states the header: size, start time, user and debug levels', () => {
    const text = [
      HEADER,
      '09:15:30.25 (1)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com|(GMT-08:00) Pacific Standard Time (America/Los_Angeles)|GMT-08:00',
      `${at(2)}|STATEMENT_EXECUTE|[1]`,
    ].join('\n');
    const log = apexLog(nodeEngine.build(encode(text)));
    expect(log.size).toBe(encode(text).byteLength);
    expect(log.startTime).toBe(((9 * 60 + 15) * 60 + 30) * 1000 + 250);
    expect(log.userInfo?.userName).toBe('user@example.com');
    expect(log.debugLevels).toEqual({ apexCode: 'FINE', apexProfiling: 'INFO', database: 'INFO' });
    expect(log.debugLevelSettings.map((s) => s.token)).toEqual([
      'APEX_CODE',
      'APEX_PROFILING',
      'DB',
    ]);
    expect(log.parsingErrors).toEqual([]);
  });

  it('gives frozen copies, so no caller reaches the build or the next caller through them', () => {
    const built = nodeEngine.build(
      encode(
        [
          '64.0 APEX_CODE,FINE;APEX_PROFILING,INFO;DB,LOUD',
          '09:15:30.25 (1)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com|(GMT-08:00) Pacific Standard Time (America/Los_Angeles)|GMT-08:00',
          `${at(2)}|LIMIT_USAGE_FOR_NS|(default)|`,
          '  Number of SOQL queries: 2 out of 100',
        ].join('\n'),
      ),
    );
    const log = apexLog(built);
    const frozen = [
      log.parsingErrors,
      log.userInfo?.timezone,
      log.debugLevels,
      log.debugLevelSettings[0],
      log.limits.snapshots[0]?.limits.soqlQueries,
      log.limits.byNamespace.get('default')?.final,
    ];
    expect(frozen.map((value) => value !== undefined && Object.isFrozen(value))).toEqual(
      frozen.map(() => true),
    );
    expect(log.parsingErrors).toEqual(built.parsingErrors);
    expect(log.parsingErrors).not.toBe(built.parsingErrors);
    expect(log.limits.snapshots[0]).not.toBe(built.snapshots[0]);
    expect(Object.isFrozen(built.debugLevelSettings[0])).toBe(false);
    expect(log.userInfo).toBe(log.userInfo);
  });
});
