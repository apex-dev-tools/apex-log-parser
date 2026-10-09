/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { isOwned, ownBytes } from '../engine/buffers.js';
import type { LogEngine } from '../engine/engine.js';
import type { ApexLog } from '../views/log.js';
import type { LogBuffers } from './buffers.js';
import { logFromBuffers } from './buffers.js';
import type { ParseOptions, Yield } from './parse.js';
import { ParseRun, readFor } from './parse.js';
import type { LogSource, ParseProgress } from './sources.js';

/**
 * A worker that runs this package's `./next/worker` file: a web `Worker`, or a Node
 * `worker_threads` `Worker`. Any object with `postMessage` and either way to listen will do, a
 * `MessagePort` included.
 */
export interface LogWorker {
  postMessage(message: unknown, transfer: ArrayBuffer[]): void;
  /** A web `MessagePort` gets no messages until it starts. */
  start?(): void;
  /** The web way to listen; `on` is Node's. */
  addEventListener?(type: string, listener: (event: { readonly data?: unknown }) => void): void;
  removeEventListener?(type: string, listener: (event: { readonly data?: unknown }) => void): void;
  on?(type: string, listener: (value: unknown) => void): unknown;
  off?(type: string, listener: (value: unknown) => void): unknown;
}

/** What the main thread sends a worker. */
export type Request =
  | { readonly kind: 'parse'; readonly id: number; readonly bytes: Uint8Array }
  | { readonly kind: 'abort'; readonly id: number };

/** What a worker sends back. */
export type Reply =
  | { readonly kind: 'progress'; readonly id: number; readonly progress: ParseProgress }
  | { readonly kind: 'done'; readonly id: number; readonly buffers: LogBuffers }
  | {
      readonly kind: 'error';
      readonly id: number;
      readonly name: string;
      readonly message: string;
    };

/**
 * Listens to `target` for `type` either way, and returns the call that stops it. A web listener
 * gets the event, so `message` hands on its `data`.
 */
export function listen(
  target: LogWorker,
  type: 'message' | 'messageerror' | 'error' | 'exit',
  listener: (value: unknown) => void,
): () => void {
  if (target.addEventListener) {
    const web = (event: { readonly data?: unknown }): void =>
      listener(type === 'message' ? event.data : event);
    target.addEventListener(type, web);
    if (type === 'message') target.start?.();
    return () => target.removeEventListener?.(type, web);
  }
  if (target.on) {
    target.on(type, listener);
    return () => target.off?.(type, listener);
  }
  throw new TypeError('A worker needs addEventListener or on');
}

// Bytes copied between pauses: well under a slice at memory speed.
const COPY_BYTES = 4 << 20;

/** `bytes` in a buffer of the parse's own, copied in steps so no step holds the host long. */
async function owned(bytes: Uint8Array, run: ParseRun): Promise<Uint8Array> {
  if (isOwned(bytes)) return bytes;
  const out = ownBytes(new Uint8Array(bytes.length));
  for (let at = 0; at < bytes.length; at += COPY_BYTES) {
    out.set(bytes.subarray(at, at + COPY_BYTES), at);
    await run.pause();
  }
  // A copy that fits in one slice never pauses, so it never checked.
  run.check();
  return out;
}

let lastId = 0;

/**
 * The log `worker` parses from `source`. The read stays on this thread. The bytes then move to the
 * worker, a caller's own bytes as a copy, so the caller keeps them, and the log comes back as buffers.
 */
export async function parseInWorker(
  engine: LogEngine,
  yieldToHost: Yield,
  worker: LogWorker,
  source: LogSource,
  options: ParseOptions,
): Promise<ApexLog> {
  const run = new ParseRun(yieldToHost, options);
  const bytes = await owned(await readFor(run, source), run);
  const id = ++lastId;
  const buffers = await new Promise<LogBuffers>((resolve, reject) => {
    // An abort in the gap since the last check fired its event already, so no listener would see it.
    run.check();
    const stops: (() => void)[] = [];
    const settle = (): void => {
      for (const stop of stops) stop();
    };
    stops.push(
      listen(worker, 'message', (value) => {
        const reply = value as Reply;
        if (reply?.id !== id) return;
        if (reply.kind === 'progress') run.report(reply.progress, true);
        else if (reply.kind === 'done') {
          settle();
          resolve(reply.buffers);
        } else if (reply.kind === 'error') {
          settle();
          reject(Object.assign(new Error(reply.message), { name: reply.name }));
        }
      }),
    );
    const failed = (cause: unknown): void => {
      settle();
      reject(new Error('The parse worker failed', { cause }));
    };
    stops.push(listen(worker, 'error', failed));
    // A reply that cannot be read back arrives as this alone.
    stops.push(listen(worker, 'messageerror', failed));
    // Node's worker ends with an exit; a web worker has no such event.
    if (!worker.addEventListener) stops.push(listen(worker, 'exit', failed));
    const signal = options.signal;
    if (signal) {
      const onAbort = (): void => {
        settle();
        worker.postMessage({ kind: 'abort', id } satisfies Request, []);
        try {
          run.check();
        } catch (reason) {
          reject(reason);
        }
      };
      signal.addEventListener('abort', onAbort, { once: true });
      stops.push(() => signal.removeEventListener('abort', onAbort));
    }
    try {
      // The buffer moves, so this thread holds no second copy while the worker parses.
      worker.postMessage({ kind: 'parse', id, bytes } satisfies Request, [
        bytes.buffer as ArrayBuffer,
      ]);
    } catch (error) {
      settle();
      reject(error);
    }
  });
  run.check();
  // The worker sent the report that ends the finish phase.
  return logFromBuffers(engine, buffers);
}
