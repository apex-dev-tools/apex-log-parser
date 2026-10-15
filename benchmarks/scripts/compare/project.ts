/**
 * Projects a parse result into canonical records, so two engines can be compared field by field.
 *
 * A projection is a stream of `[key, value]` records: `log` first, then one record per tree node in
 * pre-order. A node's key is its path of child positions from the log, e.g. `0/3/1`, not its
 * id, because two engines may number events differently. Every reference to an event
 * becomes that path.
 */

export type Projection = Iterable<readonly [key: string, value: unknown]>;

export type Entry = Projection extends Iterable<infer E> ? E : never;

/** The key of the log's own record. Sorts before every node path. */
export const LOG_KEY = 'log';

/**
 * A deterministic text form of a projected value, for reports. Keys are sorted, because field
 * order is not part of the output, and `undefined`, `NaN` and `-0` stay distinct from `null` and
 * `0`.
 */
export function canonical(value: unknown): string {
  if (value === undefined) return '"<undefined>"';
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return '"<NaN>"';
    if (Object.is(value, -0)) return '"<-0>"';
    if (!Number.isFinite(value)) return `"<${value}>"`;
    return String(value);
  }
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
}
