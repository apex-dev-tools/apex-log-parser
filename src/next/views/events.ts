/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { EVENT_TYPES, GRAMMAR } from '../catalog/catalog.js';
import type {
  Category,
  CpuType,
  DebugCategory,
  EventType,
  EventTypeInfo,
  Kind,
  Level,
} from '../catalog/types.js';
import type { Built } from '../engine/builder.js';
import { FLAG, IS_FRAME } from '../engine/builder.js';
import type { Store } from '../store/store.js';
import { COUNTER, EXTERNAL_LINE, HEAP, NO_LINE, NONE, SELF, TOTAL } from '../store/store.js';
import type { StringTable } from '../store/strings.js';
import type { AnyDetails, DetailsOf } from './details.js';
import { EventLines } from './lines.js';

/** A rollup: the own part, and the part with every descendant. */
export interface SelfTotal {
  readonly self: number;
  readonly total: number;
}

/** The time and rollups the log and every event state. Times are nanoseconds, heap bytes. */
export interface Rollups {
  readonly timestamp: number;
  readonly duration: SelfTotal;
  readonly dmlCount: SelfTotal;
  readonly soqlCount: SelfTotal;
  readonly soslCount: SelfTotal;
  readonly dmlRowCount: SelfTotal;
  readonly soqlRowCount: SelfTotal;
  readonly soslRowCount: SelfTotal;
  readonly thrownCount: SelfTotal;
  readonly heapAllocated: SelfTotal;
  readonly heapGross: SelfTotal;
  /** The highest live heap inside: a maximum, not a sum. */
  readonly heapPeak: number;
}

/** What every event states. */
interface EventBase extends Rollups {
  /** The event's position in log order, from 1: id 0 is the log. Valid within one parse only. */
  readonly id: number;
  readonly type: EventType;
  readonly kind: Kind;
  /** The timeline group. Null for a type outside the timeline. */
  readonly category: Category | null;
  readonly debugCategory: DebugCategory;
  readonly debugLevel: Level;
  /** 1 for an event at the top of the log, which is depth 0, as `columns.depth` states. */
  readonly depth: number;
  /** The frame that holds this event; null at the top of the log. */
  readonly parent: FrameEvent | null;
  /** The line number the line states, `'EXTERNAL'`, or null when it states none. */
  readonly lineNumber: number | 'EXTERNAL' | null;
  /** Null when the event is in no namespace. */
  readonly namespace: string | null;
  /** The log does not close this frame. Always false for a leaf. */
  readonly isTruncated: boolean;
  /**
   * What the event says, as its type's rule reads its line and continuation lines. Null when it
   * states nothing; a caller that needs a label can use `text ?? type`. Read from the log once.
   */
  readonly text: string | null;
  /** The event's first line as the log states it, without its line ending. */
  readonly logLine: string;
  /** A label for the kind of code, as ` (code unit)`, for a type that has one; else null. */
  readonly suffix: string | null;
  /** What the event's time is spent on, as `method` or `custom`. Null for a type that states none. */
  readonly cpuType: CpuType | null;
  /** `text` names Apex code that a symbol lookup can find. */
  readonly hasValidSymbols: boolean;
  /**
   * Field `name` of the event's first line, as stated: one of `eventType(type).fields`. The type's
   * last field runs to the line's end, `|` and all. Null when the line has no such field, or it is
   * empty. Throws a RangeError for a name the type does not list.
   */
  field(name: string): string | null;
  /**
   * The values the line states beyond its text, parsed on first read, as `aggregations` or a limit
   * usage: `EventDetails` lists them by type. Null for a type that states none.
   */
  readonly details: AnyDetails | null;
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
  /** Always empty, so a walk of the tree reads `children` on any event. */
  readonly children: readonly [];
}

/** One event of the log: narrow on `isFrame` to tell a frame from a leaf. */
export type ApexEvent = FrameEvent | LeafEvent;

/** An event of type `T`, with that type's details; for a union, one member per type, so `type` narrows. */
export type EventOf<T extends EventType> = T extends EventType
  ? ApexEvent & { readonly type: T; readonly details: DetailsOf<T> }
  : never;

/** The row's type is a frame, and its line did not make it a leaf, as a VF call with no method. */
export function isFrameRow(store: Store, id: number): boolean {
  // id is a row, so every column holds it
  return IS_FRAME[store.type[id]!] === 1 && !(store.flags[id]! & FLAG.notEntry);
}

const ZERO: SelfTotal = Object.freeze({ self: 0, total: 0 });
const NO_CHILDREN: readonly ApexEvent[] = Object.freeze([]);

/** The events of one build, each made on first read and then the same object. */
export class LogEvents {
  private readonly store: Store;
  private readonly strings: StringTable;
  /** Shared by every event of the build, so no event holds its own. */
  readonly lines: EventLines;
  private readonly views: (ApexEvent | undefined)[];

  constructor({ store, strings, source }: Built) {
    this.store = store;
    this.strings = strings;
    this.lines = new EventLines(store, source);
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
 * The time and rollups of one row, read from the store: the log's (row 0) or an event's. Each `!`
 * below reads a column at `id`, a row the store holds.
 */
export class RollupView implements Rollups {
  readonly id: number;
  protected readonly store: Store;

  constructor(store: Store, id: number) {
    this.store = store;
    this.id = id;
  }

  get timestamp(): number {
    return this.store.timestamp[this.id]!;
  }

  get duration(): SelfTotal {
    return { self: this.store.durationSelf[this.id]!, total: this.store.durationTotal(this.id) };
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
    const at = this.store.heapIndex(this.id);
    return at < 0 ? 0 : this.store.heap[at + HEAP.peak]!;
  }

  private count(counter: number): SelfTotal {
    const at = this.store.countIndex(this.id);
    if (at < 0) return ZERO;
    const counts = this.store.counts;
    return { self: counts[at + counter * 2 + SELF]!, total: counts[at + counter * 2 + TOTAL]! };
  }

  private heap(self: number, total: number): SelfTotal {
    const at = this.store.heapIndex(this.id);
    if (at < 0) return ZERO;
    const heap = this.store.heap;
    return { self: heap[at + self]!, total: heap[at + total]! };
  }
}

/** One event's row. Not exported: callers see `ApexEvent`. */
class EventView extends RollupView {
  private readonly events: LogEvents;
  private readonly strings: StringTable;
  private kids: readonly ApexEvent[] | null = null;
  // undefined until read; null is text the line does not state.
  private said: string | null | undefined = undefined;
  // undefined until read; null is a type that states no details.
  private stated: AnyDetails | null | undefined = undefined;

  constructor(events: LogEvents, store: Store, strings: StringTable, id: number) {
    super(store, id);
    this.events = events;
    this.strings = strings;
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

  get isFrame(): boolean {
    return isFrameRow(this.store, this.id);
  }

  get depth(): number {
    return this.store.depth[this.id]!;
  }

  get parent(): FrameEvent | null {
    // An event's parent row is a frame, or the log (0), which is not an event
    return this.events.event(this.store.parent[this.id]!) as FrameEvent | null;
  }

  get children(): readonly ApexEvent[] {
    if (!this.isFrame) return NO_CHILDREN;
    return (this.kids ??= this.events.childrenOf(this.id));
  }

  get exitStamp(): number | null {
    if (!this.isFrame) return null;
    return this.store.exitStamp[this.id]!;
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

  get text(): string | null {
    if (this.said === undefined) this.said = this.events.lines.text(this.id);
    return this.said;
  }

  get logLine(): string {
    return this.events.lines.logLine(this.id);
  }

  get suffix(): string | null {
    return this.events.lines.suffix(this.id);
  }

  get cpuType(): CpuType | null {
    return this.events.lines.cpuType(this.id);
  }

  /** The type's, unless the line made the event a leaf, as a VF call with no method. */
  get hasValidSymbols(): boolean {
    const store = this.store;
    // id is a row, so its type is a type id
    return (
      GRAMMAR[store.type[this.id]!]!.hasValidSymbols && !(store.flags[this.id]! & FLAG.notEntry)
    );
  }

  field(name: string): string | null {
    return this.events.lines.field(this.id, name);
  }

  get details(): AnyDetails | null {
    if (this.stated === undefined) this.stated = this.events.lines.details(this.id);
    return this.stated;
  }
}
