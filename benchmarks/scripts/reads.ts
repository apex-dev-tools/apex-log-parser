// The reads the view benchmarks time. Type imports only, so the CodSpeed bench loads no second
// engine from the sources.

import type { CountColumn, HeapColumn } from '../../src/views/columns.js';
import type { ApexEvent } from '../../src/views/events.js';
import type { ApexLog } from '../../src/views/log.js';

/** Every self and total of a count or heap column, as a sum; 0 for a column the log does not record. */
function sumOf(column: CountColumn | HeapColumn | null, id: number): number {
  // id is a row, so in range
  return column ? column.self[id]! + column.total[id]! : 0;
}

/** Reads every column of every event row once, as a caller that reads them all does. */
export function readColumns(log: ApexLog): number {
  const c = log.columns;
  const {
    type,
    parent,
    depth,
    subtreeEnd,
    startTimestamp,
    endTimestamp,
    durationSelf,
    durationTotal,
    isFrame,
    isApexCall,
    lineNumber,
  } = c;
  const ended = c.endedBy.ids;
  const counts = [
    c.dmlCount,
    c.soqlCount,
    c.soslCount,
    c.dmlRowCount,
    c.soqlRowCount,
    c.soslRowCount,
    c.thrownCount,
    c.heapAllocated,
    c.heapGross,
  ];
  const peak = c.heapPeak;
  // A sum of every read, so none is dead code the compiler can drop.
  let sum = 0;
  // Row 0 is the log, not an event. Every index is a row, so in range.
  for (let id = 1; id < type.length; id++) {
    sum += type[id]! + parent[id]! + depth[id]! + subtreeEnd[id]!;
    sum += startTimestamp[id]! + endTimestamp[id]! + durationSelf[id]! + durationTotal[id]!;
    sum += isFrame[id]! + isApexCall[id]! + lineNumber[id]! + (ended[id]! >= 0 ? 1 : 0);
    for (const column of counts) sum += sumOf(column, id);
    sum += peak ? peak[id]! : 0;
  }
  return sum;
}

/** Makes the object for every event, and reads one field from each so none is skipped. */
export function readEvents(log: ApexLog): number {
  let sum = 0;
  for (const event of log.events) sum += event.depth;
  return sum;
}

/** Walks the tree through each frame's children, as a flame chart or a tree view does. */
export function readTree(log: ApexLog): number {
  let sum = 0;
  const walk = (events: readonly ApexEvent[]): void => {
    for (const event of events) {
      sum += event.depth;
      if (event.isFrame) walk(event.children);
    }
  };
  walk(log.children);
  return sum;
}

/** Makes the object for every event and reads its text, which decodes it. */
export function readText(log: ApexLog): number {
  let sum = 0;
  for (const event of log.events) sum += event.text?.length ?? 0;
  return sum;
}

/** Reads every frame's text id and its text from the columns, as a call tree that groups by name does. */
export function readTextColumn(log: ApexLog): number {
  const { ids, values } = log.columns.text;
  let sum = 0;
  // Every index is a row, so in range; a leaf's id is -1, which reads as no text.
  for (let id = 1; id < ids.length; id++) sum += values[ids[id]!]?.length ?? 0;
  return sum;
}

/** Every read the benchmarks time, by name. */
export const READS: readonly (readonly [string, (log: ApexLog) => number])[] = [
  ['columns', readColumns],
  ['events', readEvents],
  ['tree', readTree],
  ['text', readText],
  ['textColumn', readTextColumn],
];
