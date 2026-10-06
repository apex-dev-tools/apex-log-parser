/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Fields } from '../catalog/types.js';

/** `Fields` over a line of text, for tests. `rest` is the continuation lines, each after a `\n`. */
export function fieldsOf(line: string, rest = ''): Fields {
  const parts = line.split('|');
  return {
    count: parts.length,
    rest,
    at: (i) => parts[i] ?? '',
    from: (i, separator) => parts.slice(i).join(separator),
  };
}
