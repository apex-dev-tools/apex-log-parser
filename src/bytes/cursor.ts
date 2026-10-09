/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Fields } from '../catalog/types.js';
import { CR, LBRACKET, MINUS, matchesAscii, PIPE, RBRACKET, ZERO } from './ascii.js';
import { continuationText } from './lines.js';
import type { Source } from './source.js';

const EXTERNAL = 'EXTERNAL';

/** The unsigned decimal in bytes `start` to `end`, or NaN when it is not one or is not safe. */
export function digits(bytes: Uint8Array, start: number, end: number): number {
  if (start >= end) return Number.NaN;
  let n = 0;
  for (let i = start; i < end; i++) {
    // i < end, which is inside the line
    const d = bytes[i]! - ZERO;
    if (d < 0 || d > 9) return Number.NaN;
    n = n * 10 + d;
    // Past this, n * 10 + d is no longer exact, and every later value is larger still.
    if (n > Number.MAX_SAFE_INTEGER) return Number.NaN;
  }
  return n;
}

/**
 * `Fields` over a source's bytes. One cursor serves every line: `reset` points it at the next one.
 * Field offsets are found only as far as a read needs, and numbers are read from the bytes.
 */
export class ByteFields implements Fields {
  private readonly source: Source;
  private readonly bytes: Uint8Array;
  /** Where each field found so far starts. Field 0 starts at the line. */
  private starts: Int32Array = new Int32Array(16);
  private found = 0;
  /** Every `|` on the line is found. */
  private complete = true;
  private end = 0;
  private continuationStart = 0;
  private continuationEnd = 0;

  constructor(source: Source) {
    this.source = source;
    this.bytes = source.bytes;
  }

  /**
   * Points the cursor at one line: bytes `start` to `end`, without the line ending, and the bytes
   * of its continuation lines, if any.
   */
  reset(
    start: number,
    end: number,
    continuationStart: number = end,
    continuationEnd: number = end,
  ): void {
    this.starts[0] = start;
    this.found = 1;
    this.complete = false;
    this.end = end;
    this.continuationStart = continuationStart;
    this.continuationEnd = continuationEnd;
  }

  /**
   * As `reset`, for a stored row: bytes `start` to `end` hold its line, then any continuation
   * lines. Only a line ending in `\n` loses its `\r`, as the engine's `end` already states.
   */
  resetRow(start: number, end: number): void {
    const lf = this.source.lineEnd(start);
    if (lf < 0 || lf >= end) {
      this.reset(start, end);
      return;
    }
    const lineEnd = lf > start && this.bytes[lf - 1] === CR ? lf - 1 : lf;
    this.reset(start, lineEnd, lf + 1, end);
  }

  /**
   * As `reset`, for a line whose first `|` is at `pipe1`, before `end`, and whose second is at
   * `pipe2`, or `end` for none.
   */
  resetFound(start: number, end: number, pipe1: number, pipe2: number): void {
    this.reset(start, end);
    this.starts[1] = pipe1 + 1;
    this.found = 2;
    if (pipe2 < end) this.starts[this.found++] = pipe2 + 1;
    else this.complete = true;
  }

  get count(): number {
    // Each call finds one more field or marks the line complete.
    while (!this.complete) this.startOf(this.found);
    return this.found;
  }

  at(i: number): string {
    const start = this.startOf(i);
    return start < 0 ? '' : this.source.text(start, this.endOf(i));
  }

  from(i: number, separator: string): string {
    const start = this.startOf(i);
    if (start < 0) return '';
    // The line already holds the fields joined by `|`, and every `|` on it separates two fields.
    const text = this.source.text(start, this.end);
    return separator === '|' ? text : text.replaceAll('|', separator);
  }

  /**
   * Where field `i` starts in the source, or -1 when the line has no field `i`. Finds offsets only
   * as far as field `i`.
   */
  startOf(i: number): number {
    if (i < 0) return -1;
    const bytes = this.bytes;
    const end = this.end;
    while (this.found <= i) {
      if (this.complete) return -1;
      // An incomplete line was reset, so found is at least 1
      let p = this.starts[this.found - 1]!;
      while (p < end && bytes[p] !== PIPE) p++;
      if (p >= end) {
        this.complete = true;
        return -1;
      }
      if (this.found === this.starts.length) this.grow();
      this.starts[this.found++] = p + 1;
    }
    // i < found
    return this.starts[i]!;
  }

  /** Where field `i` ends in the source: before the next field, or at the line's end, also for a field the line does not have. */
  endOf(i: number): number {
    const next = this.startOf(i + 1);
    return next < 0 ? this.end : next - 1;
  }

  continuation(): string {
    if (this.continuationStart >= this.continuationEnd) return '';
    return continuationText(this.source.text(this.continuationStart, this.continuationEnd));
  }

  lineNumber(i: number): number | 'EXTERNAL' | null {
    const start = this.startOf(i);
    if (start < 0) return null;
    const end = this.endOf(i);
    if (start === end) return null;
    const bytes = this.bytes;
    if (end - start < 3 || bytes[start] !== LBRACKET || bytes[end - 1] !== RBRACKET)
      return Number.NaN;
    if (end - start === EXTERNAL.length + 2 && matchesAscii(this.bytes, start + 1, EXTERNAL))
      return 'EXTERNAL';
    return digits(this.bytes, start + 1, end - 1);
  }

  int(i: number, prefix = ''): number | null {
    let start = this.startOf(i);
    if (start < 0) return null;
    const end = this.endOf(i);
    if (start === end) return null;
    if (end - start < prefix.length) return Number.NaN;
    if (!matchesAscii(this.bytes, start, prefix)) return Number.NaN;
    start += prefix.length;
    if (start < end && this.bytes[start] === MINUS) return -digits(this.bytes, start + 1, end);
    return digits(this.bytes, start, end);
  }

  private grow(): void {
    const grown = new Int32Array(this.starts.length * 2);
    grown.set(this.starts);
    this.starts = grown;
  }
}
