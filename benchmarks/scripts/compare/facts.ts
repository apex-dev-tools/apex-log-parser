/**
 * The facts two parse engines must agree on, as canonical records. Both engines map into these
 * shapes, so an engine's own types and names do not count, only what it states about the log.
 *
 * Records follow `project.ts`: `log` first, then one per tree node in pre-order, keyed by its path
 * of child positions. Text, `cpuType` and `suffix` are left out: those are design choices of each
 * API, not facts of the log.
 */

import type { ApexEvent } from '../../../src/views/events.js';
import type { ApexLog, LogPlace } from '../../../src/views/log.js';
import type { Projection } from './project.js';
import { LOG_KEY } from './project.js';

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
    snapshots: readonly { timestamp: number; namespace: string; limits: unknown }[];
    final: unknown;
    peak: unknown;
    byNamespace: [string, unknown][];
  };
}

/** The rollup getters an event and the log state, by the same names. */
type Counted = Pick<
  ApexEvent,
  | 'dmlCount'
  | 'soqlCount'
  | 'soslCount'
  | 'dmlRowCount'
  | 'soqlRowCount'
  | 'soslRowCount'
  | 'thrownCount'
  | 'heapAllocated'
  | 'heapGross'
  | 'heapPeak'
>;

function countsOf(event: Counted): CountsFact {
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

/** The log's facts, then `nodeOf` each event, in id order: pre-order, as the projection needs. */
function* currentRecords(log: ApexLog, nodeOf: (event: ApexEvent) => unknown): Projection {
  const paths = treePaths(log);
  const ref = (event: { id: number } | null): EventRef => ({
    node: (event && paths[event.id]) ?? LOG_KEY,
  });
  // An issue on an exit line refers to that line, which folded into the frame it closed.
  const placeOf = (place: LogPlace): EventRef =>
    place.exitType === null
      ? ref(place.event)
      : {
          offTree: place.exitType,
          at: place.event?.isFrame ? place.event.exitStamp : log.exitStamp,
        };

  const limits = log.limits;
  const fact: LogFact = {
    size: log.size,
    timestamp: log.timestamp,
    exitStamp: log.exitStamp,
    duration: log.duration,
    startTime: log.startTime,
    executionEndTime: log.executionEndTime,
    isTruncated: log.isTruncated,
    counts: countsOf(log),
    namespaces: [...log.namespaces],
    issues: log.issues.map((issue) => ({
      type: issue.type,
      summary: issue.summary,
      description: issue.description,
      startTime: issue.startTime,
      endTime: issue.endTime,
      at: placeOf(issue),
    })),
    parsingErrors: [...log.parsingErrors],
    truncation: {
      regions: log.truncation.regions.map((region) => ({
        kind: region.kind,
        startTime: region.startTime,
        endTime: region.endTime,
        at: placeOf(region),
        skippedBytes: region.skippedBytes,
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

  for (const event of log.events) {
    // Every event has a path: treePaths gives one to each.
    yield [paths[event.id]!, nodeOf(event)];
  }
}

/** The log, as facts, read through its views. Ids are in pre-order, so the records come out in it too. */
export const currentFacts = (log: ApexLog): Projection => currentRecords(log, currentNode);

/** Every field the views state: its facts, then each event's text figures. */
export const currentProjection = (log: ApexLog): Projection =>
  currentRecords(log, (event) => ({
    ...currentNode(event),
    text: event.text,
    logLine: event.logLine,
    suffix: event.suffix,
    cpuType: event.cpuType,
    hasValidSymbols: event.hasValidSymbols,
  }));

const currentNode = (event: ApexEvent): NodeFact => ({
  type: event.type,
  timestamp: event.timestamp,
  exitStamp: event.exitStamp,
  duration: event.duration,
  lineNumber: event.lineNumber,
  namespace: event.namespace,
  isTruncated: event.isTruncated,
  counts: countsOf(event),
});

/** Each event's path of child positions; index 0 is the log. */
function treePaths(log: ApexLog): string[] {
  const paths = [LOG_KEY];
  const children = new Int32Array(log.eventCount + 1);
  for (const event of log.events) {
    const parent = event.parent?.id ?? 0;
    // parent is an earlier event, or the log, so both indexes are in range
    const index = children[parent]!++;
    paths[event.id] = parent === 0 ? `${index}` : `${paths[parent]}/${index}`;
  }
  return paths;
}
