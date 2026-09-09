/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

// `tsconfig.json` keeps ambient globals out, so declare the one WHATWG global used here.
declare const TextEncoder: {
  new (): {
    encodeInto(source: string, destination: Uint8Array): { read: number; written: number };
  };
};

const encoder = new TextEncoder();

/**
 * Any size from 4 bytes up is correct, and none is measurably faster. Below 4 a single astral
 * code point never fits, `encodeInto` reads nothing, and the loop below stops advancing.
 */
const bufferBytes = 8192;

/**
 * The UTF-8 byte length of a string. `String.length` counts UTF-16 code units, which under-reports
 * any text holding a non-ASCII character.
 *
 * Encoded in passes through one small buffer, rather than measured any of the obvious ways:
 * `TextEncoder.encode` copies the whole string, and counting code points by hand is around 50 times
 * slower on a large log. `Buffer.byteLength` is faster still but is Node-only.
 */
export function utf8ByteLength(text: string): number {
  const buffer = new Uint8Array(bufferBytes);
  const len = text.length;
  let bytes = 0;
  for (let i = 0; i < len; ) {
    // `encodeInto` stops on a code-point boundary and states how far it got, so a surrogate pair
    // is never split across two passes. The `slice` is a view, not a copy, on every engine this
    // package targets; one that copied instead would make this quadratic.
    const { read, written } = encoder.encodeInto(text.slice(i), buffer);
    bytes += written;
    i += read;
  }
  return bytes;
}
