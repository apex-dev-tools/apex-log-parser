/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '../views/log.js';
import { at, HEADER, logOf, parse } from './helpers.js';

const pick = (log: ApexLog, key: 'text' | 'suffix' | 'cpuType' | 'hasValidSymbols') =>
  [...log.events].map((e) => e[key]);

describe('event text', () => {
  it('reads the text by its type rule, with continuation lines, and null when it states none', () => {
    const log = logOf(
      `${at(1)}|USER_DEBUG|[1]|DEBUG|first`,
      'second',
      `${at(2)}|STATEMENT_EXECUTE|[2]`,
      `${at(3)}|METHOD_ENTRY|[3]|01p000000000AAA|ns.MyClass.run()`,
      `${at(4)}|METHOD_EXIT|[3]|01p000000000AAA|ns.MyClass.run()`,
    );
    expect(pick(log, 'text')).toEqual(['DEBUG | first\nsecond', null, 'ns.MyClass.run()']);
    expect(log.event(1)?.text).toBe(log.event(1)?.text);
  });

  it('states the first line as the log does, without its line ending or continuation lines', () => {
    const log = parse(
      [
        HEADER,
        `${at(1)}|USER_DEBUG|[1]|DEBUG|first`,
        'second',
        `${at(2)}|STATEMENT_EXECUTE|[2]`,
        '',
      ].join('\r\n'),
    );
    expect([...log.events].map((e) => e.logLine)).toEqual([
      `${at(1)}|USER_DEBUG|[1]|DEBUG|first`,
      `${at(2)}|STATEMENT_EXECUTE|[2]`,
    ]);
    expect(log.event(1)?.text).toBe('DEBUG | first\nsecond');
    // With no `\n` after it, the last line keeps its `\r`, as the engine does.
    const cut = parse(`${HEADER}\r\n${at(1)}|STATEMENT_EXECUTE|[2]\r`);
    expect(cut.event(1)?.logLine).toBe(`${at(1)}|STATEMENT_EXECUTE|[2]\r`);
  });

  it('reads a named field as stated, null when empty or absent, and throws for a name the type lacks', () => {
    const log = logOf(
      `${at(1)}|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account`,
      `${at(2)}|SOQL_EXECUTE_END|[2]|Rows:4`,
      `${at(3)}|USER_DEBUG|[1]||`,
      `${at(4)}|USER_DEBUG|[1]|DEBUG|a|b`,
    );
    // The last field runs to the line's end.
    expect(log.event(3)?.field('message')).toBe('a|b');
    const soql = log.event(1);
    expect([soql?.field('aggregations'), soql?.field('query'), soql?.field('line')]).toEqual([
      'Aggregations:0',
      'SELECT Id FROM Account',
      '[2]',
    ]);
    expect([log.event(2)?.field('level'), log.event(2)?.field('message')]).toEqual([null, null]);
    expect(() => soql?.field('rows')).toThrow('SOQL_EXECUTE_BEGIN has no field rows');
    // ofType narrows the names to the type's own; the frame and leaf shapes survive it.
    const [typed] = log.ofType('SOQL_EXECUTE_BEGIN');
    expect(typed?.field('query')).toBe('SELECT Id FROM Account');
    // @ts-expect-error rows is a SOQL_EXECUTE_END field.
    expect(() => typed?.field('rows')).toThrow(RangeError);
    expect(typed?.isFrame).toBe(true);
    if (typed?.isFrame) {
      // Fails the typecheck if isFrame no longer narrows exitStamp to a number.
      const exitStamp: number = typed.exitStamp;
      expect(exitStamp).toBe(2);
    }
  });

  it('states the suffix and cpuType of the type, or of the line when its events differ', () => {
    const log = logOf(
      `${at(1)}|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:Account`,
      `${at(2)}|CODE_UNIT_FINISHED|Workflow:Account`,
      `${at(3)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
      `${at(4)}|METHOD_ENTRY|[1]|01p000000000AAA|System.Type.forName(String)`,
      `${at(5)}|METHOD_EXIT|[1]|01p000000000AAA|System.Type.forName(String)`,
      `${at(6)}|METHOD_ENTRY|[2]|01p000000000AAA|ns.MyClass.run()`,
      `${at(7)}|STATEMENT_EXECUTE|[3]`,
      `${at(8)}|METHOD_EXIT|[2]|01p000000000AAA|ns.MyClass.run()`,
      `${at(9)}|CODE_UNIT_FINISHED|execute_anonymous_apex`,
    );
    expect(pick(log, 'cpuType')).toEqual(['custom', 'method', 'loading', 'method', null]);
    expect(pick(log, 'suffix')).toEqual([' (code unit)', ' (code unit)', null, null, null]);
  });

  it('has valid symbols for an Apex frame, and not for a VF call the line made a leaf', () => {
    const log = logOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(3)}|VF_APEX_CALL_START|[1]|ns.MyController|`,
      `${at(4)}|STATEMENT_EXECUTE|[2]`,
    );
    expect(pick(log, 'hasValidSymbols')).toEqual([true, false, false]);
  });

  it('names flow interviews by their first interview, and by what started them', () => {
    const interviews = (from: number, name: string): string[] => [
      `${at(from)}|FLOW_START_INTERVIEWS_BEGIN|1`,
      `${at(from + 1)}|FLOW_START_INTERVIEWS_ERROR|x|01I000000000AAA|${name}`,
      `${at(from + 2)}|FLOW_START_INTERVIEW_BEGIN|01I000000000AAA|${name}`,
      `${at(from + 3)}|FLOW_START_INTERVIEW_END|01I000000000AAA|${name}`,
      `${at(from + 4)}|FLOW_START_INTERVIEWS_END|1`,
    ];
    const log = logOf(
      `${at(1)}|CODE_UNIT_STARTED|[EXTERNAL]|Flow:Account`,
      ...interviews(2, 'MyFlow'),
      `${at(7)}|CODE_UNIT_FINISHED|Flow:Account`,
      `${at(8)}|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:Account`,
      ...interviews(9, 'MyProcess'),
      `${at(14)}|CODE_UNIT_FINISHED|Workflow:Account`,
      ...interviews(15, 'Alone'),
      // Truncated: the log ends inside it.
      `${at(20)}|FLOW_START_INTERVIEWS_BEGIN|1`,
      `${at(21)}|FLOW_START_INTERVIEW_BEGIN|01I000000000AAA|Cut`,
    );
    const frames = log.ofType('FLOW_START_INTERVIEWS_BEGIN');
    expect(frames.map((e) => [e.text, e.suffix, e.isTruncated])).toEqual([
      ['MyFlow', ' (Flow)', false],
      ['MyProcess', ' (Process Builder)', false],
      ['Alone', null, false],
      ['Cut', null, true],
    ]);
  });
});
