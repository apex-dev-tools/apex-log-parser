/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEngine } from '../engine/engine.js';
import type { ApexLog } from '../views/log.js';
import { apexLog } from '../views/log.js';
import type { LogAbortSignal, LogSource, ParseProgress, ReadContext } from './sources.js';
import { readBytes } from './sources.js';

declare const performance: { now(): number };

/** How a parse runs. */
export interface ParseOptions {
  /** Stops the parse: it rejects with the signal's reason, within one time slice. */
  readonly signal?: LogAbortSignal;
  /** Called at most once per time slice, and once as each phase ends. */
  readonly onProgress?: (progress: ParseProgress) => void;
}

/** Milliseconds of work between yields, so the host stays responsive. */
const SLICE_MS = 5;

declare const DOMException: (new (message: string, name: string) => Error) | undefined;

/** The signal's reason; a signal with none, as before Node 17.2, gives the platform's AbortError. */
function reasonOf(signal: LogAbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const message = 'This operation was aborted';
  return typeof DOMException === 'function'
    ? new DOMException(message, 'AbortError')
    : Object.assign(new Error(message), { name: 'AbortError' });
}

/** Gives the host its turn: each build's own way, as `setImmediate` or `scheduler.yield`. */
export type Yield = () => Promise<void>;

/** The driver both builds share: read the source, scan it in time slices, then finish. */
export async function parseWith(
  engine: LogEngine,
  yieldToHost: Yield,
  source: LogSource,
  options: ParseOptions = {},
): Promise<ApexLog> {
  const { signal, onProgress } = options;
  const check = (): void => {
    if (signal?.aborted) throw reasonOf(signal);
  };
  check();
  const race = <T>(promise: Promise<T>): Promise<T> => {
    if (!signal) return promise;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(reasonOf(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  };
  let deadline = performance.now() + SLICE_MS;
  let reported = Number.NEGATIVE_INFINITY;
  const report = (progress: ParseProgress, always = false): void => {
    if (!onProgress) return;
    const now = performance.now();
    if (!always && now - reported < SLICE_MS) return;
    reported = now;
    onProgress(progress);
  };
  const pause = async (): Promise<void> => {
    if (performance.now() < deadline) return;
    await yieldToHost();
    check();
    deadline = performance.now() + SLICE_MS;
  };
  const cx: ReadContext = {
    check,
    race,
    progress: (bytes, totalBytes) => report({ phase: 'read', bytes, totalBytes }),
    pause,
  };

  const bytes = await readBytes(source, cx);
  const total = bytes.length;
  report({ phase: 'read', bytes: total, totalBytes: total }, true);
  check();

  const builder = engine.builder(bytes);
  while (!builder.scan(deadline)) {
    report({ phase: 'scan', bytes: builder.scanned, totalBytes: total });
    await pause();
  }
  report({ phase: 'scan', bytes: total, totalBytes: total }, true);
  // finish runs in one block, so it starts a task of its own rather than the end of a full slice.
  await yieldToHost();
  check();

  const log = apexLog(builder.finish());
  report({ phase: 'finish', bytes: total, totalBytes: total }, true);
  return log;
}
