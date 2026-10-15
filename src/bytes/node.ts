/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { LF } from './ascii.js';
import type { Source } from './source.js';
import { checkSize } from './source.js';

// `tsconfig.json` keeps ambient node types out, so declare the part of `Buffer` used here.
interface NodeBuffer {
  indexOf(value: number, byteOffset: number): number;
  toString(encoding: 'utf8', start: number, end: number): string;
}
declare const Buffer: {
  from(buffer: ArrayBufferLike, byteOffset: number, length: number): NodeBuffer;
};

/** The node build's source: `Buffer.indexOf` is memchr, and `toString` decodes natively. */
export class NodeSource implements Source {
  readonly bytes: Uint8Array;
  private readonly buffer: NodeBuffer;

  constructor(bytes: Uint8Array) {
    this.bytes = checkSize(bytes);
    // A view over the same memory, not a copy.
    this.buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  lineEnd(from: number): number {
    return this.buffer.indexOf(LF, from);
  }

  text(start: number, end: number): string {
    return this.buffer.toString('utf8', start, end);
  }
}
