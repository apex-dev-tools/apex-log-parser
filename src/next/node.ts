/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogBuffers } from './api/buffers.js';
import { logFromBuffers } from './api/buffers.js';
import type { ParseOptions } from './api/parse.js';
import { parseWith } from './api/parse.js';
import type { LogSource } from './api/sources.js';
import { nodeEngine } from './engine/node.js';
import type { ApexLog } from './views/log.js';

export * from './api/surface.js';

declare const setImmediate: (callback: () => void) => unknown;

// setImmediate runs after pending I/O, so a parse never starves the event loop.
const yieldToHost = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * Parses one Apex debug log. It works in time slices and yields between them, so the event loop
 * stays responsive; `options.signal` stops it, and `options.onProgress` reports how far it is.
 */
export function parse(source: LogSource, options?: ParseOptions): Promise<ApexLog> {
  return parseWith(nodeEngine, yieldToHost, source, options);
}

/**
 * The log `buffers` hold, from `toBuffers` in the same version of this package, as on another
 * thread. It copies nothing. Throws a TypeError for buffers of the wrong shape; it trusts the
 * values, as `toBuffers` made them.
 */
export function fromBuffers(buffers: LogBuffers): ApexLog {
  return logFromBuffers(nodeEngine, buffers);
}
