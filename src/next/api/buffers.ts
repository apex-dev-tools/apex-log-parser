/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { EVENT_TYPE_NAMES } from '../catalog/types.js';
import type { BuiltData } from '../engine/buffers.js';
import { dataOf, transferOf } from '../engine/buffers.js';
import type { LogEngine } from '../engine/engine.js';
import type { ApexLog } from '../views/log.js';
import { apexLog, builtOf } from '../views/log.js';

const FORMAT = 'apex-log-buffers';
/** Goes up on any change to `BuiltData`'s layout. */
const VERSION = 1;

/**
 * A parsed log as data that `postMessage` carries, from `toBuffers`, for `fromBuffers`. Only the
 * same version of this package reads it: it is for moving a log between threads, not for storage.
 */
export interface LogBuffers {
  readonly format: typeof FORMAT;
  readonly version: number;
  /** The log, in a layout that is internal to this version. */
  readonly data: unknown;
}

/** A log ready for `postMessage(buffers, transfer)`. */
export interface TransferableLog {
  readonly buffers: LogBuffers;
  /**
   * The buffers `postMessage` can move rather than copy. Moving them leaves the log, and a byte
   * source the log was parsed from, unreadable on this side. Without them, `postMessage` copies.
   */
  readonly transfer: ArrayBuffer[];
}

/** `log` as buffers, which share its memory: making them copies nothing. */
export function toBuffers(log: ApexLog): TransferableLog {
  const data = dataOf(builtOf(log));
  return { buffers: { format: FORMAT, version: VERSION, data }, transfer: transferOf(data) };
}

/** The log `buffers` hold, read through `engine`: each build's `fromBuffers`. */
export function logFromBuffers(engine: LogEngine, buffers: LogBuffers): ApexLog {
  if (buffers?.format !== FORMAT) throw new TypeError('Not buffers that toBuffers made');
  if (buffers.version !== VERSION)
    throw new TypeError(`Buffers of format ${buffers.version}; this version reads ${VERSION}`);
  const data = buffers.data as BuiltData;
  // Type ids index the catalog, so a log from another catalog would read as other types.
  if (data.store?.typeCount !== EVENT_TYPE_NAMES.length + 1)
    throw new TypeError('Buffers from a version of this package with another event catalog');
  return apexLog(engine.restore(data));
}
