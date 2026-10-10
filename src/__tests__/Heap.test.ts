/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent, FrameEvent } from '../views/events.js';
import { parse } from './helpers.js';

const START = '09:18:22.6 (100)|EXECUTION_STARTED\n\n';
const END = '09:19:13.82 (2000)|EXECUTION_FINISHED\n';
const method = (at: number, name: string) =>
  `15:20:52.222 (${at})|METHOD_ENTRY|[1]|01p000000000AAA|${name}\n`;
const exit = (at: number, name: string) =>
  `15:20:52.222 (${at})|METHOD_EXIT|[1]|01p000000000AAA|${name}\n`;
const alloc = (at: number, bytes: number) =>
  `15:20:52.222 (${at})|HEAP_ALLOCATE|[1]|Bytes:${bytes}\n`;

/** The first frame of the execution: the method under test. */
function firstMethod(log: string): FrameEvent {
  const execution = parse(log).children[0];
  const found = execution?.isFrame ? execution.children[0] : undefined;
  if (!found?.isFrame) throw new Error('no method');
  return found;
}

const byText = (events: Iterable<ApexEvent>, text: string): ApexEvent | undefined =>
  [...events].find((e) => e.text === text);

describe('heap rollups', () => {
  it('gives an allocation its bytes, and a frame its own leaves as self', () => {
    const outer = firstMethod(
      START +
        method(200, 'Outer.run()') +
        alloc(300, 10) +
        method(400, 'Inner.work()') +
        alloc(500, 32) +
        exit(600, 'Inner.work()') +
        exit(700, 'Outer.run()') +
        END,
    );
    const inner = outer.children.find((e) => e.type === 'METHOD_ENTRY');
    expect(outer.children[0]?.heapAllocated).toEqual({ self: 10, total: 10 });
    expect([inner?.heapAllocated, inner?.heapGross]).toEqual([
      { self: 32, total: 32 },
      { self: 32, total: 32 },
    ]);
    expect([outer.heapAllocated, outer.heapGross]).toEqual([
      { self: 10, total: 42 },
      { self: 10, total: 42 },
    ]);
  });

  it('keeps net signed, counts gross from allocations only, and peaks at the live high', () => {
    // Live heap: 500k, 0, 5MB, 0. So the peak is 5MB, reached under Data.
    const log = parse(
      START +
        method(200, 'Root.run()') +
        method(300, 'Stats.compute()') +
        alloc(310, 500000) +
        alloc(320, -500000) +
        exit(330, 'Stats.compute()') +
        method(400, 'Data.load()') +
        alloc(410, 5000000) +
        exit(420, 'Data.load()') +
        method(500, 'View.render()') +
        alloc(510, -5000000) +
        exit(520, 'View.render()') +
        exit(700, 'Root.run()') +
        END,
    );
    const figures = ['Stats.compute()', 'Data.load()', 'View.render()', 'Root.run()'].map(
      (text) => {
        const e = byText(log.events, text);
        return [e?.heapAllocated.self, e?.heapAllocated.total, e?.heapGross.total, e?.heapPeak];
      },
    );
    expect(figures).toEqual([
      [0, 0, 500000, 500000],
      [5000000, 5000000, 5000000, 5000000],
      [-5000000, -5000000, 0, 0],
      [0, 0, 5500000, 5000000],
    ]);
    // No block states a heap size, so the peak is the one the events reach, with no ceiling.
    expect(log.limits.peak.heapSize).toEqual({ used: 5000000, limit: null, percentUsed: null });
  });

  it.each([
    ['a negative HEAP_ALLOCATE', alloc(220, -1000000)],
    ['HEAP_DEALLOCATE', '15:20:52.222 (220)|HEAP_DEALLOCATE|[14]|Bytes:1000000\n'],
  ])('frees with %s: net 0, gross and peak the allocation', (_name, free) => {
    const m = firstMethod(
      START + method(200, 'M.a()') + alloc(210, 1000000) + free + exit(230, 'M.a()') + END,
    );
    expect([m.heapAllocated, m.heapGross, m.heapPeak]).toEqual([
      { self: 0, total: 0 },
      { self: 1000000, total: 1000000 },
      1000000,
    ]);
  });

  it('states positive zero for a zero-byte HEAP_DEALLOCATE', () => {
    const m = firstMethod(
      START +
        method(200, 'M.a()') +
        '15:20:52.222 (210)|HEAP_DEALLOCATE|[14]|Bytes:0\n' +
        exit(220, 'M.a()') +
        END,
    );
    // `toBe` compares with `Object.is`, so it fails on -0.
    expect(m.children[0]?.heapAllocated.total).toBe(0);
  });

  it.each([
    ['BULK_HEAP_ALLOCATE', '15:20:52.222 (210)|BULK_HEAP_ALLOCATE|Bytes:1000\n'],
    ['a negative HEAP_DEALLOCATE', '15:20:52.222 (210)|HEAP_DEALLOCATE|[14]|Bytes:-1000\n'],
  ])('counts %s as an allocation', (_name, line) => {
    const m = firstMethod(START + method(200, 'M.a()') + line + exit(220, 'M.a()') + END);
    expect([m.heapAllocated, m.heapGross, m.heapPeak]).toEqual([
      { self: 1000, total: 1000 },
      { self: 1000, total: 1000 },
      1000,
    ]);
  });

  it.each([
    ['a matched free', alloc(210, 1000000), 1000000],
    ['a free with no allocation, which a skipped block can leave behind', '', 500],
  ])('measures a later peak from the level the free left: %s', (_name, first, rootPeak) => {
    const log = parse(
      START +
        method(200, 'A.first()') +
        first +
        '15:20:52.222 (220)|HEAP_DEALLOCATE|[14]|Bytes:1000000\n' +
        exit(230, 'A.first()') +
        method(300, 'B.second()') +
        alloc(310, 500) +
        exit(320, 'B.second()') +
        END,
    );
    expect(byText(log.events, 'B.second()')?.heapPeak).toBe(500);
    expect([log.heapPeak, log.limits.peak.heapSize.used]).toEqual([rootPeak, rootPeak]);
  });
});

describe('the heap limit', () => {
  const withBlocks = (allocBytes: number, ...reported: number[]): string =>
    START +
    method(200, 'M.a()') +
    alloc(210, allocBytes) +
    exit(220, 'M.a()') +
    reported
      .map(
        (bytes, i) =>
          `12:43:02.105 (${300 + i})|LIMIT_USAGE_FOR_NS|(default)|\n  Maximum heap size: ${bytes} out of 6000000\n`,
      )
      .join('') +
    END;

  it('peaks at the higher of the stated peak and the one the events reach', () => {
    const { final, peak } = parse(withBlocks(5000000, 100)).limits;
    // The events' peak takes the block's ceiling; final stays as the block stated it.
    expect(peak.heapSize).toEqual({
      used: 5000000,
      limit: 6000000,
      percentUsed: (5000000 / 6000000) * 100,
    });
    expect(final.heapSize.used).toBe(100);
    expect(parse(withBlocks(100, 5000)).limits.peak.heapSize.used).toBe(5000);
  });

  it('peaks across every block, not at the last one', () => {
    expect(parse(withBlocks(0, 500000, 0)).limits.peak.heapSize.used).toBe(500000);
  });
});
