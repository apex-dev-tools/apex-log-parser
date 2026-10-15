/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { tagOf } from '../tags.js';
import type { Column } from './columns.js';
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
/** The per-row columns `resizeColumn` lists. */
const COLUMNS = 14;

declare const performance: { now(): number };

/** A finished store's columns and pools, as `Store.state` gives them and `Store.restore` takes them. */
export interface StoreState {
  readonly count: number;
  readonly typeCount: number;
  readonly countSlots: number;
  readonly heapSlots: number;
  readonly columns: readonly Column[];
  readonly counts: Int32Array;
  readonly heap: Float64Array;
}

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

  private typeCount = 0;
  /** The columns `finish` has trimmed so far. */
  private trimmed = 0;
  // Each type's rows, in id order, from `typeStart[type]` to `typeStart[type + 1]`; built on first use.
  private typeRows: Int32Array | null = null;
  private typeStart: Int32Array = new Int32Array(0);

  constructor(sourceBytes: number) {
    const rows = Math.max(MIN_ROWS, Math.ceil(sourceBytes / BYTES_PER_ROW));
    this.resize(rows);
    // A heap figure is on about a third of frames in the logs measured.
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

  /** The index in `counts` of the row's first counter, or -1 while every count is 0. Only reads. */
  countIndex(id: number): number {
    // id is a row the engine added
    const slot = this.countSlot[id]!;
    return slot === NONE ? -1 : slot * COUNT_STRIDE;
  }

  /** The index in `heap` of the row's first heap figure, or -1 while every one is 0. Only reads. */
  heapIndex(id: number): number {
    // id is a row the engine added
    const slot = this.heapSlot[id]!;
    return slot === NONE ? -1 : slot * HEAP_STRIDE;
  }

  /** Nanoseconds from the row's line to its exit; 0 without an exit, or with one at 0, as in v0. */
  durationTotal(id: number): number {
    // id is a row the engine added
    const exit = this.exitStamp[id]!;
    return exit ? exit - this.timestamp[id]! : 0;
  }

  /**
   * Trims every column to its rows, one column a step, until `deadline`, a `performance.now()`
   * time, passes. True once all are; call again to go on. Only after the last `add`; types run
   * from 0 to `typeCount - 1`.
   */
  finish(typeCount: number, deadline: number = Number.POSITIVE_INFINITY): boolean {
    while (this.trimmed < COLUMNS) {
      this.resizeColumn(this.trimmed++, this.count);
      // A trim can copy a whole column, so the clock is read after each one.
      if (this.trimmed < COLUMNS && performance.now() >= deadline) return false;
    }
    this.counts = resized(this.counts, this.countSlots * COUNT_STRIDE);
    this.heap = resized(this.heap, this.heapSlots * HEAP_STRIDE);
    this.typeCount = typeCount;
    return true;
  }

  /** The columns and pools, which share memory with this store. Only after `finish`. */
  state(): StoreState {
    const columns: Column[] = [];
    for (let c = 0; c < COLUMNS; c++) columns.push(this.column(c));
    const { count, typeCount, countSlots, heapSlots, counts, heap } = this;
    return { count, typeCount, countSlots, heapSlots, columns, counts, heap };
  }

  /** A finished store over `state`'s arrays, as `state` gave them. */
  static restore(state: StoreState): Store {
    // Row 0 is the log, so every store holds it.
    if (!Number.isInteger(state.count) || state.count < 1)
      throw new TypeError('The store state holds no rows');
    // Made as every store is, so it has the same object layout as one the engine built.
    const store = new Store(0);
    for (let c = 0; c < COLUMNS; c++) {
      const column = state.columns[c];
      if (!column || column.length !== state.count)
        throw new TypeError(`The store state's column ${c} does not hold its ${state.count} rows`);
      // A column of another kind would read wrong values, not fail.
      if (tagOf(column) !== tagOf(store.column(c)))
        throw new TypeError(`The store state's column ${c} is ${tagOf(column)}`);
      store.setColumn(c, column);
    }
    if (tagOf(state.counts) !== tagOf(store.counts) || tagOf(state.heap) !== tagOf(store.heap))
      throw new TypeError('The store state has pools of the wrong kind');
    if (
      state.counts.length < state.countSlots * COUNT_STRIDE ||
      state.heap.length < state.heapSlots * HEAP_STRIDE
    )
      throw new TypeError('The store state has pools shorter than their slots');
    store.count = state.count;
    store.typeCount = state.typeCount;
    store.countSlots = state.countSlots;
    store.heapSlots = state.heapSlots;
    store.counts = state.counts;
    store.heap = state.heap;
    store.trimmed = COLUMNS;
    return store;
  }

  /**
   * The ids of every row of `type`, ascending. Only after `finish`: the first call indexes every
   * type, and a row added after it is not in the index. A parse that never asks does not pay.
   */
  rowsOfType(type: number): Int32Array {
    // subarray takes undefined as "to the end", so a type past the index would answer every row.
    if (!(type >= 0 && type < this.typeCount)) throw new RangeError(`No type ${type}`);
    const rows = this.typeRows ?? this.indexTypes();
    return rows.subarray(this.typeStart[type], this.typeStart[type + 1]);
  }

  private indexTypes(): Int32Array {
    const n = this.count;
    const typeCount = this.typeCount;
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
    return typeRows;
  }

  /** Every per-row column at `size` rows. */
  private resize(size: number): void {
    for (let c = 0; c < COLUMNS; c++) this.resizeColumn(c, size);
  }

  /** Per-row column `c` at `size` rows. */
  private resizeColumn(c: number, size: number): void {
    this.setColumn(c, resized(this.column(c), size));
  }

  /** Per-row column `c`: the one list of them, which `setColumn` mirrors. */
  private column(c: number): Column {
    switch (c) {
      case 0:
        return this.type;
      case 1:
        return this.start;
      case 2:
        return this.end;
      case 3:
        return this.timestamp;
      case 4:
        return this.exitStamp;
      case 5:
        return this.parent;
      case 6:
        return this.subtreeEnd;
      case 7:
        return this.depth;
      case 8:
        return this.lineNumber;
      case 9:
        return this.namespace;
      case 10:
        return this.flags;
      case 11:
        return this.durationSelf;
      case 12:
        return this.countSlot;
      case 13:
        return this.heapSlot;
    }
    throw new RangeError(`No column ${c}`);
  }

  /** Sets per-row column `c`, which must be of the kind `column(c)` gives. */
  private setColumn(c: number, value: Column): void {
    switch (c) {
      case 0:
        this.type = value as Uint16Array;
        break;
      case 1:
        this.start = value as Int32Array;
        break;
      case 2:
        this.end = value as Int32Array;
        break;
      case 3:
        this.timestamp = value as Float64Array;
        break;
      case 4:
        this.exitStamp = value as Float64Array;
        break;
      case 5:
        this.parent = value as Int32Array;
        break;
      case 6:
        this.subtreeEnd = value as Int32Array;
        break;
      case 7:
        this.depth = value as Uint16Array;
        break;
      case 8:
        this.lineNumber = value as Int32Array;
        break;
      case 9:
        this.namespace = value as Int32Array;
        break;
      case 10:
        this.flags = value as Uint8Array;
        break;
      case 11:
        this.durationSelf = value as Float64Array;
        break;
      case 12:
        this.countSlot = value as Int32Array;
        break;
      case 13:
        this.heapSlot = value as Int32Array;
        break;
    }
  }
}
