/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '../views/log.js';
import { parse } from './helpers.js';

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

function codeUnits(log: ApexLog): (string | null)[] {
  return log.ofType('CODE_UNIT_STARTED').map((e) => e.text);
}

describe('a text that holds more than one log', () => {
  it('parses only the first log when a second settings line opens another', () => {
    const log = parse(
      SETTINGS +
        execution(100, 'First.unit') +
        '\n' +
        SETTINGS +
        execution(50, 'Second.unit', 'other@example.com') +
        SETTINGS +
        execution(10, 'Third.unit'),
    );

    expect(codeUnits(log)).toEqual(['First.unit']);
    expect(log.userInfo?.userName).toBe('user@example.com');
    // On the first log's last line: the exit that closed its execution.
    expect(log.issues).toEqual([
      expect.objectContaining({
        summary: 'Multiple-Logs',
        type: 'error',
        startTime: 140,
        event: log.event(2),
        exitType: 'EXECUTION_FINISHED',
        description:
          'The text holds 3 logs. Only the first log was parsed. Open each log on its own.',
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

    expect(log.ofType('USER_DEBUG')[0]?.text).toBe('DEBUG | hi');
    expect(codeUnits(log)).toEqual([]);
    expect(log.issues.map((issue) => issue.summary)).toContain('Multiple-Logs');
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
    expect(log.issues.map((issue) => issue.summary)).not.toContain('Multiple-Logs');
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
    expect(log.issues.map((issue) => issue.summary)).toContain('Multiple-Logs');
  });

  it('keeps one log whose every execution states USER_INFO', () => {
    const log = parse(
      SETTINGS +
        execution(100, 'FutureHandler - state load') +
        execution(200, 'Real.work', 'later@example.com'),
    );

    expect(codeUnits(log)).toEqual(['FutureHandler - state load', 'Real.work']);
    expect(log.userInfo?.userName).toBe('user@example.com');
    expect(log.issues).toEqual([]);
  });
});
