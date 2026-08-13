/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '../index.js';

/** Depth-first flatten of the parsed tree into a flat event list. */
export function flatten(root: LogEvent): LogEvent[] {
  const out: LogEvent[] = [];
  const walk = (event: LogEvent): void => {
    out.push(event);
    for (const child of event.children ?? []) {
      walk(child);
    }
  };
  for (const child of root.children ?? []) {
    walk(child);
  }
  return out;
}
