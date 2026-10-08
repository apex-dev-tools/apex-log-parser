/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ParseOptions } from './api/parse.js';
import { parseWith } from './api/parse.js';
import type { LogSource } from './api/sources.js';
import { NodeSource } from './bytes/node.js';
import type { LogEngine } from './engine/engine.js';
import { SourceEngine } from './engine/engine.js';
import type { ApexLog } from './views/log.js';

declare const setImmediate: (callback: () => void) => unknown;

/** The node build's engine. */
export const nodeEngine: LogEngine = new SourceEngine((bytes) => new NodeSource(bytes));

// setImmediate runs after pending I/O, so a parse never starves the event loop.
const yieldToHost = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Parses one Apex debug log. It works in time slices and yields between them, so the event loop
 * stays responsive; `options.signal` stops it, and `options.onProgress` reports how far it is.
 */
export function parse(source: LogSource, options?: ParseOptions): Promise<ApexLog> {
  return parseWith(nodeEngine, yieldToHost, source, options);
}
