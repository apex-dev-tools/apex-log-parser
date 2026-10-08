/**
 * The facts two parse engines must agree on, as canonical records. Both engines map into these
 * shapes, so an engine's own types and names do not count, only what it states about the log.
 *
 * Records follow `project.ts`: `log` first, then one per tree node in pre-order, keyed by its path
 * of child positions. Text, `cpuType` and `suffix` are left out: those are design choices of each
 * API, not facts of the log.
 */

import type { ApexLog, LogEvent } from '../../../src/index.js';
import { idOfType } from '../../../src/next/catalog/catalog.js';
import { EVENT_TYPE_NAMES } from '../../../src/next/catalog/types.js';
import type { Built } from '../../../src/next/engine/builder.js';
import { FLAG } from '../../../src/next/engine/builder.js';
import { governorLimits } from '../../../src/next/limits.js';
import type { Store } from '../../../src/next/store/store.js';
import {
  COUNTER,
  EXTERNAL_LINE,
  HEAP,
  NO_LINE,
  NONE,
  SELF,
  TOTAL,
} from '../../../src/next/store/store.js';
import type { Projection } from './project.js';
import { LOG_KEY, preOrder } from './project.js';

/** An event the tree holds, by path, one it does not, such as a matched exit line, or an id no event has. */
export type EventRef =
  | { node: string }
  | { offTree: string | null; at: number }
  | { missing: number }
  | null;

export interface SelfTotalFact {
  self: number;
  total: number;
}

export interface CountsFact {
  dml: SelfTotalFact;
  soql: SelfTotalFact;
  sosl: SelfTotalFact;
  dmlRows: SelfTotalFact;
  soqlRows: SelfTotalFact;
  soslRows: SelfTotalFact;
  thrown: SelfTotalFact;
  heapAllocated: SelfTotalFact;
  heapGross: SelfTotalFact;
  heapPeak: number;
}

export interface NodeFact {
  type: string | null;
  timestamp: number;
  exitStamp: number | null;
  duration: SelfTotalFact;
  lineNumber: number | 'EXTERNAL' | null;
  namespace: string | null;
  isTruncated: boolean;
  counts: CountsFact;
}

export interface IssueFact {
  type: string;
  summary: string;
  description: string;
  startTime: number | null;
  endTime: number | null;
  at: EventRef;
}

export interface LogFact {
  size: number;
  timestamp: number;
  exitStamp: number | null;
  duration: SelfTotalFact;
  startTime: number | null;
  executionEndTime: number;
  isTruncated: boolean;
  counts: CountsFact;
  namespaces: string[];
  issues: IssueFact[];
  parsingErrors: string[];
  truncation: {
    regions: {
      kind: string;
      startTime: number;
      endTime: number | null;
      at: EventRef;
      skippedBytes: number | null;
    }[];
    totalSkippedBytes: number;
  };
  truncatedEvents: EventRef[];
  entryPoints: EventRef[];
  exceptions: EventRef[];
  userInfo: unknown;
  debugLevels: unknown;
  debugLevelSettings: unknown;
  limits: {
    snapshots: { timestamp: number; namespace: string; limits: unknown }[];
    final: unknown;
    peak: unknown;
    byNamespace: [string, unknown][];
  };
}

// Today's name for an event outside any namespace.
const NO_NAMESPACE = 'default';

function countsOf(event: LogEvent): CountsFact {
  return {
    dml: event.dmlCount,
    soql: event.soqlCount,
    sosl: event.soslCount,
    dmlRows: event.dmlRowCount,
    soqlRows: event.soqlRowCount,
    soslRows: event.soslRowCount,
    thrown: event.thrownCount,
    heapAllocated: event.heapAllocated,
    heapGross: event.heapGross,
    heapPeak: event.heapPeak,
  };
}

/** The legacy engine's `ApexLog`, as facts. */
export function* legacyFacts(log: ApexLog): Projection {
  const paths = new Map<LogEvent, string>([[log, LOG_KEY]]);
  const order = preOrder(log, paths);
  const ref = (event: LogEvent): EventRef => {
    const path = paths.get(event);
    // An exit line, or a package event merged into its sibling: the tree never holds it.
    return path === undefined ? { offTree: event.type, at: event.timestamp } : { node: path };
  };
  const byIndex = (index: number | undefined): EventRef => {
    if (index === undefined) return null;
    const event = log.eventsById[index];
    return event ? ref(event) : { missing: index };
  };

  const limits = log.governorLimits;
  const fact: LogFact = {
    size: log.size,
    timestamp: log.timestamp,
    exitStamp: log.exitStamp,
    duration: log.duration,
    startTime: log.startTime,
    executionEndTime: log.executionEndTime,
    isTruncated: log.isTruncated,
    counts: countsOf(log),
    namespaces: log.namespaces.filter((ns) => ns !== NO_NAMESPACE),
    issues: log.logIssues.map((issue) => ({
      type: issue.type,
      summary: issue.summary,
      description: issue.description,
      startTime: issue.startTime ?? null,
      endTime: issue.endTime ?? null,
      at: byIndex(issue.eventIndex),
    })),
    parsingErrors: log.parsingErrors,
    truncation: {
      regions: log.truncation.regions.map((region) => ({
        kind: region.kind,
        startTime: region.startTime,
        endTime: region.endTime ?? null,
        at: byIndex(region.eventIndex),
        skippedBytes: region.skippedBytes ?? null,
      })),
      totalSkippedBytes: log.truncation.totalSkippedBytes,
    },
    truncatedEvents: log.truncatedEvents.map(ref),
    entryPoints: log.entryPoints.map(ref),
    exceptions: log.exceptions.map(ref),
    userInfo: log.userInfo,
    debugLevels: log.debugLevels,
    debugLevelSettings: log.debugLevelSettings,
    limits: {
      snapshots: limits.snapshots,
      final: limits.final,
      peak: limits.peak,
      byNamespace: [...limits.byNamespace],
    },
  };
  yield [LOG_KEY, fact];

  for (const event of order) {
    if (event === log) continue;
    const node: NodeFact = {
      type: event.type,
      timestamp: event.timestamp,
      exitStamp: event.exitStamp,
      duration: event.duration,
      // Today states 0 for an empty line-number field too; only the raw line tells them apart.
      lineNumber:
        event.lineNumber === 0 && !event.logLine.includes('|[0]') ? null : event.lineNumber,
      namespace: event.namespace && event.namespace !== NO_NAMESPACE ? event.namespace : null,
      isTruncated: event.isTruncated,
      counts: countsOf(event),
    };
    yield [paths.get(event) ?? LOG_KEY, node];
  }
}

const CODE_UNIT_STARTED = idOfType('CODE_UNIT_STARTED');
const EXECUTION_STARTED = idOfType('EXECUTION_STARTED');
const EXCEPTIONS = new Set([idOfType('EXCEPTION_THROWN'), idOfType('FATAL_ERROR')]);

/** The next engine's build, as facts. Ids are in pre-order, so the records come out in it too. */
export function* nextFacts(built: Built): Projection {
  const { store, strings } = built;
  const paths = treePaths(store);
  const ref = (id: number): EventRef => ({ node: paths[id] ?? LOG_KEY });
  // An issue on an exit line refers to that line, which folded into the frame it closed.
  const placeOf = (place: { id: number; exitType: number | null }): EventRef =>
    place.exitType === null
      ? ref(place.id)
      : { offTree: EVENT_TYPE_NAMES[place.exitType] ?? null, at: store.exitStamp[place.id]! };
  const counts = (id: number): CountsFact => nextCounts(store, id);
  const ids = (keep: (id: number) => boolean): number[] =>
    Array.from({ length: store.count - 1 }, (_, i) => i + 1).filter(keep);

  const rootCounts = counts(0);
  const limits = governorLimits([...built.snapshots], rootCounts.heapPeak);
  const fact: LogFact = {
    size: built.size,
    timestamp: store.timestamp[0]!,
    exitStamp: stamp(store.exitStamp[0]!),
    duration: nextDuration(store, 0),
    startTime: built.startTime,
    executionEndTime: built.executionEndTime,
    // The log is truncated when the platform dropped content, not when a frame lost its exit.
    isTruncated: built.truncation.regions.length > 0,
    counts: rootCounts,
    namespaces: built.namespaces.map((id) => strings.text(id)),
    issues: built.issues.list.map((issue) => ({
      type: issue.type,
      summary: issue.summary,
      description: issue.description,
      startTime: issue.startTime,
      endTime: issue.endTime,
      at: placeOf(issue),
    })),
    parsingErrors: [...built.parsingErrors],
    truncation: {
      regions: built.truncation.regions.map((region) => ({
        kind: region.kind,
        startTime: region.startTime,
        endTime: region.endTime,
        at: placeOf(region),
        skippedBytes: region.skippedBytes,
      })),
      totalSkippedBytes: built.truncation.totalSkippedBytes,
    },
    truncatedEvents: built.truncated.map(ref),
    // A code unit at the top of the log or of an execution.
    entryPoints: ids(
      (id) =>
        store.type[id] === CODE_UNIT_STARTED &&
        (store.parent[id] === 0 || store.type[store.parent[id]!] === EXECUTION_STARTED),
    ).map(ref),
    exceptions: ids((id) => EXCEPTIONS.has(store.type[id]!)).map(ref),
    userInfo: built.userInfo,
    debugLevels: built.debugLevels,
    debugLevelSettings: built.debugLevelSettings,
    limits: {
      snapshots: limits.snapshots,
      final: limits.final,
      peak: limits.peak,
      byNamespace: [...limits.byNamespace],
    },
  };
  yield [LOG_KEY, fact];

  for (let id = 1; id < store.count; id++) {
    // id < count, so every column holds it
    const line = store.lineNumber[id]!;
    const namespace = store.namespace[id]!;
    const node: NodeFact = {
      type: EVENT_TYPE_NAMES[store.type[id]!] ?? null,
      timestamp: store.timestamp[id]!,
      exitStamp: stamp(store.exitStamp[id]!),
      duration: nextDuration(store, id),
      lineNumber: line === NO_LINE ? null : line === EXTERNAL_LINE ? 'EXTERNAL' : line,
      namespace: namespace === NONE ? null : strings.text(namespace),
      isTruncated: (store.flags[id]! & FLAG.truncated) !== 0,
      counts: counts(id),
    };
    yield [paths[id]!, node];
  }
}

/** Each row's path of child positions, as `preOrder` states the legacy tree's. */
function treePaths(store: Store): string[] {
  const paths = [LOG_KEY];
  const children = new Int32Array(store.count);
  for (let id = 1; id < store.count; id++) {
    // id < count, and a parent is an earlier row
    const parent = store.parent[id]!;
    const index = children[parent]!++;
    paths[id] = parent === 0 ? `${index}` : `${paths[parent]}/${index}`;
  }
  return paths;
}

// The store holds NaN for a leaf's exit; the facts state null.
function stamp(ns: number): number | null {
  return Number.isNaN(ns) ? null : ns;
}

function nextDuration(store: Store, id: number): SelfTotalFact {
  // id is a row
  const exit = store.exitStamp[id]!;
  return {
    self: store.durationSelf[id]!,
    // As the engine and legacy: an exit at 0, or none, is no duration.
    total: exit ? exit - store.timestamp[id]! : 0,
  };
}

function nextCounts(store: Store, id: number): CountsFact {
  // id is a row; a slot is NONE while every figure in it is 0
  const countAt = store.countSlot[id] === NONE ? NONE : store.countsOf(id);
  const heapAt = store.heapSlot[id] === NONE ? NONE : store.heapOf(id);
  const pair = (counter: number): SelfTotalFact =>
    countAt === NONE
      ? { self: 0, total: 0 }
      : {
          self: store.counts[countAt + counter * 2 + SELF]!,
          total: store.counts[countAt + counter * 2 + TOTAL]!,
        };
  const heap = (figure: number): number => (heapAt === NONE ? 0 : store.heap[heapAt + figure]!);
  return {
    dml: pair(COUNTER.dml),
    soql: pair(COUNTER.soql),
    sosl: pair(COUNTER.sosl),
    dmlRows: pair(COUNTER.dmlRows),
    soqlRows: pair(COUNTER.soqlRows),
    soslRows: pair(COUNTER.soslRows),
    thrown: pair(COUNTER.thrown),
    heapAllocated: { self: heap(HEAP.allocatedSelf), total: heap(HEAP.allocatedTotal) },
    heapGross: { self: heap(HEAP.grossSelf), total: heap(HEAP.grossTotal) },
    heapPeak: heap(HEAP.peak),
  };
}
