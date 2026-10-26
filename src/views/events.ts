/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { Source } from '../bytes/source.js';
import { EVENT_TYPES } from '../catalog/catalog.js';
import type { EventFields } from '../catalog/fields.js';
import type { DebugCategory, EventType, EventTypeInfo, Kind, Level } from '../catalog/types.js';
import { LEVEL } from '../catalog/types.js';
import type { Built } from '../engine/builder.js';
import {
  COUNT_AT,
  ENDS_ON_NEXT,
  FLAG,
  HEAP_SIGN,
  HEAP_SLOT,
  isApexCallRow,
  isFrameRow,
  ROWS_AT,
  ROWS_FROM_EXIT,
} from '../engine/tables.js';
import type { Store } from '../store/store.js';
import { COUNTER, EXTERNAL_LINE, HEAP, NO_LINE, NONE, SELF, TOTAL } from '../store/store.js';
import type { StringTable } from '../store/strings.js';
import type { AnyDetails, DetailsOf } from './details.js';
import { EventLines } from './lines.js';
import type { ObjectState, Variables } from './variables.js';
import { LogVariables } from './variables.js';

/** What ended a frame, and so whether its end is stated. */
export const ENDED_BY = {
  Exit: 'exit',
  Next: 'next',
  Unwind: 'unwind',
  LogEnd: 'log-end',
} as const;

/** What ended a frame: `FrameEvent.endedBy`. */
export type EndedBy = (typeof ENDED_BY)[keyof typeof ENDED_BY];

/** Every `EndedBy`, in `ENDED_BY` order: the `values` of `columns.endedBy`. */
export const ENDINGS: readonly EndedBy[] = Object.freeze(Object.values(ENDED_BY));

/** A rollup: the own part, and the part with every descendant. */
export interface SelfTotal {
  readonly self: number;
  readonly total: number;
}

/** The time and rollups the log and every event state. Times are nanoseconds, heap bytes. */
export interface Rollups {
  /** Where the line is in the log. For the log, its first event. */
  readonly startTimestamp: number;
  /**
   * Where the event ends: a frame's exit line, or where the log stops when it never closes. A leaf
   * ends where it starts. For the log, the end of its last event at the top.
   */
  readonly endTimestamp: number;
  readonly duration: SelfTotal;
  /** Null when the header's level does not record its lines and the log holds none. */
  readonly dmlCount: SelfTotal | null;
  /** Null when the header's level does not record its lines and the log holds none. */
  readonly soqlCount: SelfTotal | null;
  /** Null when the header's level does not record its lines and the log holds none. */
  readonly soslCount: SelfTotal | null;
  /** Null when the header's level does not record its lines and the log holds none. */
  readonly dmlRowCount: SelfTotal | null;
  /**
   * Null when the header's level does not record its lines and the log holds none. Also null on a query with no end line, which
   * states its rows; a total above it sums the rows the log states.
   */
  readonly soqlRowCount: SelfTotal | null;
  /**
   * Null when the header's level does not record its lines and the log holds none. Also null on a search with no end line, which
   * states its rows; a total above it sums the rows the log states.
   */
  readonly soslRowCount: SelfTotal | null;
  /** Null when the header's level does not record its lines and the log holds none. */
  readonly thrownCount: SelfTotal | null;
  /** Null when the header's level does not record its lines and the log holds none. Heap lines need Apex Code `FINER`. */
  readonly heapAllocated: SelfTotal | null;
  /** Null when the header's level does not record its lines and the log holds none. Heap lines need Apex Code `FINER`. */
  readonly heapGross: SelfTotal | null;
  /**
   * The highest live heap inside: a maximum, not a sum. Null when the header's level does not record its lines and the log holds none.
   */
  readonly heapPeak: number | null;
}

/** What every event states. */
interface EventBase extends Rollups {
  /** The event's position in log order, from 1: id 0 is the log. Valid within one parse only. */
  readonly id: number;
  readonly type: EventType;
  readonly kind: Kind;
  readonly debugCategory: DebugCategory;
  /**
   * The level a `USER_DEBUG` line states, as `System.debug(LoggingLevel.ERROR, ...)` gives it. For
   * any other type, a line with no level, or a level this parser does not know, the type's
   * `eventType(type).debugLevel`. `field('level')` gives the raw text.
   */
  readonly debugLevel: Level;
  /** 1 at the top of the log, 1 more per frame above it, as in `columns.depth`. */
  readonly depth: number;
  /** The frame that holds this event; null at the top of the log. */
  readonly parent: FrameEvent | null;
  /** The line number the line states, `'EXTERNAL'`, or null when it states none. */
  readonly lineNumber: number | 'EXTERNAL' | null;
  /** Null when the event is in no namespace. */
  readonly namespace: string | null;
  /**
   * What the event says, as its type's rule reads its line and continuation lines. Null when it
   * states nothing; a caller that needs a label can use `text ?? type`. Read from the log once.
   */
  readonly text: string | null;
  /** The event's first line as the log states it, without its line ending. */
  readonly logLine: string;
  /**
   * A call into Apex code: `text` names a class and, for a method, the method. True for
   * `METHOD_ENTRY`, `CONSTRUCTOR_ENTRY` and a `VF_APEX_CALL_START` that opens a frame; false for
   * system code, code units, and a Visualforce call that names no method.
   */
  readonly isApexCall: boolean;
  /**
   * Field `name` of the event's first line, as stated: one of `eventType(type).fields`. The type's
   * last field runs to the line's end, `|` and all. A `VARIABLE_ASSIGNMENT` value is the exception:
   * it stops before a trailing address. Null when the line has no such field, or it is empty.
   * Throws a RangeError for a name the type does not list.
   */
  field(name: string): string | null;
  /**
   * The values the line states beyond its text, or derives from the rows after it, parsed on first
   * read, as `aggregations`, a limit usage or a throw's `isCaught`: `EventDetails` lists them by
   * type. Null for a type that has none.
   */
  readonly details: AnyDetails | null;
  /**
   * The variables the event could see, as the log recorded them: a frame as it finished, a leaf as
   * the log reached it. Each list is sorted by name, in code-unit order. The first read of any event
   * indexes the log's variable lines. Null when the event is in no frame, or the log has no
   * variable lines, as below the `FINEST` Apex level.
   */
  readonly variables: Variables | null;
  /**
   * The object at `address` when the event ran: its class, its value and its fields. Give the
   * address exactly as the log writes it, as `Variable.address` does; case counts. The platform
   * reuses an address after its object is gone, so this reads only the object that lived there at
   * the event. Null when the log holds nothing for the address by then, and no later write states
   * its value.
   */
  objectAt(address: string): ObjectState | null;
}

/** An event that spans time, from its line to the line that closes it, and holds other events. */
export interface FrameEvent extends EventBase {
  readonly isFrame: true;
  /**
   * What ended the frame. Stated: `'exit'`, its own exit line; `'next'`, the next line or
   * event, for a type with no exit line, as a package entry. Inferred: `'unwind'`, a later exit
   * line not its own, as after an exception or a skipped block, at that line's time; `'log-end'`,
   * the log stopped or a new execution started first, at the last time inside the frame.
   */
  readonly endedBy: EndedBy;
  /** In log order. A new array on each read. */
  readonly children: readonly ApexEvent[];
}

/** An event at one point in time, with no children. */
export interface LeafEvent extends EventBase {
  readonly isFrame: false;
  /** Always empty, so a walk of the tree reads `children` on any event. */
  readonly children: readonly [];
}

/** One event of the log: narrow on `isFrame` to tell a frame from a leaf. */
export type ApexEvent = FrameEvent | LeafEvent;

/** `E`, one shape of event, as type `T`: `field` takes only the names `T` lists. */
type Typed<E extends ApexEvent, T extends EventType> = Omit<E, 'type' | 'details' | 'field'> & {
  readonly type: T;
  readonly details: DetailsOf<T>;
  field(name: keyof EventFields[T] & string): string | null;
};

/**
 * An event of type `T`, with that type's details and field names; for a union, one member per
 * type, so `type` narrows. Each shape is kept apart, so `isFrame` still narrows.
 */
export type EventOf<T extends EventType> = T extends EventType
  ? Typed<FrameEvent, T> | Typed<LeafEvent, T>
  : never;

const ZERO: SelfTotal = Object.freeze({ self: 0, total: 0 });
// Ordered from the least to the most detailed, as `LEVEL` states them.
const LEVELS: readonly Level[] = Object.values(LEVEL);
const INFERRED_END = FLAG.logEnd | FLAG.unwind;

/**
 * Per counter, then `HEAP_SLOT`: 1 when the log can state the figure. The header's level records a
 * line that gives it, or states no level for its category, or the log holds one anyway, as a class
 * trace flag can raise the level.
 */
function recordedOf({ seen, debugLevels }: Built): Uint8Array {
  const recorded = seen.slice();
  for (const info of EVENT_TYPES) {
    const level = debugLevels[info.debugCategory];
    if (level && LEVELS.indexOf(level) < LEVELS.indexOf(info.debugLevel)) continue;
    const t = info.typeId;
    // t is a type id, so it indexes every table
    if (COUNT_AT[t]! >= 0) recorded[COUNT_AT[t]!] = 1;
    if (ROWS_AT[t]! >= 0) recorded[ROWS_AT[t]!] = 1;
    if (HEAP_SIGN[t]) recorded[HEAP_SLOT] = 1;
  }
  return recorded;
}
const NO_CHILDREN: readonly ApexEvent[] = Object.freeze([]);

/** The counts `Rollups` states, as `dmlCount`. */
export type CountRollup = Extract<keyof Rollups, `${string}Count`>;

/** Each count's counter: events and columns make their count getters from it. */
export const COUNT_ROLLUPS: Readonly<Record<CountRollup, number>> = Object.freeze({
  dmlCount: COUNTER.dml,
  soqlCount: COUNTER.soql,
  soslCount: COUNTER.sosl,
  dmlRowCount: COUNTER.dmlRows,
  soqlRowCount: COUNTER.soqlRows,
  soslRowCount: COUNTER.soslRows,
  thrownCount: COUNTER.thrown,
});

/** What ended frame `id`. */
export function endedByOf(store: Store, id: number): EndedBy {
  // id is a row, so every column holds it, and its type is a type id
  const flags = store.flags[id]!;
  if (flags & FLAG.logEnd) return ENDED_BY.LogEnd;
  if (flags & FLAG.unwind) return ENDED_BY.Unwind;
  return ENDS_ON_NEXT[store.type[id]!] ? ENDED_BY.Next : ENDED_BY.Exit;
}

/** The events of one build. Each read makes a new view, so the log keeps no object per event. */
export class LogEvents {
  private readonly store: Store;
  private readonly strings: StringTable;
  private readonly source: Source;
  /** Shared by every event of the build, so no event holds its own. */
  readonly lines: EventLines;
  private vars: LogVariables | null = null;
  readonly recorded: Uint8Array;

  constructor(built: Built) {
    const { store, strings, source, issues } = built;
    this.recorded = recordedOf(built);
    this.store = store;
    this.strings = strings;
    this.source = source;
    this.lines = new EventLines(store, source, issues);
  }

  /** Each event's variables, shared like `lines`; made on first read. */
  get variables(): LogVariables {
    return (this.vars ??= new LogVariables(this, this.store, this.source));
  }

  /** The event with `id`, or null when no event has it. */
  event(id: number): ApexEvent | null {
    if (!(id >= 1 && id < this.store.count && Number.isInteger(id))) return null;
    // One runtime class serves both shapes; `isFrame` tells them apart.
    return new EventView(this, this.store, this.strings, id) as unknown as ApexEvent;
  }

  /**
   * The events directly under row `id`, which is the log for 0, in log order. A new array each
   * call, so not frozen: a freeze makes a tree walk about 30% slower, and guards no shared array.
   */
  childrenOf(id: number): ApexEvent[] {
    const { subtreeEnd } = this.store;
    const out: ApexEvent[] = [];
    // A child's subtree ends where its next sibling starts; every id here is a row, so an event.
    for (let child = id + 1; child < subtreeEnd[id]!; child = subtreeEnd[child]!) {
      out.push(this.event(child)!);
    }
    return out;
  }
}

/**
 * The time and rollups of one row, read from the store: the log's (row 0) or an event's. Each `!`
 * below reads a column at `id`, a row the store holds.
 */
export abstract class RollupView implements Rollups {
  readonly id: number;
  protected readonly store: Store;

  constructor(store: Store, id: number) {
    this.store = store;
    this.id = id;
  }

  /** The build's `recordedOf`, read through the view that owns it, so no event holds a copy. */
  protected abstract get recorded(): Uint8Array;

  get startTimestamp(): number {
    return this.store.timestamp[this.id]!;
  }

  get endTimestamp(): number {
    return this.store.exitStamp[this.id]!;
  }

  // Getters from COUNT_ROLLUPS, made below.
  declare readonly dmlCount: SelfTotal | null;
  declare readonly soqlCount: SelfTotal | null;
  declare readonly soslCount: SelfTotal | null;
  declare readonly dmlRowCount: SelfTotal | null;
  declare readonly soqlRowCount: SelfTotal | null;
  declare readonly soslRowCount: SelfTotal | null;
  declare readonly thrownCount: SelfTotal | null;

  static {
    for (const [name, counter] of Object.entries(COUNT_ROLLUPS)) {
      Object.defineProperty(RollupView.prototype, name, {
        get(this: RollupView) {
          return this.count(counter);
        },
      });
    }
  }

  get duration(): SelfTotal {
    return { self: this.store.durationSelf[this.id]!, total: this.store.durationTotal(this.id) };
  }

  get heapAllocated(): SelfTotal | null {
    return this.heap(HEAP.allocatedSelf, HEAP.allocatedTotal);
  }

  get heapGross(): SelfTotal | null {
    return this.heap(HEAP.grossSelf, HEAP.grossTotal);
  }

  get heapPeak(): number | null {
    if (!this.recorded[HEAP_SLOT]) return null;
    const at = this.store.heapIndex(this.id);
    return at < 0 ? 0 : this.store.heap[at + HEAP.peak]!;
  }

  private count(counter: number): SelfTotal | null {
    const store = this.store;
    if (!this.recorded[counter]) return null;
    // Its end line states its rows, so with none they are not stated. Row 0 is no type's.
    if (ROWS_FROM_EXIT[store.type[this.id]!] === counter && store.flags[this.id]! & INFERRED_END) {
      return null;
    }
    const at = store.countIndex(this.id);
    if (at < 0) return ZERO;
    const counts = store.counts;
    return { self: counts[at + counter * 2 + SELF]!, total: counts[at + counter * 2 + TOTAL]! };
  }

  private heap(self: number, total: number): SelfTotal | null {
    if (!this.recorded[HEAP_SLOT]) return null;
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
  // undefined until read; null is text the line does not state.
  private said: string | null | undefined = undefined;
  // undefined until read; null is a type that states no details.
  private stated: AnyDetails | null | undefined = undefined;

  constructor(events: LogEvents, store: Store, strings: StringTable, id: number) {
    super(store, id);
    this.events = events;
    this.strings = strings;
  }

  protected get recorded(): Uint8Array {
    return this.events.recorded;
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

  get debugCategory(): DebugCategory {
    return this.info.debugCategory;
  }

  get debugLevel(): Level {
    return this.events.lines.statedLevel(this.id) ?? this.info.debugLevel;
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
    return this.events.childrenOf(this.id);
  }

  get lineNumber(): number | 'EXTERNAL' | null {
    const line = this.store.lineNumber[this.id]!;
    return line === NO_LINE ? null : line === EXTERNAL_LINE ? 'EXTERNAL' : line;
  }

  get namespace(): string | null {
    const ns = this.store.namespace[this.id]!;
    return ns === NONE ? null : this.strings.text(ns);
  }

  get endedBy(): EndedBy {
    return endedByOf(this.store, this.id);
  }

  get text(): string | null {
    if (this.said === undefined) this.said = this.events.lines.text(this.id);
    return this.said;
  }

  get logLine(): string {
    return this.events.lines.logLine(this.id);
  }

  get isApexCall(): boolean {
    return isApexCallRow(this.store, this.id);
  }

  field(name: string): string | null {
    return this.events.lines.field(this.id, name);
  }

  get details(): AnyDetails | null {
    if (this.stated === undefined) this.stated = this.events.lines.details(this.id);
    return this.stated;
  }

  get variables(): Variables | null {
    return this.events.variables.at(this.id);
  }

  objectAt(address: string): ObjectState | null {
    return this.events.variables.objectAt(this.id, address);
  }
}
