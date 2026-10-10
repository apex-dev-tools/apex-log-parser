/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { toBuffers } from '../api/buffers.js';
import type { Yield } from '../api/parse.js';
import { parseWith } from '../api/parse.js';
import type { LogAbortSignal } from '../api/sources.js';
import type { LogWorker, Reply, Request } from '../api/worker.js';
import { listen } from '../api/worker.js';
import { ownBytes } from '../engine/buffers.js';
import type { LogEngine } from '../engine/engine.js';

declare const AbortController: new () => { readonly signal: LogAbortSignal; abort(): void };

const send = (port: LogWorker, reply: Reply, transfer: ArrayBuffer[] = []): void =>
  port.postMessage(reply, transfer);

/** Parses each log the main thread sends on `port`, and sends it back as buffers. */
export function serve(port: LogWorker, engine: LogEngine, yieldToHost: Yield): void {
  const running = new Map<number, { abort(): void }>();
  listen(port, 'message', (value) => {
    const request = value as Request;
    if (request?.kind === 'abort') {
      running.get(request.id)?.abort();
      return;
    }
    if (request?.kind !== 'parse') return;
    const { id } = request;
    const controller = new AbortController();
    running.set(id, controller);
    // The bytes came in a message, so no one else holds them, and they can move back.
    parseWith(engine, yieldToHost, ownBytes(request.bytes), {
      signal: controller.signal,
      // The main thread reported the read.
      onProgress: (progress) => {
        if (progress.phase !== 'read') send(port, { kind: 'progress', id, progress });
      },
    })
      .then((log) => {
        const { buffers, transfer } = toBuffers(log);
        send(port, { kind: 'done', id, buffers }, transfer);
      })
      // After the then, so a failed send of the log reports too; the main thread would wait on.
      .catch((error: unknown) => {
        const { name = 'Error', message = String(error) } = (error ?? {}) as Partial<Error>;
        send(port, { kind: 'error', id, name: String(name), message: String(message) });
      })
      .finally(() => running.delete(id));
  });
}
