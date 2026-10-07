/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { hashBytes } from '../bytes/hash.js';
import type { Source } from '../bytes/source.js';
import { resized } from './columns.js';

const EMPTY = -1;
const MIN_SLOTS = 256;

/**
 * Interned byte ranges of one source: the same bytes anywhere in the log get the same id, so a
 * column holds a number, not a string. Each value is decoded once, when it is first read.
 */
export class StringTable {
  private readonly source: Source;
  private readonly bytes: Uint8Array;
  /** Each id's byte range in the source: the first place the value appeared. */
  private starts: Int32Array = new Int32Array(MIN_SLOTS);
  private ends: Int32Array = new Int32Array(MIN_SLOTS);
  private hashes: Int32Array = new Int32Array(MIN_SLOTS);
  /** Open addressing: the id in each slot, or `EMPTY`. Never more than half full. */
  private slots: Int32Array = new Int32Array(MIN_SLOTS * 2).fill(EMPTY);
  private readonly decoded: (string | undefined)[] = [];
  size = 0;

  constructor(source: Source) {
    this.source = source;
    this.bytes = source.bytes;
  }

  /** The id of the value in bytes `start` to `end`, added if it is new. */
  intern(start: number, end: number): number {
    const bytes = this.bytes;
    const h = hashBytes(bytes, start, end);
    const mask = this.slots.length - 1;
    const len = end - start;
    let slot = h & mask;
    for (; ; slot = (slot + 1) & mask) {
      // slot is masked to the table
      const id = this.slots[slot]!;
      if (id === EMPTY) break;
      // id < size, so it indexes every per-id array
      if (this.hashes[id] !== h || this.ends[id]! - this.starts[id]! !== len) continue;
      const at = this.starts[id]!;
      let k = 0;
      while (k < len && bytes[at + k] === bytes[start + k]) k++;
      if (k === len) return id;
    }
    const id = this.size++;
    if (id === this.starts.length) this.growIds();
    this.starts[id] = start;
    this.ends[id] = end;
    this.hashes[id] = h;
    // One entry per id, so the array stays dense
    this.decoded.push(undefined);
    this.slots[slot] = id;
    if (this.size * 2 > this.slots.length) this.rehash();
    return id;
  }

  /** The value of `id`. */
  text(id: number): string {
    // An id from intern() is below size, so its range is set
    return (this.decoded[id] ??= this.source.text(this.starts[id]!, this.ends[id]!));
  }

  private growIds(): void {
    const size = this.starts.length * 2;
    this.starts = resized(this.starts, size);
    this.ends = resized(this.ends, size);
    this.hashes = resized(this.hashes, size);
  }

  private rehash(): void {
    const slots = new Int32Array(this.slots.length * 2).fill(EMPTY);
    const mask = slots.length - 1;
    for (let id = 0; id < this.size; id++) {
      // id < size, so its hash is set
      const h = this.hashes[id]!;
      let slot = h & mask;
      while (slots[slot] !== EMPTY) slot = (slot + 1) & mask;
      slots[slot] = id;
    }
    this.slots = slots;
  }
}
