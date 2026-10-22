/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { BrowserSource } from '../bytes/browser.js';
import { ByteFields } from '../bytes/cursor.js';
import { LineScanner, timestampClose, timestampIn } from '../bytes/lines.js';
import { NodeSource } from '../bytes/node.js';
import type { Source } from '../bytes/source.js';
import { typeIdAt } from '../bytes/typeIds.js';
import { digits } from '../bytes/words.js';
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

  it.each([0, 1])('finds every line end in a view at offset %i', (offset) => {
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

  // A line before, so offsets in the source are not offsets in the line.
  const BEFORE = 'x|y\n';

  /** A cursor over `line`, then `continuation`, pointed at the line by `point`. */
  const fieldsOver =
    (
      point: (
        fields: ByteFields,
        bytes: Uint8Array,
        start: number,
        end: number,
        from: number,
      ) => void,
    ) =>
    (line: string, continuation = '', onContinuation?: () => void): ByteFields => {
      const start = BEFORE.length;
      const end = start + encode(line).length;
      const bytes = at(1, `${BEFORE}${continuation ? `${line}\n${continuation}` : line}`);
      const source = sourceOf(bytes);
      const watched: Source = {
        bytes,
        words: source.words,
        lineEnd: (from) => source.lineEnd(from),
        text: (from, to) => {
          if (to > end) onContinuation?.();
          return source.text(from, to);
        },
      };
      const fields = new ByteFields(watched);
      point(fields, bytes, start, end, continuation ? end + 1 : end);
      return fields;
    };

  const afterReset = fieldsOver((fields, bytes, start, end, from) =>
    fields.reset(start, end, from, bytes.length),
  );
  const afterScan = fieldsOver((fields, bytes, start, end, from) => {
    const lines = new LineScanner(sourceOf(bytes));
    lines.next(start);
    fields.resetLine(start, end, lines, from, bytes.length);
  });
  const afterRow = fieldsOver((fields, bytes, start) => fields.resetRow(start, bytes.length));

  const setups = [
    ['ByteFields', afterReset],
    ['ByteFields after a line scan', afterScan],
    ['ByteFields over a stored row', afterRow],
  ] as const;
  for (const [name, make] of setups) describeFieldsContract(name, make);

  describe.each(setups)('%s', (_, make) => {
    it.each([
      'a|b|c',
      'a||c',
      'a|',
      'a',
      // More pipes than a line scan records.
      Array.from({ length: 20 }, (_, i) => `f${i}`).join('|'),
    ])('gives where each field of %j starts and ends, and where the line ends', (line) => {
      const fields = make(line, 'more');
      const parts = line.split('|');
      let start = BEFORE.length;
      const spans = parts.map((part) => {
        const span = [start, start + part.length];
        start += part.length + 1;
        return span;
      });
      const end = BEFORE.length + line.length;
      // Last field first, so the first read finds every offset.
      const order = [...parts.keys()].reverse();
      expect(order.map((i) => [fields.startOf(i), fields.endOf(i)])).toEqual(
        order.map((i) => spans[i]),
      );
      expect([fields.lineEnd, fields.startOf(-1)]).toEqual([end, -1]);
      expect([fields.startOf(parts.length), fields.endOf(parts.length)]).toEqual([-1, end]);
    });
  });

  it("ends a stored row's line before the CR of its line ending", () => {
    const bytes = at(1, `${BEFORE}a|b\r\nmore\r\n`);
    const fields = new ByteFields(sourceOf(bytes));
    // A row ends before its last line's CR, as the builder stores it.
    fields.resetRow(BEFORE.length, bytes.length - 2);
    expect([fields.lineEnd, fields.at(1), fields.continuation()]).toEqual([
      BEFORE.length + 3,
      'b',
      'more',
    ]);
  });

  it.each([
    ['a CRLF log', 'line\r\none\r\n\r\n  \r\ntwo\r\n', 6, 'one\n  \ntwo'],
    ['a leading empty line', 'line\n\nmore', 5, 'more'],
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
});

describe('LineScanner', () => {
  type Line = [end: number, pipes: number[]];
  const scanned = (bytes: Uint8Array): Line[] => {
    const lines = new LineScanner(new NodeSource(bytes));
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
      // `}` is one above `|`, so a borrow from the pipe before it must not mark it.
      const text = [
        '',
        'a|b',
        '|',
        `${'x'.repeat(9)}${'|'.repeat(20)}`,
        'é|日本|',
        'c\r',
        '|}',
        'no|end',
      ]
        .join('\n')
        .repeat(5);
      // Padded with pipes, so a read outside the view records one.
      const bytes = at(offset, text, 0x7c);
      expect(scanned(bytes)).toEqual(expected(bytes));
    },
  );

  it('finds no line end or pipe in a byte that differs from one only in the high bit', () => {
    // 0x8a is `\n` + 0x80 and 0xfc is `|` + 0x80. Not text, as no UTF-8 string holds 0xfc.
    const bytes = new Uint8Array([
      0x61, 0x8a, 0xfc, 0x7c, 0xfc, 0x8a, 0x62, 0x0a, 0x8a, 0x7c, 0xfc, 0x63,
    ]);
    expect(scanned(bytes)).toEqual(expected(bytes));
  });

  it('finds no line end and no pipe in an empty log', () => {
    const lines = new LineScanner(new NodeSource(new Uint8Array(0)));
    expect([lines.next(0), lines.pipeCount]).toEqual([0, 0]);
  });
});

describe('typeIdAt', () => {
  it('finds every event type by its name', () => {
    // No `|` after the last, so its name ends at the end of the view.
    const line = `|${EVENT_TYPE_NAMES.join('|')}`;
    const bytes = at(3, line);
    const source = new NodeSource(bytes);
    let start = 1;
    for (const [id, name] of EVENT_TYPE_NAMES.entries()) {
      expect([name, typeIdAt(source, start, start + name.length)]).toEqual([name, id]);
      start += name.length + 1;
    }
  });

  it.each([
    '',
    // Shorter than any name, so no 4-byte read starts before it.
    'ABC',
    'METHOD_ENTRZ',
    'NOT_A_TYPE',
    // The probe key of SOQL_ and SOSL_EXECUTE_BEGIN, so only the full compare tells it apart.
    'SOXL_EXECUTE_BEGIN',
    // Bytes from 0x80 up make the key negative.
    'MÉTHOD_ENTRY',
    'X'.repeat(60),
  ])('finds no type named %j', (name) => {
    const bytes = at(1, name);
    expect(typeIdAt(new NodeSource(bytes), 0, bytes.length)).toBe(-1);
  });
});

describe('digits', () => {
  // Lengths 1 to 9, so words and the byte tail both run; bytes either side of `0` to `9`.
  it.each([
    ['1', 1],
    ['123', 123],
    ['1234', 1234],
    ['12345', 12345],
    ['00012345', 12345],
    ['123456789', 123456789],
    ['a1', Number.NaN],
    ['1-', Number.NaN],
    ['1234/678', Number.NaN],
    ['123:5678', Number.NaN],
    ['12345?78', Number.NaN],
    ['1234\u00e9', Number.NaN],
  ])('reads %j as %d', (text, n) => {
    const bytes = at(1, text);
    expect(digits(new NodeSource(bytes), 0, bytes.length)).toBe(n);
  });
});

describe('timestampIn', () => {
  it('reads the nanoseconds after the time of day', () => {
    const bytes = at(1, '12:34:56.789 (12345678901)');
    expect(timestampIn(new NodeSource(bytes), 0, bytes.length)).toBe(12345678901);
  });

  // A `(` in the time of day ends the search there, so the line states no timestamp.
  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8])('reads none with a ( at byte %i', (k) => {
    const time = '12:00:00.';
    const bytes = at(1, `${time.slice(0, k)}(${time.slice(k + 1)}0 (5)`);
    expect(timestampIn(new NodeSource(bytes), 0, bytes.length)).toBeNaN();
  });
});

describe('timestampClose', () => {
  it.each(['12:00:00.1', '12:00:00.1 (5'])('finds no close in %j at the end of the log', (text) => {
    expect(timestampClose(at(0, text), 0)).toBe(-1);
  });
});
