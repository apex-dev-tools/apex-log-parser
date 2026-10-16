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

/** Each event's variables, read from one index of the log made on first read. */
export class LogVariables {
  private readonly events: LogEvents;
  private readonly store: Store;
  private readonly source: Source;
  // undefined until made; null for a log with no variable lines.
  private index: VariableIndex | null | undefined = undefined;
  private readonly read = new Map<number, Variables | null>();

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
    const at = index ? index.addressOf(address) : NONE;
    const found = index && at !== NONE ? index.objectAt(at, index.cutOf(id)) : null;
    if (!index || !found) return null;
    const row = found.write === NONE ? NONE : index.writeRow(found.write);
    return Object.freeze({
      className: found.className === NONE ? null : index.strings.text(found.className),
      value: row === NONE ? null : this.events.lines.field(row, 'value'),
      laterAt: found.laterAt === NONE ? null : found.laterAt,
      fields: Object.freeze(found.fields.map((f) => this.field(index, f)).sort(byName)),
    });
  }

  private indexed(): VariableIndex | null {
    if (this.index === undefined) this.index = VariableIndex.of(this.store, this.source);
    return this.index;
  }

  private make(id: number): Variables | null {
    const index = this.indexed();
    if (!index) return null;
    const cut = index.cutOf(id);
    const frame = index.recordingFrame(id, cut);
    if (frame === NONE) return null;
    const scope = index.scope(frame, cut);
    const locals = scope.locals.map((found) => this.variable(index, found));
    const fields = index
      .objectFields(index.innermostFrame(id), frame, cut)
      .map((found) => this.field(index, found));
    return Object.freeze({
      frame: this.events.event(frame) as FrameEvent,
      locals: Object.freeze(locals.sort(byName)),
      this: scope.this && this.variable(index, scope.this),
      fields: Object.freeze(fields.sort(byName)),
      statics: this.statics(index, cut),
    });
  }

  private field(index: VariableIndex, found: FoundVariable): Variable {
    const { name, ...rest } = this.variable(index, found);
    // A field line's address is the object the field belongs to, so only an address value counts.
    const address = index.valueAddress(found.write);
    return Object.freeze({
      name: name.slice(name.indexOf('.') + 1),
      ...rest,
      address: address === NONE ? null : index.strings.text(address),
    });
  }

  private statics(index: VariableIndex, cut: number): readonly StaticClass[] {
    const byClass = new Map<string, Variable[]>();
    for (const found of index.statics(cut)) {
      const { name, ...rest } = this.variable(index, found);
      const dot = name.lastIndexOf('.');
      const className = name.slice(0, Math.max(dot, 0));
      const variable = Object.freeze({ name: name.slice(dot + 1), ...rest });
      const held = byClass.get(className);
      if (held) held.push(variable);
      else byClass.set(className, [variable]);
    }
    return Object.freeze(
      [...byClass]
        .sort(([a], [b]) => order(a, b))
        .map(([className, variables]) =>
          Object.freeze({ className, variables: Object.freeze(variables.sort(byName)) }),
        ),
    );
  }

  private variable(index: VariableIndex, { name, write, declaration }: FoundVariable): Variable {
    const type = declaration === NONE ? NONE : index.declarationType(declaration);
    const address = write === NONE ? NONE : index.writeAddress(write);
    const row = write === NONE ? NONE : index.writeRow(write);
    return Object.freeze({
      name: index.strings.text(name),
      type: type === NONE ? null : index.strings.text(type),
      value: row === NONE ? null : this.events.lines.field(row, 'value'),
      address: address === NONE ? null : index.strings.text(address),
      id: row === NONE ? null : row,
    });
  }
}
