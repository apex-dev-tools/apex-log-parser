/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Hook, RowsOf } from '../catalog/catalog.js';
import { EVENT_TYPES, GRAMMAR, idOfType } from '../catalog/catalog.js';
import { EVENT_TYPE_NAMES } from '../catalog/types.js';
import type { Store } from '../store/store.js';
import { COUNTER } from '../store/store.js';
import { RULE } from './namespaces.js';

// The catalog's rules as one number per type id, so the scan reads a byte, not an object.

/** Per-event bits in `Store.flags`. */
export const FLAG = {
  /** The log does not close this frame. */
  truncated: 1,
  /** A frame type that this event's line made a leaf, as a VF call with no method. */
  notEntry: 2,
} as const;

/** The type id of the log itself, row 0. One past the event types. */
export const LOG_TYPE: number = EVENT_TYPE_NAMES.length;
/** The number of event types, and the stride of `CLOSES`. */
export const TYPES: number = EVENT_TYPE_NAMES.length;

/** The hooks the engine runs when the next event is read. 0: the hook runs elsewhere. */
export const HOOK_ID: { readonly [H in Hook]: number } = {
  limitSnapshot: 1,
  limitException: 2,
  fatal: 3,
  // The flow residual pass reads these.
  flowTotal: 0,
  // readEvent decides the leaf.
  vfApexCall: 0,
};

const ROWS_OF: { readonly [R in RowsOf]: number } = {
  soql: COUNTER.soqlRows,
  sosl: COUNTER.soslRows,
  dml: COUNTER.dmlRows,
};

/** 1 for a frame-shaped type. A row of one is a leaf when its flags hold `notEntry`. */
export const IS_FRAME: Uint8Array = new Uint8Array(TYPES);
/** An exit line, or a frame the next line closes, which is also an exit for the frame before it. */
export const IS_EXIT: Uint8Array = new Uint8Array(TYPES);
/** An exit-shaped line. No such type closes anything, so it never opens a frame. */
export const EXIT_LINE: Uint8Array = new Uint8Array(TYPES);
/** A frame the next line closes. */
export const NEXT_LINE_EXITS: Uint8Array = new Uint8Array(TYPES);
/** A frame an exit line or the next line closes: one that goes on the open-frame stack. */
export const HAS_EXITS: Uint8Array = new Uint8Array(TYPES);
export const ACCEPTS_TEXT: Uint8Array = new Uint8Array(TYPES);
export const DISCONTINUITY: Uint8Array = new Uint8Array(TYPES);
/** The position of the `line` field, or -1. */
export const LINE_FIELD: Int8Array = new Int8Array(TYPES);
/** A `RULE` id, or 0 when the type states no namespace and takes its frame's. */
export const NAMESPACE_RULE: Uint8Array = new Uint8Array(TYPES);
export const NAMESPACE_POSITIONS: (readonly number[])[] = [];
/** A frame that takes the namespace its exit line states, as a method entry does. */
export const TAKES_EXIT_NAMESPACE: Uint8Array = new Uint8Array(TYPES);
/** A `HOOK_ID`, or 0. */
export const HOOK: Uint8Array = new Uint8Array(TYPES);
/** The `COUNTER` an event adds one to; -1 for none. */
export const COUNT_AT: Int8Array = new Int8Array(TYPES).fill(-1);
/** The `COUNTER` the rows the line states add to; -1 for none. */
export const ROWS_AT: Int8Array = new Int8Array(TYPES).fill(-1);
export const ROWS_FIELD: Int8Array = new Int8Array(TYPES);
/** The row counter a frame takes from its exit line, as SOQL and SOSL do; -1 for none. */
export const ROWS_FROM_EXIT: Int8Array = new Int8Array(TYPES).fill(-1);
export const HEAP_FIELD: Int8Array = new Int8Array(TYPES);
export const HEAP_SIGN: Int8Array = new Int8Array(TYPES);
/** The position of a flow running total's field, or -1. */
export const FLOW_TOTAL_FIELD: Int8Array = new Int8Array(TYPES).fill(-1);
/** `CLOSES[frame * TYPES + exit]` is 1 when an `exit` line closes a `frame`. */
export const CLOSES: Uint8Array = new Uint8Array(TYPES * TYPES);
/** The flow elements the residual pass credits. */
export const FLOW_ELEMENT: Uint8Array = new Uint8Array(TYPES);

for (const info of EVENT_TYPES) {
  const t = info.typeId;
  // t is a type id, so it indexes GRAMMAR
  const g = GRAMMAR[t]!;
  IS_FRAME[t] = info.shape === 'frame' ? 1 : 0;
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
  if (g.count) COUNT_AT[t] = COUNTER[g.count];
  if (g.rowsOf) ROWS_AT[t] = ROWS_OF[g.rowsOf];
  ROWS_FIELD[t] = g.rowsField;
  if (info.shape === 'frame' && !g.rowsOf && (g.count === 'soql' || g.count === 'sosl')) {
    ROWS_FROM_EXIT[t] = ROWS_OF[g.count];
  }
  HEAP_FIELD[t] = g.heapField;
  HEAP_SIGN[t] = g.heapSign;
  if (g.hook === 'flowTotal') FLOW_TOTAL_FIELD[t] = g.hookFields[0] ?? -1;
  for (const exit of info.exitTypes) CLOSES[t * TYPES + idOfType(exit)] = 1;
  if (g.closes === 'next-line') CLOSES[t * TYPES + t] = 1;
}
FLOW_ELEMENT[idOfType('FLOW_ELEMENT_BEGIN')] = 1;
FLOW_ELEMENT[idOfType('FLOW_BULK_ELEMENT_BEGIN')] = 1;

/**
 * The row goes on the open-frame stack: an exit line or the next line closes its type, and its
 * line did not make it a leaf. A frame the next event closes, as a package entry, does not.
 */
export function opensFrame(store: Store, id: number): boolean {
  // id is a row, so every column holds it
  return HAS_EXITS[store.type[id]!] === 1 && !(store.flags[id]! & FLAG.notEntry);
}

/**
 * The row is a frame to a caller: its type is frame-shaped, and its line did not make it a leaf.
 * Unlike `opensFrame`, it holds for a frame the next event closes, as a package entry.
 */
export function isFrameRow(store: Store, id: number): boolean {
  // id is a row, so every column holds it
  return IS_FRAME[store.type[id]!] === 1 && !(store.flags[id]! & FLAG.notEntry);
}
