/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Source } from '../bytes/source.js';
import type { FoundVariable } from '../engine/variables.js';
import { VariableIndex } from '../engine/variables.js';
import type { Store } from '../store/store.js';
import { NONE } from '../store/store.js';
import type { FrameEvent, LogEvents } from './events.js';

/** One variable, as it stood at an event. */
export interface Variable {
  /** As the log names it. */
  readonly name: string;
  /** The type the log declared it as; null when it declared none. */
  readonly type: string | null;
  /** The value as the log wrote it; null when it wrote none, as for a variable declared and never written. */
  readonly value: string | null;
  /** The address of the object the value is; null when the log states none. */
  readonly address: string | null;
  /** The id of the event that wrote the value; null for a variable never written. */
  readonly id: number | null;
}

/** The statics of one class, which the log names before each static's own name. */
export interface StaticClass {
  readonly className: string;
  /** By name, without the class. */
  readonly variables: readonly Variable[];
}

/** The variables an event could see, as the log recorded them. */
export interface Variables {
  /**
   * The frame they belong to: the nearest frame at or above the event with a variable line of its
   * own by then, so a query answers from the Apex frame that issued it.
   */
  readonly frame: FrameEvent;
  /** The frame's own: its last write to each name, and each name it declared and never wrote. */
  readonly locals: readonly Variable[];
  /** The object the frame runs on, as its last write to `this` states it; null when it wrote none. */
  readonly this: Variable | null;
  /**
   * The fields of that object: the last write to each, by name without `this.`, from any frame on
   * the object, or a constructor that set them and returned. The log names no class hierarchy, so a
   * subclass's field can be listed in a superclass frame.
   */
  readonly fields: readonly Variable[];
  /** Every static written or declared anywhere by then, by class, as a static lives for the transaction. */
  readonly statics: readonly StaticClass[];
}

/** What the log holds for the object at one address, as it stood at an event. */
export interface ObjectState {
  /** The class of the object living there by then, as its own frame declared `this`; null when the log names none. */
  readonly className: string | null;
  /** The object's value as the last write by then that states it wrote it; null when none does. */
  readonly value: string | null;
  /** The id of the first event that states the value, when none does by then; else null. */
  readonly laterAt: number | null;
  /** The last write by then to each of its fields, by name without `this.`. */
  readonly fields: readonly Variable[];
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a: Variable, b: Variable): number => order(a.name, b.name);

/** A static, split at its last `.` into its class and its own name. */
interface StaticEntry {
  readonly className: string;
  readonly variable: Variable;
}

/** Each event's variables, read from one index of the log made on first read. */
export class LogVariables {
  private readonly events: LogEvents;
  private readonly store: Store;
  private readonly source: Source;
  // undefined until made; null for a log with no variable lines.
  private index: VariableIndex | null | undefined = undefined;
  private readonly read = new Map<number, Variables | null>();
  // By statics version: events between two static lines share one list.
  private readonly staticsRead = new Map<number, readonly StaticClass[]>();
  // A static's earliest declaration is fixed, so its write's row alone names the entry, and a new
  // version decodes only what changed. A static never written is named by its declaration's row.
  private readonly staticWritten = new Map<number, StaticEntry>();
  private readonly staticDeclared = new Map<number, StaticEntry>();
  // By write row, or by declaration row for a local never written, so events share each object and
  // each value is decoded once. A local's write pairs with no type before its declaration, so the
  // type is checked.
  private readonly localWritten = new Map<number, { type: number; variable: Variable }>();
  private readonly localDeclared = new Map<number, Variable>();
  private readonly fieldWritten = new Map<number, Variable>();

  constructor(events: LogEvents, store: Store, source: Source) {
    this.events = events;
    this.store = store;
    this.source = source;
  }

  /** The variables event `id` could see; null when it is in no frame or the log states none. */
  at(id: number): Variables | null {
    let held = this.read.get(id);
    if (held === undefined) {
      held = this.make(id);
      this.read.set(id, held);
    }
    return held;
  }

  /** The object at `address` as event `id` stood; null when the log holds nothing for it. */
  objectAt(id: number, address: string): ObjectState | null {
    const index = this.indexed();
    const found = index?.objectAt(id, address);
    if (!index || !found) return null;
    return Object.freeze({
      className: text(index, found.className),
      value: found.valueRow === NONE ? null : this.events.lines.field(found.valueRow, 'value'),
      laterAt: found.laterRow === NONE ? null : found.laterRow,
      fields: Object.freeze(found.fields.map((f) => this.field(index, f)).sort(byName)),
    });
  }

  private indexed(): VariableIndex | null {
    if (this.index === undefined) this.index = VariableIndex.of(this.store, this.source);
    return this.index;
  }

  private make(id: number): Variables | null {
    const index = this.indexed();
    const found = index?.at(id);
    if (!index || !found) return null;
    return Object.freeze({
      frame: this.events.event(found.frame) as FrameEvent,
      locals: Object.freeze(found.locals.map((v) => this.local(index, v)).sort(byName)),
      this: found.this && this.local(index, found.this),
      fields: Object.freeze(found.fields.map((f) => this.field(index, f)).sort(byName)),
      statics: this.statics(index, id, found.staticsVersion),
    });
  }

  private local(index: VariableIndex, found: FoundVariable): Variable {
    if (found.row === NONE) {
      let held = this.localDeclared.get(found.declaredAt);
      if (!held) {
        held = this.variable(index, found, index.strings.text(found.name));
        this.localDeclared.set(found.declaredAt, held);
      }
      return held;
    }
    const held = this.localWritten.get(found.row);
    if (held?.type === found.type) return held.variable;
    const variable = this.variable(index, found, index.strings.text(found.name));
    if (!held) this.localWritten.set(found.row, { type: found.type, variable });
    return variable;
  }

  /** A field is always written, and its write states no type. */
  private field(index: VariableIndex, found: FoundVariable): Variable {
    let held = this.fieldWritten.get(found.row);
    if (!held) {
      held = this.variable(index, found, index.strings.text(found.name).slice('this.'.length));
      this.fieldWritten.set(found.row, held);
    }
    return held;
  }

  private statics(index: VariableIndex, id: number, version: number): readonly StaticClass[] {
    let held = this.staticsRead.get(version);
    if (!held) {
      held = this.staticsAt(index, id);
      this.staticsRead.set(version, held);
    }
    return held;
  }

  private staticsAt(index: VariableIndex, id: number): readonly StaticClass[] {
    const byClass = new Map<string, Variable[]>();
    for (const found of index.statics(id)) {
      const written = found.row !== NONE;
      const memo = written ? this.staticWritten : this.staticDeclared;
      const key = written ? found.row : found.declaredAt;
      let entry = memo.get(key);
      if (!entry) {
        const name = index.strings.text(found.name);
        const dot = name.lastIndexOf('.');
        entry = {
          className: name.slice(0, Math.max(dot, 0)),
          variable: this.variable(index, found, name.slice(dot + 1)),
        };
        memo.set(key, entry);
      }
      const held = byClass.get(entry.className);
      if (held) held.push(entry.variable);
      else byClass.set(entry.className, [entry.variable]);
    }
    return Object.freeze(
      [...byClass]
        .sort(([a], [b]) => order(a, b))
        .map(([className, variables]) =>
          Object.freeze({ className, variables: Object.freeze(variables.sort(byName)) }),
        ),
    );
  }

  private variable(index: VariableIndex, found: FoundVariable, name: string): Variable {
    const { row } = found;
    return Object.freeze({
      name,
      type: text(index, found.type),
      value: row === NONE ? null : this.events.lines.field(row, 'value'),
      address: text(index, found.address),
      id: row === NONE ? null : row,
    });
  }
}

/** String `id`'s text, or null for `NONE`. */
function text(index: VariableIndex, id: number): string | null {
  return id === NONE ? null : index.strings.text(id);
}
