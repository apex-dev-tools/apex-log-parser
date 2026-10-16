/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { ByteFields } from '../bytes/cursor.js';
import type { Source } from '../bytes/source.js';
import {
  codeUnitType,
  EVENT_TYPES,
  eventText,
  fieldPosition,
  idOfType,
} from '../catalog/catalog.js';
import type { Issues } from '../engine/issues.js';
import { throwOutcomes } from '../engine/throws.js';
import type { Store } from '../store/store.js';
import type { AnyDetails, FlowType } from './details.js';
import { eventDetails, flowTypeOfUnit } from './details.js';

const INTERVIEWS = idOfType('FLOW_START_INTERVIEWS_BEGIN');
const INTERVIEW = idOfType('FLOW_START_INTERVIEW_BEGIN');
const CODE_UNIT_STARTED = idOfType('CODE_UNIT_STARTED');
const EXPLAIN = idOfType('SOQL_EXECUTE_EXPLAIN');

/**
 * Reads each row's line from the source, on demand: its text, raw line and fields. One cursor
 * serves every read, so each result is taken before the next read starts.
 */
export class EventLines {
  private readonly store: Store;
  private readonly issues: Issues;
  private readonly fields: ByteFields;
  /** Whether each decided throw was caught, by row; made on the first read of one. */
  private outcomes: Map<number, boolean> | null = null;

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
