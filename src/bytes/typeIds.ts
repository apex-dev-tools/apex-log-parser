/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { EventType } from '../catalog/types.js';
import { EVENT_TYPE_NAMES } from '../catalog/types.js';
import type { Source } from './source.js';
import { wordsOf } from './words.js';

// At least twice the number of names, so a probe ends after a few slots.
const SLOT_BITS = 10;
const SLOTS = 1 << SLOT_BITS;
const MASK = SLOTS - 1;

/** Every name's bytes, end to end; name `id` is `pool[offsets[id]]` to `pool[offsets[id + 1]]`. */
const offsets = new Int32Array(EVENT_TYPE_NAMES.length + 1);
const pool = new Uint8Array(EVENT_TYPE_NAMES.reduce((n, name) => n + name.length, 0));
/** The type id in each slot, or -1 for an empty slot. */
const slots = new Int16Array(SLOTS).fill(-1);

/**
 * The first slot to probe for the name in bytes `start` to `end`. The key is the length and the
 * first, middle and last bytes, not every byte: names with the same key cost a further probe.
 */
const slotOf = (bytes: Uint8Array, start: number, end: number): number => {
  const len = end - start;
  // No name is empty, and typeIdAt passes none, so the three reads are inside the name.
  const key =
    len | (bytes[start]! << 8) | (bytes[start + (len >> 1)]! << 16) | (bytes[end - 1]! << 24);
  // Fibonacci hashing: the top bits of the product mix every key bit; the low bits do not.
  return Math.imul(key, 0x9e3779b1) >>> (32 - SLOT_BITS);
};

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

const SHORTEST = Math.min(...EVENT_TYPE_NAMES.map((name) => name.length));
if (SHORTEST < 4) throw new Error('typeIds: spells reads 4 bytes, so no name may be shorter');
const poolWords = wordsOf(pool);

/** `len` bytes of `words` from `start` spell the pool's bytes from `at`, compared 4 at a time. */
function spells(words: DataView, start: number, at: number, len: number): boolean {
  // The last word overlaps the one before it, so no byte is compared alone; len is at least 4.
  const last = len - 4;
  for (let k = 0; k < last; k += 4) {
    if (poolWords.getInt32(at + k, true) !== words.getInt32(start + k, true)) return false;
  }
  return poolWords.getInt32(at + last, true) === words.getInt32(start + last, true);
}

/** The type id of the event type named by bytes `start` to `end`, or -1 when no type has the name. */
export function typeIdAt(source: Source, start: number, end: number): number {
  const len = end - start;
  // No name is shorter or past the longest, so len then indexes firstByLength.
  if (len < SHORTEST || len >= firstByLength.length) return -1;
  const words = source.words;
  const first = firstByLength[len]!;
  // first is a type id, so it indexes offsets
  if (first >= 0 && spells(words, start, offsets[first]!, len)) return first;
  for (let slot = slotOf(source.bytes, start, end); ; slot = (slot + 1) & MASK) {
    // slot is masked to the table
    const id = slots[slot]!;
    if (id === -1) return -1;
    // id is a type id, so id + 1 indexes offsets
    const at = offsets[id]!;
    if (offsets[id + 1]! - at === len && spells(words, start, at, len)) return id;
  }
}
