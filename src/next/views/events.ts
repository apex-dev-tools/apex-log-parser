/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { EVENT_TYPES } from '../catalog/catalog.js';
import type {
  Category,
  DebugCategory,
  EventType,
  EventTypeInfo,
  Kind,
  Level,
} from '../catalog/types.js';
import type { Built } from '../engine/builder.js';
import { FLAG } from '../engine/builder.js';
import type { Store } from '../store/store.js';
import { COUNTER, EXTERNAL_LINE, HEAP, NO_LINE, NONE, SELF, TOTAL } from '../store/store.js';
import type { StringTable } from '../store/strings.js';

/** A rollup: the event's own part, and the part with every descendant. */
export interface SelfTotal {
  readonly self: number;
  readonly total: number;
}

/** What every event states. Times are nanoseconds and heap figures bytes. */
interface EventBase {
  /** The event's position in log order, from 1: id 0 is the log. Valid within one parse only. */
  readonly id: number;
  readonly type: EventType;
  readonly kind: Kind;
  /** The timeline group. Null for a type outside the timeline. */
  readonly category: Category | null;
  readonly debugCategory: DebugCategory;
  readonly debugLevel: Level;
  /** 0 for an event at the top of the log. */
  readonly depth: number;
  /** The frame that holds this event; null at the top of the log. */
  readonly parent: FrameEvent | null;
  readonly timestamp: number;
  readonly duration: SelfTotal;
  /** The line number the line states, `'EXTERNAL'`, or null when it states none. */
  readonly lineNumber: number | 'EXTERNAL' | null;
  /** Null when the event is in no namespace. */
  readonly namespace: string | null;
  /** The log does not close this frame. Always false for a leaf. */
  readonly isTruncated: boolean;
  readonly dmlCount: SelfTotal;
  readonly soqlCount: SelfTotal;
  readonly soslCount: SelfTotal;
  readonly dmlRowCount: SelfTotal;
  readonly soqlRowCount: SelfTotal;
  readonly soslRowCount: SelfTotal;
  readonly thrownCount: SelfTotal;
  readonly heapAllocated: SelfTotal;
  readonly heapGross: SelfTotal;
  /** The highest live heap inside the event: a maximum, not a sum. */
  readonly heapPeak: number;
}

/** An event that spans time, from its line to the line that closes it, and holds other events. */
export interface FrameEvent extends EventBase {
  readonly isFrame: true;
  /** Where the frame ends: its exit line, or where the log stops when it never closes. */
  readonly exitStamp: number;
  /** In log order. */
  readonly children: readonly ApexEvent[];
}

/** An event at one point in time, with no children. */
export interface LeafEvent extends EventBase {
  readonly isFrame: false;
  readonly exitStamp: null;
}

/** One event of the log: narrow on `isFrame` to reach `children`. */
export type ApexEvent = FrameEvent | LeafEvent;

const ZERO: SelfTotal = Object.freeze({ self: 0, total: 0 });
const NO_CHILDREN: readonly ApexEvent[] = Object.freeze([]);

/** The events of one build, each made on first read and then the same object. */
export class LogEvents {
  private readonly store: Store;
  private readonly strings: StringTable;
  private readonly views: (ApexEvent | undefined)[];

  constructor({ store, strings }: Built) {
    this.store = store;
    this.strings = strings;
    this.views = new Array(store.count);
  }

  /** The event with `id`, or null when no event has it. */
  event(id: number): ApexEvent | null {
    if (!(id >= 1 && id < this.store.count && Number.isInteger(id))) return null;
    // One runtime class serves both shapes; `isFrame` tells them apart (ADR 0002).
    return (this.views[id] ??= new EventView(
      this,
      this.store,
      this.strings,
      id,
    ) as unknown as ApexEvent);
  }

  /** The events directly under row `id`, which is the log for 0, in log order. A new array each call. */
  childrenOf(id: number): readonly ApexEvent[] {
    const { subtreeEnd } = this.store;
    const out: ApexEvent[] = [];
    // A child's subtree ends where its next sibling starts; every id here is a row, so an event.
    for (let child = id + 1; child < subtreeEnd[id]!; child = subtreeEnd[child]!) {
      out.push(this.event(child)!);
    }
    return Object.freeze(out);
  }
}

/**
 * One row of the store, read through. Not exported: callers see `ApexEvent`. Each `!` below reads
 * a column at `id`, a row the store holds.
 */
class EventView {
  readonly id: number;
  private readonly events: LogEvents;
  private readonly store: Store;
  private readonly strings: StringTable;
  private kids: readonly ApexEvent[] | null = null;

  constructor(events: LogEvents, store: Store, strings: StringTable, id: number) {
    this.events = events;
    this.store = store;
    this.strings = strings;
    this.id = id;
  }

  private get info(): EventTypeInfo {
    // id is a row, so its type is a type id
    return EVENT_TYPES[this.store.type[this.id]!]!;
  }

  get type(): EventType {
    return this.info.type;
  }

  get kind(): Kind {
    return this.info.kind;
  }

  get category(): Category | null {
    return this.info.category;
  }

  get debugCategory(): DebugCategory {
    return this.info.debugCategory;
  }

  get debugLevel(): Level {
    return this.info.debugLevel;
  }

  /** The type is a frame, and the line did not make it a leaf, as a VF call with no method. */
  get isFrame(): boolean {
    return this.info.shape === 'frame' && !(this.store.flags[this.id]! & FLAG.notEntry);
  }

  get depth(): number {
    // The store counts the log as depth 0.
    return this.store.depth[this.id]! - 1;
  }

  get parent(): FrameEvent | null {
    // An event's parent row is a frame, or the log (0), which is not an event
    return this.events.event(this.store.parent[this.id]!) as FrameEvent | null;
  }

  get children(): readonly ApexEvent[] {
    if (!this.isFrame) return NO_CHILDREN;
    return (this.kids ??= this.events.childrenOf(this.id));
  }

  get timestamp(): number {
    return this.store.timestamp[this.id]!;
  }

  get exitStamp(): number | null {
    if (!this.isFrame) return null;
    return this.store.exitStamp[this.id]!;
  }

  get duration(): SelfTotal {
    return { self: this.store.durationSelf[this.id]!, total: this.store.durationTotal(this.id) };
  }

  get lineNumber(): number | 'EXTERNAL' | null {
    const line = this.store.lineNumber[this.id]!;
    return line === NO_LINE ? null : line === EXTERNAL_LINE ? 'EXTERNAL' : line;
  }

  get namespace(): string | null {
    const ns = this.store.namespace[this.id]!;
    return ns === NONE ? null : this.strings.text(ns);
  }

  get isTruncated(): boolean {
    return (this.store.flags[this.id]! & FLAG.truncated) !== 0;
  }

  get dmlCount(): SelfTotal {
    return this.count(COUNTER.dml);
  }

  get soqlCount(): SelfTotal {
    return this.count(COUNTER.soql);
  }

  get soslCount(): SelfTotal {
    return this.count(COUNTER.sosl);
  }

  get dmlRowCount(): SelfTotal {
    return this.count(COUNTER.dmlRows);
  }

  get soqlRowCount(): SelfTotal {
    return this.count(COUNTER.soqlRows);
  }

  get soslRowCount(): SelfTotal {
    return this.count(COUNTER.soslRows);
  }

  get thrownCount(): SelfTotal {
    return this.count(COUNTER.thrown);
  }

  get heapAllocated(): SelfTotal {
    return this.heap(HEAP.allocatedSelf, HEAP.allocatedTotal);
  }

  get heapGross(): SelfTotal {
    return this.heap(HEAP.grossSelf, HEAP.grossTotal);
  }

  get heapPeak(): number {
    const store = this.store;
    if (store.heapSlot[this.id] === NONE) return 0;
    return store.heap[store.heapOf(this.id) + HEAP.peak]!;
  }

  private count(counter: number): SelfTotal {
    const store = this.store;
    // A slot is NONE while every count in it is 0, so countsOf below only reads.
    if (store.countSlot[this.id] === NONE) return ZERO;
    const at = store.countsOf(this.id) + counter * 2;
    return { self: store.counts[at + SELF]!, total: store.counts[at + TOTAL]! };
  }

  private heap(self: number, total: number): SelfTotal {
    const store = this.store;
    if (store.heapSlot[this.id] === NONE) return ZERO;
    const at = store.heapOf(this.id);
    return { self: store.heap[at + self]!, total: store.heap[at + total]! };
  }
}
