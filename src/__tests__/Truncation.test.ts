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
});
