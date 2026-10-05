/**
 * Projects a parse result into canonical records, so two engines can be compared field by field.
 *
 * A projection is a stream of `[key, value]` records: `log` first, then one record per tree node in
 * pre-order. A node's key is its path of child positions from the log, e.g. `0/3/1`, not its
 * `eventIndex`, because a new engine may number events differently. Every reference to an event
 * becomes that path.
 */

import type { ApexLog, LogEvent } from '../../src/index.js';

export type Projection = Iterable<readonly [key: string, value: unknown]>;

/** The key of the log's own record. Sorts before every node path. */
export const LOG_KEY = 'log';

// Parser state on every event, or structure the record key already states.
const SKIPPED_FIELDS = new Set(['logParser', 'parent', 'eventsById', 'eventIndex']);

/** The legacy engine's `ApexLog`, as canonical records. */
export function* projectLegacy(log: ApexLog): Projection {
  const paths = new Map<LogEvent, string>([[log, LOG_KEY]]);
  const order = preOrder(log, paths);

  const ref = (event: LogEvent): unknown => {
    const path = paths.get(event);
    // An exit line, or a package event merged into its sibling: the tree never holds it.
    return path === undefined ? { offTree: event.type, at: event.timestamp } : { node: path };
  };

  const plain = (value: unknown, key: string | null): unknown => {
    if (value === null || typeof value !== 'object') {
      if (key !== 'eventIndex' || typeof value !== 'number') return value;
      const event = log.eventsById[value];
      return event ? ref(event) : { missing: value };
    }
    if (isEvent(value)) return ref(value);
    if (Array.isArray(value)) return value.map((item) => plain(item, null));
    if (value instanceof Map) {
      return { map: [...value].map(([k, v]) => [plain(k, null), plain(v, null)]) };
    }
    return fields(value);
  };

  // An event's own fields, and any plain object a field holds. An `eventIndex` inside a plain
  // object, such as an issue's, is a reference; on an event it is the id the key replaces.
  const fields = (value: object): Record<string, unknown> => {
    const own = isEvent(value);
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (own ? !SKIPPED_FIELDS.has(k) : k !== 'logParser') out[k] = plain(v, k);
    }
    return out;
  };

  for (const event of order) yield [paths.get(event) ?? LOG_KEY, fields(event)];
}

/** Every event in pre-order, the log first, recording each node's path as it goes. */
function preOrder(root: LogEvent, paths: Map<LogEvent, string>): LogEvent[] {
  const out: LogEvent[] = [];
  const stack: LogEvent[] = [root];
  while (stack.length) {
    // the loop runs only while the stack is non-empty
    const event = stack.pop()!;
    out.push(event);
    const base = event === root ? '' : `${paths.get(event)}/`;
    // Pushed last to first, so the first child pops first. A loop, not a spread: the root of a
    // large log can hold more children than a call accepts arguments.
    for (let i = event.children.length - 1; i >= 0; i--) {
      // i is inside the bounds of children
      const child = event.children[i]!;
      paths.set(child, `${base}${i}`);
      stack.push(child);
    }
  }
  return out;
}

function isEvent(value: object): value is LogEvent {
  return 'logParser' in value && 'eventIndex' in value;
}

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
