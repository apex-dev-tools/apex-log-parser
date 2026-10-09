/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Source } from './source.js';
import { checkSize, LF } from './source.js';

// `tsconfig.json` keeps ambient DOM types out, so declare the one WHATWG global used here.
declare const TextDecoder: new (
  label: 'utf-8',
  options: { ignoreBOM: boolean },
) => { decode(input: Uint8Array): string };

const ONES = 0x01010101;
const HIGHS = 0x80808080;
const LFS = 0x0a0a0a0a;
// TextDecoder's call cost dominates on short input in Chromium, so short ASCII text is built here.
const SHORT = 128;

/**
 * The browser build's source. `Uint8Array.indexOf` is a scalar loop in V8, so line ends are found
 * four bytes at a time (SWAR). Text is decoded per field; ADR 0005's switch to one whole-log decode
 * comes with the views, in step 5.
 */
export class BrowserSource implements Source {
  readonly bytes: Uint8Array;
  private readonly words: Int32Array;
  private decoder: { decode(input: Uint8Array): string } | null = null;

  constructor(bytes: Uint8Array) {
    this.bytes = checkSize(bytes);
    // Over the whole buffer, so a word index is the byte address over 4 whatever the view's offset.
    // Signed, so every load is a small integer; the zero-byte test does not depend on the sign.
    this.words = new Int32Array(bytes.buffer, 0, bytes.buffer.byteLength >>> 2);
  }

  lineEnd(from: number): number {
    const bytes = this.bytes;
    const words = this.words;
    const offset = bytes.byteOffset;
    const len = bytes.length;
    let i = from < 0 ? 0 : from;
    while (i < len && (offset + i) & 3) {
      if (bytes[i] === LF) return i;
      i++;
    }
    const end = (offset + len) >>> 2;
    for (let w = (offset + i) >>> 2; w < end; w++) {
      // w < end, so the word is inside the view
      const x = words[w]! ^ LFS;
      if (((x - ONES) & ~x & HIGHS) !== 0) {
        i = (w << 2) - offset;
        for (let k = 0; k < 4; k++) if (bytes[i + k] === LF) return i + k;
      }
    }
    for (i = Math.max(i, (end << 2) - offset); i < len; i++) if (bytes[i] === LF) return i;
    return -1;
  }

  text(start: number, end: number): string {
    if (end - start <= SHORT) {
      const bytes = this.bytes;
      for (let i = start; i < end; i++) {
        // i < end, which is inside the view
        if (bytes[i]! > 0x7f) return this.decode(start, end);
      }
      // ASCII, so each byte is one char code; a typed array is array-like, as apply needs.
      return String.fromCharCode.apply(null, bytes.subarray(start, end) as unknown as number[]);
    }
    return this.decode(start, end);
  }

  private decode(start: number, end: number): string {
    // Keep a leading BOM, as Node's decoder does.
    this.decoder ??= new TextDecoder('utf-8', { ignoreBOM: true });
    return this.decoder.decode(this.bytes.subarray(start, end));
  }
}
