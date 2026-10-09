/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { ownBytes } from '../engine/buffers.js';

// `tsconfig.json` keeps ambient DOM types out, so the WHATWG shapes parse reads are stated here, as
// far as it reads them. The platform's own objects match them.

/** A `Blob` or a `File`. */
export interface LogBlob {
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

/** One read of a `ReadableStream` reader. */
export type StreamRead = { done: false; value: Uint8Array } | { done: true; value?: undefined };

/** A `ReadableStream` of bytes. */
export interface LogStream {
  getReader(): {
    read(): Promise<StreamRead>;
    cancel(reason?: unknown): Promise<void>;
    releaseLock(): void;
  };
}

/** A `fetch` `Response`. */
export interface LogResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly bodyUsed: boolean;
  readonly headers: { get(name: string): string | null };
  readonly body: (LogStream & { cancel?(reason?: unknown): Promise<void> }) | null;
}

/** What `parse` reads a log from. A stream must give bytes: decode no text before `parse`. */
export type LogSource =
  | string
  | Uint8Array
  | ArrayBuffer
  | LogBlob
  | LogResponse
  | LogStream
  | AsyncIterable<Uint8Array>;

/** An `AbortSignal`. */
export interface LogAbortSignal {
  readonly aborted: boolean;
  readonly reason: unknown;
  addEventListener(type: 'abort', listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** How far a parse has come. `bytes` and `totalBytes` count the log's UTF-8 bytes. */
export interface ParseProgress {
  readonly phase: 'read' | 'scan' | 'finish';
  readonly bytes: number;
  /**
   * Null while the read cannot know it: a string being encoded, a stream that states no length, or
   * one that ran past the length it stated.
   */
  readonly totalBytes: number | null;
}

declare const TextEncoder: new () => {
  encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
};

/** What the source reader needs from the driver: abort checks, progress and yields. */
export interface ReadContext {
  /** Throws the signal's reason once it aborts. */
  check(): void;
  /** `promise`, or its rejection with the signal's reason once the signal aborts first. */
  race<T>(promise: Promise<T>): Promise<T>;
  progress(bytes: number, totalBytes: number | null): void;
  /** Yields to the host once the slice's time is up. */
  pause(): Promise<void>;
}

// Characters per encode step: about 1 ms in Chromium, so a slice ends close to its deadline.
const ENCODE_CHARS = 1 << 20;
/** The largest stated length read into one buffer made up front: 256 MiB. */
const MAX_STATED = 1 << 28;

/** The type tag, which holds across realms, as a view from an iframe, where `instanceof` fails. */
const tagOf = (value: unknown): string => Object.prototype.toString.call(value);
const isBytes = (value: unknown): value is Uint8Array => tagOf(value) === '[object Uint8Array]';
const isBuffer = (value: unknown): value is ArrayBuffer =>
  tagOf(value) === '[object ArrayBuffer]' || tagOf(value) === '[object SharedArrayBuffer]';
const isResponse = (s: object): s is LogResponse => 'headers' in s && 'ok' in s && 'body' in s;
const isStream = (s: object): s is LogStream => typeof (s as LogStream).getReader === 'function';
const isBlob = (s: object): s is LogBlob => typeof (s as LogBlob).arrayBuffer === 'function';
const isIterable = (s: object): s is AsyncIterable<unknown> => Symbol.asyncIterator in s;

/** The log's bytes, in one buffer. */
export async function readBytes(source: LogSource, cx: ReadContext): Promise<Uint8Array> {
  if (typeof source === 'string') return encode(source, cx);
  if (isBytes(source)) return source;
  if (isBuffer(source)) return new Uint8Array(source);
  // A Response is also a Blob-like with arrayBuffer, and a stream is also async iterable.
  if (isResponse(source)) return readResponse(source, cx);
  if (isStream(source)) return readStream(source, null, cx);
  if (isBlob(source)) return ownBytes(new Uint8Array(await cx.race(source.arrayBuffer())));
  if (isIterable(source)) return readIterable(source, cx);
  throw new TypeError('parse takes a string, bytes, a Blob, a Response or a stream');
}

/** A stream chunk, which must be bytes: text from a decoder would read as zeros. */
function chunkOf(value: unknown): Uint8Array {
  if (isBytes(value)) return value;
  throw new TypeError('A stream must give bytes, not text: pass it to parse before any decoder');
}

async function encode(text: string, cx: ReadContext): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  // A log is mostly ASCII: one byte a character, so this buffer grows only for other text.
  let out: Uint8Array = new Uint8Array(text.length);
  let read = 0;
  let written = 0;
  while (read < text.length) {
    let end = Math.min(read + ENCODE_CHARS, text.length);
    // A surrogate pair split across two steps would encode as two replacement characters.
    if (end < text.length && isHighSurrogate(text.charCodeAt(end - 1))) end++;
    let part = text.slice(read, end);
    for (;;) {
      const step = encoder.encodeInto(part, out.subarray(written));
      written += step.written;
      read += step.read;
      if (step.read === part.length) break;
      // Out of room: UTF-8 takes at most 3 bytes per UTF-16 unit, and the rest is guessed ASCII.
      part = part.slice(step.read);
      out = grown(out, written, written + part.length * 3 + (text.length - end));
    }
    cx.progress(written, null);
    await cx.pause();
  }
  return fitted(out, written);
}

/** The first `used` bytes, ours. The log keeps their buffer, so spare room would live as long as it. */
function fitted(bytes: Uint8Array, used: number): Uint8Array {
  return ownBytes(bytes.length - used > used >> 3 ? bytes.slice(0, used) : bytes.subarray(0, used));
}

const isHighSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdbff;

/** A copy of `bytes`' first `used` bytes, in a buffer of at least `needed`. */
function grown(bytes: Uint8Array, used: number, needed: number): Uint8Array {
  const out = new Uint8Array(Math.max(needed, Math.ceil(bytes.length * 1.5)));
  out.set(bytes.subarray(0, used));
  return out;
}

async function readResponse(response: LogResponse, cx: ReadContext): Promise<Uint8Array> {
  if (!response.ok) {
    // An unread body holds its connection open until it is collected.
    response.body?.cancel?.().catch(() => undefined);
    throw new Error(`The log could not be fetched: HTTP ${response.status}`);
  }
  if (response.bodyUsed || !response.body)
    throw new TypeError('The response body was already read');
  // A compressed body states its compressed length, which is not the length read here.
  const length = response.headers.get('content-encoding')
    ? null
    : Number(response.headers.get('content-length') ?? Number.NaN);
  return readStream(response.body, Number.isSafeInteger(length) ? length : null, cx);
}

/** A stream's bytes: into one buffer when `total` is known, else joined once at the end. */
async function readStream(
  stream: LogStream,
  total: number | null,
  cx: ReadContext,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks = new Chunks(total);
  try {
    for (;;) {
      cx.check();
      const next = await cx.race(reader.read());
      if (next.done) break;
      chunks.add(chunkOf(next.value));
      cx.progress(chunks.length, chunks.total);
      await cx.pause();
    }
  } catch (error) {
    // Not awaited: a source that never settles its cancel must not hold the rejection back.
    reader.cancel(error).catch(() => undefined);
    throw error;
  }
  reader.releaseLock();
  return chunks.bytes();
}

async function readIterable(source: AsyncIterable<unknown>, cx: ReadContext): Promise<Uint8Array> {
  const iterator = source[Symbol.asyncIterator]();
  const chunks = new Chunks(null);
  try {
    for (;;) {
      cx.check();
      const next = await cx.race(iterator.next());
      if (next.done) break;
      chunks.add(chunkOf(next.value));
      cx.progress(chunks.length, null);
      await cx.pause();
    }
  } catch (error) {
    // Not awaited, as for a stream: an iterator waiting on its source settles its return late.
    iterator.return?.().catch(() => undefined);
    throw error;
  }
  return chunks.bytes();
}

/** Chunks of a stream: written into one buffer of a stated length, or kept and joined once. */
class Chunks {
  length = 0;
  /** The stated length; null when none was stated, or once the stream ran past it. */
  total: number | null;
  private buffer: Uint8Array | null;
  private readonly list: Uint8Array[] = [];

  constructor(total: number | null) {
    this.total = total;
    // A stated length is the server's claim: past the cap, the bytes that come decide.
    this.buffer = total === null || total > MAX_STATED ? null : new Uint8Array(total);
  }

  add(chunk: Uint8Array): void {
    const length = this.length + chunk.length;
    if (this.total !== null && length > this.total) this.overrun();
    if (this.buffer) this.buffer.set(chunk, this.length);
    else this.list.push(chunk);
    this.length = length;
  }

  /** The stream ran past the length it stated, so what came so far becomes one chunk. */
  private overrun(): void {
    if (this.buffer) this.list.push(this.buffer.subarray(0, this.length));
    this.buffer = null;
    this.total = null;
  }

  bytes(): Uint8Array {
    if (this.buffer) return fitted(this.buffer, this.length);
    // One chunk needs no copy; the stream's source may still hold it, so it is not ours.
    if (this.list.length === 1) return this.list[0] ?? new Uint8Array(0);
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const chunk of this.list) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return ownBytes(out);
  }
}
