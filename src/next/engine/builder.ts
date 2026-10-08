/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { ByteFields, digits } from '../bytes/cursor.js';
import { TRUNCATION_MARKER } from '../bytes/lines.js';
import type { Source } from '../bytes/source.js';
import { typeIdAt } from '../bytes/typeIds.js';
import type { Hook } from '../catalog/catalog.js';
import { EVENT_TYPES, eventText, GRAMMAR, idOfType } from '../catalog/catalog.js';
import { EVENT_TYPE_NAMES } from '../catalog/types.js';
import type { LimitSnapshot } from '../limits.js';
import { limitsOfBlock } from '../limits.js';
import { EXTERNAL_LINE, NO_LINE, NONE, Store } from '../store/store.js';
import { StringTable } from '../store/strings.js';
import type { IssueType } from './issues.js';
import { ISSUE, Issues } from './issues.js';
import { DEFAULT, Namespaces, RULE, UNSTATED } from './namespaces.js';

/** Per-event bits in `Store.flags`. */
export const FLAG = {
  /** The log does not close this frame. */
  truncated: 1,
  /** A frame type that this event's line made a leaf, as a VF call with no method. */
  notEntry: 2,
} as const;

/** The type id of the log itself, row 0. One past the event types. */
export const LOG_TYPE: number = EVENT_TYPE_NAMES.length;
const TYPES = EVENT_TYPE_NAMES.length;

/** The hooks the engine runs when the next event is read. 0: the hook runs elsewhere. */
const HOOK_ID: { readonly [H in Hook]: number } = {
  limitSnapshot: 1,
  limitException: 2,
  fatal: 3,
  // The flow residual pass reads these.
  flowTotal: 0,
  // readEvent decides the leaf.
  vfApexCall: 0,
};

// Per-type tables, so the loop reads one byte, not an object.
const IS_FRAME = new Uint8Array(TYPES);
const IS_EXIT = new Uint8Array(TYPES);
/** An exit-shaped line. No such type closes anything, so it never opens a frame. */
const EXIT_LINE = new Uint8Array(TYPES);
const NEXT_LINE_EXITS = new Uint8Array(TYPES);
const HAS_EXITS = new Uint8Array(TYPES);
const ACCEPTS_TEXT = new Uint8Array(TYPES);
const DISCONTINUITY = new Uint8Array(TYPES);
const LINE_FIELD = new Int8Array(TYPES);
/** A `RULE` id, or 0 when the type states no namespace and takes its frame's. */
const NAMESPACE_RULE = new Uint8Array(TYPES);
const NAMESPACE_POSITIONS: (readonly number[])[] = [];
/** A frame that takes the namespace its exit line states, as today's method entry. */
const TAKES_EXIT_NAMESPACE = new Uint8Array(TYPES);
/** A `HOOK_ID`, or 0. */
const HOOK = new Uint8Array(TYPES);
/** `CLOSES[frame * TYPES + exit]` is 1 when an `exit` line closes a `frame`. */
const CLOSES = new Uint8Array(TYPES * TYPES);
for (const info of EVENT_TYPES) {
  const t = info.typeId;
  // t is a type id, so it indexes GRAMMAR
  const g = GRAMMAR[t]!;
  IS_FRAME[t] = info.shape === 'frame' ? 1 : 0;
  // A frame that the next line closes is also an exit line for the frame before it, as today.
  IS_EXIT[t] = info.shape === 'exit' || g.closes === 'next-line' ? 1 : 0;
  EXIT_LINE[t] = info.shape === 'exit' ? 1 : 0;
  NEXT_LINE_EXITS[t] = g.closes === 'next-line' ? 1 : 0;
  HAS_EXITS[t] = g.closes === 'exit' || g.closes === 'next-line' ? 1 : 0;
  ACCEPTS_TEXT[t] = g.acceptsText ? 1 : 0;
  DISCONTINUITY[t] = g.discontinuity ? 1 : 0;
  LINE_FIELD[t] = g.lineField;
  NAMESPACE_RULE[t] = g.namespace ? RULE[g.namespace] : 0;
  NAMESPACE_POSITIONS[t] = g.namespaceFields;
  TAKES_EXIT_NAMESPACE[t] = g.namespace === 'method' ? 1 : 0;
  HOOK[t] = g.hook ? HOOK_ID[g.hook] : 0;
  for (const exit of info.exitTypes) CLOSES[t * TYPES + idOfType(exit)] = 1;
  if (g.closes === 'next-line') CLOSES[t * TYPES + t] = 1;
}
const EXECUTION_STARTED = idOfType('EXECUTION_STARTED');
const ENTERING_MANAGED_PKG = idOfType('ENTERING_MANAGED_PKG');
const VF_APEX_CALL_START = idOfType('VF_APEX_CALL_START');
const [VF_ELEMENT = -1, VF_METHOD = -1, VF_CONTROLLER = -1] =
  GRAMMAR[VF_APEX_CALL_START]?.hookFields ?? [];

/** What `readEvent` made of a line. */
const READ = { notEvent: 0, event: 1, error: 2, unknownType: 3 } as const;

const CR = 0x0d;
const PIPE = 0x7c;
const OPEN = 0x28;
const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const UNDERSCORE = 0x5f;
const CLOSE = 0x29;
const COLON = 0x3a;
const DOT = 0x2e;
const SPACE = 0x20;
const STAR = 0x2a;

// Looser than TRUNCATION_MARKER, as today: a line only reaches these tests when it is not text.
const MAX_SIZE = 'MAXIMUM DEBUG LOG SIZE REACHED';
const SKIPPED = '*** Skipped';
const settingsPattern = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/;
const skippedBytesPattern = /^\*\*\* Skipped ([\d,]+) bytes/;
const invalidClasses = [
  'pagemessagescomponentcontroller',
  'pagemessagecomponentcontroller',
  'severitymessages',
];

/** What the engine gives the views: the columns and the log-level facts. */
export interface Built {
  readonly store: Store;
  readonly strings: StringTable;
  readonly issues: Issues;
  readonly parsingErrors: readonly string[];
  /** The frames the log does not close, in the order they ended. */
  readonly truncated: readonly number[];
  /** The string ids of the namespaces the log states, in first-stated order. */
  readonly namespaces: readonly number[];
  /** The `LIMIT_USAGE_FOR_NS` blocks, in log order. */
  readonly snapshots: readonly LimitSnapshot[];
}

/**
 * Builds the event tree in one pass, with today's rules and today's order of side effects. Lines
 * are read one event ahead: taking an event reads every line up to the next one, so the work that
 * follows an event (its text, then the next event's own) runs before the tree places that next
 * event.
 */
export class LogBuilder {
  private readonly source: Source;
  private readonly bytes: Uint8Array;
  private readonly fields: ByteFields;
  /** The hooks' own cursor, so a hook never moves the one the next line was read with. */
  private readonly hookFields: ByteFields;
  private readonly store: Store;
  private readonly strings: StringTable;
  private readonly issues: Issues = new Issues();
  private readonly parsingErrors: string[] = [];
  private readonly unsupported = new Set<string>();
  private readonly truncated: number[] = [];
  private readonly namespaces: Namespaces;
  private readonly snapshots: LimitSnapshot[] = [];
  // The open frames, innermost last: each one's id, and its last child's id or `NONE`.
  private readonly frameIds: number[] = [];
  private readonly frameLastChild: number[] = [];

  /** Where the next unread line starts. */
  private pos = 0;
  private discontinuity = false;
  private lastTimestamp = 0;
  /** Nanoseconds; 0 until the log states it reached the maximum size. */
  private maxSizeTimestamp = 0;

  // The next event, read but not yet placed.
  private hasNext = false;
  private nextType = 0;
  private nextStart = 0;
  private nextEnd = 0;
  private nextTimestamp = 0;
  private nextLine = NO_LINE;
  private nextFlags = 0;
  /** The namespace the next line states: a string id, `UNSTATED` or `DEFAULT`. */
  private nextNamespace = UNSTATED;

  // The event placed last: its id, or the frame a folded exit closed.
  private lastId = NONE;
  private lastType = -1;
  /** The last event was an exit line, folded into `lastId`. */
  private lastFolded = false;
  /** Where the last event's own line ends, before its continuation lines. */
  private lastLineEnd = 0;
  // Where the last line `readEvent` judged an unknown type has that type.
  private unknownStart = 0;
  private unknownEnd = 0;

  constructor(source: Source) {
    this.source = source;
    this.bytes = source.bytes;
    this.fields = new ByteFields(source);
    this.hookFields = new ByteFields(source);
    this.store = new Store(source.bytes.length);
    this.strings = new StringTable(source);
    this.namespaces = new Namespaces(source.bytes, this.strings);
  }

  build(): Built {
    const store = this.store;
    store.add(LOG_TYPE, 0, 0, 0, NONE, 0);
    this.pos = this.firstEventLine();
    this.readNext();
    while (this.hasNext) {
      const id = this.take(0, 1);
      // id was added by take, so it has a type
      if (IS_FRAME[store.type[id]!]) this.parseTree(id);
    }
    store.finish(TYPES + 1);
    return {
      store,
      strings: this.strings,
      issues: this.issues,
      parsingErrors: this.parsingErrors,
      truncated: this.truncated,
      namespaces: this.namespaces.order,
      snapshots: this.snapshots,
    };
  }

  /** Today's `parseTree`, iterative, so a deep log cannot overflow the call stack. */
  private parseTree(root: number): void {
    const store = this.store;
    const ids = this.frameIds;
    this.open(root);
    while (ids.length) {
      const top = ids.length - 1;
      // the loop runs only while a frame is open, and take added it, so it has a type
      const frame = ids[top]!;
      const onNextLine = NEXT_LINE_EXITS[store.type[frame]!] === 1;
      if (!this.hasNext) {
        this.closeUnterminated();
        continue;
      }
      const next = this.nextType;
      this.discontinuity ||= DISCONTINUITY[next] === 1;
      const nextHasExits = HAS_EXITS[next] === 1 && !(this.nextFlags & FLAG.notEntry);
      // endMethod can fold the exit line and read past it.
      const exitNamespace = this.nextNamespace;
      if (!onNextLine && EXIT_LINE[next] && this.endMethod(frame)) {
        // As today, also when the line unwinds this frame to close one below it.
        if (TAKES_EXIT_NAMESPACE[store.type[frame]!] && exitNamespace !== UNSTATED) {
          store.namespace[frame] = exitNamespace === DEFAULT ? NONE : exitNamespace;
        }
        this.pop();
      } else if (onNextLine && (IS_EXIT[next] || nextHasExits)) {
        store.exitStamp[frame] = this.nextTimestamp;
        this.pop();
      } else if (
        this.discontinuity &&
        this.maxSizeTimestamp &&
        this.nextTimestamp > this.maxSizeTimestamp
      ) {
        store.flags[frame]! |= FLAG.truncated;
        this.closeUnterminated();
      } else if (next === EXECUTION_STARTED) {
        // An execution is always top level, so every frame still open lost its exit.
        this.discontinuity = false;
        this.closeUnterminated();
      } else {
        const child = this.take(frame, store.depth[frame]! + 1);
        this.frameLastChild[top] = child;
        // child was added by take, so it has a type
        if (IS_FRAME[store.type[child]!]) this.open(child);
      }
    }
  }

  private open(id: number): void {
    const store = this.store;
    // id was added by take, so every column holds it
    if (!HAS_EXITS[store.type[id]!] || store.flags[id]! & FLAG.notEntry) return;
    this.frameIds.push(id);
    this.frameLastChild.push(NONE);
  }

  private pop(): void {
    this.frameIds.pop();
    this.frameLastChild.pop();
  }

  /** The log stops inside the innermost frame, or a new execution or the maximum size ends it. */
  private closeUnterminated(): void {
    const store = this.store;
    const top = this.frameIds.length - 1;
    // only called while a frame is open
    const id = this.frameIds[top]!;
    const last = this.frameLastChild[top]!;
    // last is an id from take, when it is not NONE
    const lastEnd =
      last === NONE
        ? store.timestamp[id]!
        : Number.isNaN(store.exitStamp[last]!)
          ? store.timestamp[last]!
          : store.exitStamp[last]!;
    const exitStamp = Math.max(this.lastTimestamp, lastEnd);
    store.exitStamp[id] = exitStamp;
    this.issues.add(exitStamp, id, ISSUE.unexpectedEnd);
    if (store.flags[id]! & FLAG.truncated) {
      this.issues.replace(exitStamp, id, ISSUE.maxSize);
      this.maxSizeTimestamp = exitStamp;
    }
    store.flags[id]! |= FLAG.truncated;
    this.truncated.push(id);
    this.pop();
  }

  /** Today's `endMethod`: true when the next line closes this frame, or one below it. */
  private endMethod(frame: number): boolean {
    const store = this.store;
    store.exitStamp[frame] = this.nextTimestamp;
    if (this.matches(frame)) {
      this.discontinuity = false;
      this.fold(frame);
      return true;
    }
    if (this.discontinuity) return true;
    for (const below of this.frameIds) if (this.matches(below)) return true;
    // The exit becomes a child, the next row.
    this.issues.add(this.nextTimestamp, store.count, ISSUE.unexpectedExit);
    return false;
  }

  /** The next line is an exit that closes `frame`: of one of its exit types, at its line or none. */
  private matches(frame: number): boolean {
    const store = this.store;
    // frame was added by take, so every column holds it
    if (!CLOSES[store.type[frame]! * TYPES + this.nextType]) return false;
    const line = store.lineNumber[frame]!;
    const exitLine = this.nextLine;
    // Today a missing or zero line number matches any.
    return (
      exitLine === line || exitLine === NO_LINE || exitLine === 0 || line === NO_LINE || line === 0
    );
  }

  /** Places the next event as a row under `parent`, then reads the event after it. */
  private take(parent: number, depth: number): number {
    const store = this.store;
    const id = store.add(
      this.nextType,
      this.nextStart,
      this.nextEnd,
      this.nextTimestamp,
      parent,
      depth,
    );
    store.lineNumber[id] = this.nextLine;
    store.flags[id] = this.nextFlags;
    const own = this.nextNamespace;
    // parent was added before id, so its namespace is set; the log's own is NONE
    store.namespace[id] = own >= 0 ? own : own === DEFAULT ? NONE : store.namespace[parent]!;
    this.lastTimestamp = this.nextTimestamp;
    this.lastFolded = false;
    this.placed(id);
    return id;
  }

  /** Takes the next event, a matched exit line, into the frame it closes: it gets no row. */
  private fold(frame: number): void {
    this.lastFolded = true;
    this.placed(frame);
  }

  private placed(id: number): void {
    this.lastId = id;
    this.lastType = this.nextType;
    this.lastLineEnd = this.nextEnd;
    this.readNext();
  }

  /** Today's line generator, one event at a time: reads lines up to and including the next event. */
  private readNext(): void {
    const bytes = this.bytes;
    const len = bytes.length;
    this.hasNext = false;
    while (this.pos < len) {
      const start = this.pos;
      let eol = this.source.lineEnd(start);
      const last = eol < 0;
      if (last) eol = len;
      this.pos = eol + 1;
      // A CR before the line's LF is part of its line end; the last line keeps one, as today.
      const end = !last && eol > start && bytes[eol - 1] === CR ? eol - 1 : eol;
      if (end === start) continue;
      const read = this.readEvent(start, end);
      if (read === READ.event) {
        this.afterEvent();
        return;
      }
      if (read === READ.notEvent) this.notAnEvent(start, end);
      else if (read === READ.unknownType) this.unsupportedType();
    }
    // Nothing follows the last event, so its text is complete.
    this.runHook();
  }

  /** Reads the line as the next event, when it starts one. */
  private readEvent(start: number, end: number): number {
    const bytes = this.bytes;
    let p1 = start;
    while (p1 < end && bytes[p1] !== PIPE) p1++;
    if (p1 >= end) return READ.notEvent;
    let p2 = p1 + 1;
    while (p2 < end && bytes[p2] !== PIPE) p2++;
    const type = typeIdAt(bytes, p1 + 1, p2);
    if (type < 0) {
      if (!this.isTypeName(p1 + 1, p2)) return READ.notEvent;
      this.unknownStart = p1 + 1;
      this.unknownEnd = p2;
      return READ.unknownType;
    }
    const timestamp = this.timestampIn(start, p1);
    if (Number.isNaN(timestamp)) {
      // Today the whole parse throws here.
      this.parsingErrors.push(`Invalid log line: ${this.source.text(start, end)}`);
      return READ.error;
    }

    let flags = 0;
    let line = NO_LINE;
    const fields = this.fields;
    fields.reset(start, end);
    // type is a type id, so it indexes the tables
    const lineField = LINE_FIELD[type]!;
    if (lineField >= 0) {
      const stated = fields.lineNumber(lineField);
      if (stated === 'EXTERNAL') line = EXTERNAL_LINE;
      else if (stated === null) line = NO_LINE;
      else if (Number.isNaN(stated)) {
        this.parsingErrors.push(`Invalid line number: ${this.source.text(start, end)}`);
      } else line = stated;
    }
    if (type === VF_APEX_CALL_START && this.vfCallIsLeaf()) flags |= FLAG.notEntry;
    const rule = NAMESPACE_RULE[type]!;
    // type is a type id, so it has positions
    const namespace = rule
      ? this.namespaces.read(rule, fields, NAMESPACE_POSITIONS[type]!)
      : UNSTATED;

    this.hasNext = true;
    this.nextType = type;
    this.nextStart = start;
    this.nextEnd = end;
    this.nextTimestamp = timestamp;
    this.nextLine = line;
    this.nextFlags = flags;
    this.nextNamespace = namespace;
    return READ.event;
  }

  /** Today's `onAfter` of the last event, now that the next one is read. */
  private afterEvent(): void {
    this.runHook();
    // A package entry ends where the next event starts; the last one in the log stays open.
    if (this.lastType === ENTERING_MANAGED_PKG)
      this.store.exitStamp[this.lastId] = this.nextTimestamp;
  }

  /** Today's `onAfter` hooks of the last event, which read its whole text. */
  private runHook(): void {
    const type = this.lastType;
    const hook = type < 0 || this.lastFolded ? 0 : HOOK[type];
    if (!hook) return;
    const store = this.store;
    const id = this.lastId;
    const lineEnd = this.lastLineEnd;
    // id was placed, so every column holds it
    const end = store.end[id]!;
    const lf = end > lineEnd ? this.source.lineEnd(lineEnd) : -1;
    const from = lf < 0 ? lineEnd : lf + 1;
    const fields = this.hookFields;
    fields.reset(store.start[id]!, lineEnd, from, lf < 0 ? lineEnd : end);
    const text = eventText(type, fields) ?? '';
    const timestamp = store.timestamp[id]!;
    if (hook === HOOK_ID.limitSnapshot) {
      const ns = store.namespace[id]!;
      // The limits rule always states one, so NONE is its 'default'.
      const namespace = ns === NONE ? 'default' : this.strings.text(ns);
      this.snapshots.push({ timestamp, namespace, limits: limitsOfBlock(text) });
    } else if (hook === HOOK_ID.fatal) {
      this.textIssue(timestamp, id, text, 'fatal');
    } else if (text.includes('System.LimitException')) {
      this.textIssue(timestamp, id, text, 'error');
    }
  }

  /** An issue from an event's text: its first line is the summary, as today. */
  private textIssue(timestamp: number, id: number, text: string, type: IssueType): void {
    const lf = text.indexOf('\n');
    const summary = (lf < 0 ? text : text.slice(0, lf)).trim();
    const description = lf < 0 ? '' : text.slice(lf + 1).trim();
    this.issues.add(timestamp, id, { summary, description, type });
  }

  /** Today's rule: a VF call with no method, on a class with no space or a page-messages class, is a leaf. */
  private vfCallIsLeaf(): boolean {
    const fields = this.fields;
    if (fields.at(VF_METHOD)) return false;
    const classText = fields.at(VF_CONTROLLER) || fields.at(VF_ELEMENT);
    if (!classText.includes(' ')) return true;
    const lower = classText.toLowerCase();
    for (const invalid of invalidClasses) if (lower.includes(invalid)) return true;
    return false;
  }

  /** The nanoseconds in `(…)` of field 0, or NaN when it states none. */
  private timestampIn(start: number, end: number): number {
    const bytes = this.bytes;
    let i = start;
    while (i < end && bytes[i] !== OPEN) i++;
    if (i >= end || bytes[end - 1] !== CLOSE) return Number.NaN;
    return digits(bytes, i + 1, end - 1);
  }

  /** A line that starts no event: text of the last event, a marker, or an error, as today. */
  private notAnEvent(start: number, end: number): void {
    const store = this.store;
    const last = this.lastId;
    if (last !== NONE && ACCEPTS_TEXT[this.lastType] && !this.isTruncationMarker(start, end)) {
      store.end[last] = end;
      return;
    }
    const text = this.source.text(start, end);
    if (last === NONE) {
      if (!settingsPattern.test(text)) this.parsingErrors.push(`Invalid log line: ${text}`);
      return;
    }
    // A folded exit's time is its frame's exitStamp.
    const at = this.lastFolded ? store.exitStamp[last]! : store.timestamp[last]!;
    const exitType = this.lastFolded ? this.lastType : null;
    if (text.startsWith(SKIPPED)) {
      const issue = this.issues.add(at, last, {
        summary: 'Skipped-Lines',
        description: `${text}. A section of the log has been skipped and the log has been truncated. Full details of this section of log can not be provided.`,
        type: 'skip',
      });
      const skipped = text.match(skippedBytesPattern)?.[1];
      if (issue) issue.exitType = exitType;
      if (issue && skipped) issue.skippedBytes = Number.parseInt(skipped.replaceAll(',', ''), 10);
    } else if (text.includes(MAX_SIZE)) {
      const issue = this.issues.add(at, last, ISSUE.maxSize);
      if (issue) issue.exitType = exitType;
      this.maxSizeTimestamp = at;
    } else if (!settingsPattern.test(text)) {
      this.parsingErrors.push(`Invalid log line: ${text}`);
    }
  }

  /** A line whose field 1 names a type the catalog does not hold: one error per name, as today. */
  private unsupportedType(): void {
    const message = `Unsupported log event name: ${this.source.text(this.unknownStart, this.unknownEnd)}`;
    if (this.unsupported.has(message)) return;
    this.unsupported.add(message);
    this.parsingErrors.push(message);
  }

  /** Bytes `start` to `end` are a non-empty run of `A`-`Z` and `_`, as an event name is. */
  private isTypeName(start: number, end: number): boolean {
    if (start >= end) return false;
    const bytes = this.bytes;
    for (let i = start; i < end; i++) {
      // i < end, which is inside the line
      const c = bytes[i]!;
      if (!((c >= UPPER_A && c <= UPPER_Z) || c === UNDERSCORE)) return false;
    }
    return true;
  }

  private isTruncationMarker(start: number, end: number): boolean {
    // '*' first: a cheap test, because this runs on every continuation line.
    return this.bytes[start] === STAR && TRUNCATION_MARKER.test(this.source.text(start, end));
  }

  /** The start of the first timestamped line, or 0 when there is none, as today. */
  private firstEventLine(): number {
    const bytes = this.bytes;
    for (let start = 0; start < bytes.length; ) {
      if (this.isTimestamped(start)) return start;
      const eol = this.source.lineEnd(start);
      if (eol < 0) break;
      start = eol + 1;
    }
    return 0;
  }

  /** `HH:MM:SS.f+ (n+)|` at `start`. */
  private isTimestamped(start: number): boolean {
    const bytes = this.bytes;
    const digit = (i: number): boolean => bytes[i]! >= 0x30 && bytes[i]! <= 0x39;
    if (!(digit(start) && digit(start + 1) && bytes[start + 2] === COLON)) return false;
    if (!(digit(start + 3) && digit(start + 4) && bytes[start + 5] === COLON)) return false;
    if (!(digit(start + 6) && digit(start + 7) && bytes[start + 8] === DOT)) return false;
    let i = start + 9;
    if (!digit(i)) return false;
    while (digit(i)) i++;
    if (bytes[i++] !== SPACE || bytes[i++] !== OPEN || !digit(i)) return false;
    while (digit(i)) i++;
    return bytes[i] === CLOSE && bytes[i + 1] === PIPE;
  }
}
