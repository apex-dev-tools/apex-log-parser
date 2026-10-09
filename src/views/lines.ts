/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { ByteFields } from '../bytes/cursor.js';
import type { Source } from '../bytes/source.js';
import {
  codeUnitType,
  EVENT_TYPES,
  eventCpuType,
  eventText,
  fieldPosition,
  GRAMMAR,
  idOfType,
} from '../catalog/catalog.js';
import type { CpuType, Fields } from '../catalog/types.js';
import type { Issues } from '../engine/issues.js';
import { caughtOf, throwOutcomes } from '../engine/throws.js';
import type { Store } from '../store/store.js';
import type { AnyDetails, RowReads } from './details.js';
import { eventDetails } from './details.js';

const CODE_UNIT_STARTED = idOfType('CODE_UNIT_STARTED');
const INTERVIEWS = idOfType('FLOW_START_INTERVIEWS_BEGIN');
const INTERVIEW = idOfType('FLOW_START_INTERVIEW_BEGIN');
const EXPLAIN = idOfType('SOQL_EXECUTE_EXPLAIN');

/**
 * Reads each row's line from the source, on demand: its text, raw line, fields, suffix and
 * cpuType. One cursor serves every read, so each result is taken before the next read starts.
 */
export class EventLines implements RowReads {
  private readonly store: Store;
  private readonly issues: Issues;
  private readonly fields: ByteFields;
  /** Each throw's outcome, made on the first `caughtOf`. */
  private outcomes: Int8Array | null = null;

  constructor(store: Store, source: Source, issues: Issues) {
    this.store = store;
    this.issues = issues;
    this.fields = new ByteFields(source);
  }

  /** The row's text, as its type's rule reads it; null when it states none. */
  text(id: number): string | null {
    const type = this.typeOf(id);
    // A flow interviews frame is named by its first interview.
    if (type === INTERVIEWS) {
      const interview = this.firstChildOf(id, INTERVIEW);
      return interview < 0 ? null : this.text(interview);
    }
    return eventText(type, this.at(id));
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
    if (at < 0)
      throw new RangeError(`${EVENT_TYPES[type]?.type ?? 'The log'} has no field ${name}`);
    const f = this.at(id);
    return (last ? f.from(at, '|') : f.at(at)) || null;
  }

  /** The type's suffix; for flow interviews, what started them. Null when there is none. */
  suffix(id: number): string | null {
    const type = this.typeOf(id);
    return type === INTERVIEWS ? this.flowSuffix(id) : (GRAMMAR[type]?.suffix ?? null);
  }

  /** The type's cpuType, or the line's for a type whose events differ. */
  cpuType(id: number): CpuType | null {
    return eventCpuType(this.typeOf(id), () => this.at(id));
  }

  /** What the row's line states beyond its text, or derives from the rows after; null if none. */
  details(id: number): AnyDetails | null {
    return eventDetails(this.typeOf(id), id, () => this.at(id), this);
  }

  explainOf(id: number): Fields | null {
    // The platform writes a query's plan as a child line of the query.
    const plan = this.firstChildOf(id, EXPLAIN);
    return plan < 0 ? null : this.at(plan);
  }

  caughtOf(id: number): boolean | null {
    this.outcomes ??= throwOutcomes(this.store, this.issues);
    return caughtOf(this.outcomes, id);
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

  private firstChildOf(id: number, type: number): number {
    const { subtreeEnd } = this.store;
    // Each child's subtree ends where its next sibling starts; every id here is a row.
    for (let child = id + 1; child < subtreeEnd[id]!; child = subtreeEnd[child]!) {
      if (this.typeOf(child) === type) return child;
    }
    return -1;
  }

  /** What started the interviews: the nearest code unit or interviews frame above it. */
  private flowSuffix(id: number): string | null {
    const { parent } = this.store;
    // Every parent is a row; row 0, the log, ends the walk.
    for (let up = parent[id]!; up > 0; up = parent[up]!) {
      const type = this.typeOf(up);
      if (type === INTERVIEWS) return ' (Flow)';
      if (type === CODE_UNIT_STARTED)
        return codeUnitType(this.at(up)) === 'Flow' ? ' (Flow)' : ' (Process Builder)';
    }
    return null;
  }
}
