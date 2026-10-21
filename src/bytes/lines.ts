/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  COLON,
  CR,
  DOT,
  LF,
  LPAREN,
  NINE,
  PIPE,
  RPAREN,
  SPACE,
  UNDERSCORE,
  UPPER_A,
  UPPER_Z,
  ZERO,
} from './ascii.js';
import { digits } from './cursor.js';
import type { Source } from './source.js';

/** A truncation marker line, in its exact forms only, so a debug message that quotes it stays text. */
export const TRUNCATION_MARKER: RegExp =
  /^(?:\*\*\* Skipped [\d,]+ bytes of detailed log|\*+ MAXIMUM DEBUG LOG SIZE REACHED \*+) *$/;

const TYPE_LIKE = /^[A-Z_]+$/;

/** Field 1 of `line` looks like an event name, so the line is never another event's text. */
function statesType(line: string): boolean {
  const first = line.indexOf('|');
  if (first < 0) return false;
  const second = line.indexOf('|', first + 1);
  return TYPE_LIKE.test(line.slice(first + 1, second < 0 ? undefined : second));
}

/**
 * The continuation lines in `text`, joined: without CRs, empty lines,
 * truncation markers, or lines that look like an event. The engine's byte range spans them all.
 */
export function continuationText(text: string): string {
  const clean =
    text.indexOf('\r') < 0 &&
    text.indexOf('\n\n') < 0 &&
    text.indexOf('|') < 0 &&
    text.indexOf('\n*') < 0 &&
    text[0] !== '\n' &&
    text[0] !== '*' &&
    text.at(-1) !== '\n';
  if (clean) return text;
  const lines = text.split('\n');
  // Only a CR before an LF ends a line; the log's last line keeps its CR, as before 0.4.
  return lines
    .map((line, i) => (i < lines.length - 1 && line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line !== '' && !TRUNCATION_MARKER.test(line) && !statesType(line))
    .join('\n');
}

/** Where `)` closes the `HH:MM:SS.f+ (n+)|` that starts at `start`, or -1 without one. */
export function timestampClose(bytes: Uint8Array, start: number): number {
  const digit = (i: number): boolean => bytes[i]! >= ZERO && bytes[i]! <= NINE;
  if (!(digit(start) && digit(start + 1) && bytes[start + 2] === COLON)) return -1;
  if (!(digit(start + 3) && digit(start + 4) && bytes[start + 5] === COLON)) return -1;
  if (!(digit(start + 6) && digit(start + 7) && bytes[start + 8] === DOT)) return -1;
  let i = start + 9;
  if (!digit(i)) return -1;
  while (digit(i)) i++;
  if (bytes[i++] !== SPACE || bytes[i++] !== LPAREN || !digit(i)) return -1;
  while (digit(i)) i++;
  return bytes[i] === RPAREN && bytes[i + 1] === PIPE ? i : -1;
}

/** The nanoseconds in `(…)` of field 0, bytes `start` to `end`, or NaN when it states none. */
export function timestampIn(bytes: Uint8Array, start: number, end: number): number {
  // Skip the `HH:MM:SS.` of the time of day, unless a `(` in it would have ended the search there.
  const skip =
    end - start >= 9 &&
    bytes[start + 2] === COLON &&
    bytes[start + 5] === COLON &&
    bytes[start + 8] === DOT &&
    bytes[start] !== LPAREN &&
    bytes[start + 1] !== LPAREN &&
    bytes[start + 3] !== LPAREN &&
    bytes[start + 4] !== LPAREN &&
    bytes[start + 6] !== LPAREN &&
    bytes[start + 7] !== LPAREN;
  let i = skip ? start + 9 : start;
  while (i < end && bytes[i] !== LPAREN) i++;
  if (i >= end || bytes[end - 1] !== RPAREN) return Number.NaN;
  return digits(bytes, i + 1, end - 1);
}

/** Bytes `start` to `end` are a non-empty run of `A`-`Z` and `_`, as an event name is. */
export function isTypeName(bytes: Uint8Array, start: number, end: number): boolean {
  if (start >= end) return false;
  for (let i = start; i < end; i++) {
    // i < end, which is inside the line
    const c = bytes[i]!;
    if (!((c >= UPPER_A && c <= UPPER_Z) || c === UNDERSCORE)) return false;
  }
  return true;
}

// The SWAR lanes, local as in browser.ts: imported from one module, they made the scan 10% slower.
const ONES = 0x01010101;
const HIGHS = 0x80808080;
const LFS = 0x0a0a0a0a;
const PIPES = 0x7c7c7c7c;
/** A word's first byte is its lowest, so a mask bit's position gives its byte. Else, byte by byte. */
const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
/** The most pipes `LineScanner` records per line; the cursor finds any later ones itself. */
const PIPE_CAP = 16;

/**
 * Finds a line's end and its first pipes in one pass, four bytes at a time (SWAR), so no field
 * search reads the line again. One scanner serves every line of one log.
 */
export class LineScanner {
  /** The first `pipeCount` pipes on the line `next` scanned last. */
  readonly pipes: Int32Array = new Int32Array(PIPE_CAP);
  private recorded = 0;
  private readonly bytes: Uint8Array;
  private readonly words: Int32Array;

  /** How many pipes `pipes` holds for the line `next` scanned last. */
  get pipeCount(): number {
    return this.recorded;
  }

  /** Every pipe on the line `next` scanned last is in `pipes`. */
  get complete(): boolean {
    return this.recorded < PIPE_CAP;
  }

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
    // Over the whole buffer, so a word index is the byte address over 4 whatever the view's offset.
    this.words = new Int32Array(bytes.buffer, 0, bytes.buffer.byteLength >>> 2);
  }

  /**
   * The `\n` at or after `start`, or the log's length when there is none, not -1 as
   * `Source.lineEnd`. Overwrites `pipes` with the line's first pipes.
   */
  next(start: number): number {
    const bytes = this.bytes;
    const pipes = this.pipes;
    const len = bytes.length;
    const offset = bytes.byteOffset;
    let n = 0;
    let i = start;
    for (; i < len && (offset + i) & 3; i++) {
      const c = bytes[i];
      if (c === LF) break;
      if (c === PIPE && n < PIPE_CAP) pipes[n++] = i;
    }
    if (LITTLE_ENDIAN && i < len && bytes[i] !== LF) {
      const words = this.words;
      // Words below `last` end inside the view.
      const last = (offset + len) >>> 2;
      for (let w = (offset + i) >>> 2; w < last; w++) {
        // w < last, so the word is inside the buffer
        const x = words[w]!;
        const lf = x ^ LFS;
        const pipe = x ^ PIPES;
        // OR in the high bits first, so no borrow crosses a byte and only a 0 byte keeps 0x80.
        const lfBits = ~(((lf | HIGHS) - ONES) | lf) & HIGHS;
        let pipeBits = ~(((pipe | HIGHS) - ONES) | pipe) & HIGHS;
        if (!(lfBits | pipeBits)) continue;
        const at = (w << 2) - offset;
        const lfBit = lfBits & -lfBits;
        // A pipe after the line end belongs to the next line. With no LF, lfBit - 1 keeps all.
        pipeBits &= lfBit - 1;
        while (pipeBits && n < PIPE_CAP) {
          pipes[n++] = at + ((31 - Math.clz32(pipeBits & -pipeBits)) >>> 3);
          pipeBits &= pipeBits - 1;
        }
        if (lfBit) {
          this.recorded = n;
          return at + ((31 - Math.clz32(lfBit)) >>> 3);
        }
      }
      i = (last << 2) - offset;
    }
    for (; i < len; i++) {
      const c = bytes[i];
      if (c === LF) break;
      if (c === PIPE && n < PIPE_CAP) pipes[n++] = i;
    }
    this.recorded = n;
    return i;
  }
}

/** The start of the first timestamped line, or -1 when there is none. */
export function firstEventLine(source: Source): number {
  const bytes = source.bytes;
  for (let start = 0; start < bytes.length; ) {
    if (timestampClose(bytes, start) >= 0) return start;
    const eol = source.lineEnd(start);
    if (eol < 0) break;
    start = eol + 1;
  }
  return -1;
}

/** The line at `start`, without its line ending. */
export function lineText(source: Source, start: number): string {
  const eol = source.lineEnd(start);
  let end = eol < 0 ? source.bytes.length : eol;
  if (end > start && source.bytes[end - 1] === CR) end--;
  return source.text(start, end);
}
