/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Fields } from '../catalog/types.js';
import { nodeEngine } from '../engine/node.js';
import type { ApexLog } from '../views/log.js';
import { apexLog } from '../views/log.js';

// `tsconfig.json` keeps ambient globals out, so declare the one WHATWG global used here.
declare const TextEncoder: new () => { encode(input: string): Uint8Array };

/** `text` as UTF-8 bytes. */
export const encode = (text: string): Uint8Array => new TextEncoder().encode(text);

/** The log `text` states, through the views. */
export const parse = (text: string): ApexLog => apexLog(nodeEngine.build(encode(text)));

/** A settings line, for a log built from event lines. */
export const HEADER = '64.0 APEX_CODE,FINE;APEX_PROFILING,INFO;DB,INFO';

/** A line's timestamp field at `ns` nanoseconds. */
export const at = (ns: number): string => `09:00:00.0 (${ns})`;

/** The log of `HEADER` and `lines`. */
export const logOf = (...lines: string[]): ApexLog => parse([HEADER, ...lines].join('\n'));

/** A code unit with a method, a SOQL query and a statement: 4 events, from 10 to 100 ns. */
export const method: readonly string[] = [
  `${at(10)}|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex`,
  `${at(20)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
  `${at(30)}|SOQL_EXECUTE_BEGIN|[2]|Aggregations:0|SELECT Id FROM Account`,
  `${at(50)}|SOQL_EXECUTE_END|[2]|Rows:4`,
  `${at(60)}|STATEMENT_EXECUTE|[3]`,
  `${at(90)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
  `${at(100)}|CODE_UNIT_FINISHED|execute_anonymous_apex`,
];

const END_MARK = { exit: '', next: '', unwind: '~', 'log-end': '!' } as const;

/**
 * Each event as `depth type@start-end`, a leaf with no end; a frame ends `~` when an exit further
 * out ended it, `!` when the log stopped first.
 */
export const outline = (log: ApexLog): string[] =>
  [...log.events].map(
    (e) =>
      `${'  '.repeat(e.depth - 1)}${e.type}@${e.startTimestamp}${e.isFrame ? `-${e.endTimestamp}${END_MARK[e.endedBy]}` : ''}`,
  );

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
