/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEngine } from '../engine/engine.js';
import type { ApexLog } from '../views/log.js';
import { apexLog } from '../views/log.js';
import type { LogAbortSignal, LogSource, ParseProgress, ReadContext } from './sources.js';
import { readBytes } from './sources.js';
import type { LogWorker } from './worker.js';

declare const performance: { now(): number };

/** How a parse runs. */
export interface ParseOptions {
  /** Stops the parse: it rejects with the signal's reason, within one time slice. */
  readonly signal?: LogAbortSignal;
  /** Called at most once per time slice, and once as each phase ends. */
  readonly onProgress?: (progress: ParseProgress) => void;
  /**
   * A worker running `./next/worker`, to scan the log off this thread; the read stays here. It
   * pays for logs of a few MB and up: a small log parses faster on this thread.
   */
  readonly worker?: LogWorker;
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

/** One parse's abort checks, progress reports and time slices. */
export class ParseRun implements ReadContext {
  /** When the running slice ends, as a `performance.now()` time. */
  deadline: number = performance.now() + SLICE_MS;
  private readonly signal: LogAbortSignal | undefined;
  private readonly onProgress: ((progress: ParseProgress) => void) | undefined;
  private readonly yieldToHost: Yield;
  private reported = Number.NEGATIVE_INFINITY;

  constructor(yieldToHost: Yield, options: ParseOptions) {
    this.yieldToHost = yieldToHost;
    this.signal = options.signal;
    this.onProgress = options.onProgress;
  }

  check(): void {
    if (this.signal?.aborted) throw reasonOf(this.signal);
  }

  race<T>(promise: Promise<T>): Promise<T> {
    const signal = this.signal;
    if (!signal) return promise;
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => reject(reasonOf(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
    });
  }

  /** Calls `onProgress` at most once per slice; `always` for the report that ends a phase. */
  report(progress: ParseProgress, always = false): void {
    if (!this.onProgress) return;
    const now = performance.now();
    if (!always && now - this.reported < SLICE_MS) return;
    this.reported = now;
    this.onProgress(progress);
  }

  progress(bytes: number, totalBytes: number | null): void {
    this.report({ phase: 'read', bytes, totalBytes });
  }

  async pause(): Promise<void> {
    if (performance.now() < this.deadline) return;
    await this.yieldToHost();
    this.check();
    this.deadline = performance.now() + SLICE_MS;
  }
}

/** The source's bytes, with the report that ends the read phase. */
export async function readFor(run: ParseRun, source: LogSource): Promise<Uint8Array> {
  run.check();
  const bytes = await readBytes(source, run);
  run.report({ phase: 'read', bytes: bytes.length, totalBytes: bytes.length }, true);
  run.check();
  return bytes;
}

/** The driver both builds share: read the source, scan it in time slices, then finish. */
export async function parseWith(
  engine: LogEngine,
  yieldToHost: Yield,
  source: LogSource,
  options: ParseOptions = {},
): Promise<ApexLog> {
  const run = new ParseRun(yieldToHost, options);
  const bytes = await readFor(run, source);
  const total = bytes.length;

  const builder = engine.builder(bytes);
  while (!builder.scan(run.deadline)) {
    run.report({ phase: 'scan', bytes: builder.scanned, totalBytes: total });
    await run.pause();
  }
  run.report({ phase: 'scan', bytes: total, totalBytes: total }, true);
  while (!builder.settle(run.deadline)) {
    run.report({ phase: 'finish', bytes: total, totalBytes: total });
    await run.pause();
  }
  // A small log can settle in the slice its last scan report ran in, with no pause to check.
  run.check();

  const log = apexLog(builder.finish());
  run.report({ phase: 'finish', bytes: total, totalBytes: total }, true);
  return log;
}
