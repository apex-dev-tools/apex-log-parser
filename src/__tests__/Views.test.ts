/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent, FrameEvent } from '../views/events.js';
import type { ApexLog } from '../views/log.js';
import { at, logOf, method } from './helpers.js';

const frame = (e: ApexEvent | null | undefined): FrameEvent => {
  if (!e?.isFrame) throw new Error(`not a frame: ${e?.type}`);
  return e;
};

const COUNTERS = [
  'dmlCount',
  'dmlRowCount',
  'soslCount',
  'soslRowCount',
  'thrownCount',
  'soqlCount',
  'soqlRowCount',
] as const;

describe('events', () => {
  it('links each event to its parent and children, with the log at depth 0 and its top at 1', () => {
    const log = logOf(...method);
    const unit = frame(log.event(1));
    const run = frame(unit.children[0]);
    expect([unit.parent, unit.depth]).toEqual([null, 1]);
    expect([run.parent?.id, run.depth]).toEqual([unit.id, 2]);
    expect(run.children.map((e) => e.type)).toEqual(['SOQL_EXECUTE_BEGIN', 'STATEMENT_EXECUTE']);
    expect(run.children.every((e) => e.parent?.id === run.id && e.depth === 3)).toBe(true);
  });

  it('states times, rollups and the type info, from the columns', () => {
    const log = logOf(...method);
    const run = frame(log.event(2));
    const query = frame(log.event(3));
    expect([run.startTimestamp, run.endTimestamp, run.duration]).toEqual([
      20,
      90,
      { self: 50, total: 70 },
    ]);
    expect([query.soqlCount, query.soqlRowCount]).toEqual([
      { self: 1, total: 1 },
      { self: 4, total: 4 },
    ]);
    expect([run.soqlCount, run.soqlRowCount, run.dmlCount]).toEqual([
      { self: 0, total: 1 },
      { self: 0, total: 4 },
      { self: 0, total: 0 },
    ]);
    // The namespace rules give `ns.MyClass.run()` no namespace of its own, nor the code unit one.
    expect([run.lineNumber, run.namespace, run.isFrame && run.endedBy]).toEqual([1, null, 'exit']);
    expect([run.kind, run.debugCategory, run.debugLevel]).toEqual(['method', 'apexCode', 'FINE']);
    expect(log.event(1)?.lineNumber).toBe('EXTERNAL');
  });

  it('gives a USER_DEBUG the level its line states, else the type level', () => {
    const log = logOf(
      `${at(1)}|USER_DEBUG|[1]|ERROR|failed`,
      `${at(2)}|USER_DEBUG|[2]|FINE|went on`,
      `${at(3)}|USER_DEBUG|[3]|NONE|stated`,
      `${at(4)}|USER_DEBUG|[4]|LOUD|not a level`,
      `${at(5)}|USER_DEBUG|[5]`,
    );
    expect([...log.events].map((e) => e.debugLevel)).toEqual([
      'ERROR',
      'FINE',
      'NONE',
      'DEBUG',
      'DEBUG',
    ]);
  });

  it('maps every counter to its own rollup, and gives a new object on each read', () => {
    const log = logOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|DML_BEGIN|[2]|Op:Insert|Type:Account|Rows:2`,
      `${at(3)}|DML_END|[2]`,
      `${at(4)}|SOSL_EXECUTE_BEGIN|[3]|FIND {x}`,
      `${at(5)}|SOSL_EXECUTE_END|[3]|Rows:3`,
      `${at(6)}|EXCEPTION_THROWN|[4]|System.NullPointerException: x`,
      `${at(7)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
    );
    const run = frame(log.event(1));
    // The log is row 0, and rolls up the same figures as the one frame under it.
    const totals = (e: ApexEvent | ApexLog): (number | null)[] =>
      COUNTERS.map((name) => e[name]?.total ?? null);
    expect(totals(log)).toEqual([1, 2, 1, 3, 1, 0, 0]);
    expect(totals(run)).toEqual([1, 2, 1, 3, 1, 0, 0]);
    expect(run.dmlCount).not.toBe(run.dmlCount);
    expect(run.dmlCount).toEqual(run.dmlCount);
  });

  it('makes a leaf that ends where it starts, with no children and no duration', () => {
    const leaf = logOf(...method).event(4);
    expect(leaf?.isFrame).toBe(false);
    expect(leaf?.children).toEqual([]);
    expect(Object.isFrozen(leaf?.children)).toBe(true);
    expect([leaf?.startTimestamp, leaf?.endTimestamp, leaf?.duration, leaf?.heapPeak]).toEqual([
      60,
      60,
      { self: 0, total: 0 },
      // HEADER's Apex Code FINE does not record heap lines.
      null,
    ]);
  });
});
