/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Shared parsing for governor-limit log lines. One label map + one number parser serve every
 * limit-reporting format so the mappings live in a single place:
 * - `LIMIT_USAGE_FOR_NS` cumulative block   — "Number of SOQL queries: 8 out of 100"
 * - flow colon reports                       — "SOQL queries: 0 out of 100"
 * - flow running-total reports               — "1 SOQL queries, total 1 out of 100"
 * - single `LIMIT_USAGE`                      — code "SOQL", used "1", limit "100"
 */

import type {
  GovernorLimits,
  GovernorSnapshot,
  LimitValue,
  Limits,
  NamespaceLimits,
} from './types.js';

/** Metric key of a governor limit that can be tracked granularly. */
export type LimitMetricKey = keyof Limits;

/** A limit value with `percentUsed` derived, null when the log stated no ceiling. */
export function toLimitValue(used: number, limit: number): LimitValue {
  return { used, limit, percentUsed: limit > 0 ? (used / limit) * 100 : null };
}

/** Every metric at zero, with no ceiling. The one place a `Limits` is built from nothing. */
export function emptyLimits(): Limits {
  const zero = (): LimitValue => toLimitValue(0, 0);
  return {
    soqlQueries: zero(),
    soslQueries: zero(),
    queryRows: zero(),
    dmlStatements: zero(),
    publishImmediateDml: zero(),
    dmlRows: zero(),
    cpuTime: zero(),
    heapSize: zero(),
    callouts: zero(),
    emailInvocations: zero(),
    futureCalls: zero(),
    queueableJobsAddedToQueue: zero(),
    mobileApexPushCalls: zero(),
  };
}

/**
 * A single governor-limit observation parsed from a limit-usage log line. `used`/`limit` are the
 * cumulative values reported for that metric at the point in the log where the line was emitted.
 */
export interface LimitObservation {
  metric: LimitMetricKey;
  used: number;
  limit: number;
}

/**
 * A running-total observation, e.g. "1 SOQL queries, total 1 out of 100". `delta` is the leading
 * incremental count: how much the reporting event itself used since the last report.
 */
export interface RunningTotalObservation extends LimitObservation {
  delta: number;
}

/** An empty limit set: no snapshots, so nothing derived from them either. */
export function emptyGovernorLimits(): GovernorLimits {
  return { snapshots: [], final: emptyLimits(), peak: emptyLimits(), byNamespace: new Map() };
}

// Exhaustive by construction: the keys of a total `Limits`, so no metric can be missed.
const LIMIT_METRIC_KEYS = Object.keys(emptyLimits()) as LimitMetricKey[];

/**
 * Limits the platform shares across namespaces, so the per-namespace figures are not additive:
 * combining them takes the highest, not the sum.
 */
const SHARED_METRICS: ReadonlySet<LimitMetricKey> = new Set<LimitMetricKey>(['heapSize']);

/**
 * Fold `used` per metric across sources. `limit` takes the highest stated ceiling, because 0 means
 * the source stated none and no log states two different ceilings for one metric.
 */
function foldLimits(
  sources: Iterable<Limits>,
  foldUsed: (metric: LimitMetricKey, running: number, next: number) => number,
): Limits {
  const folded = emptyLimits();
  for (const source of sources) {
    for (const metric of LIMIT_METRIC_KEYS) {
      const running = folded[metric];
      const next = source[metric];
      folded[metric] = toLimitValue(
        foldUsed(metric, running.used, next.used),
        Math.max(running.limit, next.limit),
      );
    }
  }
  return folded;
}

/** Combine per-namespace limits into one figure: summed, except the shared limits. */
function combineLimits(sources: Iterable<Limits>): Limits {
  return foldLimits(sources, (metric, running, next) =>
    SHARED_METRICS.has(metric) ? Math.max(running, next) : running + next,
  );
}

/** The highest `used` each metric reached across the sources. */
function maxLimits(sources: Iterable<Limits>): Limits {
  return foldLimits(sources, (_metric, running, next) => Math.max(running, next));
}

/** A detached copy, so a caller cannot reach back into the snapshot it came from. */
function copyLimits(limits: Limits): Limits {
  return maxLimits([limits]);
}

/** A source that states heap alone, so a heap figure from elsewhere folds in like any other. */
function heapOnly(used: number): Limits {
  return { ...emptyLimits(), heapSize: toLimitValue(used, 0) };
}

/**
 * Derives the whole-log and per-namespace figures from the snapshots, which are in log order. A
 * namespace states a cumulative total each time, so its last snapshot is its final figure, and the
 * combined figure at any timepoint carries every other namespace forward.
 *
 * `heapPeak` is folded into the combined peak because it comes from the `HEAP_ALLOCATE` events, not
 * from a snapshot: an observed block states heap as 0, so it is the only heap figure most logs give.
 */
export function deriveGovernorLimits(
  snapshots: GovernorSnapshot[],
  heapPeak: number,
): GovernorLimits {
  const byNamespace = new Map<string, NamespaceLimits>();
  let final = emptyLimits();
  let peak = emptyLimits();

  for (const { namespace, limits } of snapshots) {
    const previous = byNamespace.get(namespace);
    byNamespace.set(namespace, {
      final: copyLimits(limits),
      peak: previous ? maxLimits([previous.peak, limits]) : copyLimits(limits),
    });
    final = combineLimits(Array.from(byNamespace.values(), (nsLimits) => nsLimits.final));
    peak = maxLimits([peak, final]);
  }

  return { snapshots, final, peak: maxLimits([peak, heapOnly(heapPeak)]), byNamespace };
}

/**
 * Every known governor-limit label → metric key. Covers the cumulative block ("Number of …" /
 * "Maximum …"), the flow colon reports, and the flow running-total reports ("ms CPU time").
 * Labels not present here are not tracked governor limits (e.g. FIELDS_DESCRIBES).
 */
const LIMIT_LABELS = new Map<string, LimitMetricKey>([
  // LIMIT_USAGE_FOR_NS cumulative block
  ['Number of SOQL queries', 'soqlQueries'],
  ['Number of query rows', 'queryRows'],
  ['Number of SOSL queries', 'soslQueries'],
  ['Number of DML statements', 'dmlStatements'],
  ['Number of Publish Immediate DML', 'publishImmediateDml'],
  ['Number of DML rows', 'dmlRows'],
  ['Maximum CPU time', 'cpuTime'],
  ['Maximum heap size', 'heapSize'],
  ['Number of callouts', 'callouts'],
  ['Number of Email Invocations', 'emailInvocations'],
  ['Number of future calls', 'futureCalls'],
  ['Number of queueable jobs added to the queue', 'queueableJobsAddedToQueue'],
  ['Number of Mobile Apex push calls', 'mobileApexPushCalls'],
  // Flow colon reports + running-total labels
  ['SOQL queries', 'soqlQueries'],
  ['SOQL query rows', 'queryRows'],
  ['SOSL queries', 'soslQueries'],
  ['DML statements', 'dmlStatements'],
  ['DML rows', 'dmlRows'],
  ['CPU time in ms', 'cpuTime'],
  ['ms CPU time', 'cpuTime'],
  ['Heap size in bytes', 'heapSize'],
  ['Callouts', 'callouts'],
  ['Email invocations', 'emailInvocations'],
  ['Future calls', 'futureCalls'],
  ['Jobs in queue', 'queueableJobsAddedToQueue'],
]);

/**
 * Governor-limit codes for the single-line LIMIT_USAGE format. Non-governor codes
 * (FIELDS_DESCRIBES, FIELDSETS_DESCRIBES, AGGS, SCRIPT_STATEMENTS) are intentionally omitted.
 */
const LIMIT_USAGE_CODES = new Map<string, LimitMetricKey>([
  ['SOQL', 'soqlQueries'],
  ['SOQL_ROWS', 'queryRows'],
  ['SOSL', 'soslQueries'],
  ['DML', 'dmlStatements'],
  ['DML_ROWS', 'dmlRows'],
]);

/** Matches "<used> out of <limit>" or "<used>/<limit>". */
const USED_OF_RE = /(\d+)\s*(?:out of|\/)\s*(\d+)/;

/** Matches the "<count> <label>" head of a running-total line, e.g. "1 SOQL queries". */
const COUNT_LABEL_RE = /^(\d+)\s+(.+)$/;

function toInt(value: string): number {
  return Number.parseInt(value, 10);
}

function used(metric: LimitMetricKey | undefined, text: string): LimitObservation | null {
  if (!metric) {
    return null;
  }
  const match = USED_OF_RE.exec(text);
  return match ? { metric, used: toInt(match[1]!), limit: toInt(match[2]!) } : null;
}

/**
 * Parse a labelled limit line, e.g. "Number of SOQL queries: 8 out of 100" (cumulative block) or
 * "SOQL queries: 0 out of 100" (flow). Returns null for untracked labels.
 */
export function parseLabelledLimit(body: string): LimitObservation | null {
  const colon = body.indexOf(':');
  if (colon === -1) {
    return null;
  }
  return used(LIMIT_LABELS.get(body.slice(0, colon).trim()), body.slice(colon + 1));
}

/**
 * Parse a running-total limit line, e.g. "1 SOQL queries, total 1 out of 100". Uses the reported
 * running total as `used` and the leading count as `delta`. Returns null for untracked labels.
 */
export function parseTotalLimit(body: string): RunningTotalObservation | null {
  const comma = body.indexOf(',');
  if (comma === -1) {
    return null;
  }
  // A head with no leading count still reports a usable total, so keep it with a zero delta.
  const head = body.slice(0, comma).trim();
  const [, count = '0', label = head] = COUNT_LABEL_RE.exec(head) ?? [];
  const observation = used(LIMIT_LABELS.get(label), body.slice(comma + 1));
  return observation ? { ...observation, delta: toInt(count) } : null;
}

/**
 * Parse a single-line LIMIT_USAGE record, e.g. code "SOQL", used "1", limit "100".
 * Returns null for non-governor codes.
 */
export function parseCodedLimit(
  code: string | undefined,
  usedValue: string | undefined,
  limit: string | undefined,
): LimitObservation | null {
  const metric = code ? LIMIT_USAGE_CODES.get(code) : undefined;
  return metric ? { metric, used: toInt(usedValue ?? '0'), limit: toInt(limit ?? '0') } : null;
}
