/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** A 32-bit hash of bytes `start` to `end`, mixed so its low bits suit a power-of-two table. */
export function hashBytes(bytes: Uint8Array, start: number, end: number): number {
  let h = 0;
  for (let i = start; i < end; i++) {
    // i < end, which is inside the caller's view
    h = (Math.imul(h, 31) + bytes[i]!) | 0;
  }
  return h ^ (h >>> 15);
}
