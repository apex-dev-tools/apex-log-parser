/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  COLON,
  CR,
  DOT,
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
export function statesType(line: string): boolean {
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
  // Only a CR before an LF ends a line; the log's last line keeps its CR, as in v0.
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
  let i = start;
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
