/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { parse } from '../index.js';

const SETTINGS = '64.0 APEX_CODE,FINE;APEX_PROFILING,FINE\n';

function execution(nanos: number, unit: string, userName = 'user@example.com'): string {
  return (
    `09:18:22.6 (${nanos})|USER_INFO|[EXTERNAL]|005000000000AAA|${userName}|Pacific Standard Time|GMT-08:00\n` +
    `09:18:22.6 (${nanos + 10})|EXECUTION_STARTED\n` +
    `09:18:22.6 (${nanos + 20})|CODE_UNIT_STARTED|[EXTERNAL]|01p|${unit}\n` +
    `09:18:22.6 (${nanos + 30})|CODE_UNIT_FINISHED|${unit}\n` +
    `09:18:22.6 (${nanos + 40})|EXECUTION_FINISHED\n`
  );
}

function codeUnits(log: ReturnType<typeof parse>): string[] {
  return log.eventsById.filter((event) => event.type === 'CODE_UNIT_STARTED').map((e) => e.text);
}

describe('a text that holds more than one log', () => {
  it('parses only the first log when a second settings line opens another', () => {
    const log = parse(
      SETTINGS +
        execution(100, 'First.unit') +
        '\n' +
        SETTINGS +
        execution(50, 'Second.unit', 'other@example.com'),
    );

    expect(codeUnits(log)).toEqual(['First.unit']);
    expect(log.userInfo?.userName).toBe('user@example.com');
    expect(log.logIssues).toEqual([
      expect.objectContaining({
        summary: 'Multiple-Logs',
        type: 'error',
        startTime: 140,
        description: expect.stringContaining('holds 2 logs'),
      }),
    ]);
  });

  it('splits after an event that takes wrapped text', () => {
    const log = parse(
      SETTINGS +
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|USER_DEBUG|[1]|DEBUG|hi\n' +
        SETTINGS +
        execution(50, 'Second.unit'),
    );

    expect(log.eventsById.find((event) => event.type === 'USER_DEBUG')?.text).toBe('DEBUG | hi');
    expect(codeUnits(log)).toEqual([]);
    expect(log.logIssues.map((issue) => issue.summary)).toContain('Multiple-Logs');
  });

  it('keeps one log when a debug message quotes a settings line', () => {
    const log = parse(
      SETTINGS +
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|USER_DEBUG|[1]|DEBUG|pasted header follows:\n' +
        SETTINGS +
        '09:18:22.6 (300)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Real.unit\n' +
        '09:18:22.6 (400)|CODE_UNIT_FINISHED|Real.unit\n' +
        '09:18:22.6 (500)|EXECUTION_FINISHED\n',
    );

    expect(codeUnits(log)).toEqual(['Real.unit']);
    expect(log.logIssues.map((issue) => issue.summary)).not.toContain('Multiple-Logs');
  });

  it('parses the first log when only a later log states EXECUTION_STARTED', () => {
    const log = parse(
      SETTINGS +
        '09:18:22.6 (100)|CODE_UNIT_STARTED|[EXTERNAL]|01q|First.unit\n' +
        '09:18:22.6 (200)|CODE_UNIT_FINISHED|First.unit\n' +
        SETTINGS +
        execution(50, 'Second.unit'),
    );

    expect(codeUnits(log)).toEqual(['First.unit']);
    expect(log.logIssues.map((issue) => issue.summary)).toContain('Multiple-Logs');
  });

  it('keeps one log whose every execution states USER_INFO', () => {
    const log = parse(
      SETTINGS + execution(100, 'FutureHandler - state load') + execution(200, 'Real.work'),
    );

    expect(codeUnits(log)).toEqual(['FutureHandler - state load', 'Real.work']);
    expect(log.logIssues).toEqual([]);
  });
});
