/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
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

/** The type id of the event type named by bytes `start` to `end`, or -1 when no type has the name. */
export function typeIdAt(bytes: Uint8Array, start: number, end: number): number {
  const len = end - start;
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
