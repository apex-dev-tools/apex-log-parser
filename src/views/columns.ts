/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Built } from '../engine/builder.js';
import { HEAP_SLOT, isApexCallRow, isFrameRow } from '../engine/tables.js';
import type { Store } from '../store/store.js';
import { EXTERNAL_LINE, HEAP, NO_LINE, NONE } from '../store/store.js';
import type { CountRollup, EndedBy, LogEvents } from './events.js';
import { COUNT_ROLLUPS, ENDINGS, endedByOf } from './events.js';

/** `Columns.lineNumber` for a line that states `[EXTERNAL]`, and for a line that states none. */
export const LINE_NUMBER: { readonly External: -1; readonly None: -2 } = Object.freeze({
  External: EXTERNAL_LINE,
  None: NO_LINE,
});

/**
 * Every event as arrays indexed by id, with no object per event. Row 0 is the log; events are
 * ids 1 to `count`. Use these for a pass over every event that reads numbers or groups by text, or
 * for a pass you repeat, as a redraw: on a 95 MB log a repeated flame chart or call tree takes about
 * 16 and 5 ms, against about 26 and 36 ms through event objects. Reading every event's text costs
 * the same both ways. For one event or a few, or a line's fields, details or variables, use
 * `ApexLog.event(id)`.
 *
 * Each column is made on its first read, then held: a count column holds 8 bytes per event, a heap
 * column 16, and all of them about as much again as the parse. Some arrays are the parse's own,
 * and the rest are made for this log: read them, never write them.
 */
export interface Columns {
  /** The number of events, so `for (let id = 1; id <= count; id++)` reads them all. */
  readonly count: number;
  /** Type ids: `eventType(type[id])`. Row 0 holds one past the last type id. */
  readonly type: Uint16Array;
  /** The parent's id: 0 for an event at the top of the log, -1 for the log. */
  readonly parent: Int32Array;
  /** 0 for the log, 1 for an event at its top. */
  readonly depth: Uint16Array;
  /** One past the last id under each row, so its descendants are `id + 1` to `subtreeEnd[id] - 1`. */
  readonly subtreeEnd: Int32Array;
  /** Nanoseconds. */
  readonly startTimestamp: Float64Array;
  /** Nanoseconds; a leaf ends where it starts. */
  readonly endTimestamp: Float64Array;
  /** Nanoseconds. */
  readonly durationSelf: Float64Array;
  /** Nanoseconds; 0 without an exit, or with one at 0, as `duration.total`. */
  readonly durationTotal: Float64Array;
  /** 1 for a frame, as `isFrame`; 0 for a leaf and for the log. */
  readonly isFrame: Uint8Array;
  /** 1 for a call into Apex code, as `isApexCall`; else 0. */
  readonly isApexCall: Uint8Array;
  /**
   * The line number the line states; `LINE_NUMBER.External` (-1) for `'EXTERNAL'`, and
   * `LINE_NUMBER.None` (-2) for none.
   */
  readonly lineNumber: Int32Array;
  /** Each frame's `endedBy`. `values` is in `ENDED_BY` order; an id is -1 for a leaf and the log. */
  readonly endedBy: TextColumn<EndedBy>;
  /**
   * Each event's `text`. Frames with the same text share an id, whatever their type, so a call tree
   * can group by it. A leaf's text is rarely repeated, so its id is -1, and `at` reads its text.
   */
  readonly text: TextColumn;
  /** Each event's `namespace`. `values` is `ApexLog.namespaces`; an id is -1 for the log. */
  readonly namespace: TextColumn;
  /** As `dmlCount`. Null when the log's debug levels do not record DML lines. */
  readonly dmlCount: CountColumn | null;
  /** As `soqlCount`. Null when the log's debug levels do not record SOQL lines. */
  readonly soqlCount: CountColumn | null;
  /** As `soslCount`. Null when the log's debug levels do not record SOSL lines. */
  readonly soslCount: CountColumn | null;
  /** As `dmlRowCount`. Null when the log's debug levels do not record DML lines. */
  readonly dmlRowCount: CountColumn | null;
  /**
   * As `soqlRowCount`, but 0 for a query with no end line, where its event says null. Null when the
   * log's debug levels do not record SOQL lines.
   */
  readonly soqlRowCount: CountColumn | null;
  /**
   * As `soslRowCount`, but 0 for a search with no end line, where its event says null. Null when
   * the log's debug levels do not record SOSL lines.
   */
  readonly soslRowCount: CountColumn | null;
  /** As `thrownCount`. Null when the log's debug levels do not record exception lines. */
  readonly thrownCount: CountColumn | null;
  /** Bytes, as `heapAllocated`. Null when the log's debug levels do not record heap lines. */
  readonly heapAllocated: HeapColumn | null;
  /** Bytes, as `heapGross`. Null when the log's debug levels do not record heap lines. */
  readonly heapGross: HeapColumn | null;
  /** Bytes, as `heapPeak`. Null when the log's debug levels do not record heap lines. */
  readonly heapPeak: Float64Array | null;
}

/** Strings by event id, each distinct string held once. */
export interface TextColumn<T extends string = string> {
  /** By event id: an index into `values`, or -1 when `values` holds no string for it. */
  readonly ids: Int32Array;
  readonly values: readonly (T | null)[];
  /** The event's string, as its event gives it; null when it states none, or for no event. */
  at(id: number): T | null;
}

/** A count by event id: the event's own, and with every event under it. */
export interface CountColumn {
  readonly self: Int32Array;
  readonly total: Int32Array;
}

/** Heap bytes by event id: the event's own, and with every event under it. */
export interface HeapColumn {
  readonly self: Float64Array;
  readonly total: Float64Array;
}

/** The columns of one build, each made on its first read. `namespaces` is `ApexLog.namespaces`. */
export function columnsOf(built: Built, events: LogEvents, namespaces: readonly string[]): Columns {
  const { store } = built;
  const { lines, recorded } = events;
  const durationTotal = new Float64Array(store.count);
  for (let id = 0; id < store.count; id++) durationTotal[id] = store.durationTotal(id);
  const made: {
    isFrame?: Uint8Array;
    isApexCall?: Uint8Array;
    endedBy?: TextColumn<EndedBy>;
    text?: TextColumn;
    namespace?: TextColumn;
    counts: (CountColumn | null)[];
    heap: (HeapColumn | null)[];
    heapPeak?: Float64Array | null;
  } = { counts: [], heap: [] };
  const count = (counter: number): CountColumn | null =>
    (made.counts[counter] ??= recorded[counter] ? Object.freeze(store.countByRow(counter)) : null);
  const heap = (self: number, total: number): HeapColumn | null =>
    (made.heap[self] ??= recorded[HEAP_SLOT] ? heapColumn(store, self, total) : null);
  const columns: Omit<Columns, CountRollup> = {
    count: store.count - 1,
    type: store.type,
    parent: store.parent,
    depth: store.depth,
    subtreeEnd: store.subtreeEnd,
    startTimestamp: store.timestamp,
    endTimestamp: store.exitStamp,
    durationSelf: store.durationSelf,
    durationTotal,
    lineNumber: store.lineNumber,
    get isFrame(): Uint8Array {
      return (made.isFrame ??= flagColumn(store, (id) => isFrameRow(store, id)));
    },
    get isApexCall(): Uint8Array {
      return (made.isApexCall ??= flagColumn(store, (id) => isApexCallRow(store, id)));
    },
    get endedBy(): TextColumn<EndedBy> {
      return (made.endedBy ??= endedByColumn(store));
    },
    get text(): TextColumn {
      return (made.text ??= Object.freeze({
        ids: lines.textIndexes(),
        values: lines.texts,
        at: (id: number) => (isEventId(id, store.count) ? lines.text(id) : null),
      }));
    },
    get namespace(): TextColumn {
      return (made.namespace ??= namespaceColumn(store, built.namespaces, namespaces));
    },
    get heapAllocated(): HeapColumn | null {
      return heap(HEAP.allocatedSelf, HEAP.allocatedTotal);
    },
    get heapGross(): HeapColumn | null {
      return heap(HEAP.grossSelf, HEAP.grossTotal);
    },
    get heapPeak(): Float64Array | null {
      if (made.heapPeak === undefined) {
        // heapByRow gives one array per figure
        made.heapPeak = recorded[HEAP_SLOT] ? store.heapByRow(HEAP.peak)[0]! : null;
      }
      return made.heapPeak;
    },
  };
  for (const [name, counter] of Object.entries(COUNT_ROLLUPS)) {
    Object.defineProperty(columns, name, { get: () => count(counter), enumerable: true });
  }
  // The loop above added every count
  return Object.freeze(columns) as Columns;
}

/** `id` is an event of a log with `rows` rows: row 0 is the log. */
const isEventId = (id: number, rows: number): boolean =>
  Number.isInteger(id) && id >= 1 && id < rows;

/** Frozen; `at` reads `values` through `ids`, and null for an id that is no event. */
function textColumn<T extends string>(
  ids: Int32Array,
  values: readonly (T | null)[],
  rows: number,
): TextColumn<T> {
  return Object.freeze({
    ids,
    values,
    // An index of -1 reads as undefined, so as none
    at: (id: number) => (isEventId(id, rows) ? (values[ids[id]!] ?? null) : null),
  });
}

/** Two heap figures for every row, as one column. */
function heapColumn(store: Store, self: number, total: number): HeapColumn {
  // heapByRow gives one array per figure
  const [selves, totals] = store.heapByRow(self, total) as [Float64Array, Float64Array];
  return Object.freeze({ self: selves, total: totals });
}

/** 1 per row that `test` holds for, else 0. */
function flagColumn(store: Store, test: (id: number) => boolean): Uint8Array {
  const column = new Uint8Array(store.count);
  for (let id = 1; id < store.count; id++) if (test(id)) column[id] = 1;
  return column;
}

/** Each frame's `endedBy` as an index into `ENDINGS`. */
function endedByColumn(store: Store): TextColumn<EndedBy> {
  const ids = new Int32Array(store.count).fill(-1);
  for (let id = 1; id < store.count; id++) {
    if (isFrameRow(store, id)) ids[id] = ENDINGS.indexOf(endedByOf(store, id));
  }
  return textColumn(ids, ENDINGS, store.count);
}

/** Each row's namespace as an index into `namespaces`, from the string ids, or `NONE`, the store holds. */
function namespaceColumn(
  store: Store,
  namespaceIds: readonly number[],
  namespaces: readonly string[],
): TextColumn {
  const indexOf = new Map(namespaceIds.map((ns, i) => [ns, i]));
  const ids = new Int32Array(store.count).fill(-1);
  const defaultIndex = indexOf.get(NONE) ?? -1;
  for (let id = 1; id < store.count; id++) {
    // id is a row, so in range
    const ns = store.namespace[id]!;
    ids[id] = ns === NONE ? defaultIndex : (indexOf.get(ns) ?? -1);
  }
  return textColumn(ids, namespaces, store.count);
}
