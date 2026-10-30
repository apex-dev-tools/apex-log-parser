/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { addressPipe } from '../bytes/ascii.js';
import { ByteFields } from '../bytes/cursor.js';
import type { Source } from '../bytes/source.js';
import {
  codeUnitType,
  eventText,
  fieldPosition,
  idOfType,
  textFieldStart,
} from '../catalog/catalog.js';
import type { Level } from '../catalog/types.js';
import { isLevel } from '../catalog/types.js';
import type { Issues } from '../engine/issues.js';
import { isFrameRow } from '../engine/tables.js';
import { throwOutcomes } from '../engine/throws.js';
import type { Store } from '../store/store.js';
import { StringTable } from '../store/strings.js';
import type { AnyDetails, FlowType } from './details.js';
import { eventDetails, flowTypeOfUnit } from './details.js';

const INTERVIEWS = idOfType('FLOW_START_INTERVIEWS_BEGIN');
const INTERVIEW = idOfType('FLOW_START_INTERVIEW_BEGIN');
const CODE_UNIT_STARTED = idOfType('CODE_UNIT_STARTED');
const EXPLAIN = idOfType('SOQL_EXECUTE_EXPLAIN');
const ASSIGNMENT = idOfType('VARIABLE_ASSIGNMENT');
const VALUE = fieldPosition(ASSIGNMENT, 'value').at;
const USER_DEBUG = idOfType('USER_DEBUG');
const USER_LEVEL = fieldPosition(USER_DEBUG, 'level').at;
/** `textIndex` for a leaf, whose text is not shared, and for the log. */
const LEAF = -1;
const UNREAD = -2;

/**
 * Reads each row's line from the source, on demand: its text, raw line and fields. One cursor
 * serves every read, so each result is taken before the next read starts.
 */
export class EventLines {
  private readonly store: Store;
  private readonly source: Source;
  private readonly issues: Issues;
  private readonly fields: ByteFields;
  /** Whether each decided throw was caught, by row; made on the first read of one. */
  private outcomes: Map<number, boolean> | null = null;
  /** Per type, each distinct frame line read so far, and the index of its text in `texts`. */
  private readonly frameLines: StringTable[] = [];
  private readonly textOfLine: number[][] = [];
  private readonly indexOfText = new Map<string | null, number>();
  /** Each distinct frame text once. */
  readonly texts: (string | null)[] = [];
  /** By row: the index of its text in `texts`, `LEAF`, or `UNREAD`; made on the first read. */
  private textIds: Int32Array | null = null;
  private allRead = false;

  constructor(store: Store, source: Source, issues: Issues) {
    this.store = store;
    this.source = source;
    this.issues = issues;
    this.fields = new ByteFields(source);
  }

  /** The row's text, as its type's rule reads it; null when it states none. */
  text(id: number): string | null {
    const index = this.textIndex(id);
    // A set index points into texts
    return index === LEAF ? eventText(this.typeOf(id), this.at(id)) : this.texts[index]!;
  }

  /** The index of a frame's text in `texts`, shared by every frame with that text; `LEAF` for a leaf. */
  textIndex(id: number): number {
    const ids = (this.textIds ??= this.unreadIds());
    // id is a row, so in range
    const known = ids[id]!;
    if (known !== UNREAD) return known;
    const index = isFrameRow(this.store, id) ? this.frameTextIndex(id) : LEAF;
    ids[id] = index;
    return index;
  }

  /** Every row's `textIndex`, by id: the array itself, so read it, never write it. */
  textIndexes(): Int32Array {
    if (!this.allRead) {
      for (let id = 1; id < this.store.count; id++) this.textIndex(id);
      // Every frame is read, so no text is added: callers can hold `texts`.
      Object.freeze(this.texts);
      this.allRead = true;
    }
    // Made above, or by the first textIndex
    return (this.textIds ??= this.unreadIds());
  }

  /** Every row unread, but row 0, the log, which states no text. */
  private unreadIds(): Int32Array {
    const ids = new Int32Array(this.store.count).fill(UNREAD);
    ids[0] = LEAF;
    return ids;
  }

  private indexOf(text: string | null): number {
    let index = this.indexOfText.get(text);
    if (index === undefined) {
      index = this.texts.push(text) - 1;
      this.indexOfText.set(text, index);
    }
    return index;
  }

  /**
   * A frame repeats its method, so its text is the same for every frame of its type whose line is
   * the same bytes from the first field the text reads; the type name is field 1. The index, so a
   * repeated line costs no lookup by text.
   */
  private frameTextIndex(id: number): number {
    const type = this.typeOf(id);
    // A flow interviews frame is named by its first interview.
    if (type === INTERVIEWS) {
      const interview = this.firstChildOf(id, INTERVIEW);
      return this.indexOf(interview < 0 ? null : this.text(interview));
    }
    const f = this.at(id);
    const from = f.startOf(Math.max(1, textFieldStart(type)));
    if (from < 0) return this.indexOf(eventText(type, f));
    // id is a row, so every column holds it; type indexes the per-type tables
    const line = (this.frameLines[type] ??= new StringTable(this.source)).intern(
      from,
      this.store.end[id]!,
    );
    const lines = (this.textOfLine[type] ??= []);
    // intern numbers new lines in order, so a new one is lines.length
    if (line === lines.length) lines.push(this.indexOf(eventText(type, f)));
    // lines holds an index into texts for every line id
    return lines[line]!;
  }

  /** The row's first line as the log states it, without its line ending. */
  logLine(id: number): string {
    return this.at(id).from(0, '|');
  }

  /**
   * Field `name` of the row's first line, or null when the line has none or it is empty. The
   * type's last listed field runs to the line's end, so a message that holds `|` stays whole.
   */
  field(id: number, name: string): string | null {
    const type = this.typeOf(id);
    const { at, last } = fieldPosition(type, name);
    const f = this.at(id);
    if (type === ASSIGNMENT && at >= VALUE) return this.assignmentField(f, at === VALUE);
    return (last ? f.from(at, '|') : f.at(at)) || null;
  }

  /** The level a `USER_DEBUG` line states; null for another type, or a level this parser does not know. */
  statedLevel(id: number): Level | null {
    if (this.typeOf(id) !== USER_DEBUG) return null;
    const level = this.at(id).at(USER_LEVEL);
    return isLevel(level) ? level : null;
  }

  /** A write's value runs to its trailing address, if any, so a value that holds `|` stays whole. */
  private assignmentField(f: ByteFields, value: boolean): string | null {
    const start = f.startOf(VALUE);
    if (start < 0) return null;
    const end = f.lineEnd;
    const pipe = addressPipe(this.source.bytes, start, end);
    if (value) return this.source.text(start, pipe < 0 ? end : pipe) || null;
    return pipe < 0 ? null : this.source.text(pipe + 1, end) || null;
  }

  /** The values the row's line states beyond its text, or the rows after it give; null for none. */
  details(id: number): AnyDetails | null {
    return eventDetails(
      this.typeOf(id),
      () => this.at(id),
      () => {
        // The platform writes a query's plan as a child line of the query.
        const plan = this.firstChildOf(id, EXPLAIN);
        return plan < 0 ? null : this.at(plan);
      },
      () => (this.outcomes ??= throwOutcomes(this.store, this.issues)).get(id) ?? null,
      () => this.flowTypeOf(id),
    );
  }

  private typeOf(id: number): number {
    // id is a row
    return this.store.type[id]!;
  }

  /** Points the cursor at the row's line and its continuation lines. */
  private at(id: number): ByteFields {
    // id is a row, so every column holds it
    this.fields.resetRow(this.store.start[id]!, this.store.end[id]!);
    return this.fields;
  }

  /** What started the interviews: the nearest code unit or interviews frame above them. */
  private flowTypeOf(id: number): FlowType | null {
    const { parent } = this.store;
    // Every parent is a row; row 0, the log, ends the walk.
    for (let up = parent[id]!; up > 0; up = parent[up]!) {
      const type = this.typeOf(up);
      if (type === INTERVIEWS) return 'flow';
      if (type === CODE_UNIT_STARTED) return flowTypeOfUnit(codeUnitType(this.at(up)));
    }
    return null;
  }

  private firstChildOf(id: number, type: number): number {
    const { subtreeEnd } = this.store;
    // Each child's subtree ends where its next sibling starts; every id here is a row.
    for (let child = id + 1; child < subtreeEnd[id]!; child = subtreeEnd[child]!) {
      if (this.typeOf(child) === type) return child;
    }
    return -1;
  }
}
