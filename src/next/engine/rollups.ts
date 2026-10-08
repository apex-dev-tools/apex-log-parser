/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Store } from '../store/store.js';
import { COUNTERS, HEAP, NONE, SELF, TOTAL } from '../store/store.js';

/** A flow limit line's running total, which the flow residual pass reads. */
export interface FlowTotal {
  /** A `COUNTER` value. */
  counter: number;
  used: number;
  delta: number;
}

/**
 * The last top-level package entry, when it merged into the run before it. Today sets the log's
 * times before the merge, so they still see it, and the kept entry's exit before the merge.
 */
export interface MergedTail {
  /** Nanoseconds. */
  timestamp: number;
  kept: number;
  /** Nanoseconds; the kept entry's exit before this one merged. */
  keptExit: number;
}

/** A row's total nanoseconds: from its line to its exit, or 0 without one, as today. */
function total(store: Store, id: number): number {
  // id is a row the store holds
  const exit = store.exitStamp[id]!;
  return exit ? exit - store.timestamp[id]! : 0;
}

/**
 * Today's `setTimes` for row 0: from the first top-level event to the last one's end. Returns
 * the execution end: the exit of the last top-level event that has one, or 0.
 */
export function setLogTimes(store: Store, tail: MergedTail | null): number {
  let start = 0;
  let last = NONE;
  let executionEnd = 0;
  // Each top-level event's subtree ends where the next one starts; every id here is a row.
  for (let id = 1; id < store.count; id = store.subtreeEnd[id]!) {
    if (!start) start = store.timestamp[id]!;
    last = id;
    const exit = tail && id === tail.kept ? tail.keptExit : store.exitStamp[id]!;
    if (exit) executionEnd = exit;
  }
  let end = 0;
  // Nothing follows a merged tail, so it has no exit of its own.
  if (tail) end = tail.timestamp;
  else if (last !== NONE) end = store.exitStamp[last]! || store.timestamp[last]!;
  store.timestamp[0] = start;
  store.exitStamp[0] = end;
  return executionEnd;
}

/**
 * Today's `aggregateTotals`: each row's counts, heap and duration into its parent. Rows are in
 * prefix order, so going down from the last id adds every subtree before its root moves up.
 * Counts and heap sum, the heap peak takes the highest, and heap self comes from leaves only.
 */
export function rollUp(store: Store, isFrame: Uint8Array): void {
  // The column starts at 0, and each row adds its total and takes it off its parent.
  for (let id = store.count - 1; id > 0; id--) {
    // id > 0, so it has a parent row
    const parent = store.parent[id]!;
    const time = total(store, id);
    store.durationSelf[id]! += time;
    store.durationSelf[parent]! -= time;
    if (store.countSlot[id] !== NONE) {
      const to = store.countsOf(parent);
      const from = store.countsOf(id);
      const counts = store.counts;
      for (let c = 0; c < COUNTERS; c++)
        counts[to + c * 2 + TOTAL]! += counts[from + c * 2 + TOTAL]!;
    }
    if (store.heapSlot[id] !== NONE) {
      const to = store.heapOf(parent);
      const from = store.heapOf(id);
      const heap = store.heap;
      heap[to + HEAP.allocatedTotal]! += heap[from + HEAP.allocatedTotal]!;
      heap[to + HEAP.grossTotal]! += heap[from + HEAP.grossTotal]!;
      // id is a row, so it has a type
      if (!isFrame[store.type[id]!]) {
        heap[to + HEAP.allocatedSelf]! += heap[from + HEAP.allocatedSelf]!;
        heap[to + HEAP.grossSelf]! += heap[from + HEAP.grossSelf]!;
      }
      if (heap[from + HEAP.peak]! > heap[to + HEAP.peak]!)
        heap[to + HEAP.peak] = heap[from + HEAP.peak]!;
    }
  }
  store.durationSelf[0]! += total(store, 0);
}

/**
 * Today's `applyFlowDbResiduals`, after `rollUp`: a flow element gets the part of the database
 * work its limit lines report that no statement under it accounts for. Elements go innermost
 * first, so a nested one's residual is in its parent's total before the parent is measured.
 */
export function applyFlowResiduals(
  store: Store,
  isFlowElement: Uint8Array,
  totals: ReadonlyMap<number, FlowTotal>,
): void {
  if (!totals.size) return;
  for (let id = store.count - 1; id > 0; id--) {
    // id is a row, so it has a type
    if (!isFlowElement[store.type[id]!]) continue;
    // Per counter: the deltas summed, the total before the first line, the total after the last.
    let reports: Map<number, { summed: number; before: number; after: number }> | null = null;
    for (let child = id + 1; child < store.subtreeEnd[id]!; child = store.subtreeEnd[child]!) {
      const line = totals.get(child);
      if (!line) continue;
      reports ??= new Map();
      const report = reports.get(line.counter);
      if (report) {
        report.summed += line.delta;
        report.after = line.used;
      } else {
        reports.set(line.counter, {
          summed: line.delta,
          before: line.used - line.delta,
          after: line.used,
        });
      }
    }
    if (!reports) continue;
    for (const [counter, report] of reports) {
      // A repeated or cumulative line would over-attribute, so the reported rise is the ceiling.
      const reported = Math.min(report.summed, report.after - report.before);
      // countsOf can replace the pool, so each call comes before the read of `store.counts`.
      const at = store.countsOf(id) + counter * 2;
      const residual = reported - store.counts[at + TOTAL]!;
      if (residual <= 0) continue;
      store.counts[at + SELF]! += residual;
      store.counts[at + TOTAL]! += residual;
      for (let up = store.parent[id]!; up !== NONE; up = store.parent[up]!) {
        const above = store.countsOf(up) + counter * 2 + TOTAL;
        store.counts[above]! += residual;
      }
    }
  }
}
