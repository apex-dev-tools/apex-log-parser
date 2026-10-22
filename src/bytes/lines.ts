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
import type { Source } from './source.js';
import { digits } from './words.js';

const SKIPPED = String.raw`\*\*\* Skipped ([\d,]+) bytes of detailed log`;
const MAX_SIZE = String.raw`\*+ MAXIMUM DEBUG LOG SIZE REACHED \*+`;

/**
 * A truncation marker line, in its exact forms only, so a debug message that quotes it stays text.
 * Group 1 holds a skip's bytes, as `1,000`.
 */
export const TRUNCATION_MARKER: RegExp = new RegExp(`^(?:${SKIPPED}|${MAX_SIZE}) *$`);

/** The maximum-size marker at the end of an event's line, which the platform cut there. */
export const CUT_BY_MAX_SIZE: RegExp = new RegExp(`${MAX_SIZE} *$`);

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
    // A CR before an LF is line end. The text's end already is one, so a CR there is text.
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
  // A loop, not indexOfByte: in V8's lower tiers the call costs more than the search.
  let i = skip ? start + 9 : start;
  while (i < end && bytes[i] !== LPAREN) i++;
  if (i >= end || bytes[end - 1] !== RPAREN) return Number.NaN;
  return digits(source, i + 1, end - 1);
}

/** Bytes `start` to `end` are a non-empty run of `A`-`Z` and `_`, as an event name is. */
export function isTypeName(bytes: Uint8Array, start: number, end: number): boolean {
  if (start >= end) return false;
  for (let i = start; i < end; i++) {
    // i < end, which is inside the line
    const c = bytes[i]!;
    if (!((c - UPPER_A) >>> 0 <= UPPER_Z - UPPER_A || c === UNDERSCORE)) return false;
  }
  return true;
}

// Local, not imported, and inline below: under Vite's module runner, as CodSpeed runs, an
// imported binding is a getter, and V8's lower tiers inline no call.
const ONES = 0x01010101;
const HIGHS = 0x80808080;
const LFS = 0x0a0a0a0a;
const PIPES = 0x7c7c7c7c;
/** A word's first byte is its lowest, so a bit's position gives its byte. Else, byte by byte. */
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
  /**
   * How many pipes `pipes` holds for the line `next` scanned last; below `pipes.length`, all of
   * them. Only `next` writes it. A field, not a getter: V8's lower tiers inline no call.
   */
  pipeCount = 0;
  private readonly bytes: Uint8Array;
  // An Int32Array, not the source's DataView: in V8's lower tiers each DataView read is a call.
  private readonly words: Int32Array;
  private readonly offset: number;

  constructor(source: Source) {
    const bytes = source.bytes;
    this.bytes = bytes;
    // Over the whole buffer, so a word index is the byte address over 4 whatever the view's offset.
    this.words = new Int32Array(bytes.buffer, 0, bytes.buffer.byteLength >>> 2);
    this.offset = bytes.byteOffset;
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
    const offset = this.offset;
    // Byte addresses in the buffer: the words below `whole` end inside the view.
    const whole = LITTLE_ENDIAN ? (offset + len) & ~3 : 0;
    const from = offset + start;
    let n = 0;
    // `keep` masks off the bytes of the first word before `start`; the masks are as in words.ts.
    for (let at = from & ~3, keep = -1 << ((from & 3) << 3); at < whole; at += 4, keep = -1) {
      // at < whole, so the word is inside the buffer
      let lf = words[at >>> 2]!;
      let pipe = lf ^ PIPES;
      lf ^= LFS;
      let lfBits = ~(((lf | HIGHS) - ONES) | lf) & HIGHS & keep;
      let pipeBits = ~(((pipe | HIGHS) - ONES) | pipe) & HIGHS & keep;
      // A word with neither reads the next one too: one branch per 8 bytes scans 9-22% faster.
      if (!(lfBits | pipeBits) && at + 4 < whole) {
        at += 4;
        lf = words[at >>> 2]!;
        pipe = lf ^ PIPES;
        lf ^= LFS;
        lfBits = ~(((lf | HIGHS) - ONES) | lf) & HIGHS;
        pipeBits = ~(((pipe | HIGHS) - ONES) | pipe) & HIGHS;
      }
      // Lowest bit first, so a pipe after the line end is never recorded.
      for (let hits = lfBits | pipeBits; hits; hits &= hits - 1) {
        const bit = hits & -hits;
        const pos = at - offset + 3 - (Math.clz32(bit) >>> 3);
        if (bit & lfBits) {
          this.pipeCount = n;
          return pos;
        }
        if (n < PIPE_CAP) pipes[n++] = pos;
      }
    }
    let i = Math.max(start, whole - offset);
    for (; i < len; i++) {
      const c = bytes[i];
      if (c === LF) break;
      if (c === PIPE && n < PIPE_CAP) pipes[n++] = i;
    }
    this.pipeCount = n;
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
