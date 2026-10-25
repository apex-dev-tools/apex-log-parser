/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { ByteFields } from '../bytes/cursor.js';
import { NodeSource } from '../bytes/node.js';
import type { Source } from '../bytes/source.js';
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

/** A method around a debug line of multi-byte characters: 2 events. */
export const SMALL_LOG: string = [
  '64.0 APEX_CODE,FINE',
  '09:00:00.001 (1000)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.run()',
  '09:00:00.001 (1500)|USER_DEBUG|[2]|DEBUG|café ☕ 😀',
  '09:00:00.001 (4000)|METHOD_EXIT|[1]|01p000000000AAA|MyClass.run()',
].join('\n');

/** Enough lines that a parse takes many slices. */
export function longLog(): string {
  const lines = ['64.0 APEX_CODE,FINE'];
  for (let i = 0; i < 200_000; i++)
    lines.push(`09:00:00.0 (${i + 1})|USER_DEBUG|[1]|DEBUG|line ${i}`);
  return lines.join('\n');
}

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

/**
 * The engine's `Fields` over a line and its continuation lines. `onContinuation` runs on each read
 * of the continuation.
 */
export function fieldsOf(line: string, continuation = '', onContinuation?: () => void): Fields {
  const end = encode(line).length;
  const bytes = encode(continuation ? `${line}\n${continuation}` : line);
  const fields = watchedFields(new NodeSource(bytes), end, onContinuation);
  fields.reset(0, end, continuation ? end + 1 : end, bytes.length);
  return fields;
}

/** A `ByteFields` over `source` that runs `onContinuation` on each read past `end`. */
export function watchedFields(
  source: Source,
  end: number,
  onContinuation?: () => void,
): ByteFields {
  return new ByteFields({
    bytes: source.bytes,
    words: source.words,
    lineEnd: (from) => source.lineEnd(from),
    text: (from, to) => {
      if (to > end) onContinuation?.();
      return source.text(from, to);
    },
  });
}
