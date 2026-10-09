/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type {
  LogAbortSignal,
  LogBlob,
  LogResponse,
  LogStream,
  ParseProgress,
  StreamRead,
} from '../api/sources.js';
import { readBytes } from '../api/sources.js';
import { parse as browserParse } from '../browser.js';
import { parse as nodeParse } from '../node.js';
import type { ApexLog } from '../views/log.js';
import { encode, parse as syncParse } from './helpers.js';

declare const setTimeout: (callback: () => void, ms: number) => unknown;

// The platform's own objects, which `src` has no DOM types for.
const platform = globalThis as unknown as {
  Response: new (body: Uint8Array, init?: { status?: number }) => LogResponse;
  Blob: new (parts: Uint8Array[]) => LogBlob;
  ReadableStream: new (source: {
    start(controller: { enqueue(chunk: Uint8Array): void; close(): void }): void;
  }) => LogStream;
  AbortController: new () => { signal: LogAbortSignal; abort(): void };
  SharedArrayBuffer: new (length: number) => ArrayBuffer;
};

/** Never settles: a source stalled mid-read, as a server that stops sending. */
const stalled = <T>(): Promise<T> => new Promise<T>(() => undefined);

/** A stream whose first read never settles. */
function stalledStream(): LogStream & { cancelled: unknown } {
  const stream = {
    cancelled: undefined as unknown,
    getReader: () => ({
      read: stalled<StreamRead>,
      cancel: async (reason?: unknown) => {
        stream.cancelled = reason;
      },
      releaseLock: () => undefined,
    }),
  };
  return stream;
}

/** Aborts `controller` once the parse is waiting. */
const abortSoon = (controller: { abort(): void }): void => {
  setTimeout(() => controller.abort(), 5);
};

const LOG = [
  '64.0 APEX_CODE,FINE',
  '09:00:00.001 (1000)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.run()',
  '09:00:00.001 (1500)|USER_DEBUG|[2]|DEBUG|café ☕ 😀',
  '09:00:00.001 (4000)|METHOD_EXIT|[1]|01p000000000AAA|MyClass.run()',
].join('\n');
const BYTES = encode(LOG);

/** What a parse states, to compare one source's result with another's. */
const summary = (log: ApexLog) => ({
  size: log.size,
  events: [...log.events].map((e) => [e.type, e.text, e.duration.total]),
});
const expected = summary(syncParse(LOG));

/** Enough lines that a parse takes several slices. */
function longLog(): string {
  const lines = ['64.0 APEX_CODE,FINE'];
  for (let i = 0; i < 200_000; i++)
    lines.push(`09:00:00.0 (${i + 1})|USER_DEBUG|[1]|DEBUG|line ${i}`);
  return lines.join('\n');
}

/** A stream that hands out `chunks` one read at a time, each `delayMs` after it is asked for. */
function streamOf(chunks: Uint8Array[], delayMs = 0): LogStream & { cancelled: unknown } {
  const queue = [...chunks];
  const stream = {
    cancelled: undefined as unknown,
    getReader: () => ({
      read: async (): Promise<StreamRead> => {
        if (delayMs) await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
        const value = queue.shift();
        return value ? { done: false, value } : { done: true };
      },
      cancel: async (reason?: unknown) => {
        stream.cancelled = reason;
      },
      releaseLock: () => undefined,
    }),
  };
  return stream;
}

const halves = (bytes: Uint8Array): Uint8Array[] => [
  bytes.subarray(0, bytes.length >> 1),
  bytes.subarray(bytes.length >> 1),
];

function response(body: LogStream, headers: Record<string, string> = {}, ok = true): LogResponse {
  return {
    ok,
    status: ok ? 200 : 404,
    bodyUsed: false,
    headers: { get: (name) => headers[name] ?? null },
    body,
  };
}

describe.each([
  ['node', nodeParse],
  ['browser', browserParse],
])('parse, %s build', (_build, parse) => {
  it.each([
    ['a string', () => LOG],
    ['bytes', () => BYTES],
    ['an ArrayBuffer', () => BYTES.slice().buffer],
    ['a Blob', () => new platform.Blob([BYTES])],
    ['a Response', () => new platform.Response(BYTES)],
    [
      'a ReadableStream',
      () =>
        new platform.ReadableStream({
          start(c) {
            for (const part of halves(BYTES)) c.enqueue(part);
            c.close();
          },
        }),
    ],
    [
      'an async iterable',
      () =>
        (async function* () {
          yield* halves(BYTES);
        })(),
    ],
    [
      'a Response that states its length',
      () => response(streamOf(halves(BYTES)), { 'content-length': String(BYTES.length) }),
    ],
    [
      'a Response that states too short a length',
      () => response(streamOf(halves(BYTES)), { 'content-length': '5' }),
    ],
    [
      'a compressed Response, whose length is not the body read',
      () =>
        response(streamOf(halves(BYTES)), { 'content-length': '5', 'content-encoding': 'gzip' }),
    ],
  ])('reads %s', async (_name, source) => {
    expect(summary(await parse(source()))).toEqual(expected);
  });

  it('rejects a Response that is not ok, and one already read', async () => {
    await expect(parse(response(streamOf([]), {}, false))).rejects.toThrow('HTTP 404');
    await expect(parse({ ...response(streamOf([])), bodyUsed: true })).rejects.toThrow(TypeError);
  });

  it('rejects a source it cannot read', async () => {
    await expect(parse({} as never)).rejects.toThrow(TypeError);
  });

  it('reports each phase in order, ending with every byte', async () => {
    const phases: ParseProgress[] = [];
    await parse(LOG, { onProgress: (p) => phases.push(p) });
    const order = phases.map((p) => p.phase).filter((p, i, all) => p !== all[i - 1]);
    expect(order).toEqual(['read', 'scan', 'finish']);
    expect(phases.at(-1)).toEqual({
      phase: 'finish',
      bytes: BYTES.length,
      totalBytes: BYTES.length,
    });
  });

  it('rejects with the reason of a signal aborted before it starts, and does no work', async () => {
    const controller = new platform.AbortController();
    controller.abort();
    const onProgress = vi.fn();
    const error = await parse(LOG, { signal: controller.signal, onProgress }).catch((e) => e);
    expect(error).toBe(controller.signal.reason);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('stops within a slice when the signal aborts mid-scan', async () => {
    const controller = new platform.AbortController();
    const scans: number[] = [];
    const error = await parse(longLog(), {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase !== 'scan') return;
        scans.push(p.bytes);
        controller.abort();
      },
    }).catch((e) => e);
    expect(error).toBe(controller.signal.reason);
    expect(scans).toHaveLength(1);
  });

  it('rejects when the signal aborts in the last scan report of a small log', async () => {
    const controller = new platform.AbortController();
    const error = await parse(LOG, {
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === 'scan') controller.abort();
      },
    }).catch((e) => e);
    expect(error).toBe(controller.signal.reason);
  });

  it('cancels a stream it stops reading', async () => {
    const controller = new platform.AbortController();
    const stream = streamOf([BYTES, BYTES]);
    const error = await parse(stream, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    }).catch((e) => e);
    expect(error).toBe(controller.signal.reason);
    expect(stream.cancelled).toBe(controller.signal.reason);
  });

  it.each([
    ['a stream read', () => stalledStream()],
    ['a Blob read', () => ({ size: 1, arrayBuffer: stalled<ArrayBuffer> })],
    ['an async iterator step', () => ({ [Symbol.asyncIterator]: () => ({ next: stalled }) })],
  ])('stops when the signal aborts during %s that never settles', async (_name, source) => {
    const controller = new platform.AbortController();
    const pending = parse(source() as never, { signal: controller.signal });
    abortSoon(controller);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBe(controller.signal.reason);
  });

  it('cancels a stream whose read never settles once the signal aborts', async () => {
    const controller = new platform.AbortController();
    const stream = stalledStream();
    const pending = parse(stream, { signal: controller.signal });
    abortSoon(controller);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBe(controller.signal.reason);
    expect(stream.cancelled).toBe(controller.signal.reason);
  });

  it('rejects with an AbortError for a signal that states no reason', async () => {
    const signal: LogAbortSignal = {
      aborted: true,
      reason: undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    };
    await expect(parse(LOG, { signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects a stream of text, which would read as zeros', async () => {
    const text = (async function* () {
      yield LOG;
    })();
    await expect(parse(text as never)).rejects.toThrow('not text');
  });

  it('reads a SharedArrayBuffer', async () => {
    const shared = new platform.SharedArrayBuffer(BYTES.length);
    new Uint8Array(shared).set(BYTES);
    expect(summary(await parse(shared))).toEqual(expected);
  });

  it('cancels the body of a Response that is not ok', async () => {
    const cancel = vi.fn(async () => undefined);
    const failed = { ...response(streamOf([]), {}, false), body: { ...streamOf([]), cancel } };
    await expect(parse(failed)).rejects.toThrow('HTTP 404');
    expect(cancel).toHaveBeenCalled();
  });

  it('states no total once a stream runs past the length it stated', async () => {
    const phases: ParseProgress[] = [];
    // Each read takes longer than the progress throttle, so every one reports.
    const chunks = streamOf([BYTES, BYTES], 10);
    const short = response(chunks, { 'content-length': String(BYTES.length) });
    await parse(short, { onProgress: (p) => phases.push(p) });
    const reads = phases.filter((p) => p.phase === 'read');
    expect(reads.slice(0, 2)).toEqual([
      { phase: 'read', bytes: BYTES.length, totalBytes: BYTES.length },
      { phase: 'read', bytes: 2 * BYTES.length, totalBytes: null },
    ]);
    expect(reads.at(-1)).toEqual({
      phase: 'read',
      bytes: 2 * BYTES.length,
      totalBytes: 2 * BYTES.length,
    });
  });
});

describe('the browser build', () => {
  it('yields through scheduler.yield where the browser has it', async () => {
    const host = globalThis as { scheduler?: unknown };
    const yields = vi.fn(async () => undefined);
    host.scheduler = { yield: yields };
    try {
      await browserParse(longLog());
    } finally {
      delete host.scheduler;
    }
    expect(yields).toHaveBeenCalled();
  });
});

describe('readBytes', () => {
  const cx = {
    check: () => undefined,
    race: <T>(promise: Promise<T>) => promise,
    progress: () => undefined,
    pause: async () => undefined,
  };

  it('encodes a string as UTF-8, a surrogate pair kept whole across encode steps', async () => {
    // The pair straddles the first step's last character.
    const text = `${'a'.repeat((1 << 20) - 1)}😀é${'b'.repeat(10)}`;
    const [got, want] = [await readBytes(text, cx), encode(text)];
    // toEqual compares a megabyte one byte at a time, which takes seconds on a CI runner.
    expect(got.length).toBe(want.length);
    expect(got.findIndex((byte, at) => byte !== want[at])).toBe(-1);
  });

  it('keeps bytes and one chunk without a copy', async () => {
    expect(await readBytes(BYTES, cx)).toBe(BYTES);
    expect(await readBytes(streamOf([BYTES]), cx)).toBe(BYTES);
  });
});
