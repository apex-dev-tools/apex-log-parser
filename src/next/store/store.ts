/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { resized } from './columns.js';

/** The rollup counters, each with a self and a total slot in the count pool. */
export const COUNTER = {
  dml: 0,
  soql: 1,
  sosl: 2,
  dmlRows: 3,
  soqlRows: 4,
  soslRows: 5,
  thrown: 6,
} as const;
export const COUNTERS = 7;
/** Where a counter's self and total sit in its pair: `counts[at + counter * 2 + TOTAL]`. */
export const SELF = 0;
export const TOTAL = 1;
/** Self and total per counter. */
const COUNT_STRIDE = COUNTERS * 2;

/** The heap figures in each heap pool slot. Bytes. */
export const HEAP = {
  allocatedSelf: 0,
  allocatedTotal: 1,
  grossSelf: 2,
  grossTotal: 3,
  peak: 4,
} as const;
const HEAP_STRIDE = 5;

/** `lineNumber` for a line that states `[EXTERNAL]`. */
export const EXTERNAL_LINE = -1;
/** `lineNumber` for a line that states none. */
export const NO_LINE = -2;
/** A string id, slot or row that is not there. */
export const NONE = -1;

// Corpus logs over 1 MB hold one row per 51 to 287 bytes, p50 189. Starting near the sparse end
// and growing by half keeps both the growth copies and the unused tail small.
const BYTES_PER_ROW = 256;
const MIN_ROWS = 64;

/**
 * The events of one parse as parallel columns indexed by id, in log order. Row 0 is the log
 * itself. Columns grow by half while the engine adds rows, and `finish` trims them.
 */
export class Store {
  count = 0;
  type: Uint16Array = new Uint16Array(0);
  /** Byte offsets of the event's line and its continuation lines in the source. */
  start: Int32Array = new Int32Array(0);
  end: Int32Array = new Int32Array(0);
  /** Nanoseconds. */
  timestamp: Float64Array = new Float64Array(0);
  /** Nanoseconds; NaN for a leaf. */
  exitStamp: Float64Array = new Float64Array(0);
  parent: Int32Array = new Int32Array(0);
  /** One past the event's last descendant, so its children are `id + 1` to `subtreeEnd - 1`. */
  subtreeEnd: Int32Array = new Int32Array(0);
  depth: Uint16Array = new Uint16Array(0);
  /** The stated line number, `EXTERNAL_LINE` or `NO_LINE`. */
  lineNumber: Int32Array = new Int32Array(0);
  /** A string id, or `NONE`. */
  namespace: Int32Array = new Int32Array(0);
  /** Per-event bits that the engine defines. */
  flags: Uint8Array = new Uint8Array(0);
  /** Nanoseconds. The total is `exitStamp - timestamp`. */
  durationSelf: Float64Array = new Float64Array(0);
  /** The row's slot in `counts`, or `NONE` while every count is 0. */
  countSlot: Int32Array = new Int32Array(0);
  /** The row's slot in `heap`, or `NONE` while every heap figure is 0. */
  heapSlot: Int32Array = new Int32Array(0);

  /** `COUNT_STRIDE` integers per slot: each counter's self, then its total. */
  counts: Int32Array = new Int32Array(MIN_ROWS * COUNT_STRIDE);
  countSlots = 0;
  /** `HEAP_STRIDE` numbers per slot, in `HEAP` order. */
  heap: Float64Array = new Float64Array(MIN_ROWS * HEAP_STRIDE);
  heapSlots = 0;

  /** Each type's rows, in id order, from `typeStart[type]` to `typeStart[type + 1]`. Set by `finish`. */
  typeRows: Int32Array = new Int32Array(0);
  typeStart: Int32Array = new Int32Array(0);

  constructor(sourceBytes: number) {
    const rows = Math.max(MIN_ROWS, Math.ceil(sourceBytes / BYTES_PER_ROW));
    this.resize(rows);
    // A heap figure is on about a third of frames in the brief's logs.
    this.heap = new Float64Array(Math.max(MIN_ROWS, rows >>> 2) * HEAP_STRIDE);
  }

  /** Adds an event and returns its id. It starts as a leaf with no children and zero rollups. */
  add(
    type: number,
    start: number,
    end: number,
    timestamp: number,
    parent: number,
    depth: number,
  ): number {
    if (this.count === this.type.length)
      this.resize(Math.max(MIN_ROWS, Math.ceil(this.count * 1.5)));
    const id = this.count++;
    this.type[id] = type;
    this.start[id] = start;
    this.end[id] = end;
    this.timestamp[id] = timestamp;
    this.exitStamp[id] = Number.NaN;
    this.parent[id] = parent;
    this.subtreeEnd[id] = id + 1;
    this.depth[id] = depth;
    this.lineNumber[id] = NO_LINE;
    this.namespace[id] = NONE;
    this.countSlot[id] = NONE;
    this.heapSlot[id] = NONE;
    return id;
  }

  /** The index in `counts` of the row's first counter, given a slot first if it has none. It can replace `counts`, so read the pool after the call. */
  countsOf(id: number): number {
    // id is a row the engine added
    let slot = this.countSlot[id]!;
    if (slot === NONE) {
      if ((this.countSlots + 1) * COUNT_STRIDE > this.counts.length) {
        this.counts = resized(
          this.counts,
          Math.max(MIN_ROWS * COUNT_STRIDE, this.counts.length * 2),
        );
      }
      slot = this.countSlots++;
      this.countSlot[id] = slot;
    }
    return slot * COUNT_STRIDE;
  }

  /** The index in `heap` of the row's first heap figure, given a slot first if it has none. It can replace `heap`, so read the pool after the call. */
  heapOf(id: number): number {
    // id is a row the engine added
    let slot = this.heapSlot[id]!;
    if (slot === NONE) {
      if ((this.heapSlots + 1) * HEAP_STRIDE > this.heap.length) {
        this.heap = resized(this.heap, Math.max(MIN_ROWS * HEAP_STRIDE, this.heap.length * 2));
      }
      slot = this.heapSlots++;
      this.heapSlot[id] = slot;
    }
    return slot * HEAP_STRIDE;
  }

  /** Trims every column to its rows, and indexes the rows by type. Call once, after the last `add`. */
  finish(typeCount: number): void {
    const n = this.count;
    this.resize(n);
    this.counts = resized(this.counts, this.countSlots * COUNT_STRIDE);
    this.heap = resized(this.heap, this.heapSlots * HEAP_STRIDE);

    // A counting sort, so ids ascend within each type; every index below is checked or in range.
    const typeStart = new Int32Array(typeCount + 1);
    for (let id = 0; id < n; id++) {
      const type = this.type[id]!;
      if (type >= typeCount) throw new RangeError(`Row ${id} has type ${type}, past ${typeCount}`);
      typeStart[type + 1]!++;
    }
    for (let t = 0; t < typeCount; t++) typeStart[t + 1]! += typeStart[t]!;
    const next = typeStart.slice(0, typeCount);
    const typeRows = new Int32Array(n);
    for (let id = 0; id < n; id++) typeRows[next[this.type[id]!]!++] = id;
    this.typeStart = typeStart;
    this.typeRows = typeRows;
  }

  /** Every per-row column at `size` rows: the one list of them. */
  private resize(size: number): void {
    this.type = resized(this.type, size);
    this.start = resized(this.start, size);
    this.end = resized(this.end, size);
    this.timestamp = resized(this.timestamp, size);
    this.exitStamp = resized(this.exitStamp, size);
    this.parent = resized(this.parent, size);
    this.subtreeEnd = resized(this.subtreeEnd, size);
    this.depth = resized(this.depth, size);
    this.lineNumber = resized(this.lineNumber, size);
    this.namespace = resized(this.namespace, size);
    this.flags = resized(this.flags, size);
    this.durationSelf = resized(this.durationSelf, size);
    this.countSlot = resized(this.countSlot, size);
    this.heapSlot = resized(this.heapSlot, size);
  }
}
