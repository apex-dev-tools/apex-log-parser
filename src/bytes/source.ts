/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * One log's bytes, with the two reads that differ between the node and browser builds (ADR 0005).
 * The engine holds one source per parse, so each build's call sites see one class.
 */
export interface Source {
  readonly bytes: Uint8Array;
  /** The index of the next `\n` at or after `from`, which is 0 or more, or -1 when there is none. */
  lineEnd(from: number): number;
  /** Bytes `start` to `end`, decoded as UTF-8. */
  text(start: number, end: number): string;
}

/** Offsets are 32-bit integers in the cursor and the line search, so a view must end below 2^31. */
export function checkSize(bytes: Uint8Array): Uint8Array {
  if (bytes.byteOffset + bytes.byteLength > 0x7fffffff) {
    throw new RangeError('A log must end within the first 2 GiB of its buffer');
  }
  return bytes;
}
