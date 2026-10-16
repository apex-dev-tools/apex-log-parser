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

/** The variables an event could see, as the log recorded them. */
export interface Variables {
  /**
   * The frame they belong to: the nearest frame at or above the event with a variable line of its
   * own by then, so a query answers from the Apex frame that issued it.
   */
  readonly frame: FrameEvent;
  /** The frame's own: its last write to each name, and each name it declared and never wrote. */
  readonly locals: readonly Variable[];
}

const byName = (a: Variable, b: Variable): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

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

  private make(id: number): Variables | null {
    if (this.index === undefined) this.index = VariableIndex.of(this.store, this.source);
    const index = this.index;
    if (!index) return null;
    const cut = index.cutOf(id);
    const frame = index.recordingFrame(id, cut);
    if (frame === NONE) return null;
    const locals = index.locals(frame, cut).map((found) => this.variable(index, found));
    return Object.freeze({
      frame: this.events.event(frame) as FrameEvent,
      locals: Object.freeze(locals.sort(byName)),
    });
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
