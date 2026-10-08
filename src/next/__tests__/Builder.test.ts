/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { NodeSource } from '../bytes/node.js';
import { EVENT_TYPE_NAMES } from '../catalog/types.js';
import type { Built } from '../engine/builder.js';
import { FLAG, LogBuilder } from '../engine/builder.js';
import { COUNTER, EXTERNAL_LINE, HEAP, NO_LINE, NONE } from '../store/store.js';
import { encode } from './helpers.js';

const HEADER = '64.0 APEX_CODE,FINE;APEX_PROFILING,INFO;DB,INFO';
const at = (ns: number): string => `09:00:00.0 (${ns})`;
const build = (...lines: string[]): Built =>
  new LogBuilder(new NodeSource(encode([HEADER, ...lines].join('\n')))).build();

/** Each event as `depth type@timestamp-exitStamp`, with `!` for an unterminated frame. */
function tree({ store }: Built): string[] {
  const out: string[] = [];
  for (let id = 1; id < store.count; id++) {
    const exit = store.exitStamp[id]!;
    const end = Number.isNaN(exit) ? '' : `-${exit}`;
    const cut = store.flags[id]! & FLAG.truncated ? '!' : '';
    out.push(
      `${'  '.repeat(store.depth[id]! - 1)}${EVENT_TYPE_NAMES[store.type[id]!]}@${store.timestamp[id]}${end}${cut}`,
    );
  }
  return out;
}

const issues = ({ issues }: Built): string[] =>
  issues.list.map(
    (i) => `${i.summary}@${i.startTime} #${i.id}${i.exitType === null ? '' : ' exit'}`,
  );

describe('LogBuilder', () => {
  it('folds a matched exit line into its frame, and gives each event an id in log order', () => {
    const built = build(
      `${at(1)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
      `${at(2)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(3)}|STATEMENT_EXECUTE|[2]`,
      `${at(4)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(5)}|CODE_UNIT_FINISHED|execute_anonymous_apex`,
    );
    expect(tree(built)).toEqual([
      'CODE_UNIT_STARTED@1-5',
      '  METHOD_ENTRY@2-4',
      '    STATEMENT_EXECUTE@3',
    ]);
    expect([...built.store.lineNumber.subarray(1)]).toEqual([EXTERNAL_LINE, 1, 2]);
    expect([...built.store.parent.subarray(1)]).toEqual([0, 1, 2]);
    expect([...built.store.subtreeEnd]).toEqual([4, 4, 4, 4]);
    expect(issues(built)).toEqual([]);
  });

  it('keeps an exit line no frame matches as a child, with an Unexpected-Exit issue on it', () => {
    const built = build(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|CONSTRUCTOR_EXIT|[9]|01p000000000AAA|ns.Other`,
      `${at(3)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
    );
    expect(tree(built)).toEqual(['METHOD_ENTRY@1-3', '  CONSTRUCTOR_EXIT@2']);
    expect(issues(built)).toEqual(['Unexpected-Exit@2 #2']);
  });

  it('ends frames the log does not close at the latest time inside them', () => {
    const built = build(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|METHOD_ENTRY|[2]|01p000000000AAA|ns.MyClass.inner()`,
      `${at(7)}|STATEMENT_EXECUTE|[3]`,
    );
    expect(tree(built)).toEqual([
      'METHOD_ENTRY@1-7!',
      '  METHOD_ENTRY@2-7!',
      '    STATEMENT_EXECUTE@7',
    ]);
    expect(built.truncated).toEqual([2, 1]);
    expect(issues(built)).toEqual(['Unexpected-End@7 #2']);
  });

  it('unwinds every frame an exception passes, and an exit closes the frame it matches below', () => {
    const built = build(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.outer()`,
      `${at(2)}|METHOD_ENTRY|[2]|01p000000000AAA|ns.MyClass.inner()`,
      `${at(3)}|EXCEPTION_THROWN|[3]|System.NullPointerException`,
      `${at(4)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.outer()`,
      `${at(5)}|METHOD_ENTRY|[5]|01p000000000AAA|ns.MyClass.next()`,
      `${at(6)}|METHOD_ENTRY|[6]|01p000000000AAA|ns.MyClass.deep()`,
      `${at(7)}|METHOD_EXIT|[5]|01p000000000AAA|ns.MyClass.next()`,
    );
    expect(tree(built)).toEqual([
      'METHOD_ENTRY@1-4',
      '  METHOD_ENTRY@2-4',
      '    EXCEPTION_THROWN@3',
      'METHOD_ENTRY@5-7',
      '  METHOD_ENTRY@6-7',
    ]);
    expect(issues(built)).toEqual([]);
  });

  it('closes a frame that the next line closes at that line, and a new execution closes all', () => {
    const built = build(
      `${at(1)}|EXECUTION_STARTED`,
      `${at(2)}|WF_FIELD_UPDATE|a|b|c|d|e`,
      `${at(3)}|WF_FIELD_UPDATE|a|b|c|d|e`,
      `${at(4)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(5)}|EXECUTION_STARTED`,
    );
    expect(tree(built)).toEqual([
      'EXECUTION_STARTED@1-4!',
      '  WF_FIELD_UPDATE@2-3',
      '  WF_FIELD_UPDATE@3-4',
      '  METHOD_ENTRY@4-4!',
      'EXECUTION_STARTED@5-5!',
    ]);
  });

  it('ends a package entry at the next event, and merges the next one in its namespace', () => {
    const built = build(
      `${at(1)}|ENTERING_MANAGED_PKG|ns`,
      `${at(4)}|STATEMENT_EXECUTE|[1]`,
      `${at(6)}|ENTERING_MANAGED_PKG|ns`,
      `${at(8)}|ENTERING_MANAGED_PKG|other`,
      `${at(9)}|ENTERING_MANAGED_PKG|ns`,
    );
    expect(tree(built)).toEqual([
      'ENTERING_MANAGED_PKG@1-8',
      'STATEMENT_EXECUTE@4',
      'ENTERING_MANAGED_PKG@8-9',
      // Nothing follows the last one, so it has no exit, as today.
      'ENTERING_MANAGED_PKG@9',
    ]);
  });

  it('times the log as today, which sees a last package entry before it merges', () => {
    const built = build(
      `${at(1)}|ENTERING_MANAGED_PKG|ns`,
      `${at(2)}|STATEMENT_EXECUTE|[1]`,
      `${at(3)}|ENTERING_MANAGED_PKG|ns`,
    );
    expect(tree(built)).toEqual(['ENTERING_MANAGED_PKG@1-3', 'STATEMENT_EXECUTE@2']);
    expect([built.store.exitStamp[0], built.executionEndTime]).toEqual([3, 2]);
  });

  it('rolls counts, rows, heap and time up to every frame above, as today', () => {
    const built = build(
      `${at(10)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(20)}|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account`,
      `${at(30)}|SOQL_EXECUTE_END|[2]|Rows:5`,
      `${at(40)}|DML_BEGIN|[3]|Op:Insert|Type:Account|Rows:2`,
      `${at(45)}|HEAP_ALLOCATE|[4]|Bytes:100`,
      `${at(50)}|DML_END|[3]`,
      `${at(55)}|HEAP_DEALLOCATE|[5]|Bytes:300`,
      `${at(56)}|HEAP_ALLOCATE|[6]|Bytes:40`,
      `${at(60)}|EXCEPTION_THROWN|[7]|System.NullPointerException`,
      `${at(70)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
    );
    const { store } = built;
    const counts = (id: number) => {
      if (store.countSlot[id] === NONE) return null;
      const at = store.countsOf(id);
      return Object.fromEntries(
        Object.entries(COUNTER).map(([name, c]) => [name, store.counts[at + c * 2 + 1]]),
      );
    };
    const heap = (id: number) => {
      if (store.heapSlot[id] === NONE) return null;
      const at = store.heapOf(id);
      return [...store.heap.subarray(at, at + 5)];
    };
    expect(counts(1)).toEqual({
      dml: 1,
      soql: 1,
      sosl: 0,
      dmlRows: 2,
      soqlRows: 5,
      soslRows: 0,
      thrown: 1,
    });
    expect(counts(0)).toEqual(counts(1));
    // The method's own heap is its leaves': +40 and -300 net, with the DML's +100 in its total.
    expect(heap(1)).toEqual([-260, -160, 40, 140, 100]);
    // The free clamps the running heap at 0, so the last allocation peaks at 40.
    expect(heap(6)?.[HEAP.peak]).toBe(40);
    expect([store.durationSelf[1], store.durationSelf[2], store.durationSelf[3]]).toEqual([
      40, 10, 10,
    ]);
    expect([store.timestamp[0], store.exitStamp[0], built.executionEndTime]).toEqual([10, 70, 70]);
  });

  it('makes a VF call with no method on a page-messages class a leaf', () => {
    const built = build(
      `${at(1)}|VF_APEX_CALL_START|[EXTERNAL]|PageMessagesComponentController|`,
      `${at(2)}|STATEMENT_EXECUTE|[1]`,
    );
    expect(tree(built)).toEqual(['VF_APEX_CALL_START@1', 'STATEMENT_EXECUTE@2']);
    expect(built.store.flags[1]! & FLAG.notEntry).toBe(FLAG.notEntry);
  });

  it('reads continuation lines into the event before them, and reports every other line', () => {
    const built = build(
      `${at(1)}|USER_DEBUG|[1]|DEBUG|first`,
      'second',
      '',
      '*** Skipped 1,024 bytes of detailed log',
      'third',
      `${at(2)}|STATEMENT_EXECUTE|[2]`,
      'not text',
      'x|NOT_A_TYPE',
      'x|NOT_A_TYPE',
      '64.0 APEX_CODE,FINE;APEX_PROFILING,INFO',
      `${at(3)}|STATEMENT_EXECUTE|[]`,
    );
    const store = built.store;
    expect(tree(built)).toEqual(['USER_DEBUG@1', 'STATEMENT_EXECUTE@2', 'STATEMENT_EXECUTE@3']);
    const all = [HEADER, `${at(1)}|USER_DEBUG|[1]|DEBUG|first`].join('\n').length + 1;
    expect(store.end[1]).toBeGreaterThan(all);
    expect(built.parsingErrors).toEqual([
      'Invalid log line: not text',
      'Unsupported log event name: NOT_A_TYPE',
      // Today the whole parse throws here.
      `Invalid line number: ${at(3)}|STATEMENT_EXECUTE|[]`,
    ]);
    expect(store.lineNumber[3]).toBe(NO_LINE);
  });

  it('points a skipped block after a folded exit at its frame, and states the bytes', () => {
    const built = build(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
      '*** Skipped 1,024 bytes of detailed log',
      `${at(3)}|STATEMENT_EXECUTE|[2]`,
    );
    expect(issues(built)).toEqual(['Skipped-Lines@2 #1 exit']);
    expect(built.issues.list[0]?.skippedBytes).toBe(1024);
  });

  it('marks the frame open at the maximum size as truncated', () => {
    const built = build(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|STATEMENT_EXECUTE|[2]`,
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********',
      `${at(3)}|FATAL_ERROR|System.LimitException`,
    );
    expect(tree(built)).toEqual(['METHOD_ENTRY@1-2!', '  STATEMENT_EXECUTE@2', 'FATAL_ERROR@3']);
    // Replaced once the frame ends, so it follows the Unexpected-End issue at the same time, as today.
    expect(issues(built)).toEqual([
      'Unexpected-End@2 #1',
      'Max-Size-reached@2 #1',
      'System.LimitException@3 #3',
    ]);
  });

  it('reads each namespace by its rule, and passes a frame its namespace down', () => {
    const built = build(
      `${at(1)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
      `${at(2)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.Inner.run()`,
      `${at(3)}|STATEMENT_EXECUTE|[2]`,
      `${at(4)}|DML_BEGIN|[3]|Op:Insert|Type:Account|Rows:1`,
      `${at(5)}|DML_END|[3]`,
      `${at(6)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.Inner.run()`,
      // Three parts read as a namespace only once the log has stated it.
      `${at(7)}|METHOD_ENTRY|[4]|01p000000000AAA|ns.MyClass.go()`,
      `${at(8)}|METHOD_EXIT|[4]|01p000000000AAA|ns.MyClass.go()`,
      `${at(9)}|METHOD_ENTRY|[5]|01p000000000AAA|MyClass.run()`,
      `${at(10)}|STATEMENT_EXECUTE|[6]`,
      `${at(11)}|METHOD_EXIT|[5]|01p000000000AAA|MyClass.run()`,
      // A class's first use: the exit names the class, and the frame takes its namespace.
      `${at(12)}|METHOD_ENTRY|[7]|01p000000000AAA|other.MyClass.go()`,
      `${at(13)}|METHOD_EXIT|[7]|01p000000000AAA|other.MyClass`,
      `${at(14)}|CODE_UNIT_FINISHED|execute_anonymous_apex`,
    );
    const { store, strings } = built;
    const namespaces = [...store.namespace.subarray(1)].map((id) =>
      id === NONE ? null : strings.text(id),
    );
    expect(namespaces).toEqual([null, 'ns', 'ns', null, 'ns', null, null, 'other']);
    expect(built.namespaces.map((id) => strings.text(id))).toEqual(['ns', 'other']);
  });

  it('reads a limit block whole, and reports a limit exception and a fatal error', () => {
    const built = build(
      `${at(1)}|LIMIT_USAGE_FOR_NS|(default)|`,
      '  Number of SOQL queries: 2 out of 100',
      '  Maximum CPU time: 15 out of 10000 ******* CLOSE TO LIMIT',
      `${at(2)}|EXCEPTION_THROWN|[1]|System.NullPointerException`,
      `${at(3)}|EXCEPTION_THROWN|[2]|System.LimitException: Too many SOQL queries: 101`,
      `${at(4)}|FATAL_ERROR|System.LimitException: Too many SOQL queries: 101`,
      '',
      'Class.ns.MyClass.run: line 2, column 1',
    );
    expect(built.snapshots).toHaveLength(1);
    const [snapshot] = built.snapshots;
    expect(snapshot?.namespace).toBe('default');
    expect(snapshot?.limits.soqlQueries).toEqual({ used: 2, limit: 100, percentUsed: 2 });
    expect(snapshot?.limits.cpuTime.used).toBe(15);
    expect(built.issues.list.map((i) => [i.type, i.id, i.summary, i.description])).toEqual([
      ['error', 3, 'System.LimitException: Too many SOQL queries: 101', ''],
      [
        'fatal',
        4,
        'System.LimitException: Too many SOQL queries: 101',
        'Class.ns.MyClass.run: line 2, column 1',
      ],
    ]);
  });

  it('reads a CRLF log as an LF log, and starts at the first timestamped line', () => {
    const lf = build(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
    );
    const crlf = new LogBuilder(
      new NodeSource(
        encode(
          [
            'garbage before the log',
            HEADER,
            `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
            `${at(2)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
            '',
          ].join('\r\n'),
        ),
      ),
    ).build();
    expect(tree(crlf)).toEqual(tree(lf));
    expect(crlf.parsingErrors).toEqual([]);
  });
});
