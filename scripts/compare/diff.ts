/**
 * Compares two projections record by record, and reports where they first differ.
 *
 * Both sides are in pre-order, which is the order of their path keys, so the records join like a
 * merge of two sorted lists. A node only one side has is reported once, and the records after it
 * still line up.
 */

import type { Projection } from './project.js';
import { canonical, LOG_KEY } from './project.js';

export interface Difference {
  /** The record, e.g. `log` or `0/3/1`. */
  key: string;
  /** The field path inside the record, e.g. `duration.self`. Empty when one side lacks the record. */
  path: string;
  left: string;
  right: string;
}

export interface DiffResult {
  /** Records compared, counting a record only one side has. */
  records: number;
  /** Records that differ. Counts every one, past `limit`. */
  differing: number;
  /** The first differences, at most `limit` records' worth. */
  differences: Difference[];
}

const ABSENT = '<absent>';
const PATHS_PER_RECORD = 5;

export function diffProjections(left: Projection, right: Projection, limit = 20): DiffResult {
  const a = left[Symbol.iterator]();
  const b = right[Symbol.iterator]();
  const result: DiffResult = { records: 0, differing: 0, differences: [] };
  const report = (found: Omit<Difference, 'key'>[], key: string): void => {
    result.differing++;
    if (result.differing <= limit) {
      result.differences.push(...found.slice(0, PATHS_PER_RECORD).map((d) => ({ key, ...d })));
    }
  };

  let x = a.next();
  let y = b.next();
  while (!x.done || !y.done) {
    result.records++;
    const order = x.done ? 1 : y.done ? -1 : compareKeys(x.value[0], y.value[0]);
    if (order < 0 && !x.done) {
      report([{ path: '', left: x.value[0], right: ABSENT }], x.value[0]);
      x = a.next();
    } else if (order > 0 && !y.done) {
      report([{ path: '', left: ABSENT, right: y.value[0] }], y.value[0]);
      y = b.next();
    } else if (!x.done && !y.done) {
      if (!same(x.value[1], y.value[1])) report(paths(x.value[1], y.value[1], ''), x.value[0]);
      x = a.next();
      y = b.next();
    }
  }
  return result;
}

/** Pre-order: the log first, then node paths compared position by position. */
export function compareKeys(p: string, q: string): number {
  if (p === q) return 0;
  if (p === LOG_KEY) return -1;
  if (q === LOG_KEY) return 1;
  const ps = p.split('/');
  const qs = q.split('/');
  for (let i = 0; i < Math.min(ps.length, qs.length); i++) {
    const d = Number(ps[i]) - Number(qs[i]);
    if (d) return d;
  }
  // An ancestor comes before its descendants.
  return ps.length - qs.length;
}

/** Structural equality: key order does not count, and `undefined` is not the same as absent. */
export function same(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => k in rb && same(ra[k], rb[k]));
}

function paths(a: unknown, b: unknown, at: string): Omit<Difference, 'key'>[] {
  if (isRecord(a) && isRecord(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => {
      const next = at ? `${at}.${k}` : k;
      if (!(k in a)) return [{ path: next, left: ABSENT, right: canonical(b[k]) }];
      if (!(k in b)) return [{ path: next, left: canonical(a[k]), right: ABSENT }];
      return paths(a[k], b[k], next);
    });
  }
  return same(a, b) ? [] : [{ path: at, left: canonical(a), right: canonical(b) }];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}
