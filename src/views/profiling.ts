/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** The kind of row a `CUMULATIVE_PROFILING` section lists. */
export const PROFILING_SECTION = {
  Soql: 'soql',
  Sosl: 'sosl',
  Dml: 'dml',
  Methods: 'methods',
} as const;

/** The kind of row a `CUMULATIVE_PROFILING` section lists: `details.section`. */
export type ProfilingSection = (typeof PROFILING_SECTION)[keyof typeof PROFILING_SECTION];

/** One `CUMULATIVE_PROFILING` section and its rows. */
export interface ProfilingDetails {
  /** Null for a header this parser does not know. */
  readonly section: ProfilingSection | null;
  /**
   * Empty when the log states no profiling information for the section. A line whose text between
   * its first two `|` is all capitals and `_` looks like an event, so it is not read.
   */
  readonly rows: readonly ProfilingRow[];
}

/** One row of a section: what ran, how often, and how long in all. */
export interface ProfilingRow {
  /** As the log states it: `'Class.MyClass.run'`, `'External entry point'`. Null for `(ns)`. */
  readonly location: string | null;
  /** From the `(ns)` form only; a class's own namespace stays in `location`. Null otherwise. */
  readonly namespace: string | null;
  /** Null when the row states none, as `External entry point`: its `location` names it. */
  readonly lineNumber: number | null;
  /** Null when the row states none. */
  readonly column: number | null;
  /** The method signature, query or DML operation, as the log states it, less its empty lines. */
  readonly detail: string;
  readonly count: number;
  /** Nanoseconds, to the whole millisecond the log states. */
  readonly duration: number;
}

const SECTIONS = new Map<string, ProfilingSection>([
  ['SOQL operations', 'soql'],
  ['SOSL operations', 'sosl'],
  ['DML operations', 'dml'],
  ['method invocations', 'methods'],
]);

const NONE_FOR = 'No profiling information for ';
const EXECUTED = /: executed (\d+) times? in (\d+) ms\s*$/;
const LINE_COLUMN = /^line (\d+), column (\d+): /;
const NS_PER_MS = 1_000_000;

/**
 * A `CUMULATIVE_PROFILING` header and the rows in `body`, its continuation lines. A row ends at the
 * line that ends `executed …`, so a query can span lines. A row a truncated log cut off is left out.
 */
export function profilingDetails(header: string | null, body: string): ProfilingDetails {
  const name = header?.startsWith(NONE_FOR) ? header.slice(NONE_FOR.length) : header;
  const rows: ProfilingRow[] = [];
  let rowStart = 0;
  for (let lineStart = 0; lineStart <= body.length; ) {
    const lf = body.indexOf('\n', lineStart);
    const end = lf < 0 ? body.length : lf;
    const executed = EXECUTED.exec(body.slice(lineStart, end));
    if (executed) {
      rows.push(row(body.slice(rowStart, lineStart + executed.index), executed));
      rowStart = end + 1;
    }
    lineStart = end + 1;
  }
  return { section: SECTIONS.get(name ?? '') ?? null, rows: Object.freeze(rows) };
}

/** A row's head, as `Class.MyClass.run: line 10, column 1: <detail>`, with its count and time. */
function row(head: string, executed: RegExpExecArray): ProfilingRow {
  // The pattern matched two digit runs.
  const count = Number.parseInt(executed[1]!, 10);
  const duration = Number.parseInt(executed[2]!, 10) * NS_PER_MS;
  // `(ns): <detail>` states a namespace where other rows state a location.
  const close = head[0] === '(' ? head.indexOf('): ') : -1;
  if (close > 0) {
    const detail = head.slice(close + 3);
    const namespace = head.slice(1, close);
    return { location: null, namespace, lineNumber: null, column: null, detail, count, duration };
  }
  const colon = head.indexOf(': ');
  const rest = colon < 0 ? head : head.slice(colon + 2);
  const at = colon < 0 ? null : LINE_COLUMN.exec(rest);
  return {
    location: colon < 0 ? null : head.slice(0, colon),
    namespace: null,
    // The pattern matched two digit runs.
    lineNumber: at ? Number.parseInt(at[1]!, 10) : null,
    column: at ? Number.parseInt(at[2]!, 10) : null,
    detail: at ? rest.slice(at[0].length) : rest,
    count,
    duration,
  };
}
