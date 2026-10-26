/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { idOfType } from '../catalog/catalog.js';
import { nodeEngine } from '../engine/node.js';
import type { ApexEvent, EventOf } from '../views/events.js';
import { apexLog } from '../views/log.js';
import { at, encode, HEADER, logOf, method, parse } from './helpers.js';

const ids = (events: Iterable<{ id: number }>): number[] => [...events].map((e) => e.id);

describe('ApexLog', () => {
  it('holds every event and its top level as children', () => {
    const log = logOf(...method, `${at(110)}|STATEMENT_EXECUTE|[9]`);
    expect([log.eventCount, ids(log.events), ids(log.children)]).toEqual([
      5,
      [1, 2, 3, 4, 5],
      [1, 5],
    ]);
    expect([0, 6, -1, 1.5, Number.NaN].map((id) => log.event(id))).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(log.children.every((e) => e.parent === null)).toBe(true);
  });

  it('states its own time and rollups, as row 0', () => {
    const log = logOf(...method);
    expect([log.startTimestamp, log.endTimestamp, log.duration]).toEqual([
      10,
      100,
      { self: 0, total: 90 },
    ]);
    expect([log.soqlCount, log.soqlRowCount]).toEqual([
      { self: 0, total: 1 },
      { self: 0, total: 4 },
    ]);
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
    // A frame runs from its startTimestamp up to, not including, its endTimestamp.
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
    expect(log.children.map((e) => [e.type, e.startTimestamp, e.endTimestamp])).toEqual([
      ['ENTERING_MANAGED_PKG', 1, 5],
      ['HEAP_ALLOCATE', 2, 2],
      ['STATEMENT_EXECUTE', 5, 5],
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
    expect([...columns.startTimestamp]).toEqual([10, 10, 20, 30, 60]);
    // The leaf, last, ends where it starts.
    expect([...columns.endTimestamp].slice(1)).toEqual([100, 90, 50, 60]);
    expect([...columns.durationTotal]).toEqual([90, 90, 70, 20, 0]);
    expect([...columns.durationSelf]).toEqual([0, 20, 50, 20, 0]);
  });

  // Catches a shared-text key that drops the line number for a rule that reads it: both queries
  // would read `line: 4`.
  it('gives frames with the same text one text id, frames with different text another', () => {
    const log = logOf(
      `${at(1)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
      `${at(2)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(3)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(4)}|METHOD_ENTRY|[7]|01p000000000AAA|ns.MyClass.run()`,
      `${at(5)}|METHOD_EXIT|[7]|01p000000000AAA|ns.MyClass.run()`,
      `${at(6)}|QUERY_MORE_BEGIN|[4]`,
      `${at(7)}|QUERY_MORE_END|[4]`,
      `${at(8)}|QUERY_MORE_BEGIN|[9]`,
      `${at(9)}|QUERY_MORE_END|[9]`,
      `${at(10)}|USER_DEBUG|[3]|DEBUG|hello`,
      `${at(11)}|CODE_UNIT_FINISHED|execute_anonymous_apex`,
    );
    const { ids, values, at: textAt } = log.columns.text;
    expect(ids[2]).toBe(ids[3]);
    expect(values[ids[2]!]).toBe('ns.MyClass.run()');
    expect([textAt(4), textAt(5)]).toEqual(['line: 4', 'line: 9']);
    expect(ids[4]).not.toBe(ids[5]);
    // A leaf has no id; its text still reads.
    expect([ids[6], textAt(6)]).toEqual([-1, 'DEBUG | hello']);
    expect([textAt(0), textAt(7)]).toEqual([null, null]);
  });

  // Catches a shared-text key that stops at the first line: both formulas would read the first.
  // WF_FORMULA is the frame whose text runs on to its continuation lines.
  it('gives frames whose text differs only after the first line their own text id', () => {
    const log = parse(
      `${at(1)}|WF_FORMULA|Formula:AND(\nISBLANK(Name))|Values:Name=null\n` +
        `${at(2)}|WF_FORMULA|Formula:AND(\nISBLANK(Phone))|Values:Phone=null\n`,
    );
    const { ids, at: textAt } = log.columns.text;
    expect(ids[1]).not.toBe(ids[2]);
    expect([textAt(1), textAt(2)]).toEqual([
      'Formula:AND(\nISBLANK(Name)) : Values:Name=null',
      'Formula:AND(\nISBLANK(Phone)) : Values:Phone=null',
    ]);
  });

  // The contract: a call tree groups by name, whatever the frame's type.
  it('gives frames of different types with the same text one text id', () => {
    const log = logOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(3)}|SYSTEM_METHOD_ENTRY|[2]|ns.MyClass.run()`,
      `${at(4)}|SYSTEM_METHOD_EXIT|[2]|ns.MyClass.run()`,
    );
    const { ids, at: textAt } = log.columns.text;
    expect([textAt(1), textAt(2)]).toEqual(['ns.MyClass.run()', 'ns.MyClass.run()']);
    expect(ids[1]).toBe(ids[2]);
  });

  // Catches a read past the arrays: an id that is no event gives undefined, not null.
  it('gives null from every text column for an id that is no event', () => {
    const { text, namespace, endedBy } = logOf(...method).columns;
    const none = [0, 5, -1, 1.5, Number.NaN];
    expect([text, namespace, endedBy].map((column) => none.map((id) => column.at(id)))).toEqual([
      [null, null, null, null, null],
      [null, null, null, null, null],
      [null, null, null, null, null],
    ]);
    expect([text.ids[0], namespace.ids[0], endedBy.ids[0]]).toEqual([-1, -1, -1]);
  });

  // Catches an iterator that keeps its place between loops: the second loop would be empty.
  it('gives every event in id order on each loop over events', () => {
    const log = logOf(...method);
    const { events } = log;
    expect([ids(events), ids(events)]).toEqual([
      [1, 2, 3, 4],
      [1, 2, 3, 4],
    ]);
    // As a generator's: the iterator is iterable too, so a loop can take it.
    const iterator = events[Symbol.iterator]() as IterableIterator<ApexEvent>;
    iterator.next();
    expect(ids(iterator)).toEqual([2, 3, 4]);
  });

  // Catches one array shared between reads: a caller's change would reach every other caller.
  it("gives an event's children as a new array on each read, and the log's as one frozen array", () => {
    const log = logOf(...method);
    const unit = log.event(1);
    const first = unit?.children as ApexEvent[];
    first.pop();
    expect(ids(unit?.children ?? [])).toEqual([2]);
    expect(log.children).toBe(log.children);
    expect(Object.isFrozen(log.children)).toBe(true);
  });

  // Catches a column read at the wrong row or from the wrong figure. Each value comes from the
  // fixture's lines. No header, so the log records every line, heap lines too.
  it('gives each event field the columns hold, row 0 as the log', () => {
    const log = parse(
      [
        `${at(1)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
        `${at(2)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
        `${at(3)}|HEAP_ALLOCATE|[2]|Bytes:10`,
        `${at(4)}|HEAP_DEALLOCATE|[2]|Bytes:4`,
        `${at(5)}|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Account`,
        `${at(6)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
        `${at(7)}|ENTERING_MANAGED_PKG|ns`,
        `${at(8)}|METHOD_ENTRY|[4]|01p000000000AAA|ns.MyClass.go()`,
        `${at(9)}|HEAP_ALLOCATE|[5]|Bytes:32`,
      ].join('\n'),
    );
    const c = log.columns;
    const [unit, run, alloc, , query, pkg, go] = [1, 2, 3, 4, 5, 6, 7];
    const row = (id: number) => ({
      isFrame: c.isFrame[id],
      isApexCall: c.isApexCall[id],
      lineNumber: c.lineNumber[id],
      endedBy: c.endedBy.at(id),
      text: c.text.at(id),
    });
    // The query has no end line, so an exit not its own ends it; the package run ends on the next
    // line; nothing closes the last method or the code unit.
    expect([unit, run, query, pkg, go].map(row)).toEqual([
      {
        isFrame: 1,
        isApexCall: 0,
        lineNumber: -1,
        endedBy: 'log-end',
        text: 'execute_anonymous_apex',
      },
      { isFrame: 1, isApexCall: 1, lineNumber: 1, endedBy: 'exit', text: 'ns.MyClass.run()' },
      {
        isFrame: 1,
        isApexCall: 0,
        lineNumber: 3,
        endedBy: 'unwind',
        text: 'SELECT Id FROM Account',
      },
      { isFrame: 1, isApexCall: 0, lineNumber: -2, endedBy: 'next', text: 'ns' },
      { isFrame: 1, isApexCall: 1, lineNumber: 4, endedBy: 'log-end', text: 'ns.MyClass.go()' },
    ]);
    expect([c.isFrame[alloc], c.text.ids[alloc], c.endedBy.ids[alloc]]).toEqual([0, -1, -1]);
    expect([c.namespace.at(pkg), c.namespace.at(run)]).toEqual(['ns', null]);
    // Its event says null: the rows are not stated. The column gives 0.
    expect(log.event(query)?.soqlRowCount).toBeNull();
    expect([c.soqlRowCount?.self[query], c.soqlCount?.total[query]]).toEqual([0, 1]);
    // Net bytes 10 - 4 = 6, gross counts allocations only: 10. The log adds the 32 after.
    const heap = (id: number) => [
      c.heapAllocated?.total[id],
      c.heapGross?.total[id],
      c.heapPeak?.[id],
    ];
    expect(heap(run)).toEqual([6, 10, 10]);
    expect(heap(0)).toEqual([38, 42, 38]);
  });

  it('gives null heap columns when the log does not record heap lines', () => {
    const { columns } = logOf(...method);
    expect([columns.heapAllocated, columns.heapGross, columns.heapPeak]).toEqual([
      null,
      null,
      null,
    ]);
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
    expect([
      skipped?.summary,
      skipped?.startTimestamp,
      skipped?.event,
      skipped?.exitType,
      skipped?.skippedBytes,
    ]).toEqual(['Skipped-Lines', 2, log.event(1), 'METHOD_EXIT', 1024]);
    // An unclosed frame ends at the latest time inside it.
    expect([
      end?.summary,
      end?.startTimestamp,
      end?.event,
      end?.exitType,
      end?.skippedBytes,
    ]).toEqual(['Unexpected-End', 4, log.event(2), null, null]);
    expect(log.issues).toBe(log.issues);
    expect(Object.isFrozen(log.issues[0])).toBe(true);
    expect(log.unclosedFrames).toEqual([log.event(2)]);
  });

  it('reports the parts the platform did not write as truncation, apart from unclosed frames', () => {
    const log = logOf(
      `${at(1)}|STATEMENT_EXECUTE|[1]`,
      '*** Skipped 2,048 bytes of detailed log',
      `${at(2)}|HEAP_ALLOCATE|[2]|Bytes:10`,
      `${at(3)}|METHOD_ENTRY|[3]|01p000000000AAA|ns.MyClass.run()`,
      `${at(4)}|METHOD_EXIT|[3]|01p000000000AAA|ns.MyClass.run()`,
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********',
      `${at(9)}|STATEMENT_EXECUTE|[4]`,
    );
    expect([log.isTruncated, log.unclosedFrames]).toEqual([true, []]);
    // A skipped block ends at the next frame; the maximum size at the next later event.
    expect(log.truncation).toEqual({
      regions: [
        {
          kind: 'skipped-lines',
          startTimestamp: 1,
          endTimestamp: 3,
          event: log.event(1),
          exitType: null,
          skippedBytes: 2048,
        },
        {
          kind: 'max-size',
          startTimestamp: 4,
          endTimestamp: 9,
          event: log.event(3),
          exitType: 'METHOD_EXIT',
          skippedBytes: null,
        },
      ],
      totalSkippedBytes: 2048,
    });
  });

  it('states the limits and exceptions', () => {
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
    expect(log.exceptions.map((e) => e.type)).toEqual(['EXCEPTION_THROWN', 'FATAL_ERROR']);
    expectTypeOf(log.exceptions).toEqualTypeOf<
      readonly EventOf<'EXCEPTION_THROWN' | 'FATAL_ERROR'>[]
    >();
    expect(log.limits.snapshots).toHaveLength(1);
    expect(log.limits.byNamespace.get('default')?.final.soqlQueries.used).toBe(2);
    expect(log.limits).toBe(log.limits);
  });

  it('states its size in bytes and its start time', () => {
    const text = [
      HEADER,
      '09:15:30.25 (1)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com|(GMT-08:00) Pacific Standard Time (America/Los_Angeles)|GMT-08:00',
      `${at(2)}|STATEMENT_EXECUTE|[1]`,
    ].join('\n');
    const log = apexLog(nodeEngine.build(encode(text)));
    expect(log.size).toBe(encode(text).byteLength);
    expect(log.startTime).toBe(((9 * 60 + 15) * 60 + 30) * 1000 + 250);
  });

  it("reads an event's debug level from debugLevels by its debugCategory", () => {
    const log = logOf(...method);
    const levels = [2, 3].map((id) => {
      const event = log.event(id);
      return event && [event.debugCategory, log.debugLevels[event.debugCategory]];
    });
    expect(levels).toEqual([
      ['apexCode', 'FINE'],
      ['database', 'INFO'],
    ]);
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
