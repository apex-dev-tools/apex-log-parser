/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Fields } from '../catalog/types.js';
import type { Source } from './source.js';

const PIPE = 0x7c;
const OPEN = 0x5b;
const CLOSE = 0x5d;
const MINUS = 0x2d;
const ZERO = 0x30;
const EXTERNAL = 'EXTERNAL';

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

  get count(): number {
    while (!this.complete) this.scan();
    return this.found;
  }

  at(i: number): string {
    return this.has(i) ? this.source.text(this.start(i), this.fieldEnd(i)) : '';
  }

  from(i: number, separator: string): string {
    if (!this.has(i)) return '';
    // The line already holds the fields joined by `|`, and every `|` on it separates two fields.
    const text = this.source.text(this.start(i), this.end);
    return separator === '|' ? text : text.replaceAll('|', separator);
  }

  continuation(): string {
    if (this.continuationStart >= this.continuationEnd) return '';
    const text = this.source.text(this.continuationStart, this.continuationEnd);
    // Rare: a CRLF log, or an empty line between continuation lines, which the log drops.
    const clean =
      text.indexOf('\r') < 0 &&
      text.indexOf('\n\n') < 0 &&
      text[0] !== '\n' &&
      text.at(-1) !== '\n';
    if (clean) return text;
    return text
      .split('\n')
      .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
      .filter((line) => line !== '')
      .join('\n');
  }

  lineNumber(i: number): number | 'EXTERNAL' | null {
    if (!this.has(i)) return null;
    const start = this.start(i);
    const end = this.fieldEnd(i);
    if (start === end) return null;
    const bytes = this.bytes;
    if (end - start < 3 || bytes[start] !== OPEN || bytes[end - 1] !== CLOSE) return Number.NaN;
    if (end - start === EXTERNAL.length + 2 && this.matches(start + 1, EXTERNAL)) return 'EXTERNAL';
    return this.digits(start + 1, end - 1);
  }

  int(i: number, prefix = ''): number | null {
    if (!this.has(i)) return null;
    let start = this.start(i);
    const end = this.fieldEnd(i);
    if (start === end) return null;
    if (end - start < prefix.length) return Number.NaN;
    if (!this.matches(start, prefix)) return Number.NaN;
    start += prefix.length;
    if (start < end && this.bytes[start] === MINUS) return -this.digits(start + 1, end);
    return this.digits(start, end);
  }

  /** The unsigned decimal in bytes `start` to `end`, or NaN when it is not one or is not safe. */
  private digits(start: number, end: number): number {
    if (start >= end) return Number.NaN;
    const bytes = this.bytes;
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

  /** Bytes from `start` spell `ascii`. */
  private matches(start: number, ascii: string): boolean {
    for (let k = 0; k < ascii.length; k++) {
      if (this.bytes[start + k] !== ascii.charCodeAt(k)) return false;
    }
    return true;
  }

  /** Field `i` exists, finding offsets only as far as it. */
  private has(i: number): boolean {
    if (i < 0) return false;
    if (i < 0) return false;
    while (this.found <= i && !this.complete) this.scan();
    return i < this.found;
  }

  private start(i: number): number {
    // Only called after has(i)
    return this.starts[i]!;
  }

  /** Where field `i` ends: one before the next field's start, or the line's end. */
  private fieldEnd(i: number): number {
    return this.has(i + 1) ? this.start(i + 1) - 1 : this.end;
  }

  /** Finds the next `|`, or marks the line complete. */
  private scan(): void {
    const bytes = this.bytes;
    const end = this.end;
    let i = this.start(this.found - 1);
    while (i < end && bytes[i] !== PIPE) i++;
    if (i >= end) {
      this.complete = true;
      return;
    }
    if (this.found === this.starts.length) {
      const grown = new Int32Array(this.starts.length * 2);
      grown.set(this.starts);
      this.starts = grown;
    }
    this.starts[this.found++] = i + 1;
  }
}
