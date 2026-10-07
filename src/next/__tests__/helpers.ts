/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Fields } from '../catalog/types.js';

/** `Fields` over a line of text and its continuation lines, or a function that gives them. */
export function fieldsOf(line: string, continuation: string | (() => string) = ''): Fields {
  const parts = line.split('|');
  return {
    count: parts.length,
    continuation: typeof continuation === 'function' ? continuation : () => continuation,
    at: (i) => parts[i] ?? '',
    from: (i, separator) => parts.slice(i).join(separator),
  };
}
