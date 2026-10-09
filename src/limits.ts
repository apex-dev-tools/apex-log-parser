/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** One governor limit: what the code used, and the ceiling the log stated. */
export interface LimitValue {
  used: number;
  /** 0 when the log stated no ceiling. */
  limit: number;
  /** Null when the log stated no ceiling. */
  percentUsed: number | null;
}

/** Governor limit usage. `cpuTime` is milliseconds, `heapSize` is bytes, every other metric a count. */
export interface Limits {
  soqlQueries: LimitValue;
  soslQueries: LimitValue;
  queryRows: LimitValue;
  dmlStatements: LimitValue;
  publishImmediateDml: LimitValue;
  dmlRows: LimitValue;
  cpuTime: LimitValue;
  heapSize: LimitValue;
  callouts: LimitValue;
  emailInvocations: LimitValue;
  futureCalls: LimitValue;
  queueableJobsAddedToQueue: LimitValue;
  mobileApexPushCalls: LimitValue;
}

export type LimitMetric = keyof Limits;

/** The units a limit metric is stated in. */
export const LIMIT_UNIT = {
  Count: 'count',
  Millisecond: 'millisecond',
  Byte: 'byte',
} as const;

export type LimitUnit = (typeof LIMIT_UNIT)[keyof typeof LIMIT_UNIT];

/** Every limit metric, with the unit its `used` and `limit` are stated in. */
export const LIMIT_METRICS: Readonly<Record<LimitMetric, LimitUnit>> = Object.freeze({
  soqlQueries: LIMIT_UNIT.Count,
  soslQueries: LIMIT_UNIT.Count,
  queryRows: LIMIT_UNIT.Count,
  dmlStatements: LIMIT_UNIT.Count,
  publishImmediateDml: LIMIT_UNIT.Count,
  dmlRows: LIMIT_UNIT.Count,
  cpuTime: LIMIT_UNIT.Millisecond,
  heapSize: LIMIT_UNIT.Byte,
  callouts: LIMIT_UNIT.Count,
  emailInvocations: LIMIT_UNIT.Count,
  futureCalls: LIMIT_UNIT.Count,
  queueableJobsAddedToQueue: LIMIT_UNIT.Count,
  mobileApexPushCalls: LIMIT_UNIT.Count,
});

/** One `LIMIT_USAGE_FOR_NS` block: a namespace's cumulative usage at that point in the log. */
export interface LimitSnapshot {
  /** Nanoseconds. */
  timestamp: number;
  /** The name the block states, `'default'` included. */
  namespace: string;
  limits: Limits;
}

/** One namespace's usage, from the snapshots it reported. */
export interface NamespaceLimits {
  /** Its last snapshot. */
  final: Limits;
  /** The highest value each metric reached in its own snapshots. */
  peak: Limits;
}

/** The log's governor limit usage, from its snapshots. */
export interface GovernorLimits {
  snapshots: LimitSnapshot[];
  /** Each namespace's last snapshot, combined. */
  final: Limits;
  /** The highest each metric of the combined figure reached at any point. */
  peak: Limits;
  /** Per namespace, in the order the log first reports them. */
  byNamespace: Map<string, NamespaceLimits>;
}

function value(used: number, limit: number): LimitValue {
  return { used, limit, percentUsed: limit > 0 ? (used / limit) * 100 : null };
}

/** Every metric at zero, with no ceiling. */
export function emptyLimits(): Limits {
  const zero = (): LimitValue => value(0, 0);
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

const METRICS = Object.keys(emptyLimits()) as LimitMetric[];

// The platform shares these across namespaces, so combining them takes the highest, not the sum.
const SHARED: ReadonlySet<LimitMetric> = new Set<LimitMetric>(['heapSize']);

const LABELS = new Map<string, LimitMetric>([
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
  // The flow reports' labels.
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

const USED_OF = /(\d+)\s*(?:out of|\/)\s*(\d+)/;
const COUNT_LABEL = /^(\d+)\s+(.+)$/;

const CODES = new Map<string, LimitMetric>([
  ['SOQL', 'soqlQueries'],
  ['SOQL_ROWS', 'queryRows'],
  ['SOSL', 'soslQueries'],
  ['DML', 'dmlStatements'],
  ['DML_ROWS', 'dmlRows'],
]);

/** One line's reading of one limit. `cpuTime` is milliseconds, `heapSize` bytes, others a count. */
export interface LimitUsage {
  /** Null for a label or code no metric tracks, such as `AGGS`. */
  readonly metric: LimitMetric | null;
  /** The label or code, as the line states it. */
  readonly label: string;
  readonly used: number;
  readonly limit: number;
}

/** A flow report's running total: `used` so far, and `delta`, what the reporting element used. */
export interface RunningUsage extends LimitUsage {
  readonly delta: number;
}

/** `used out of limit` or `used/limit` in `text`, read as `label`; null when it states neither. */
function usage(label: string, text: string): LimitUsage | null {
  const match = USED_OF.exec(text);
  if (!match) return null;
  return {
    metric: LABELS.get(label) ?? null,
    label,
    // The pattern matched two digit runs.
    used: Number.parseInt(match[1]!, 10),
    limit: Number.parseInt(match[2]!, 10),
  };
}

/** A `LIMIT_USAGE` line's code and figures; null unless the line states all three. */
export function codedUsage(
  code: string | null,
  used: number | null,
  limit: number | null,
): LimitUsage | null {
  if (code === null || used === null || limit === null) return null;
  return { metric: CODES.get(code) ?? null, label: code, used, limit };
}

/** A `Label: used out of limit` line; null when it states no label or no figures. */
export function labelledUsage(text: string): LimitUsage | null {
  const colon = text.indexOf(':');
  return colon < 0 ? null : usage(text.slice(0, colon).trim(), text.slice(colon + 1));
}

/** A running-total line, as `1 SOQL queries, total 1 out of 100`; null when it states no total. */
export function runningUsage(text: string): RunningUsage | null {
  const comma = text.indexOf(',');
  if (comma < 0) return null;
  // A head with no leading count still reports a total, so it is kept with a zero delta.
  const head = text.slice(0, comma).trim();
  const [, count = '0', label = head] = COUNT_LABEL.exec(head) ?? [];
  const found = usage(label, text.slice(comma + 1));
  return found && { ...found, delta: Number.parseInt(count, 10) };
}

// The engine's scan reads the two below. Built on the views' parsers above, they made the scan
// lose its optimised code across a GC (deopt.test.ts), so they stay apart.

/** A flow report's running total of a tracked metric, for the log's figures. */
export interface RunningTotal {
  metric: LimitMetric;
  used: number;
  limit: number;
  delta: number;
}

/** A running-total line, as `1 SOQL queries, total 1 out of 100`; null for an untracked label. */
export function runningTotal(text: string): RunningTotal | null {
  const comma = text.indexOf(',');
  if (comma < 0) return null;
  // A head with no leading count still reports a total, so it is kept with a zero delta.
  const head = text.slice(0, comma).trim();
  const [, count = '0', label = head] = COUNT_LABEL.exec(head) ?? [];
  const metric = LABELS.get(label);
  const match = metric ? USED_OF.exec(text.slice(comma + 1)) : null;
  if (!metric || !match) return null;
  return {
    metric,
    // The pattern matched two digit runs.
    used: Number.parseInt(match[1]!, 10),
    limit: Number.parseInt(match[2]!, 10),
    delta: Number.parseInt(count, 10),
  };
}

/**
 * The usage a limit text states, one `Label: used/limit` or `Label: used out of limit` line per
 * metric: a limit block, or a flow element's report.
 */
export function limitsOfBlock(text: string): Limits {
  const limits = emptyLimits();
  for (const line of text.split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const metric = LABELS.get(line.slice(0, colon).trim());
    const match = metric ? USED_OF.exec(line.slice(colon + 1)) : null;
    if (metric && match) {
      // The pattern matched two digit runs.
      limits[metric] = value(Number.parseInt(match[1]!, 10), Number.parseInt(match[2]!, 10));
    }
  }
  return limits;
}

/** `limit` takes the highest stated ceiling: 0 means none, and no log states two for one metric. */
function fold(
  sources: Iterable<Limits>,
  used: (m: LimitMetric, a: number, b: number) => number,
): Limits {
  const out = emptyLimits();
  for (const source of sources) {
    for (const m of METRICS) {
      const a = out[m];
      const b = source[m];
      out[m] = value(used(m, a.used, b.used), Math.max(a.limit, b.limit));
    }
  }
  return out;
}

const combined = (sources: Iterable<Limits>): Limits =>
  fold(sources, (m, a, b) => (SHARED.has(m) ? Math.max(a, b) : a + b));
const highest = (sources: Iterable<Limits>): Limits => fold(sources, (_m, a, b) => Math.max(a, b));

/**
 * The whole-log and per-namespace figures from snapshots in log order. Each snapshot is
 * cumulative, so a namespace's last is its final figure. `heapPeak` (bytes) comes from the heap
 * events, because a block states heap as 0.
 */
export function governorLimits(snapshots: LimitSnapshot[], heapPeak: number): GovernorLimits {
  const byNamespace = new Map<string, NamespaceLimits>();
  let final = emptyLimits();
  let peak = emptyLimits();
  for (const { namespace, limits } of snapshots) {
    const previous = byNamespace.get(namespace);
    byNamespace.set(namespace, {
      // A copy, so a caller cannot reach the snapshot through it.
      final: highest([limits]),
      peak: highest(previous ? [previous.peak, limits] : [limits]),
    });
    final = combined(Array.from(byNamespace.values(), (ns) => ns.final));
    peak = highest([peak, final]);
  }
  const heap = { ...emptyLimits(), heapSize: value(heapPeak, 0) };
  return { snapshots, final, peak: highest([peak, heap]), byNamespace };
}
