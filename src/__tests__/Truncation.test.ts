/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent } from '../views/events.js';
import { at, logOf, outline, parse } from './helpers.js';

const firstChild = (event: ApexEvent | undefined): ApexEvent | undefined =>
  event?.isFrame ? event.children[0] : undefined;

describe('truncation', () => {
  it('reports every skipped region, not just the first', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p000000000AAA|UnitOfWork.first()\n' +
      '*** Skipped 22,606,355 bytes of detailed log\n' +
      '15:20:52.222 (400)|METHOD_EXIT|[185]|01p000000000AAA|UnitOfWork.first()\n' +
      '15:20:52.222 (600)|METHOD_ENTRY|[190]|01p000000000AAB|UnitOfWork.second()\n' +
      '*** Skipped 1,000 bytes of detailed log\n' +
      '15:20:52.222 (800)|METHOD_EXIT|[190]|01p000000000AAB|UnitOfWork.second()\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.isTruncated).toBe(true);
    expect(apexLog.truncation.regions.map((region) => region.kind)).toEqual([
      'skipped-lines',
      'skipped-lines',
    ]);
    expect(apexLog.truncation.totalSkippedBytes).toBe(22_607_355);
    expect(apexLog.issues.filter((issue) => issue.summary === 'Skipped-Lines').length).toBe(2);
  });

  it('bounds each skipped region at the point trust resumes', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p000000000AAA|UnitOfWork.first()\n' +
      '*** Skipped 500 bytes of detailed log\n' +
      '15:20:52.222 (500)|HEAP_ALLOCATE|[52]|Bytes:3\n' +
      '15:20:52.222 (800)|METHOD_ENTRY|[190]|01p000000000AAB|UnitOfWork.second()\n' +
      '15:20:52.222 (900)|METHOD_EXIT|[190]|01p000000000AAB|UnitOfWork.second()\n' +
      '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p000000000AAA|UnitOfWork.first()\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    const region = parse(log).truncation.regions[0];

    expect(region?.startTimestamp).toBe(200);
    // The following METHOD_ENTRY (800), not the HEAP_ALLOCATE detail line (500).
    expect(region?.endTimestamp).toBe(800);
    expect(region?.skippedBytes).toBe(500);
  });

  it('reports a max-size region and the event the log stopped inside', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p000000000AAA|UnitOfWork.getNextIdInternal()\n' +
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n';

    const apexLog = parse(log);

    expect(apexLog.isTruncated).toBe(true);
    expect(apexLog.truncation.regions.length).toBe(1);
    expect(apexLog.truncation.regions[0]?.kind).toBe('max-size');
    // The platform states no byte figure on the max-size line.
    expect(apexLog.truncation.regions[0]?.skippedBytes).toBeNull();
    expect(apexLog.truncation.totalSkippedBytes).toBe(0);
    // Both frames the log stopped inside, innermost first.
    expect(apexLog.unclosedFrames.map((event) => event.type)).toEqual([
      'METHOD_ENTRY',
      'EXECUTION_STARTED',
    ]);
  });

  it('keeps both skips when two skip lines follow the same event', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p000000000AAA|UnitOfWork.getNextIdInternal()\n' +
      '*** Skipped 500 bytes of detailed log\n' +
      '*** Skipped 700 bytes of detailed log\n' +
      '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p000000000AAA|UnitOfWork.getNextIdInternal()\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.truncation.regions.map((region) => region.skippedBytes)).toEqual([500, 700]);
    expect(apexLog.truncation.totalSkippedBytes).toBe(1200);
  });

  it('does not attribute skipped bytes to a max-size region on the same event', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '*** Skipped 500 bytes of detailed log\n' +
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n' +
      '15:20:52.222 (9000)|FATAL_ERROR|boom\n';

    const apexLog = parse(log);

    const maxSize = apexLog.truncation.regions.find((region) => region.kind === 'max-size');
    expect(maxSize?.skippedBytes).toBeNull();
    expect(apexLog.truncation.totalSkippedBytes).toBe(500);
  });

  it('ends an unclosed frame no earlier than the child that closed inside it', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.outer()\n' +
      '09:18:22.6 (300)|METHOD_ENTRY|[2]|01p000000000AAA|MyClass.inner()\n' +
      '09:18:22.6 (900)|METHOD_EXIT|[2]|01p000000000AAA|MyClass.inner()\n';

    const outer = firstChild(parse(log).children[0]);

    expect(outer?.isFrame && outer.endedBy).toBe('log-end');
    expect(outer?.endTimestamp).toBe(900);
    expect(outer?.duration).toMatchObject({ total: 700, self: 100 });
  });

  it('ends every unclosed frame when a new execution starts', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|01p|First.unit\n' +
      '09:18:22.6 (300)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.run()\n' +
      '*** Skipped 1000 bytes of detailed log\n' +
      '09:18:22.6 (400)|EXECUTION_STARTED\n' +
      '09:18:22.6 (410)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Second.unit\n' +
      '09:18:22.6 (420)|CODE_UNIT_FINISHED|Second.unit\n' +
      '09:18:22.6 (430)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.children.map((event) => event.type)).toEqual([
      'EXECUTION_STARTED',
      'EXECUTION_STARTED',
    ]);
    expect(apexLog.unclosedFrames.map((event) => event.text)).toEqual([
      'MyClass.run()',
      'First.unit',
      // An execution's line states no text.
      null,
    ]);
    expect(apexLog.children[1]?.isFrame && apexLog.children[1].endedBy).toBe('exit');
    expect(apexLog.unclosedFrames.map((event) => event.endTimestamp)).toEqual([300, 300, 300]);
  });

  it('never ends an unclosed frame before a child that closes on the next execution', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:Account\n' +
      '09:18:22.6 (300)|WF_FIELD_UPDATE|[Workflow:Account: MyRule]|Field:Account: Name|Value:x\n' +
      '09:18:22.6 (5000)|EXECUTION_STARTED\n' +
      '09:18:22.6 (5100)|EXECUTION_FINISHED\n';

    const unit = firstChild(parse(log).children[0]);

    expect(unit?.endTimestamp).toBe(5000);
    expect(unit?.duration.self).toBe(100);
  });

  it('parses a new execution normally after an exception in the one the log dropped', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.outer()\n' +
      '09:18:22.6 (300)|EXCEPTION_THROWN|[1]|System.NullPointerException: boom\n' +
      '09:18:22.6 (400)|EXECUTION_STARTED\n' +
      '09:18:22.6 (410)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Second.unit\n' +
      '09:18:22.6 (420)|METHOD_ENTRY|[5]|01p000000000AAA|MyClass.a()\n' +
      '09:18:22.6 (430)|METHOD_EXIT|[9]|01p000000000AAA|MyClass.b()\n' +
      '09:18:22.6 (440)|METHOD_EXIT|[5]|01p000000000AAA|MyClass.a()\n' +
      '09:18:22.6 (450)|CODE_UNIT_FINISHED|Second.unit\n' +
      '09:18:22.6 (460)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);
    const second = apexLog.children[1];

    expect(second?.isFrame && second.endedBy).toBe('exit');
    expect(second?.endTimestamp).toBe(460);
    expect(apexLog.issues.map((issue) => issue.summary)).toContain('Unexpected-Exit');
  });

  it('reports no truncation for a complete log', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p000000000AAA|UnitOfWork.getNextIdInternal()\n' +
      '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p000000000AAA|UnitOfWork.getNextIdInternal()\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.isTruncated).toBe(false);
    expect(apexLog.truncation).toEqual({ regions: [], totalSkippedBytes: 0 });
    expect(apexLog.unclosedFrames).toEqual([]);
  });

  it('reports a skip line that follows an event which takes wrapped text', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|USER_DEBUG|[1]|DEBUG|hello\n' +
        '*** Skipped 1,000 bytes of detailed log\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.truncation.regions.map((region) => region.kind)).toEqual(['skipped-lines']);
    expect(apexLog.truncation.totalSkippedBytes).toBe(1000);
    expect(apexLog.ofType('USER_DEBUG')[0]?.text).toBe('DEBUG | hello');
  });

  it('reports a max-size line that follows an event which takes wrapped text', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|USER_DEBUG|[1]|DEBUG|hello\n' +
        '*********** MAXIMUM DEBUG LOG SIZE REACHED *********** \n',
    );

    expect(apexLog.truncation.regions.map((region) => region.kind)).toEqual(['max-size']);
    expect(apexLog.ofType('USER_DEBUG')[0]?.text).toBe('DEBUG | hello');
  });

  it('keeps a skip line out of the limit block before it', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (500)|CUMULATIVE_LIMIT_USAGE\n' +
        '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 8 out of 100\n' +
        '*** Skipped 1,000 bytes of detailed log\n' +
        '09:18:22.6 (600)|CUMULATIVE_LIMIT_USAGE_END\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.truncation.regions.map((region) => region.kind)).toEqual(['skipped-lines']);
    expect(apexLog.limits.final.soqlQueries).toMatchObject({ used: 8, limit: 100 });
  });

  it('keeps a debug message that quotes the marker words as text', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|USER_DEBUG|[1]|DEBUG|line one\n' +
        '*** Skipped lines are logged when MAXIMUM DEBUG LOG SIZE REACHED\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.truncation.regions).toEqual([]);
    expect(apexLog.ofType('USER_DEBUG')[0]?.text).toBe(
      'DEBUG | line one\n*** Skipped lines are logged when MAXIMUM DEBUG LOG SIZE REACHED',
    );
  });

  it.each([
    '*** Skipped 10 bytes',
    '*** Skipped , bytes of detailed log',
    'the log says MAXIMUM DEBUG LOG SIZE REACHED here',
  ])('reads %j, not a whole marker, as an invalid line after an event with no text', (near) => {
    const log = logOf(`${at(1)}|STATEMENT_EXECUTE|[1]`, near);

    expect(log.parsingErrors).toEqual([`Invalid log line: ${near}`]);
    expect(log.truncation.regions).toEqual([]);
  });

  it('reads a marker on a last line cut after its CR', () => {
    const marker = '*** Skipped 1,000 bytes of detailed log\r';
    const afterText = logOf(`${at(1)}|USER_DEBUG|[1]|DEBUG|hello`, marker);
    const afterLeaf = logOf(`${at(1)}|STATEMENT_EXECUTE|[1]`, marker);

    expect(afterText.ofType('USER_DEBUG')[0]?.text).toBe('DEBUG | hello');
    for (const log of [afterText, afterLeaf]) {
      expect(log.truncation.regions.map((region) => region.kind)).toEqual(['skipped-lines']);
      expect(log.truncation.totalSkippedBytes).toBe(1000);
    }
  });

  it('marks the frame open at the maximum size, and reports its end before the maximum size', () => {
    const log = logOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|STATEMENT_EXECUTE|[2]`,
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********',
      `${at(3)}|FATAL_ERROR|System.LimitException`,
    );
    expect(outline(log)).toEqual(['METHOD_ENTRY@1-2!', '  STATEMENT_EXECUTE@2', 'FATAL_ERROR@3']);
    // Replaced once the frame ends, so it follows the Unexpected-End issue at the same time.
    expect(log.issues.map((i) => [i.summary, i.startTimestamp, i.event?.id])).toEqual([
      ['Unexpected-End', 2, 1],
      ['Max-Size-reached', 2, 1],
      ['System.LimitException', 3, 3],
    ]);
  });

  it('ends the maximum size at an exit line after it, which gets no row', () => {
    const log = logOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|STATEMENT_EXECUTE|[2]`,
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********',
      `${at(5)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(9)}|STATEMENT_EXECUTE|[3]`,
    );
    expect(log.truncation.regions.map((r) => [r.kind, r.startTimestamp, r.endTimestamp])).toEqual([
      ['max-size', 2, 5],
    ]);
  });

  it('ends the maximum size at the first event after its time, not one at the same time', () => {
    const log = logOf(
      `${at(1)}|STATEMENT_EXECUTE|[1]`,
      `${at(2)}|STATEMENT_EXECUTE|[2]`,
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********',
      `${at(2)}|STATEMENT_EXECUTE|[3]`,
      `${at(9)}|STATEMENT_EXECUTE|[4]`,
      `${at(20)}|STATEMENT_EXECUTE|[5]`,
    );
    expect(log.truncation.regions.map((r) => [r.kind, r.startTimestamp, r.endTimestamp])).toEqual([
      ['max-size', 2, 9],
    ]);
  });

  it('reads the maximum size from the end of an event line it cut', () => {
    const cut = `${at(2)}|STATEMENT_EXECUTE|[2*********** MAXIMUM DEBUG LOG SIZE REACHED ***********`;
    const log = logOf(`${at(1)}|STATEMENT_EXECUTE|[1]`, cut, `${at(9)}|STATEMENT_EXECUTE|[3]`);
    expect(log.parsingErrors).toEqual([`Invalid line number: ${cut}`]);
    expect(log.issues.map((i) => [i.summary, i.event?.id, i.startTimestamp])).toEqual([
      ['Max-Size-reached', 2, 2],
    ]);
    expect(log.truncation.regions.map((r) => [r.kind, r.startTimestamp, r.endTimestamp])).toEqual([
      ['max-size', 2, 9],
    ]);
  });

  it('reads the maximum size from a text line it cut, and keeps the line as text', () => {
    const cut = 'partial text*********** MAXIMUM DEBUG LOG SIZE REACHED ***********';
    const log = logOf(`${at(1)}|USER_DEBUG|[1]|DEBUG|hello`, cut, `${at(9)}|STATEMENT_EXECUTE|[3]`);
    expect(log.issues.map((i) => [i.summary, i.event?.id])).toEqual([['Max-Size-reached', 1]]);
    expect(log.ofType('USER_DEBUG')[0]?.text).toBe(`DEBUG | hello\n${cut}`);
  });

  it('reads the maximum size from an event line it cut, at a log cut after its CR', () => {
    const cut = `${at(2)}|STATEMENT_EXECUTE|[2*********** MAXIMUM DEBUG LOG SIZE REACHED ***********`;
    const log = logOf(`${at(1)}|STATEMENT_EXECUTE|[1]`, `${cut}\r`);
    expect(log.issues.map((i) => [i.summary, i.event?.id])).toEqual([['Max-Size-reached', 2]]);
  });

  // Truncation keeps method, constructor, code unit, query and callout pairs, but not system ones.
  it('marks a frame whose exit a skipped block hid as unwound by the exit further out', () => {
    const log = logOf(
      `${at(100)}|EXECUTION_STARTED`,
      `${at(200)}|METHOD_ENTRY|[10]|01p000000000AAA|MyClass.outer()`,
      `${at(300)}|SYSTEM_METHOD_ENTRY|[20]|System.debug(ANY)`,
      '*** Skipped 1,000 bytes of detailed log',
      `${at(900)}|METHOD_EXIT|[10]|01p000000000AAA|MyClass.outer()`,
      `${at(1000)}|EXECUTION_FINISHED`,
    );
    expect(outline(log)).toEqual([
      'EXECUTION_STARTED@100-1000',
      '  METHOD_ENTRY@200-900',
      '    SYSTEM_METHOD_ENTRY@300-900~',
    ]);
    expect(log.unclosedFrames.map((event) => event.text)).toEqual(['System.debug(ANY)']);
  });

  it('marks the frames a fatal error leaves as unwound by the code unit that ends', () => {
    const log = logOf(
      `${at(100)}|EXECUTION_STARTED`,
      `${at(150)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
      `${at(200)}|METHOD_ENTRY|[10]|01p000000000AAA|MyClass.outer()`,
      `${at(300)}|METHOD_ENTRY|[20]|01p000000000AAA|MyClass.inner()`,
      `${at(350)}|EXCEPTION_THROWN|[21]|System.NullPointerException: x`,
      `${at(400)}|FATAL_ERROR|System.NullPointerException: x`,
      `${at(450)}|CODE_UNIT_FINISHED|execute_anonymous_apex`,
      `${at(500)}|EXECUTION_FINISHED`,
    );
    expect(outline(log)).toEqual([
      'EXECUTION_STARTED@100-500',
      '  CODE_UNIT_STARTED@150-450',
      '    METHOD_ENTRY@200-450~',
      '      METHOD_ENTRY@300-450~',
      '        EXCEPTION_THROWN@350',
      '        FATAL_ERROR@400',
    ]);
    // In the order they ended: innermost first.
    expect(log.unclosedFrames.map((event) => event.text)).toEqual([
      'MyClass.inner()',
      'MyClass.outer()',
    ]);
    expect(log.issues.map((issue) => issue.summary)).not.toContain('Unexpected-End');
  });

  it('marks a method open when its code unit ends as unwound', () => {
    const log = logOf(
      `${at(150)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
      `${at(200)}|METHOD_ENTRY|[10]|01p000000000AAA|MyClass.outer()`,
      `${at(450)}|CODE_UNIT_FINISHED|execute_anonymous_apex`,
    );
    expect(outline(log)).toEqual(['CODE_UNIT_STARTED@150-450', '  METHOD_ENTRY@200-450~']);
  });

  it('lists unwound and log-ended frames together, in the order they ended', () => {
    const log = logOf(
      `${at(200)}|METHOD_ENTRY|[10]|01p000000000AAA|MyClass.outer()`,
      `${at(300)}|METHOD_ENTRY|[20]|01p000000000AAA|MyClass.inner()`,
      `${at(400)}|METHOD_EXIT|[10]|01p000000000AAA|MyClass.outer()`,
      `${at(500)}|METHOD_ENTRY|[30]|01p000000000AAA|MyClass.last()`,
    );
    expect(
      log.unclosedFrames.map((event) => [event.text, event.endedBy, event.endTimestamp]),
    ).toEqual([
      ['MyClass.inner()', 'unwind', 400],
      ['MyClass.last()', 'log-end', 500],
    ]);
  });

  it('states a package entry as ended by the next event, and the last one by the log end', () => {
    const log = logOf(
      `${at(100)}|ENTERING_MANAGED_PKG|ns`,
      `${at(200)}|STATEMENT_EXECUTE|[1]`,
      `${at(300)}|ENTERING_MANAGED_PKG|other`,
    );
    expect(log.children.map((event) => (event.isFrame ? event.endedBy : null))).toEqual([
      'next',
      null,
      'log-end',
    ]);
    expect(log.unclosedFrames.map((event) => event.startTimestamp)).toEqual([300]);
  });

  it('states no rows for a query the log states no end line for', () => {
    const log = logOf(
      `${at(100)}|METHOD_ENTRY|[10]|01p000000000AAA|MyClass.run()`,
      `${at(200)}|SOQL_EXECUTE_BEGIN|[11]|Aggregations:0|SELECT Id FROM Account`,
      `${at(300)}|EXCEPTION_THROWN|[11]|System.QueryException: x`,
      `${at(400)}|METHOD_EXIT|[10]|01p000000000AAA|MyClass.run()`,
    );
    const [query] = log.ofType('SOQL_EXECUTE_BEGIN');
    expect([query?.isFrame && query.endedBy, query?.soqlCount, query?.soqlRowCount]).toEqual([
      'unwind',
      { self: 1, total: 1 },
      null,
    ]);
    expect(log.soqlRowCount).toEqual({ self: 0, total: 0 });
  });
});
