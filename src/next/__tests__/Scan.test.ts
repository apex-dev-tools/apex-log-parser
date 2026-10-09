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
    // A running total, so the flow residual pass has work.
    `09:00:00.0 (${at + 8})|FLOW_ELEMENT_BEGIN|abc-1|FlowRecordUpdate|Update_Account`,
    `09:00:00.0 (${at + 9})|FLOW_ELEMENT_LIMIT_USAGE|1 DML statements, total ${i + 1} out of 150`,
    `09:00:00.0 (${at + 10})|FLOW_ELEMENT_END|abc-1|FlowRecordUpdate|Update_Account`,
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
  // Each row's pool figures, or null for a row with no slot.
  const pooled = (slots: Int32Array, pool: Int32Array | Float64Array, stride: number) =>
    Array.from({ length: count }, (_, id) => {
      const slot = slots[id] ?? -1;
      return slot < 0 ? null : Array.from(pool.slice(slot * stride, (slot + 1) * stride));
    });
  return {
    columns: [store.type, store.parent, store.depth, store.subtreeEnd, store.timestamp]
      .map(column)
      .concat([column(store.exitStamp), column(store.durationSelf), totals]),
    counts: pooled(store.countSlot, store.counts, 14),
    heap: pooled(store.heapSlot, store.heap, 5),
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

describe('LogBuilder.settle', () => {
  it('runs the passes in slices to the same build as in one call', () => {
    const sliced = builder();
    while (!sliced.scan(Number.POSITIVE_INFINITY));
    let slices = 1;
    // A deadline already past stops each pass at its first clock read.
    while (!sliced.settle(Number.NEGATIVE_INFINITY)) slices++;
    // Two stops each in the rollup and the flow pass, and one per trimmed column but the last.
    expect(slices).toBe(1 + 2 + 2 + 13);
    expect(figures(sliced.finish())).toEqual(figures(builder().build()));
  });

  it('settles a log with no events in one call', () => {
    const empty = new LogBuilder(new NodeSource(encode('')));
    expect(empty.scan(Number.NEGATIVE_INFINITY)).toBe(true);
    // The trim still stops after each column.
    let slices = 1;
    while (!empty.settle(Number.NEGATIVE_INFINITY)) slices++;
    expect(slices).toBe(14);
    expect(empty.finish().store.count).toBe(1);
  });
});
