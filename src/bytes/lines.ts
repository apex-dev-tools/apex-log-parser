/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  COLON,
  CR,
  DOT,
  indexOfByte,
  inRange,
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
import type { Source } from './source.js';
import { byteOf, digits, fromByte, LFS, matchBytes, PIPES } from './words.js';

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
  // Null while every line so far is kept as it is: those lines are then `text` up to `keptEnd`.
  let out: string | null = null;
  let keptEnd = 0;
  for (let start = 0; ; ) {
    const lf = text.indexOf('\n', start);
    const last = lf < 0;
    const eol = last ? text.length : lf;
    // Only a CR before an LF ends a line; the log's last line keeps its CR, as before 0.4.
    const cr = !last && eol > start && text.charCodeAt(eol - 1) === CR;
    const end = cr ? eol - 1 : eol;
    const line = text.slice(start, end);
    // Every marker starts with `*`, so most lines skip the regex.
    const marker = line[0] === '*' && TRUNCATION_MARKER.test(line);
    const keep = line !== '' && !marker && !statesType(line);
    if (out === null && (cr || !keep)) out = text.slice(0, keptEnd);
    if (out === null) keptEnd = end;
    else if (keep) out = out ? `${out}\n${line}` : line;
    if (last) return out ?? text;
    start = lf + 1;
  }
}

/** Where `)` closes the `HH:MM:SS.f+ (n+)|` that starts at `start`, or -1 without one. */
export function timestampClose(bytes: Uint8Array, start: number): number {
  // Past the end, -1, which is no digit: `undefined` would pass `inRange`.
  const digit = (i: number): boolean => inRange(bytes[i] ?? -1, ZERO, NINE);
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
export function timestampIn(source: Source, start: number, end: number): number {
  const bytes = source.bytes;
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
  const open = indexOfByte(bytes, LPAREN, skip ? start + 9 : start, end);
  if (open < 0 || bytes[end - 1] !== RPAREN) return Number.NaN;
  return digits(source, open + 1, end - 1);
}

/** Bytes `start` to `end` are a non-empty run of `A`-`Z` and `_`, as an event name is. */
export function isTypeName(bytes: Uint8Array, start: number, end: number): boolean {
  if (start >= end) return false;
  for (let i = start; i < end; i++) {
    // i < end, which is inside the line
    const c = bytes[i]!;
    if (!(inRange(c, UPPER_A, UPPER_Z) || c === UNDERSCORE)) return false;
  }
  return true;
}

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
  private readonly words: DataView;

  /** How many pipes `pipes` holds for the line `next` scanned last. */
  get pipeCount(): number {
    return this.recorded;
  }

  /** Every pipe on the line `next` scanned last is in `pipes`. */
  get complete(): boolean {
    return this.recorded < PIPE_CAP;
  }

  constructor(source: Source) {
    this.bytes = source.bytes;
    this.words = source.words;
  }

  /**
   * The `\n` at or after `start`, or the log's length when there is none, not -1 as
   * `Source.lineEnd`. Overwrites `pipes` with the line's first pipes.
   */
  next(start: number): number {
    const bytes = this.bytes;
    const pipes = this.pipes;
    const len = bytes.length;
    const words = this.words;
    // The bytes in whole words; the rest are read one at a time.
    const whole = len & ~3;
    let n = 0;
    for (let at = start & ~3, keep = fromByte(start); at < whole; at += 4, keep = -1) {
      let x = words.getInt32(at, true);
      let lfBits = matchBytes(x, LFS) & keep;
      let pipeBits = matchBytes(x, PIPES) & keep;
      // A word with neither reads the next one too: one branch per 8 bytes scans 9-22% faster.
      if (!(lfBits | pipeBits) && at + 4 < whole) {
        at += 4;
        x = words.getInt32(at, true);
        lfBits = matchBytes(x, LFS);
        pipeBits = matchBytes(x, PIPES);
      }
      // Lowest bit first, so a pipe after the line end is never recorded.
      for (let hits = lfBits | pipeBits; hits; hits &= hits - 1) {
        const bit = hits & -hits;
        const pos = at + byteOf(bit);
        if (bit & lfBits) {
          this.recorded = n;
          return pos;
        }
        if (n < PIPE_CAP) pipes[n++] = pos;
      }
    }
    let i = Math.max(start, whole);
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
