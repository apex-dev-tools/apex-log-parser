/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { EventType } from '../catalog/types.js';
import { EVENT_TYPE_NAMES } from '../catalog/types.js';
import { hashBytes } from './hash.js';

// A power of two, at least twice the number of names, so a probe ends after a few slots.
const SLOTS = 1024;
const MASK = SLOTS - 1;

/** Every name's bytes, end to end; name `id` is `pool[offsets[id]]` to `pool[offsets[id + 1]]`. */
const offsets = new Int32Array(EVENT_TYPE_NAMES.length + 1);
const pool = new Uint8Array(EVENT_TYPE_NAMES.reduce((n, name) => n + name.length, 0));
/** The type id in each slot, or -1 for an empty slot. */
const slots = new Int16Array(SLOTS).fill(-1);

/** The first slot to probe for the name in bytes `start` to `end`. */
const slotOf = (bytes: Uint8Array, start: number, end: number): number =>
  hashBytes(bytes, start, end) & MASK;

if (EVENT_TYPE_NAMES.length * 2 > SLOTS) throw new Error('typeIds: too many event types for SLOTS');
for (const [id, name] of EVENT_TYPE_NAMES.entries()) {
  // ids run in order, so offsets[id] is already set
  const at = offsets[id]!;
  for (let k = 0; k < name.length; k++) {
    const c = name.charCodeAt(k);
    if (c > 0x7f) throw new Error(`typeIds: ${name} is not ASCII`);
    pool[at + k] = c;
  }
  offsets[id + 1] = at + name.length;
  let slot = slotOf(pool, at, at + name.length);
  while (slots[slot] !== -1) slot = (slot + 1) & MASK;
  slots[slot] = id;
}

// The most frequent type of each name length in real logs, 90% of lines: skips the hash.
const FREQUENT = [
  'METHOD_ENTRY',
  'METHOD_EXIT',
  'STATEMENT_EXECUTE',
  'HEAP_ALLOCATE',
  'ENTERING_MANAGED_PKG',
  'VARIABLE_ASSIGNMENT',
  'CONSTRUCTOR_EXIT',
] as const satisfies readonly EventType[];

/** Per name length, the type id to compare first, or -1. */
const firstByLength = new Int16Array(
  Math.max(...EVENT_TYPE_NAMES.map((name) => name.length)) + 1,
).fill(-1);
for (const name of FREQUENT) {
  const held = firstByLength[name.length]!;
  if (held !== -1) throw new Error(`typeIds: ${name} has the length of ${EVENT_TYPE_NAMES[held]}`);
  firstByLength[name.length] = EVENT_TYPE_NAMES.indexOf(name);
}

/** The type id of the event type named by bytes `start` to `end`, or -1 when no type has the name. */
export function typeIdAt(bytes: Uint8Array, start: number, end: number): number {
  const len = end - start;
  const first = len < firstByLength.length ? firstByLength[len]! : -1;
  if (first >= 0) {
    // first is a type id, so it indexes offsets
    const at = offsets[first]!;
    let k = 0;
    while (k < len && pool[at + k] === bytes[start + k]) k++;
    if (k === len) return first;
  }
  for (let slot = slotOf(bytes, start, end); ; slot = (slot + 1) & MASK) {
    // slot is masked to the table
    const id = slots[slot]!;
    if (id === -1) return -1;
    // id is a type id, so id + 1 indexes offsets
    const at = offsets[id]!;
    if (offsets[id + 1]! - at !== len) continue;
    let k = 0;
    while (k < len && pool[at + k] === bytes[start + k]) k++;
    if (k === len) return id;
  }
}
