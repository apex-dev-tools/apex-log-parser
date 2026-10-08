/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { NodeSource } from '../bytes/node.js';
import type { Built } from '../engine/builder.js';
import { LogBuilder } from '../engine/builder.js';
import { encode } from './helpers.js';

// Enough events that a scan stopped every 256 steps stops inside frames and between them.
const lines = ['64.0 APEX_CODE,FINE'];
for (let i = 0; i < 400; i++) {
  const at = i * 100;
  lines.push(
    `09:00:00.0 (${at + 1})|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.run()`,
    `09:00:00.0 (${at + 2})|STATEMENT_EXECUTE|[2]`,
    `09:00:00.0 (${at + 3})|METHOD_ENTRY|[3]|01p000000000AAA|MyClass.work()`,
    `09:00:00.0 (${at + 4})|HEAP_ALLOCATE|[4]|Bytes:8`,
    `09:00:00.0 (${at + 5})|METHOD_EXIT|[3]|01p000000000AAA|MyClass.work()`,
    `09:00:00.0 (${at + 6})|METHOD_EXIT|[1]|01p000000000AAA|MyClass.run()`,
    `09:00:00.0 (${at + 7})|USER_DEBUG|[5]|DEBUG|done`,
  );
}
// A frame the log never closes, so the last scan closes it.
lines.push('09:00:00.0 (50000)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.last()');
const bytes = encode(lines.join('\n'));

const builder = (): LogBuilder => new LogBuilder(new NodeSource(bytes));

/** Every column and figure a build states, as plain values. */
function figures(built: Built): unknown {
  const { store } = built;
  const count = store.count;
  const column = (c: ArrayLike<number>) => Array.from(c).slice(0, count);
  const totals = Array.from({ length: count }, (_, id) => store.durationTotal(id));
  return {
    columns: [store.type, store.parent, store.depth, store.subtreeEnd, store.timestamp]
      .map(column)
      .concat([column(store.exitStamp), column(store.durationSelf), totals]),
    issues: built.issues.list,
    truncation: built.truncation,
    executionEndTime: built.executionEndTime,
  };
}

describe('LogBuilder.scan', () => {
  it('builds the same log in slices as in one call', () => {
    const sliced = builder();
    let slices = 1;
    // A deadline already past stops each scan at its first clock read.
    while (!sliced.scan(Number.NEGATIVE_INFINITY)) slices++;
    expect(slices).toBeGreaterThan(5);
    expect(figures(sliced.finish())).toEqual(figures(builder().build()));
  });

  it('scans a log with no events in one call', () => {
    const empty = new LogBuilder(new NodeSource(encode('')));
    expect(empty.scan(Number.NEGATIVE_INFINITY)).toBe(true);
    expect(empty.finish().store.count).toBe(1);
  });
});
