/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

export type Column = Uint8Array | Uint16Array | Int32Array | Float64Array;

/**
 * `column` at `size` elements: a copy that keeps its values when it grows, and a view when it
 * shrinks by little, so a trim does not copy a column that is nearly full.
 */
export function resized<T extends Column>(column: T, size: number): T {
  if (size <= column.length && size * 9 >= column.length * 8) return column.subarray(0, size) as T;
  const out = new (column.constructor as new (size: number) => T)(size);
  out.set(size < column.length ? column.subarray(0, size) : column);
  return out;
}
