/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { NodeSource } from '../bytes/node.js';
import { EVENT_TYPE_NAMES } from '../catalog/types.js';
import type { Built } from '../engine/builder.js';
import { FLAG, LogBuilder } from '../engine/builder.js';
import { EXTERNAL_LINE, NO_LINE } from '../store/store.js';
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
    expect([...built.store.subtreeEnd]).toEqual([1, 2, 3, 4]);
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

  it('ends a package entry at the next event, and leaves the last one open', () => {
    const built = build(
      `${at(1)}|ENTERING_MANAGED_PKG|ns`,
      `${at(4)}|STATEMENT_EXECUTE|[1]`,
      `${at(6)}|ENTERING_MANAGED_PKG|ns`,
    );
    expect(tree(built)).toEqual([
      'ENTERING_MANAGED_PKG@1-4',
      'STATEMENT_EXECUTE@4',
      'ENTERING_MANAGED_PKG@6',
    ]);
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
    expect(issues(built)).toEqual(['Unexpected-End@2 #1', 'Max-Size-reached@2 #1']);
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
