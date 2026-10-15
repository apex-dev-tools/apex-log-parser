/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

// The ASCII bytes the engine tests for, and the searches it runs over a byte range.

export const LF = 0x0a;
export const CR = 0x0d;
export const SPACE = 0x20;
export const STAR = 0x2a;
export const LPAREN = 0x28;
export const RPAREN = 0x29;
export const MINUS = 0x2d;
export const DOT = 0x2e;
export const SLASH = 0x2f;
export const ZERO = 0x30;
export const NINE = 0x39;
export const COLON = 0x3a;
export const UPPER_A = 0x41;
export const UPPER_Z = 0x5a;
export const LBRACKET = 0x5b;
export const RBRACKET = 0x5d;
export const UNDERSCORE = 0x5f;
export const PIPE = 0x7c;

/** The bytes from `at` spell `ascii`. The caller checks that they are there. */
export function matchesAscii(bytes: Uint8Array, at: number, ascii: string): boolean {
  for (let k = 0; k < ascii.length; k++) {
    if (bytes[at + k] !== ascii.charCodeAt(k)) return false;
  }
  return true;
}

/** Bytes `start` to `end` start with `ascii`. */
export function startsWithAscii(
  bytes: Uint8Array,
  start: number,
  end: number,
  ascii: string,
): boolean {
  return end - start >= ascii.length && matchesAscii(bytes, start, ascii);
}

/** Bytes `start` to `end` are `ascii`. */
export function spellsAscii(bytes: Uint8Array, start: number, end: number, ascii: string): boolean {
  return end - start === ascii.length && matchesAscii(bytes, start, ascii);
}

/** Where `ascii` first starts in bytes `start` to `end`, or -1. */
export function findAscii(bytes: Uint8Array, ascii: string, start: number, end: number): number {
  for (let i = start; i + ascii.length <= end; i++) if (matchesAscii(bytes, i, ascii)) return i;
  return -1;
}

/** Where `byte` first is in bytes `start` to `end`, or -1. */
export function indexOfByte(bytes: Uint8Array, byte: number, start: number, end: number): number {
  for (let i = start; i < end; i++) if (bytes[i] === byte) return i;
  return -1;
}

/** Where `byte` last is in bytes `start` to `end`, or -1. */
export function lastIndexOfByte(
  bytes: Uint8Array,
  byte: number,
  start: number,
  end: number,
): number {
  for (let i = end - 1; i >= start; i--) if (bytes[i] === byte) return i;
  return -1;
}

/** How many times `byte` is in bytes `start` to `end`. */
export function countByte(bytes: Uint8Array, byte: number, start: number, end: number): number {
  let n = 0;
  for (let i = start; i < end; i++) if (bytes[i] === byte) n++;
  return n;
}
