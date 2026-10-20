/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { BrowserSource } from '../bytes/browser.js';
import { ByteFields, digits } from '../bytes/cursor.js';
import { LineScanner, timestampIn } from '../bytes/lines.js';
import { NodeSource } from '../bytes/node.js';
import type { Source } from '../bytes/source.js';
import { typeIdAt } from '../bytes/typeIds.js';
import { EVENT_TYPE_NAMES } from '../catalog/types.js';
import { describeFieldsContract } from './fieldsContract.js';
import { encode } from './helpers.js';

/**
 * `text` at byte `offset` of a larger buffer, so a view's offset is not word aligned. The padding is
 * `fill`, line ends by default, so a search that reads outside the view finds one.
 */
function at(offset: number, text: string, fill = 0x0a): Uint8Array {
  const body = encode(text);
  const buffer = new Uint8Array(offset + body.length + 7).fill(fill);
  buffer.set(body, offset);
  return buffer.subarray(offset, offset + body.length);
}

const SOURCES: [string, (bytes: Uint8Array) => Source][] = [
  ['NodeSource', (bytes) => new NodeSource(bytes)],
  ['BrowserSource', (bytes) => new BrowserSource(bytes)],
];

describe.each(SOURCES)('%s', (_, sourceOf) => {
  const ends = (source: Source): number[] => {
    const out: number[] = [];
    for (let i = source.lineEnd(0); i !== -1; i = source.lineEnd(i + 1)) out.push(i);
    return out;
  };
  const expected = (bytes: Uint8Array): number[] =>
    [...bytes].flatMap((b, i) => (b === 0x0a ? [i] : []));

  it.each([0, 1, 2, 3, 5])('finds every line end in a view at offset %i', (offset) => {
    const text = ['a', '', 'bb|ccc', 'dddd', 'eeeee', 'é日本', '', ''].join('\n').repeat(9);
    const bytes = at(offset, text);
    expect(ends(sourceOf(bytes))).toEqual(expected(bytes));
  });

  it('finds no line end past the last, in a log with no trailing line end', () => {
    const source = sourceOf(at(1, 'one\ntwo\nthree'));
    expect(source.lineEnd(4)).toBe(7);
    expect(source.lineEnd(8)).toBe(-1);
    expect(source.lineEnd(99)).toBe(-1);
  });

  it('finds no line end in an empty log', () => {
    expect(sourceOf(new Uint8Array(0)).lineEnd(0)).toBe(-1);
  });

  it.each([
    ['ASCII', 'USER_DEBUG'],
    ['non-ASCII', 'é日本 😀'],
    ['long ASCII', 'x'.repeat(500)],
    ['long non-ASCII', 'é'.repeat(300)],
  ])('decodes %s text', (_, text) => {
    const bytes = at(3, `|${text}|`);
    expect(sourceOf(bytes).text(1, bytes.length - 1)).toBe(text);
  });

  /** A cursor over `line`, then `continuation`, pointed at the line by `point`. */
  const fieldsOver =
    (point: (fields: ByteFields, bytes: Uint8Array, lineBytes: number, from: number) => void) =>
    (line: string, continuation = '', onContinuation?: () => void): ByteFields => {
      const lineBytes = encode(line).length;
      const bytes = at(1, continuation ? `${line}\n${continuation}` : line);
      const source = sourceOf(bytes);
      const watched: Source = {
        bytes,
        lineEnd: (from) => source.lineEnd(from),
        text: (start, end) => {
          if (end > lineBytes) onContinuation?.();
          return source.text(start, end);
        },
      };
      const fields = new ByteFields(watched);
      point(fields, bytes, lineBytes, continuation ? lineBytes + 1 : lineBytes);
      return fields;
    };

  describeFieldsContract(
    'ByteFields',
    fieldsOver((fields, bytes, lineBytes, from) => fields.reset(0, lineBytes, from, bytes.length)),
  );

  describeFieldsContract(
    'ByteFields after a line scan',
    fieldsOver((fields, bytes, lineBytes, from) => {
      const lines = new LineScanner(bytes);
      lines.next(0);
      fields.resetLine(0, lineBytes, lines, from, bytes.length);
    }),
  );

  it.each([
    ['a CRLF log', 'line\r\none\r\n\r\n  \r\ntwo\r\n', 6, 'one\n  \ntwo'],
    ['a leading empty line', 'line\n\nmore', 5, 'more'],
    // The log's last line keeps its CR, so it is text, not a marker.
    [
      'a CRLF log with no final LF',
      'line\r\none\r\n*** Skipped 10 bytes of detailed log\r',
      6,
      'one\n*** Skipped 10 bytes of detailed log\r',
    ],
    [
      'a marker or an event-like line',
      'line\none\n*** Skipped 10 bytes of detailed log\nx|NOT_A_TYPE\na|b|c\ntwo',
      5,
      'one\na|b|c\ntwo',
    ],
  ])('drops the CRs and empty lines among the continuation lines of %s', (_, text, from, out) => {
    const bytes = at(2, text);
    const fields = new ByteFields(sourceOf(bytes));
    fields.reset(0, 4, from, bytes.length);
    expect(fields.continuation()).toBe(out);
  });

  it('keeps a leading byte order mark', () => {
    const bytes = at(1, `\uFEFF${'a'.repeat(200)}`);
    expect(sourceOf(bytes).text(0, bytes.length)).toBe(`\uFEFF${'a'.repeat(200)}`);
  });

  it('serves one line after another, with more fields than it first holds room for', () => {
    const wide = Array.from({ length: 40 }, (_, i) => `f${i}`).join('|');
    const bytes = at(0, `a|b\n${wide}\nc`);
    const fields = new ByteFields(sourceOf(bytes));
    fields.reset(0, 3);
    expect([fields.count, fields.at(1)]).toEqual([2, 'b']);
    fields.reset(4, 4 + wide.length);
    expect([fields.count, fields.at(39), fields.from(38, ',')]).toEqual([40, 'f39', 'f38,f39']);
    fields.reset(bytes.length - 1, bytes.length);
    expect([fields.count, fields.at(0), fields.at(1)]).toEqual([1, 'c', '']);
  });

  it.each([
    'a|b|c|d',
    'a|b',
    'a|',
    'a||c',
    'a',
    // More pipes than a line scan records.
    Array.from({ length: 20 }, (_, i) => `f${i}`).join('|'),
  ])('reads %j the same when given the pipes a line scan found', (line) => {
    // A line after another, so offsets in the source are not offsets in the line.
    const bytes = at(1, `x|y\n${line}`);
    const lines = new LineScanner(bytes);
    const end = lines.next(4);
    const fields = new ByteFields(sourceOf(bytes));
    fields.resetLine(4, end, lines);
    const parts = line.split('|');
    expect(parts.map((_, i) => fields.at(i))).toEqual(parts);
    expect([fields.count, fields.startOf(parts.length)]).toEqual([parts.length, -1]);
  });
});

describe('LineScanner', () => {
  type Line = [end: number, pipes: number[]];
  const scanned = (bytes: Uint8Array): Line[] => {
    const lines = new LineScanner(bytes);
    const out: Line[] = [];
    for (let start = 0; start < bytes.length; ) {
      const end = lines.next(start);
      out.push([end, [...lines.pipes.subarray(0, lines.pipeCount)]]);
      start = end + 1;
    }
    return out;
  };
  const expected = (bytes: Uint8Array): Line[] => {
    const out: Line[] = [];
    for (let start = 0; start < bytes.length; ) {
      let end = start;
      const pipes: number[] = [];
      for (; end < bytes.length && bytes[end] !== 0x0a; end++) {
        if (bytes[end] === 0x7c && pipes.length < 16) pipes.push(end);
      }
      out.push([end, pipes]);
      start = end + 1;
    }
    return out;
  };

  it.each([0, 1, 2, 3, 5])(
    'finds each line end and its first 16 pipes in a view at offset %i',
    (offset) => {
      const text = ['', 'a|b', '|', `${'x'.repeat(9)}${'|'.repeat(20)}`, 'é|日本|', 'c\r', 'no|end']
        .join('\n')
        .repeat(5);
      // Padded with pipes, so a read outside the view records one.
      const bytes = at(offset, text, 0x7c);
      expect(scanned(bytes)).toEqual(expected(bytes));
    },
  );

  it('finds no line end and no pipe in an empty log', () => {
    const lines = new LineScanner(new Uint8Array(0));
    expect([lines.next(0), lines.pipeCount]).toEqual([0, 0]);
  });
});

describe('typeIdAt', () => {
  it('finds every event type by its name', () => {
    const line = `|${EVENT_TYPE_NAMES.join('|')}|`;
    const bytes = at(3, line);
    let start = 1;
    for (const [id, name] of EVENT_TYPE_NAMES.entries()) {
      expect([name, typeIdAt(bytes, start, start + name.length)]).toEqual([name, id]);
      start += name.length + 1;
    }
  });

  it.each([
    '',
    'METHOD_ENTR',
    'METHOD_ENTRYX',
    'METHOD_ENTRZ',
    'method_entry',
    'NOT_A_TYPE',
    'X'.repeat(60),
  ])('finds no type named %j', (name) => {
    const bytes = at(1, name);
    expect(typeIdAt(bytes, 0, bytes.length)).toBe(-1);
  });
});

describe('digits', () => {
  it.each([
    ['123', 123],
    ['123456789012345', 123456789012345],
    // A byte above `9` or below `0`, in a pair and in the odd first digit.
    ['a1', Number.NaN],
    ['1-', Number.NaN],
    ['a12', Number.NaN],
    ['-12', Number.NaN],
  ])('reads %j as %d', (text, n) => {
    const bytes = at(1, text);
    expect(digits(bytes, 0, bytes.length)).toBe(n);
  });
});

describe('timestampIn', () => {
  it('reads the nanoseconds after the time of day', () => {
    const bytes = at(1, '12:34:56.789 (12345678901)');
    expect(timestampIn(bytes, 0, bytes.length)).toBe(12345678901);
  });

  // A `(` in the time of day ends the search there, so the line states no timestamp.
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('reads none with a ( at byte %i', (k) => {
    const time = '12:00:00.';
    const bytes = at(1, `${time.slice(0, k)}(${time.slice(k + 1)}0 (5)`);
    expect(timestampIn(bytes, 0, bytes.length)).toBeNaN();
  });
});
