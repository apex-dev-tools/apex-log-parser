/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { NodeSource } from '../bytes/node.js';
import { COUNTER, HEAP, NO_LINE, NONE, Store } from '../store/store.js';
import { StringTable } from '../store/strings.js';
import { encode } from './helpers.js';

describe('Store', () => {
  it('starts each row as a leaf with no line number, namespace or rollups', () => {
    const store = new Store(0);
    const id = store.add(7, 10, 20, 1000, NONE, 0);
    expect(id).toBe(0);
    expect([store.type[0], store.start[0], store.end[0], store.timestamp[0]]).toEqual([
      7, 10, 20, 1000,
    ]);
    expect([store.parent[0], store.subtreeEnd[0], store.depth[0]]).toEqual([NONE, 1, 0]);
    expect(store.exitStamp[0]).toBeNaN();
    expect([
      store.lineNumber[0],
      store.namespace[0],
      store.countSlot[0],
      store.heapSlot[0],
    ]).toEqual([NO_LINE, NONE, NONE, NONE]);
  });

  it('grows past its first size and keeps every row', () => {
    const store = new Store(0);
    for (let i = 0; i < 1000; i++) store.add(i % 5, i, i + 1, i * 10, i - 1, i % 3);
    expect(store.count).toBe(1000);
    expect(store.timestamp[999]).toBe(9990);
    expect(store.parent[500]).toBe(499);
  });

  it('gives a pool slot only to a row that asks, once', () => {
    const store = new Store(0);
    for (let i = 0; i < 200; i++) store.add(0, 0, 0, 0, NONE, 0);
    // A read gives no slot.
    expect([store.countIndex(150), store.heapIndex(3), store.countSlots, store.heapSlots]).toEqual([
      -1, -1, 0, 0,
    ]);
    const at = store.countsOf(150);
    expect(store.countIndex(150)).toBe(at);
    expect(store.countsOf(150)).toBe(at);
    store.counts[at + COUNTER.soql * 2] = 1;
    for (let i = 0; i < 100; i++) store.countsOf(i);
    expect(store.counts[store.countsOf(150) + COUNTER.soql * 2]).toBe(1);
    expect(store.countSlots).toBe(101);
    const heap = store.heapOf(3);
    expect(store.heapIndex(3)).toBe(heap);
    store.heap[heap + HEAP.peak] = 64;
    expect([store.heapSlots, store.heapSlot[2], store.heap[store.heapOf(3) + HEAP.peak]]).toEqual([
      1,
      NONE,
      64,
    ]);
  });

  it('grows the heap pool, and grows a pool or the rows again after finish trims them to 0', () => {
    const store = new Store(0);
    for (let i = 0; i < 2000; i++) store.add(0, 0, 0, 0, NONE, 0);
    for (let i = 0; i < 2000; i++) store.heap[store.heapOf(i) + HEAP.peak] = i;
    expect([store.heapSlots, store.heap[store.heapOf(1999) + HEAP.peak]]).toEqual([2000, 1999]);
    const empty = new Store(0);
    empty.finish(1);
    const at = empty.countsOf(empty.add(0, 0, 0, 0, NONE, 0));
    empty.counts[at] = 3;
    expect([empty.count, empty.counts[0]]).toEqual([1, 3]);
  });

  it('throws on a type, or a row’s type, past the type count', () => {
    const store = new Store(0);
    store.add(3, 0, 0, 0, NONE, 0);
    store.finish(3);
    expect(() => store.rowsOfType(0)).toThrow(RangeError);
    expect(() => store.rowsOfType(3)).toThrow(RangeError);
    expect(() => store.rowsOfType(-1)).toThrow(RangeError);
  });

  it('builds the type index once', () => {
    const store = new Store(0);
    for (const type of [1, 0]) store.add(type, 0, 0, 0, NONE, 0);
    store.finish(2);
    expect(store.rowsOfType(0).buffer).toBe(store.rowsOfType(1).buffer);
  });

  it('trims to its rows on finish, and lists each type’s rows in id order', () => {
    const store = new Store(1_000_000);
    for (const type of [2, 0, 2, 1, 2]) store.add(type, 0, 0, 0, NONE, 0);
    store.countsOf(1);
    store.finish(4);
    expect([store.type.length, store.durationSelf.length, store.counts.length]).toEqual([5, 5, 14]);
    const rowsOf = (type: number): number[] => [...store.rowsOfType(type)];
    expect([rowsOf(0), rowsOf(1), rowsOf(2), rowsOf(3)]).toEqual([[1], [3], [0, 2, 4], []]);
  });
});

describe('StringTable', () => {
  const tableOf = (text: string): [StringTable, Uint8Array] => {
    const bytes = encode(text);
    return [new StringTable(new NodeSource(bytes)), bytes];
  };

  it('gives the same bytes the same id wherever they are, and other bytes another', () => {
    const [table] = tableOf('ns|other|ns|n|');
    const ns = table.intern(0, 2);
    expect(table.intern(9, 11)).toBe(ns);
    expect(table.intern(3, 8)).not.toBe(ns);
    expect(table.intern(12, 13)).not.toBe(ns);
    expect(table.size).toBe(3);
    expect([table.text(ns), table.text(table.intern(3, 8))]).toEqual(['ns', 'other']);
  });

  it('keeps apart two values that share a hash', () => {
    // 'Aa' and 'BB' are the classic collision of a 31-multiplier hash.
    const [table] = tableOf('Aa|BB');
    const aa = table.intern(0, 2);
    const bb = table.intern(3, 5);
    expect(aa).not.toBe(bb);
    expect([table.text(aa), table.text(bb), table.intern(0, 2)]).toEqual(['Aa', 'BB', aa]);
  });

  it('interns the empty string, and decodes non-ASCII bytes', () => {
    const [table] = tableOf('é日本');
    expect(table.text(table.intern(0, 0))).toBe('');
    expect(table.text(table.intern(0, 8))).toBe('é日本');
  });

  it('keeps every id through growth', () => {
    const words = Array.from({ length: 5000 }, (_, i) => `w${i}`);
    const [table, bytes] = tableOf(words.join('|'));
    const ids: number[] = [];
    let start = 0;
    for (const word of words) {
      ids.push(table.intern(start, start + word.length));
      start += word.length + 1;
    }
    expect(new Set(ids).size).toBe(5000);
    expect(table.text(ids[4321]!)).toBe('w4321');
    expect(table.intern(bytes.length - 5, bytes.length)).toBe(ids[4999]);
  });
});
