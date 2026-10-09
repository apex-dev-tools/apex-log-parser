/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

declare const setImmediate: (callback: () => void) => unknown;

interface Port {
  onmessage: (() => void) | null;
  postMessage(message: null): void;
  close(): void;
}
declare const MessageChannel: new () => { port1: Port; port2: Port };
declare const scheduler: { yield?: () => Promise<void> } | undefined;

/** Node's way to give the host its turn: `setImmediate` runs after pending I/O, so a parse never starves the event loop. */
export const yieldToNode = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/**
 * The browser's way. `scheduler.yield` resumes ahead of other queued tasks, where the browser has it
 * (not Safari). A message is the fallback: a timeout of 0 is clamped to 4 ms after a few nested calls.
 */
export function yieldToBrowser(): Promise<void> {
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
