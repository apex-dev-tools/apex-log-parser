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
 * Any size from 6 bytes up is correct, and none is measurably faster. Below 6 a chunk is one unit, a
 * high surrogate there trims it to nothing, and the loop below stops advancing.
 */
const bufferBytes = 8192;

/** A UTF-16 code unit never takes more than 3 UTF-8 bytes, so a chunk this long always fits. */
export const chunkUnits: number = Math.floor(bufferBytes / 3);

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
    // Bound the slice: Blink copies the source string, so an open-ended one would be quadratic.
    let end = Math.min(i + chunkUnits, len);
    // A high surrogate cut from its pair would encode as a 3-byte replacement character.
    if (end < len && (text.charCodeAt(end - 1) & 0xfc00) === 0xd800) {
      end--;
    }
    const { read, written } = encoder.encodeInto(text.slice(i, end), buffer);
    bytes += written;
    i += read;
  }
  return bytes;
}
