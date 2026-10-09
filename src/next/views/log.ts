/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { eventType, idOfType } from '../catalog/catalog.js';
import type { DebugCategory, EventType, Level } from '../catalog/types.js';
import type { Built } from '../engine/builder.js';
import type { DebugLevelSetting, UserInfo } from '../engine/header.js';
import type { IssueType } from '../engine/issues.js';
import type { GovernorLimits } from '../limits.js';
import { governorLimits } from '../limits.js';
import type { ApexEvent, EventOf, FrameEvent, Rollups } from './events.js';
import { isFrameRow, LogEvents, RollupView } from './events.js';

// WHATWG and Node 17+; declared here so `lib` stays ES2022.
declare function structuredClone<T>(value: T): T;

/**
 * The log's events as parallel arrays indexed by id, for a caller that reads every event. Row 0 is
 * the log. The arrays are the parse's own, not copies: read them, never write them.
 */
export interface Columns {
  /** Type ids: `eventType(type[id])`. Row 0 holds one past the last type id. */
  readonly type: Uint16Array;
  /** The parent's id: 0 for an event at the top of the log, -1 for the log. */
  readonly parent: Int32Array;
  /** 0 for the log, 1 for an event at its top. */
  readonly depth: Uint16Array;
  /** One past the last id under each row, so its descendants are `id + 1` to `subtreeEnd[id] - 1`. */
  readonly subtreeEnd: Int32Array;
  /** Nanoseconds. */
  readonly timestamp: Float64Array;
  /** Nanoseconds; NaN for a leaf. */
  readonly exitStamp: Float64Array;
  /** Nanoseconds. */
  readonly durationSelf: Float64Array;
  /** Nanoseconds; 0 without an exit, or with one at 0, as `duration.total`. */
  readonly durationTotal: Float64Array;
}

/** Where in the tree an issue or a truncation region is. */
export interface LogPlace {
  /** The event it is on; null when it is on none, as before the first event. */
  readonly event: ApexEvent | null;
  /** The type of the exit line that closed `event`, when it is on that line; else null. */
  readonly exitType: EventType | null;
}

/** Something wrong or missing in the log that the caller should know. Times are nanoseconds. */
export interface LogIssue extends LogPlace {
  readonly type: IssueType;
  readonly summary: string;
  readonly description: string;
  readonly startTime: number;
  /** Null when the issue is at one point in time. */
  readonly endTime: number | null;
  /** The bytes the platform states it dropped, for a skipped block; else null. */
  readonly skippedBytes: number | null;
}

/** A part of the log the platform did not write. Times are nanoseconds. */
export interface LogTruncationRegion extends LogPlace {
  readonly kind: 'skipped-lines' | 'max-size';
  readonly startTime: number;
  /** Where the log can be trusted again. */
  readonly endTime: number;
  /** The bytes the platform states it dropped, for a skipped block; else null. */
  readonly skippedBytes: number | null;
}

/** Every part of the log the platform did not write, in log order. */
export interface LogTruncation {
  readonly regions: readonly LogTruncationRegion[];
  readonly totalSkippedBytes: number;
}

/**
 * One parsed log, and the root of its event tree. Every object it returns is frozen, apart from
 * the typed arrays in `columns` and the `Map` in `limits`, which JavaScript cannot freeze.
 */
export interface ApexLog extends Rollups {
  /** Where the log ends: the end of its last event at the top. Nanoseconds. */
  readonly exitStamp: number;
  /** The events at the top of the log, in log order. Their `parent` is null. */
  readonly children: readonly ApexEvent[];
  /** Every event, in id order. */
  readonly events: Iterable<ApexEvent>;
  /** The number of events. The log itself is not one. */
  readonly eventCount: number;
  /** The event with `id`, the same object on every call; null when no event has it. */
  event(id: number): ApexEvent | null;
  /** Every event of the given types, in id order. Throws a RangeError for a name no type has. */
  ofType<T extends EventType>(...types: T[]): readonly EventOf<T>[];
  /** The deepest frame running at `ns`: its timestamp ≤ ns < its exitStamp. Null when none is. */
  at(ns: number): FrameEvent | null;
  /** Every event's tree links and times as arrays, made on first read. */
  readonly columns: Columns;
  /** Bytes of the source. */
  readonly size: number;
  /** Milliseconds since midnight, from the first event's line; null when it states none. */
  readonly startTime: number | null;
  /** Nanoseconds: the end of the last event at the top that has one, or 0. */
  readonly executionEndTime: number;
  /** The platform did not write part of the log. A frame with no exit does not count. */
  readonly isTruncated: boolean;
  /** The parts of the log the platform did not write. */
  readonly truncation: LogTruncation;
  /** The frames the log does not close, in the order they ended. */
  readonly truncatedEvents: readonly FrameEvent[];
  /** In start time order. */
  readonly issues: readonly LogIssue[];
  /** The lines the parser could not read, one message each. */
  readonly parsingErrors: readonly string[];
  /** The governor limit usage the log's limit blocks state. */
  readonly limits: GovernorLimits;
  /** Every namespace the log states, in first-stated order. */
  readonly namespaces: readonly string[];
  /** Every `EXCEPTION_THROWN` and `FATAL_ERROR`, in id order. */
  readonly exceptions: readonly ApexEvent[];
  /** The code units at the top of the log or of an execution: where work starts. */
  readonly entryPoints: readonly ApexEvent[];
  /** The user the `USER_INFO` line states; null when the log has none. */
  readonly userInfo: UserInfo | null;
  /** The level per debug category the header states. */
  readonly debugLevels: Partial<Record<DebugCategory, Level>>;
  /** Every entry of the header's settings line, as stated. */
  readonly debugLevelSettings: readonly DebugLevelSetting[];
}

/** The root view over one build. */
export function apexLog(built: Built): ApexLog {
  return new LogView(built);
}

/** The build under `log`; a TypeError for an object `parse` did not make. */
export function builtOf(log: ApexLog): Built {
  if (!(log instanceof LogView)) throw new TypeError('Not a log that parse made');
  return LogView.builtOf(log);
}

const CODE_UNIT_STARTED = idOfType('CODE_UNIT_STARTED');
const EXECUTION_STARTED = idOfType('EXECUTION_STARTED');

/** Freezes every plain object and array in `value`, and each value of a `Map`, then returns it. */
function deepFreeze<T>(value: T): T {
  if (value instanceof Map) for (const v of value.values()) deepFreeze(v);
  else if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** A frozen copy, so a caller never reaches the build through it. */
const owned = <T>(value: T): T => deepFreeze(structuredClone(value));

/** Row 0, read as the log. Each figure that needs work is made on first read. */
class LogView extends RollupView implements ApexLog {
  private readonly built: Built;
  private readonly all: LogEvents;
  private memo: {
    children?: readonly ApexEvent[];
    columns?: Columns;
    frames?: Int32Array;
    issues?: readonly LogIssue[];
    truncation?: LogTruncation;
    truncatedEvents?: readonly FrameEvent[];
    parsingErrors?: readonly string[];
    limits?: GovernorLimits;
    namespaces?: readonly string[];
    exceptions?: readonly ApexEvent[];
    entryPoints?: readonly ApexEvent[];
    userInfo?: UserInfo | null;
    debugLevels?: Partial<Record<DebugCategory, Level>>;
    debugLevelSettings?: readonly DebugLevelSetting[];
  } = {};

  constructor(built: Built) {
    super(built.store, 0);
    this.built = built;
    this.all = new LogEvents(built);
  }

  /** `builtOf`'s way past `private`, so the field stays out of the public type. */
  static builtOf(log: LogView): Built {
    return log.built;
  }

  get exitStamp(): number {
    // Row 0 is always a row
    return this.store.exitStamp[0]!;
  }

  get children(): readonly ApexEvent[] {
    return (this.memo.children ??= this.all.childrenOf(0));
  }

  get events(): Iterable<ApexEvent> {
    const all = this.all;
    const count = this.store.count;
    return {
      *[Symbol.iterator]() {
        // Every id from 1 below count is a row, so an event.
        for (let id = 1; id < count; id++) yield all.event(id)!;
      },
    };
  }

  get eventCount(): number {
    return this.store.count - 1;
  }

  event(id: number): ApexEvent | null {
    return this.all.event(id);
  }

  ofType<T extends EventType>(...types: T[]): readonly EventOf<T>[] {
    const lists = [...new Set(types)].map((type) => {
      const typeId = idOfType(type);
      if (typeId < 0) throw new RangeError(`No event type ${type}`);
      return this.store.rowsOfType(typeId);
    });
    // Each id is a row of one of the types.
    return Object.freeze(Array.from(this.merged(lists), (id) => this.all.event(id) as EventOf<T>));
  }

  at(ns: number): FrameEvent | null {
    const { timestamp, exitStamp, parent } = this.store;
    // Leaves are skipped: a merged package run ends after the leaves that follow it.
    const frames = (this.memo.frames ??= this.frameRows());
    let low = 0;
    let high = frames.length - 1;
    let row = 0;
    while (low <= high) {
      const mid = (low + high) >>> 1;
      // mid is in range, and each entry is a row
      const id = frames[mid]!;
      if (timestamp[id]! <= ns) {
        row = id;
        low = mid + 1;
      } else high = mid - 1;
    }
    // Each row and its parents are rows; row 0 is the log, not an event.
    for (; row > 0; row = parent[row]!) {
      if (ns < exitStamp[row]!) return this.all.event(row) as FrameEvent;
    }
    return null;
  }

  get columns(): Columns {
    return (this.memo.columns ??= this.makeColumns());
  }

  get size(): number {
    return this.built.size;
  }

  get startTime(): number | null {
    return this.built.startTime;
  }

  get executionEndTime(): number {
    return this.built.executionEndTime;
  }

  get isTruncated(): boolean {
    return this.built.truncation.regions.length > 0;
  }

  get truncation(): LogTruncation {
    return (this.memo.truncation ??= Object.freeze({
      regions: Object.freeze(
        this.built.truncation.regions.map((region) =>
          Object.freeze({
            kind: region.kind,
            startTime: region.startTime,
            endTime: region.endTime,
            ...this.place(region),
            skippedBytes: region.skippedBytes,
          }),
        ),
      ),
      totalSkippedBytes: this.built.truncation.totalSkippedBytes,
    }));
  }

  get truncatedEvents(): readonly FrameEvent[] {
    // The engine lists frames only, and each one is a row.
    return (this.memo.truncatedEvents ??= Object.freeze(
      this.built.truncated.map((id) => this.all.event(id) as FrameEvent),
    ));
  }

  get issues(): readonly LogIssue[] {
    return (this.memo.issues ??= Object.freeze(
      this.built.issues.list.map((issue) =>
        Object.freeze({
          type: issue.type,
          summary: issue.summary,
          description: issue.description,
          startTime: issue.startTime,
          endTime: issue.endTime,
          ...this.place(issue),
          skippedBytes: issue.skippedBytes,
        }),
      ),
    ));
  }

  get parsingErrors(): readonly string[] {
    return (this.memo.parsingErrors ??= Object.freeze([...this.built.parsingErrors]));
  }

  get limits(): GovernorLimits {
    return (this.memo.limits ??= deepFreeze(
      governorLimits(structuredClone([...this.built.snapshots]), this.heapPeak),
    ));
  }

  get namespaces(): readonly string[] {
    return (this.memo.namespaces ??= Object.freeze(
      this.built.namespaces.map((id) => this.built.strings.text(id)),
    ));
  }

  get exceptions(): readonly ApexEvent[] {
    return (this.memo.exceptions ??= this.ofType('EXCEPTION_THROWN', 'FATAL_ERROR'));
  }

  get entryPoints(): readonly ApexEvent[] {
    return (this.memo.entryPoints ??= this.makeEntryPoints());
  }

  get userInfo(): UserInfo | null {
    if (this.memo.userInfo === undefined) this.memo.userInfo = owned(this.built.userInfo);
    return this.memo.userInfo;
  }

  get debugLevels(): Partial<Record<DebugCategory, Level>> {
    return (this.memo.debugLevels ??= owned(this.built.debugLevels));
  }

  get debugLevelSettings(): readonly DebugLevelSetting[] {
    return (this.memo.debugLevelSettings ??= owned(this.built.debugLevelSettings));
  }

  private place(at: { id: number; exitType: number | null }): LogPlace {
    return {
      event: this.all.event(at.id),
      exitType: at.exitType === null ? null : (eventType(at.exitType)?.type ?? null),
    };
  }

  /** The ids of every list, ascending, in one array. */
  private merged(lists: Int32Array[]): Int32Array {
    if (lists.length === 1) return lists[0]!; // length checked
    const ids = new Int32Array(lists.reduce((n, list) => n + list.length, 0));
    let at = 0;
    for (const list of lists) {
      ids.set(list, at);
      at += list.length;
    }
    return ids.sort();
  }

  private makeColumns(): Columns {
    const store = this.store;
    const durationTotal = new Float64Array(store.count);
    for (let id = 0; id < store.count; id++) durationTotal[id] = store.durationTotal(id);
    return Object.freeze({
      type: store.type,
      parent: store.parent,
      depth: store.depth,
      subtreeEnd: store.subtreeEnd,
      timestamp: store.timestamp,
      exitStamp: store.exitStamp,
      durationSelf: store.durationSelf,
      durationTotal,
    });
  }

  private makeEntryPoints(): readonly ApexEvent[] {
    const { type, parent } = this.store;
    const units = this.store.rowsOfType(CODE_UNIT_STARTED);
    // Each unit is a row, and its parent is a row: the log, or a frame.
    const ids = units.filter((id) => parent[id] === 0 || type[parent[id]!] === EXECUTION_STARTED);
    return Object.freeze(Array.from(ids, (id) => this.all.event(id)!));
  }

  private frameRows(): Int32Array {
    const store = this.store;
    let n = 0;
    for (let id = 1; id < store.count; id++) if (isFrameRow(store, id)) n++;
    const rows = new Int32Array(n);
    n = 0;
    for (let id = 1; id < store.count; id++) if (isFrameRow(store, id)) rows[n++] = id;
    return rows;
  }
}
