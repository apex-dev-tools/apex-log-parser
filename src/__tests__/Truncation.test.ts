/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { parse } from '../index.js';

describe('truncation', () => {
  it('reports every skipped region, not just the first', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|UnitOfWork.first()\n' +
      '*** Skipped 22,606,355 bytes of detailed log\n' +
      '15:20:52.222 (400)|METHOD_EXIT|[185]|01p4J00000FpS6t|UnitOfWork.first()\n' +
      '15:20:52.222 (600)|METHOD_ENTRY|[190]|01p4J00000FpS6u|UnitOfWork.second()\n' +
      '*** Skipped 1,000 bytes of detailed log\n' +
      '15:20:52.222 (800)|METHOD_EXIT|[190]|01p4J00000FpS6u|UnitOfWork.second()\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.isTruncated).toBe(true);
    expect(apexLog.truncation.regions.map((region) => region.kind)).toEqual([
      'skipped-lines',
      'skipped-lines',
    ]);
    expect(apexLog.truncation.totalSkippedBytes).toBe(22_607_355);
    expect(apexLog.logIssues.filter((issue) => issue.summary === 'Skipped-Lines').length).toBe(2);
  });

  it('bounds each skipped region at the point trust resumes', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|UnitOfWork.first()\n' +
      '*** Skipped 500 bytes of detailed log\n' +
      '15:20:52.222 (500)|HEAP_ALLOCATE|[52]|Bytes:3\n' +
      '15:20:52.222 (800)|METHOD_ENTRY|[190]|01p4J00000FpS6u|UnitOfWork.second()\n' +
      '15:20:52.222 (900)|METHOD_EXIT|[190]|01p4J00000FpS6u|UnitOfWork.second()\n' +
      '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|UnitOfWork.first()\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    const region = parse(log).truncation.regions[0];

    expect(region?.startTime).toBe(200);
    // The following METHOD_ENTRY (800), not the HEAP_ALLOCATE detail line (500).
    expect(region?.endTime).toBe(800);
    expect(region?.skippedBytes).toBe(500);
  });

  it('reports a max-size region and the event the log stopped inside', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|UnitOfWork.getNextIdInternal()\n' +
      '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n';

    const apexLog = parse(log);

    expect(apexLog.isTruncated).toBe(true);
    expect(apexLog.truncation.regions.length).toBe(1);
    expect(apexLog.truncation.regions[0]?.kind).toBe('max-size');
    // The platform states no byte figure on the max-size line.
    expect(apexLog.truncation.regions[0]?.skippedBytes).toBeUndefined();
    expect(apexLog.truncation.totalSkippedBytes).toBe(0);
    // Both frames the log stopped inside, innermost first.
    expect(apexLog.truncatedEvents.map((event) => event.text)).toEqual([
      'UnitOfWork.getNextIdInternal()',
      'EXECUTION_STARTED',
    ]);
  });

  it('keeps both skips when two skip lines follow the same event', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|UnitOfWork.getNextIdInternal()\n' +
      '*** Skipped 500 bytes of detailed log\n' +
      '*** Skipped 700 bytes of detailed log\n' +
      '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|UnitOfWork.getNextIdInternal()\n' +
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
    expect(maxSize?.skippedBytes).toBeUndefined();
    expect(apexLog.truncation.totalSkippedBytes).toBe(500);
  });

  it('ends an unclosed frame no earlier than the child that closed inside it', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.outer()\n' +
      '09:18:22.6 (300)|METHOD_ENTRY|[2]|01p000000000AAA|MyClass.inner()\n' +
      '09:18:22.6 (900)|METHOD_EXIT|[2]|01p000000000AAA|MyClass.inner()\n';

    const outer = parse(log).children[0]?.children[0];

    expect(outer?.isTruncated).toBe(true);
    expect(outer?.exitStamp).toBe(900);
    expect(outer?.duration).toMatchObject({ total: 700, self: 100 });
  });

  it('closes every open frame when a new execution starts', () => {
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
    expect(apexLog.truncatedEvents.map((event) => event.text)).toEqual([
      'MyClass.run()',
      'First.unit',
      'EXECUTION_STARTED',
    ]);
    expect(apexLog.children[1]?.isTruncated).toBe(false);
    expect(apexLog.truncatedEvents.map((event) => event.exitStamp)).toEqual([300, 300, 300]);
  });

  it('never ends an open frame before a child that closes on the next execution', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
      '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:Account\n' +
      '09:18:22.6 (300)|WF_FIELD_UPDATE|[Workflow:Account: MyRule]|Field:Account: Name|Value:x\n' +
      '09:18:22.6 (5000)|EXECUTION_STARTED\n' +
      '09:18:22.6 (5100)|EXECUTION_FINISHED\n';

    const unit = parse(log).children[0]?.children[0];

    expect(unit?.exitStamp).toBe(5000);
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

    expect(second?.isTruncated).toBe(false);
    expect(second?.exitStamp).toBe(460);
    expect(apexLog.logIssues.map((issue) => issue.summary)).toContain('Unexpected-Exit');
  });

  it('reports no truncation for a complete log', () => {
    const log =
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
      '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p4J00000FpS6t|UnitOfWork.getNextIdInternal()\n' +
      '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p4J00000FpS6t|UnitOfWork.getNextIdInternal()\n' +
      '09:19:13.82 (2000)|EXECUTION_FINISHED\n';

    const apexLog = parse(log);

    expect(apexLog.isTruncated).toBe(false);
    expect(apexLog.truncation).toEqual({ regions: [], totalSkippedBytes: 0 });
    expect(apexLog.truncatedEvents).toEqual([]);
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
    expect(apexLog.eventsById.find((event) => event.type === 'USER_DEBUG')?.text).toBe(
      'DEBUG | hello',
    );
  });

  it('reports a max-size line that follows an event which takes wrapped text', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|USER_DEBUG|[1]|DEBUG|hello\n' +
        '*********** MAXIMUM DEBUG LOG SIZE REACHED *********** \n',
    );

    expect(apexLog.truncation.regions.map((region) => region.kind)).toEqual(['max-size']);
    expect(apexLog.eventsById.find((event) => event.type === 'USER_DEBUG')?.text).toBe(
      'DEBUG | hello',
    );
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
    expect(apexLog.governorLimits.final.soqlQueries).toMatchObject({ used: 8, limit: 100 });
  });

  it('keeps a debug message that quotes the marker words as text', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|USER_DEBUG|[1]|DEBUG|line one\n' +
        '*** Skipped lines are logged when MAXIMUM DEBUG LOG SIZE REACHED\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.truncation.regions).toEqual([]);
    expect(apexLog.eventsById.find((event) => event.type === 'USER_DEBUG')?.text).toBe(
      'DEBUG | line one\n*** Skipped lines are logged when MAXIMUM DEBUG LOG SIZE REACHED',
    );
  });
});
