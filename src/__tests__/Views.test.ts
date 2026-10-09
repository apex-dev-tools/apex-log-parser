/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { nodeEngine } from '../engine/node.js';
import type { ApexEvent, FrameEvent } from '../views/events.js';
import { LogEvents } from '../views/events.js';
import { encode } from './helpers.js';

const HEADER = '64.0 APEX_CODE,FINE;APEX_PROFILING,INFO;DB,INFO';
const at = (ns: number): string => `09:00:00.0 (${ns})`;
const eventsOf = (...lines: string[]): LogEvents =>
  new LogEvents(nodeEngine.build(encode([HEADER, ...lines].join('\n'))));

/** Every event, in id order, read only through the views. */
function all(events: LogEvents): ApexEvent[] {
  const out: ApexEvent[] = [];
  for (let id = 1, e = events.event(id); e; e = events.event(++id)) out.push(e);
  return out;
}

const frame = (e: ApexEvent | null | undefined): FrameEvent => {
  if (!e?.isFrame) throw new Error(`not a frame: ${e?.type}`);
  return e;
};

describe('LogEvents', () => {
  const method = [
    `${at(10)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
    `${at(20)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
    `${at(30)}|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account`,
    `${at(50)}|SOQL_EXECUTE_END|[2]|Rows:4`,
    `${at(60)}|STATEMENT_EXECUTE|[3]`,
    `${at(90)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
    `${at(100)}|CODE_UNIT_FINISHED|execute_anonymous_apex`,
  ];

  it('gives each event an id in log order from 1, and the same object for the same id', () => {
    const events = eventsOf(...method);
    expect(all(events).map((e) => [e.id, e.type])).toEqual([
      [1, 'CODE_UNIT_STARTED'],
      [2, 'METHOD_ENTRY'],
      [3, 'SOQL_EXECUTE_BEGIN'],
      [4, 'STATEMENT_EXECUTE'],
    ]);
    expect(events.event(2)).toBe(events.event(2));
    expect([0, 5, -1, 1.5, Number.NaN].map((id) => events.event(id))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it('links each event to its parent and children, with the log at depth 0 and its top at 1', () => {
    const events = eventsOf(...method);
    const unit = frame(events.event(1));
    const run = frame(unit.children[0]);
    expect([unit.parent, unit.depth]).toEqual([null, 1]);
    expect([run.parent, run.depth]).toEqual([unit, 2]);
    expect(run.children.map((e) => e.type)).toEqual(['SOQL_EXECUTE_BEGIN', 'STATEMENT_EXECUTE']);
    expect(run.children).toBe(run.children);
    expect(run.children.every((e) => e.parent === run && e.depth === 3)).toBe(true);
  });

  it('states times, rollups and the type info, from the columns', () => {
    const events = eventsOf(...method);
    const run = frame(events.event(2));
    const query = frame(events.event(3));
    expect([run.timestamp, run.exitStamp, run.duration]).toEqual([20, 90, { self: 50, total: 70 }]);
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
    expect([run.lineNumber, run.namespace, run.isTruncated]).toEqual([1, null, false]);
    expect([run.kind, run.category, run.debugCategory, run.debugLevel]).toEqual([
      'method',
      'Apex',
      'apexCode',
      'FINE',
    ]);
    expect(events.event(1)?.lineNumber).toBe('EXTERNAL');
  });

  it('maps every counter to its own rollup, and gives a new object on each read', () => {
    const events = eventsOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|DML_BEGIN|[2]|Op:Insert|Type:Account|Rows:2`,
      `${at(3)}|DML_END|[2]`,
      `${at(4)}|SOSL_EXECUTE_BEGIN|[3]|FIND {x}`,
      `${at(5)}|SOSL_EXECUTE_END|[3]|Rows:3`,
      `${at(6)}|EXCEPTION_THROWN|[4]|System.NullPointerException: x`,
      `${at(7)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
    );
    const run = frame(events.event(1));
    const totals = [
      run.dmlCount,
      run.dmlRowCount,
      run.soslCount,
      run.soslRowCount,
      run.thrownCount,
      run.soqlCount,
      run.soqlRowCount,
    ].map((c) => c.total);
    expect(totals).toEqual([1, 2, 1, 3, 1, 0, 0]);
    expect(run.dmlCount).not.toBe(run.dmlCount);
    expect(run.dmlCount).toEqual(run.dmlCount);
  });

  it('lists the events at the top of the log as the children of id 0', () => {
    const events = eventsOf(...method, `${at(110)}|STATEMENT_EXECUTE|[9]`);
    expect(events.childrenOf(0).map((e) => e.id)).toEqual([1, 5]);
  });

  it('makes a leaf with no exit, no children and no duration', () => {
    const leaf = eventsOf(...method).event(4);
    expect(leaf?.isFrame).toBe(false);
    expect(leaf?.children).toEqual([]);
    expect(Object.isFrozen(leaf?.children)).toBe(true);
    expect([leaf?.exitStamp, leaf?.duration, leaf?.heapPeak]).toEqual([
      null,
      { self: 0, total: 0 },
      0,
    ]);
  });

  it('keeps a package entry a frame, and a VF call with no method a leaf, as the line states', () => {
    const events = eventsOf(
      `${at(1)}|ENTERING_MANAGED_PKG|ns`,
      `${at(4)}|VF_APEX_CALL_START|[1]|ns.MyController|`,
      `${at(6)}|STATEMENT_EXECUTE|[2]`,
    );
    const pkg = frame(events.event(1));
    expect([pkg.exitStamp, pkg.children, pkg.namespace]).toEqual([4, [], 'ns']);
    expect(events.event(2)?.isFrame).toBe(false);
  });

  it('marks a frame the log does not close as truncated, ending where the log stops', () => {
    const run = frame(
      eventsOf(
        `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
        `${at(5)}|STATEMENT_EXECUTE|[2]`,
      ).event(1),
    );
    expect([run.isTruncated, run.exitStamp]).toEqual([true, 5]);
  });

  it('states the heap figures a leaf allocates, which its frame takes as self', () => {
    const events = eventsOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|HEAP_ALLOCATE|[2]|Bytes:100`,
      `${at(3)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
    );
    const run = frame(events.event(1));
    expect([run.heapAllocated, run.heapGross, run.heapPeak]).toEqual([
      { self: 100, total: 100 },
      { self: 100, total: 100 },
      100,
    ]);
    expect(events.event(2)?.heapAllocated).toEqual({ self: 100, total: 100 });
  });
});
