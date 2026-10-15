/**
 * The current engine's result as canonical records: every field its views state. Records follow
 * `project.ts`: `log` first, then one per tree node in pre-order, keyed by its path of child
 * positions.
 */

import type { ApexEvent } from '../../../src/views/events.js';
import type { ApexLog, LogPlace } from '../../../src/views/log.js';
import type { Projection } from './project.js';
import { LOG_KEY } from './project.js';

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

function countsOf(event: Counted) {
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

/** The log's record, then each event's, in id order, which is pre-order. */
export function* currentProjection(log: ApexLog): Projection {
  const paths = treePaths(log);
  const ref = (event: { id: number } | null) => ({
    node: (event && paths[event.id]) ?? LOG_KEY,
  });
  // An issue on an exit line refers to that line, which folded into the frame it closed.
  const placeOf = (place: LogPlace) =>
    place.exitType === null
      ? ref(place.event)
      : {
          offTree: place.exitType,
          at: place.event?.isFrame ? place.event.exitStamp : log.exitStamp,
        };

  const limits = log.limits;
  const record = {
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
  yield [LOG_KEY, record];

  for (const event of log.events) {
    // Every event has a path: treePaths gives one to each.
    yield [paths[event.id]!, nodeOf(event)];
  }
}

const nodeOf = (event: ApexEvent) => ({
  type: event.type,
  timestamp: event.timestamp,
  exitStamp: event.exitStamp,
  duration: event.duration,
  lineNumber: event.lineNumber,
  namespace: event.namespace,
  isTruncated: event.isTruncated,
  counts: countsOf(event),
  text: event.text,
  logLine: event.logLine,
  suffix: event.suffix,
  cpuType: event.cpuType,
  hasValidSymbols: event.hasValidSymbols,
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
