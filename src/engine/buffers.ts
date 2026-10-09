/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Source } from '../bytes/source.js';
import type { StoreState } from '../store/store.js';
import { Store } from '../store/store.js';
import type { StringState } from '../store/strings.js';
import { StringTable } from '../store/strings.js';
import type { Built } from './builder.js';
import type { Issue } from './issues.js';
import { Issues } from './issues.js';

/** A build as typed arrays and plain values, which structured clone carries whole. */
export interface BuiltData extends Omit<Built, 'store' | 'strings' | 'issues' | 'source'> {
  readonly bytes: Uint8Array;
  /** `bytes`' buffer holds nothing but the log, so a move can take it whole. */
  readonly ownsBytes: boolean;
  readonly store: StoreState;
  readonly strings: StringState;
  readonly issues: readonly Issue[];
}

/** The byte arrays this package made, which no caller holds. */
const OWNED = new WeakSet<Uint8Array>();

/** Marks `bytes` as made by this package, so a move takes its buffer even when it is a part. */
export function ownBytes(bytes: Uint8Array): Uint8Array {
  OWNED.add(bytes);
  return bytes;
}

/** `bytes` was made by this package, so no caller holds it. */
export function isOwned(bytes: Uint8Array): boolean {
  return OWNED.has(bytes);
}

/** `built` as data that shares its memory. */
export function dataOf(built: Built): BuiltData {
  const bytes = built.source.bytes;
  return {
    bytes,
    // A caller's whole buffer can move too; a part of one, as a pooled Node Buffer, cannot.
    ownsBytes:
      OWNED.has(bytes) || (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength),
    store: built.store.state(),
    strings: built.strings.state(),
    issues: built.issues.list,
    parsingErrors: built.parsingErrors,
    truncated: built.truncated,
    namespaces: built.namespaces,
    snapshots: built.snapshots,
    executionEndTime: built.executionEndTime,
    size: built.size,
    startTime: built.startTime,
    debugLevels: built.debugLevels,
    debugLevelSettings: built.debugLevelSettings,
    userInfo: built.userInfo,
    truncation: built.truncation,
  };
}

/**
 * The build `data` states, over a source of `sourceOf`'s class. A TypeError for data of the wrong
 * shape; the values themselves are trusted, as `toBuffers` in this same version made them.
 */
export function restoreBuilt(data: BuiltData, sourceOf: (bytes: Uint8Array) => Source): Built {
  if (tagOf(data?.bytes) !== '[object Uint8Array]')
    throw new TypeError('The buffers hold no log bytes');
  if (!data.store || !data.strings || !Array.isArray(data.issues))
    throw new TypeError('The buffers are missing part of the log');
  if (data.ownsBytes) ownBytes(data.bytes);
  const source = sourceOf(data.bytes);
  const issues = new Issues();
  for (const issue of data.issues) issues.list.push(issue);
  // In the builder's order, so every build has the same object layout.
  return {
    store: Store.restore(data.store),
    strings: StringTable.restore(source, data.strings),
    issues,
    parsingErrors: data.parsingErrors,
    truncated: data.truncated,
    namespaces: data.namespaces,
    snapshots: data.snapshots,
    executionEndTime: data.executionEndTime,
    size: data.size,
    startTime: data.startTime,
    debugLevels: data.debugLevels,
    debugLevelSettings: data.debugLevelSettings,
    userInfo: data.userInfo,
    truncation: data.truncation,
    source,
  };
}

const tagOf = (value: unknown): string => Object.prototype.toString.call(value);

/**
 * Every buffer under `data` that `postMessage` can move, once each. The source's moves only when
 * the log owns it: Node's small `Buffer`s share a pool, which cannot move.
 */
export function transferOf(data: BuiltData): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const add = (view: ArrayBufferView): void => {
    // A SharedArrayBuffer is shared, not moved.
    if (tagOf(view.buffer) === '[object ArrayBuffer]') buffers.add(view.buffer as ArrayBuffer);
  };
  const { bytes, store, strings } = data;
  if (data.ownsBytes) add(bytes);
  for (const column of store.columns) add(column);
  add(store.counts);
  add(store.heap);
  add(strings.starts);
  add(strings.ends);
  return [...buffers];
}
