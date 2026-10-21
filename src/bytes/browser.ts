/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { indexOfByte, LF } from './ascii.js';
import type { Source } from './source.js';
import { checkSize } from './source.js';
import { byteOf, fromByte, LFS, matchBytes, wordsOf } from './words.js';

// `tsconfig.json` keeps ambient DOM types out, so declare the one WHATWG global used here.
declare const TextDecoder: new (
  label: 'utf-8',
  options: { ignoreBOM: boolean },
) => { decode(input: Uint8Array): string };

// TextDecoder's call cost dominates on short input in Chromium, so short ASCII text is built here.
const SHORT = 128;

/**
 * The browser build's source. `Uint8Array.indexOf` is a scalar loop in V8, so line ends are found
 * four bytes at a time (SWAR). Text is decoded per field.
 */
export class BrowserSource implements Source {
  readonly bytes: Uint8Array;
  readonly words: DataView;
  private decoder: { decode(input: Uint8Array): string } | null = null;

  constructor(bytes: Uint8Array) {
    this.bytes = checkSize(bytes);
    this.words = wordsOf(bytes);
  }

  lineEnd(from: number): number {
    const bytes = this.bytes;
    const words = this.words;
    const len = bytes.length;
    const start = from < 0 ? 0 : from;
    // The bytes in whole words; the rest are read one at a time.
    const whole = len & ~3;
    for (let at = start & ~3, keep = fromByte(start); at < whole; at += 4, keep = -1) {
      const lf = matchBytes(words.getInt32(at, true), LFS) & keep;
      if (lf) return at + byteOf(lf & -lf);
    }
    return indexOfByte(bytes, LF, Math.max(start, whole), len);
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
