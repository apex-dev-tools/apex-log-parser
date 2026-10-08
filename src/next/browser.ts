/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ParseOptions } from './api/parse.js';
import { parseWith } from './api/parse.js';
import type { LogSource } from './api/sources.js';
import { BrowserSource } from './bytes/browser.js';
import type { LogEngine } from './engine/engine.js';
import { SourceEngine } from './engine/engine.js';
import type { ApexLog } from './views/log.js';

interface Port {
  onmessage: (() => void) | null;
  postMessage(message: null): void;
  close(): void;
}
declare const MessageChannel: new () => { port1: Port; port2: Port };
declare const scheduler: { yield?: () => Promise<void> } | undefined;

/** The browser build's engine. */
export const browserEngine: LogEngine = new SourceEngine((bytes) => new BrowserSource(bytes));

/**
 * `scheduler.yield` resumes ahead of other queued tasks, where the browser has it (not Safari). A
 * message is the fallback: a timeout of 0 is clamped to 4 ms after a few nested calls.
 */
function yieldToHost(): Promise<void> {
  if (typeof scheduler !== 'undefined' && scheduler.yield) return scheduler.yield();
  return new Promise((resolve) => {
    const { port1, port2 } = new MessageChannel();
    port1.onmessage = () => {
      port1.close();
      port2.close();
      resolve();
    };
    port2.postMessage(null);
  });
}

/**
 * Parses one Apex debug log. It works in time slices and yields between them, so the page stays
 * responsive; `options.signal` stops it, and `options.onProgress` reports how far it is.
 */
export function parse(source: LogSource, options?: ParseOptions): Promise<ApexLog> {
  return parseWith(browserEngine, yieldToHost, source, options);
}
