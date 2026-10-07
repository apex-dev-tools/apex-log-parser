/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Fields } from '../catalog/types.js';

/**
 * Builds the adapter under test from a line of text, without its line ending, and its continuation
 * lines. The line split strips `\r`, so no field ends in one. The adapter calls `onContinuation`
 * when it reads the continuation lines, so the suite can check it reads them only when asked.
 */
export type MakeFields = (
  line: string,
  continuation?: string,
  onContinuation?: () => void,
) => Fields;

/** What every `Fields` adapter must do, so the test fake and the byte cursor agree. */
export function describeFieldsContract(name: string, make: MakeFields): void {
  const head = '00:00:00.0 (1)|SOQL_EXECUTE_END';

  describe(`${name} meets the Fields contract`, () => {
    it('counts the fields, with the timestamp and the type as 0 and 1', () => {
      const f = make(`${head}|[12]|Rows:10`);
      expect(f.count).toBe(4);
      expect([f.at(0), f.at(1), f.at(2), f.at(3)]).toEqual([
        '00:00:00.0 (1)',
        'SOQL_EXECUTE_END',
        '[12]',
        'Rows:10',
      ]);
    });

    it('gives an empty string, or no number, for a field past either end', () => {
      const f = make(`${head}|[12]|Rows:10`);
      expect([f.at(5), f.at(-1), f.from(-1, ','), f.lineNumber(-1), f.int(-1)]).toEqual([
        '',
        '',
        '',
        null,
        null,
      ]);
    });

    it('joins a field and every later one, or gives an empty string when there are none', () => {
      const f = make(`${head}|a|b|c`);
      expect(f.from(3, '|')).toBe('b|c');
      expect(f.from(9, '|')).toBe('');
    });

    it('gives the continuation lines, or an empty string', () => {
      expect(make(head, 'one\ntwo').continuation()).toBe('one\ntwo');
      expect(make(head).continuation()).toBe('');
    });

    it('reads the continuation lines only when asked', () => {
      const continuation = vi.fn();
      const f = make(`${head}|[12]|Rows:10`, 'more', continuation);
      f.at(2);
      f.from(2, '|');
      f.lineNumber(2);
      f.int(3, 'Rows:');
      expect(continuation).not.toHaveBeenCalled();
      expect(f.continuation()).toBe('more');
    });

    it.each([
      ['[12]', 12],
      ['[0]', 0],
      ['[EXTERNAL]', 'EXTERNAL'],
      ['', null],
      ['[]', Number.NaN],
      ['12', Number.NaN],
      ['[1x]', Number.NaN],
      ['[-3]', Number.NaN],
      ['[99999999999999999999]', Number.NaN],
    ])('reads the line number %j as %s', (field, expected) => {
      expect(make(`${head}|${field}`).lineNumber(2)).toEqual(expected);
    });

    it('states no line number for a field past the end', () => {
      expect(make(head).lineNumber(2)).toBeNull();
    });

    it.each([
      ['Rows:10', 'Rows:', 10],
      ['Rows:0', 'Rows:', 0],
      ['Bytes:-8', 'Bytes:', -8],
      ['42', '', 42],
      ['', 'Rows:', null],
      ['Rows:', 'Rows:', Number.NaN],
      ['Rows:1.5', 'Rows:', Number.NaN],
      ['Rows: 1', 'Rows:', Number.NaN],
      ['Bytes:10', 'Rows:', Number.NaN],
      ['Rows:9007199254740991', 'Rows:', 9007199254740991],
      ['Rows:9007199254740992', 'Rows:', Number.NaN],
    ])('reads %j after %j as %s', (field, prefix, expected) => {
      expect(make(`${head}|${field}`).int(2, prefix)).toEqual(expected);
    });

    it('states no integer for a field past the end', () => {
      expect(make(head).int(4, 'Rows:')).toBeNull();
    });
  });
}
