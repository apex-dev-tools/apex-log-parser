/**
 * The facts the next engine states differently from legacy on purpose: legacy bugs it fixes, and
 * facts legacy drops. Each rule undoes its own difference on the next engine's side of one field.
 * A field counts as explained only when the undone value then equals legacy's, so a rule can never
 * hide a difference it does not describe.
 */

import type { Explain } from './diff.js';
import { same } from './diff.js';
import type { CountsFact, EventRef, LogFact } from './facts.js';
import type { Projection } from './project.js';

export type Entry = Projection extends Iterable<infer E> ? E : never;

import { LOG_KEY } from './project.js';

type Rec = Record<string, unknown>;

/** Both projections, by record key, and each record's direct children on the next side. */
export interface Records {
  readonly left: ReadonlyMap<string, Rec>;
  readonly right: ReadonlyMap<string, Rec>;
  readonly children: ReadonlyMap<string, readonly string[]>;
}

export interface KnownDifference {
  readonly name: string;
  /** `value`, the next engine's `field` of record `key`, with this difference undone. */
  undo(key: string, field: string, value: unknown, records: Records): unknown;
}

interface SelfTotal {
  self: number;
  total: number;
}

const PACKAGE = 'ENTERING_MANAGED_PKG';
const MAX_SIZE = 'Max-Size-reached';
const ROWS = ['dmlRows', 'soqlRows', 'soslRows'] as const;

export const KNOWN: readonly KnownDifference[] = [
  {
    // Legacy leaves a package entry at 0 when it ends the log or its run; next times every one.
    name: 'package-duration',
    undo(key, field, value, { left, right, children }) {
      // The log's last event: legacy states no exit, next one at its own start.
      const endsLog = (at: string | undefined): boolean => {
        if (at === undefined) return false;
        const own = right.get(at);
        const stamped = own?.type === PACKAGE && own.exitStamp === own.timestamp;
        return stamped && left.get(at)?.exitStamp === null;
      };
      if (field === 'exitStamp') return endsLog(key) ? null : value;
      // At the top level it is then the last event with an exit, so it ends the execution too.
      if (key === LOG_KEY && field === 'executionEndTime') {
        return endsLog(children.get(LOG_KEY)?.at(-1)) ? left.get(key)?.executionEndTime : value;
      }
      if (field !== 'duration') return value;
      const own = right.get(key);
      const was = left.get(key)?.duration as SelfTotal | undefined;
      const now = value as SelfTotal;
      if (own?.type === PACKAGE && was?.self === 0 && was.total === 0) return was;
      // A parent's self time loses what its package children gained, from legacy's 0 only.
      const gained = (children.get(key) ?? [])
        .filter((child) => right.get(child)?.type === PACKAGE)
        .reduce((sum, child) => {
          const before = left.get(child)?.duration as SelfTotal | undefined;
          if (before?.self !== 0 || before.total !== 0) return sum;
          // child came from the right side's own keys
          return sum + (right.get(child)!.duration as SelfTotal).total;
        }, 0);
      return gained ? { self: now.self + gained, total: now.total } : value;
    },
  },
  {
    // Legacy reads a malformed number as NaN, silently; next states null plus a parsing error.
    name: 'malformed-number',
    undo(key, field, value, { left }) {
      if (field === 'lineNumber' && value === null) {
        const was = left.get(key)?.lineNumber;
        return Number.isNaN(was) ? was : value;
      }
      // Legacy's NaN rows add up through every ancestor; next reads them as none.
      if (field === 'counts') return withNaNRows(value as CountsFact, left.get(key)?.counts);
      if (key !== LOG_KEY || field !== 'parsingErrors') return value;
      return (value as string[]).filter((e) => !/^Invalid (line number|row count): /.test(e));
    },
  },
  {
    // Legacy's code unit never reads its line-number field, so it states none.
    name: 'code-unit-line',
    undo(key, field, value, { right }) {
      if (field !== 'lineNumber' || right.get(key)?.type !== 'CODE_UNIT_STARTED') return value;
      return null;
    },
  },
  {
    // Legacy misses the maximum-size marker when the platform writes it inside an event's line.
    name: 'max-size-in-line',
    undo(key, field, value, { left, right }) {
      if (key !== LOG_KEY) return value;
      // explain runs only on a record both sides hold
      const was = left.get(key) as unknown as LogFact;
      const now = right.get(key) as unknown as LogFact;
      const legacyRegions = was.truncation.regions.some((r) => r.kind === 'max-size')
        ? now.truncation.regions
        : now.truncation.regions.filter((r) => r.kind !== 'max-size');
      if (field === 'isTruncated') return legacyRegions.length > 0;
      if (field === 'issues') {
        const stated = was.issues.some((i) => i.summary === MAX_SIZE);
        return stated ? value : (value as LogFact['issues']).filter((i) => i.summary !== MAX_SIZE);
      }
      if (field === 'truncation')
        return { ...(value as LogFact['truncation']), regions: legacyRegions };
      return value;
    },
  },
  {
    // Legacy refers to a merged package entry, which the tree drops; next to the entry it merged into.
    name: 'merged-package-issue',
    undo(key, field, value, { left, right }) {
      if (key !== LOG_KEY || (field !== 'issues' && field !== 'truncation')) return value;
      const was = left.get(key) as unknown as LogFact;
      const merged = (now: EventRef, then: EventRef | undefined): EventRef => {
        if (!now || !('node' in now) || !then || !('offTree' in then)) return now;
        const into = right.get(now.node);
        const span = [into?.timestamp, into?.exitStamp] as (number | null)[];
        const inside = (span[0] ?? Infinity) <= then.at && then.at <= (span[1] ?? -Infinity);
        return into?.type === PACKAGE && then.offTree === PACKAGE && inside ? then : now;
      };
      if (field === 'issues') {
        return (value as LogFact['issues']).map((issue, i) => ({
          ...issue,
          at: merged(issue.at, was.issues[i]?.at),
        }));
      }
      const now = value as LogFact['truncation'];
      return {
        ...now,
        regions: now.regions.map((region, i) => ({
          ...region,
          at: merged(region.at, was.truncation.regions[i]?.at),
        })),
      };
    },
  },
];

/** `counts` with each row counter legacy states as NaN set back to NaN. */
function withNaNRows(now: CountsFact, was: unknown): CountsFact {
  const then = was as CountsFact | undefined;
  if (!then) return now;
  const out = { ...now };
  for (const rows of ROWS) {
    const nan = (n: number): boolean => Number.isNaN(n);
    out[rows] = {
      self: nan(then[rows].self) ? Number.NaN : now[rows].self,
      total: nan(then[rows].total) ? Number.NaN : now[rows].total,
    };
  }
  return out;
}

/** Takes both projections whole, because a rule can need records the diff has not reached. */
export function explainer(
  left: readonly Entry[],
  right: readonly Entry[],
  rules: readonly KnownDifference[] = KNOWN,
): Explain {
  // Most logs have no difference, so the lookups wait for the first one.
  let lookups: Records | null = null;
  const records = (): Records =>
    (lookups ??= {
      left: new Map(left.map(([k, v]) => [k, v as Rec])),
      right: new Map(right.map(([k, v]) => [k, v as Rec])),
      children: childrenOf(right.map(([k]) => k)),
    });
  return (key, field, was, now) => {
    const used: string[] = [];
    let value = now;
    for (const rule of rules) {
      const undone = rule.undo(key, field, value, records());
      if (!same(undone, value)) used.push(rule.name);
      value = undone;
    }
    return used.length && same(was, value) ? used : null;
  };
}

function childrenOf(keys: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const key of keys) {
    if (key === LOG_KEY) continue;
    const cut = key.lastIndexOf('/');
    const parent = cut < 0 ? LOG_KEY : key.slice(0, cut);
    const list = out.get(parent);
    if (list) list.push(key);
    else out.set(parent, [key]);
  }
  return out;
}
