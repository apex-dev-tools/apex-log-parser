/**
 * The facts two parse engines must agree on, as canonical records. Both engines map into these
 * shapes, so an engine's own types and names do not count, only what it states about the log.
 *
 * Records follow `project.ts`: `log` first, then one per tree node in pre-order, keyed by its path
 * of child positions. Text, `cpuType` and `suffix` are left out: those are design choices of each
 * API, not facts of the log.
 */

import type { ApexLog, LogEvent } from '../../../src/index.js';
import type { ApexEvent } from '../../../src/next/views/events.js';
import type { LogPlace, ApexLog as NextLog } from '../../../src/next/views/log.js';
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

/** The rollup getters both engines' events and logs state, by the same names. */
type Counted = Pick<
  LogEvent,
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

/** The log's facts, then `nodeOf` each event, in id order: pre-order, as the projection needs. */
function* nextRecords(log: NextLog, nodeOf: (event: ApexEvent) => unknown): Projection {
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

/** The next engine's log, as facts, read through its views. Ids are in pre-order, so the records come out in it too. */
export const nextFacts = (log: NextLog): Projection => nextRecords(log, nextNode);

/** Every field the next engine's views state: its facts, then each event's text figures. */
export const nextProjection = (log: NextLog): Projection =>
  nextRecords(log, (event) => ({
    ...nextNode(event),
    text: event.text,
    logLine: event.logLine,
    suffix: event.suffix,
    cpuType: event.cpuType,
    hasValidSymbols: event.hasValidSymbols,
  }));

const nextNode = (event: ApexEvent): NodeFact => ({
  type: event.type,
  timestamp: event.timestamp,
  exitStamp: event.exitStamp,
  duration: event.duration,
  lineNumber: event.lineNumber,
  namespace: event.namespace,
  isTruncated: event.isTruncated,
  counts: countsOf(event),
});

/** Each event's path of child positions, as `preOrder` states the legacy tree's; index 0 is the log. */
function treePaths(log: NextLog): string[] {
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
