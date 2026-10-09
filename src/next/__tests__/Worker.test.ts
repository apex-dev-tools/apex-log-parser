/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogAbortSignal, ParseProgress } from '../api/sources.js';
import type { LogWorker } from '../api/worker.js';
import { parse as browserParse } from '../browser.js';
import { parse as nodeParse } from '../node.js';
import type { ApexLog } from '../views/log.js';
import { encode } from './helpers.js';

// `src` has no node types, so the parts of Node and the platform used here are declared.
interface NodeWorker extends LogWorker {
  terminate(): Promise<number>;
}
declare const URL: new (path: string, base: string) => object;
declare const process: {
  getBuiltinModule(id: 'node:worker_threads'): {
    Worker: new (url: object, options: { execArgv: string[] }) => NodeWorker;
  };
};
interface Port extends LogWorker {
  close(): void;
}
declare const MessageChannel: new () => { port1: Port; port2: Port };
declare const AbortController: new () => { readonly signal: LogAbortSignal; abort(): void };
declare const setTimeout: (callback: () => void, ms: number) => unknown;

const LOG = [
  '64.0 APEX_CODE,FINE',
  '09:00:00.001 (1000)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.run()',
  '09:00:00.001 (1500)|USER_DEBUG|[2]|DEBUG|café ☕ 😀',
  '09:00:00.001 (4000)|METHOD_EXIT|[1]|01p000000000AAA|MyClass.run()',
].join('\n');

/** Enough lines that a parse takes many slices. */
function longLog(): string {
  const lines = ['64.0 APEX_CODE,FINE'];
  for (let i = 0; i < 200_000; i++)
    lines.push(`09:00:00.0 (${i + 1})|USER_DEBUG|[1]|DEBUG|line ${i}`);
  return lines.join('\n');
}

const summary = (log: ApexLog) => ({
  size: log.size,
  events: [...log.events].map((e) => [e.id, e.type, e.text, e.parent?.id ?? null, e.duration]),
  issues: log.issues.length,
});

describe('parse with a Node worker thread', () => {
  let worker: NodeWorker;
  beforeAll(() => {
    const { Worker } = process.getBuiltinModule('node:worker_threads');
    // The worker runs the source, as tsx compiles it.
    const here = (import.meta as { url?: string }).url ?? '';
    worker = new Worker(new URL('../worker/node.ts', here), {
      execArgv: ['--import', 'tsx'],
    });
  });
  afterAll(() => worker.terminate());

  it('gives the log a parse on this thread gives, and keeps the caller’s bytes', async () => {
    const bytes = encode(LOG);
    const log = await nodeParse(bytes, { worker });
    expect(summary(log)).toEqual(summary(await nodeParse(LOG)));
    expect(bytes.byteLength).toBeGreaterThan(0);
  });

  it('reports the read here, then the worker’s scan, ending with every byte', async () => {
    const phases: ParseProgress[] = [];
    await nodeParse(longLog(), { worker, onProgress: (p) => phases.push(p) });
    const order = phases.map((p) => p.phase).filter((p, i, all) => p !== all[i - 1]);
    expect(order).toEqual(['read', 'scan', 'finish']);
    expect(phases.at(-1)?.bytes).toBe(phases.at(-1)?.totalBytes);
  });

  it('parses two logs at once on one worker', async () => {
    const [a, b] = await Promise.all([
      nodeParse(LOG, { worker }),
      nodeParse(longLog(), { worker }),
    ]);
    expect(a.eventCount).toBe(2);
    expect(b.eventCount).toBe(200_000);
  });

  it('rejects with the reason of an abort, and the worker goes on to the next parse', async () => {
    const controller = new AbortController();
    const pending = nodeParse(longLog(), { worker, signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(await pending.catch((e: unknown) => e)).toBe(controller.signal.reason);
    expect((await nodeParse(LOG, { worker })).eventCount).toBe(2);
  });
});

describe('parse with a web worker', () => {
  it('serves the browser build over a message port', async () => {
    const { port1, port2 } = new MessageChannel();
    // The worker entry serves on its global scope; a port stands in for it here.
    const scope = globalThis as { self?: unknown };
    const saved = scope.self;
    scope.self = port2;
    try {
      await import('../worker/browser.js');
    } finally {
      scope.self = saved;
    }
    try {
      const log = await browserParse(LOG, { worker: port1 });
      expect(summary(log)).toEqual(summary(await browserParse(LOG)));
    } finally {
      port1.close();
      port2.close();
    }
  });
});

describe('parse with a worker that fails', () => {
  /** A fake worker that answers each parse with `reply`, in Node's `on` style. */
  function fake(reply: (id: number, emit: (type: string, value: unknown) => void) => void) {
    const listeners = new Map<string, ((value: unknown) => void)[]>();
    const emit = (type: string, value: unknown): void => {
      for (const listener of listeners.get(type) ?? []) listener(value);
    };
    const worker: LogWorker = {
      postMessage: (message) => {
        const request = message as { kind: string; id: number };
        if (request.kind === 'parse') reply(request.id, emit);
      },
      on: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      off: (type, listener) =>
        listeners.set(
          type,
          (listeners.get(type) ?? []).filter((l) => l !== listener),
        ),
    };
    return { worker, listeners };
  }

  it('rejects with the error the worker sends', async () => {
    const { worker } = fake((id, emit) =>
      emit('message', { kind: 'error', id, name: 'RangeError', message: 'too big' }),
    );
    const error = await nodeParse(LOG, { worker }).catch((e: unknown) => e);
    expect(error).toMatchObject({ name: 'RangeError', message: 'too big' });
  });

  it('rejects when the worker exits, and stops listening', async () => {
    const { worker, listeners } = fake((_id, emit) => emit('exit', 1));
    await expect(nodeParse(LOG, { worker })).rejects.toThrow('The parse worker failed');
    expect([...listeners.values()].flat()).toHaveLength(0);
  });

  it('rejects when a reply cannot be read back', async () => {
    const { worker } = fake((_id, emit) => emit('messageerror', {}));
    await expect(nodeParse(LOG, { worker })).rejects.toThrow('The parse worker failed');
  });

  it('rejects, and stops listening, when the request cannot be posted', async () => {
    const { worker, listeners } = fake(() => {
      throw new TypeError('DataCloneError');
    });
    await expect(nodeParse(LOG, { worker })).rejects.toThrow('DataCloneError');
    expect([...listeners.values()].flat()).toHaveLength(0);
  });

  it('ignores a reply for another parse', async () => {
    const { worker } = fake((id, emit) => {
      emit('message', { kind: 'error', id: id + 1000, name: 'Error', message: 'not mine' });
      emit('message', { kind: 'error', id, name: 'Error', message: 'mine' });
    });
    await expect(nodeParse(LOG, { worker })).rejects.toThrow('mine');
  });
});
