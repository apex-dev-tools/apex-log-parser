/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Fields } from '../catalog/types.js';
import { nodeEngine } from '../node.js';
import type { ApexLog } from '../views/log.js';
import { apexLog } from '../views/log.js';

// `tsconfig.json` keeps ambient globals out, so declare the one WHATWG global used here.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

/** `text` as UTF-8 bytes. */
export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The log `text` states, through the views. */
export const parse = (text: string): ApexLog => apexLog(nodeEngine.build(encode(text)));

const INTEGER = /^-?\d+$/;
const LINE_NUMBER = /^\[\d+\]$/;

const safe = (digits: string): number => {
  const n = Number(digits);
  return Number.isSafeInteger(n) ? n : Number.NaN;
};

function intOf(text: string, prefix: string): number | null {
  if (!text) return null;
  const digits = text.startsWith(prefix) ? text.slice(prefix.length) : '';
  return INTEGER.test(digits) ? safe(digits) : Number.NaN;
}

/** `Fields` over a line of text and its continuation lines, or a function that gives them. */
export function fieldsOf(line: string, continuation: string | (() => string) = ''): Fields {
  const parts = line.split('|');
  return {
    count: parts.length,
    continuation: typeof continuation === 'function' ? continuation : () => continuation,
    at: (i) => parts[i] ?? '',
    from: (i, separator) => (i < 0 ? '' : parts.slice(i).join(separator)),
    lineNumber: (i) => {
      const text = parts[i] ?? '';
      if (!text) return null;
      if (text === '[EXTERNAL]') return 'EXTERNAL';
      return LINE_NUMBER.test(text) ? safe(text.slice(1, -1)) : Number.NaN;
    },
    int: (i, prefix = '') => intOf(parts[i] ?? '', prefix),
  };
}
