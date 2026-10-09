/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { idOfType } from '../catalog/catalog.js';
import type { Store } from '../store/store.js';
import type { Issues } from './issues.js';
import { ISSUE_TYPE } from './issues.js';
import { EXIT_LINE } from './tables.js';

const THROWN = idOfType('EXCEPTION_THROWN');
const FATAL = idOfType('FATAL_ERROR');
// The platform writes these once execution ends, so a throw before them can be caught or not.
const AFTER_EXECUTION = new Set(
  (
    [
      'CUMULATIVE_LIMIT_USAGE',
      'LIMIT_USAGE_FOR_NS',
      'TESTING_LIMITS',
      'CUMULATIVE_PROFILING_BEGIN',
    ] as const
  ).map(idOfType),
);
const UNKNOWN = -1;
const UNCAUGHT = 0;
const CAUGHT = 1;

/**
 * What the rows after each throw say of it, indexed by row id: the log goes on, or a `FATAL_ERROR`
 * ends it. A run of throws with only exit lines between takes the answer of the row after the run.
 * One pass over the throws and those lines.
 */
export function throwOutcomes(store: Store, issues: Issues): Int8Array {
  const { type, count } = store;
  const throws = store.rowsOfType(THROWN);
  const out = new Int8Array(count).fill(UNKNOWN);
  // The first row after each part the platform dropped, in log order.
  const cuts = issues.list
    .filter((issue) => issue.type === ISSUE_TYPE.Skip)
    .map((issue) => issue.after)
    .sort((a, b) => a - b);
  let cut = 0;
  for (let i = 0; i < throws.length; ) {
    // Each entry and each id below count is a row.
    const first = throws[i]!;
    let next = first + 1;
    while (next < count && (EXIT_LINE[type[next]!] === 1 || type[next] === THROWN)) next++;
    while (cut < cuts.length && cuts[cut]! <= first) cut++;
    const after = next < count ? type[next]! : -1;
    const outcome =
      after < 0 || AFTER_EXECUTION.has(after) || (cut < cuts.length && cuts[cut]! <= next)
        ? UNKNOWN
        : after === FATAL
          ? UNCAUGHT
          : CAUGHT;
    for (; i < throws.length && throws[i]! < next; i++) out[throws[i]!] = outcome;
  }
  return out;
}

/** Row `id`'s outcome in `outcomes`, as `caught` states it. */
export function caughtOf(outcomes: Int8Array, id: number): boolean | null {
  const outcome = outcomes[id];
  return outcome === undefined || outcome === UNKNOWN ? null : outcome === CAUGHT;
}
