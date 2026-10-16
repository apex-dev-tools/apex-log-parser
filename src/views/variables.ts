/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Source } from '../bytes/source.js';
import type { FoundStaticClass, FoundVariable } from '../engine/variables.js';
import { VariableIndex } from '../engine/variables.js';
import type { Store } from '../store/store.js';
import { NONE } from '../store/store.js';
import type { EventOf, FrameEvent, LogEvents } from './events.js';

type Write = EventOf<'VARIABLE_ASSIGNMENT'>;

/** One variable, as it stood at an event. */
export interface Variable {
  /** As the log names it. */
  readonly name: string;
  /** The type the log declared it as; null when it declared none. */
  readonly type: string | null;
  /** The value as the log wrote it; null when it wrote none, as for a variable never written. */
  readonly value: string | null;
  /** The address of the object the value is; null when the log states none. */
  readonly address: string | null;
  /** The write that set the value; null for a variable never written. */
  readonly write: EventOf<'VARIABLE_ASSIGNMENT'> | null;
}

/** The statics of one class, which the log names before each static's own name. */
export interface StaticClass {
  /** As the log names it, with its namespace, as `ns.MyClass`; null when the name has no class. */
  readonly className: string | null;
  /** By name, without the class. */
  readonly variables: readonly Variable[];
}

/** The variables an event could see, as the log recorded them. */
export interface Variables {
  /**
   * The frame they belong to: the nearest frame at or above the event with a variable line of its
   * own by then, so a query answers from the Apex frame that issued it. The frame the event is in
   * when no frame has one.
   */
  readonly frame: FrameEvent;
  /** The frame's own: its last write to each name, and each name it declared and never wrote. */
  readonly locals: readonly Variable[];
  /** The object the frame runs on, as its last write to `this` states it; null for none. */
  readonly this: Variable | null;
  /**
   * The fields of that object: the last write to each, by name without `this.`, from any frame on
   * the object, or a constructor that set them and returned. The log names no class hierarchy, so a
   * subclass's field can be listed in a superclass frame. By name.
   */
  readonly fields: readonly Variable[];
  /**
   * Every static written or declared anywhere by then, as a static lives for the transaction. By
   * class name.
   */
  readonly statics: readonly StaticClass[];
}

/** What the log holds for the object at one address, as it stood at an event. */
export interface ObjectState {
  /**
   * The class of the object living there by then, as its own frame declared `this`; null when the
   * log names none.
   */
  readonly className: string | null;
  /** The value from the last write by then that states it. Null when no write does. */
  readonly value: string | null;
  /** The first write after the event that states the value, when none does by then; else null. */
  readonly laterWrite: EventOf<'VARIABLE_ASSIGNMENT'> | null;
  /** The last write by then to each of its fields, without `this.`. By name. */
  readonly fields: readonly Variable[];
}

const order = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const byName = (a: Variable, b: Variable): number => order(a.name, b.name);
const whole = (name: string): string => name;
const fieldName = (name: string): string => name.slice('this.'.length);
const staticName = (name: string): string => name.slice(name.lastIndexOf('.') + 1);

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
  // By class key, then the class's version, so a new version rebuilds only the class that changed.
  private readonly classRead = new Map<number, Map<number, StaticClass>>();
  // By its write's row and its declaration's row, which together fix every value it holds.
  private readonly shares = new Map<number, Variable>();

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
      laterWrite: this.write(found.laterRow),
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
    return this.shared(index, found, whole);
  }

  private field(index: VariableIndex, found: FoundVariable): Variable {
    return this.shared(index, found, fieldName);
  }

  /** The one `Variable` for `found`'s line, named by `short` of the name the log writes. */
  private shared(
    index: VariableIndex,
    found: FoundVariable,
    short: (name: string) => string,
  ): Variable {
    // Rows are below the store's count, so the pair fits in one safe integer.
    const key = (found.row + 1) * (this.store.count + 1) + found.declaredAt + 1;
    let held = this.shares.get(key);
    if (!held) {
      held = this.variable(index, found, short(index.strings.text(found.name)));
      this.shares.set(key, held);
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
    const classes = index.staticClasses(id).map((c) => this.staticClass(index, id, c));
    return Object.freeze(classes.sort((a, b) => order(a.className ?? '', b.className ?? '')));
  }

  private staticClass(index: VariableIndex, id: number, found: FoundStaticClass): StaticClass {
    let byVersion = this.classRead.get(found.key);
    if (!byVersion) {
      byVersion = new Map();
      this.classRead.set(found.key, byVersion);
    }
    let held = byVersion.get(found.version);
    if (!held) {
      const variables = index.staticsOf(found.key, id).map((v) => this.static(index, v));
      held = Object.freeze({
        className: text(index, found.className),
        variables: Object.freeze(variables.sort(byName)),
      });
      byVersion.set(found.version, held);
    }
    return held;
  }

  private static(index: VariableIndex, found: FoundVariable): Variable {
    return this.shared(index, found, staticName);
  }

  private variable(index: VariableIndex, found: FoundVariable, name: string): Variable {
    const { row } = found;
    return Object.freeze({
      name,
      type: text(index, found.type),
      value: row === NONE ? null : this.events.lines.field(row, 'value'),
      address: text(index, found.address),
      write: this.write(row),
    });
  }

  private write(row: number): Write | null {
    // A write's row is a VARIABLE_ASSIGNMENT event
    return row === NONE ? null : (this.events.event(row) as Write);
  }
}

/** String `id`'s text, or null for `NONE`. */
function text(index: VariableIndex, id: number): string | null {
  return id === NONE ? null : index.strings.text(id);
}
