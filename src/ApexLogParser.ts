/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import {
  ApexLog,
  applyFlowDbResiduals,
  type CodeUnitStartedLine,
  type LogEvent,
} from './LogEvents.js';
import { eventNames, getLogEventClass } from './LogLineMapping.js';
import { deriveGovernorLimits } from './limits.js';
import type {
  DebugLevelSetting,
  DebugLevels,
  GovernorSnapshot,
  IssueType,
  LogEventType,
  LogIssue,
  LogLevel,
  LogTimezone,
  Truncation,
  TruncationRegion,
  UserInfo,
} from './types.js';
import { LOG_LEVEL } from './types.js';
import { utf8ByteLength } from './utf8.js';

const typePattern = /^[A-Z_]*$/,
  settingsPattern = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/m;

/**
 * Summaries that are a constant text describing a distinct occurrence, so every one is reported.
 * Deduping them by summary would report only the first region of a log with several.
 */
const alwaysReportedSummaries = new Set(['Skipped-Lines']);

/** The truncation kind each `skip` issue describes. */
const truncationKinds: Record<string, TruncationRegion['kind']> = {
  'Skipped-Lines': 'skipped-lines',
  'Max-Size-reached': 'max-size',
};

/**
 * Identity of a log issue for dedupe. Keyed on type + summary so a FATAL_ERROR and an
 * EXCEPTION_THROWN with the same first line both survive.
 */
function issueKey(type: IssueType, summary: string): string {
  return type + ':' + summary;
}

// From the parser, not the tree: an unfinished event can nest the next execution at any depth.
function findEntryPoints(root: ApexLog, codeUnits: CodeUnitStartedLine[]): CodeUnitStartedLine[] {
  const entryPoints: CodeUnitStartedLine[] = [];
  for (const unit of codeUnits) {
    if (unit.parent === root || unit.parent?.type === 'EXECUTION_STARTED') {
      entryPoints.push(unit);
    }
  }
  return entryPoints;
}

/**
 * The settings line names each category with a log token, which is not the `DebugLevels` property.
 * Keyed by property, so a new `DebugLevels` category does not compile until it states its token.
 * Exported for the test which crosses it with the bundled event database, not part of the API.
 */
export const debugLevelTokenByKey: Record<keyof DebugLevels, string> = {
  apexCode: 'APEX_CODE',
  apexProfiling: 'APEX_PROFILING',
  callout: 'CALLOUT',
  dataAccess: 'DATA_ACCESS',
  database: 'DB',
  nba: 'NBA',
  system: 'SYSTEM',
  validation: 'VALIDATION',
  visualforce: 'VISUALFORCE',
  wave: 'WAVE',
  workflow: 'WORKFLOW',
};

const debugLevelKeyByToken = new Map<string, keyof DebugLevels>(
  Object.entries(debugLevelTokenByKey).map(([key, token]) => [token, key as keyof DebugLevels]),
);

// The first event, near the top of a log. It needs the counter: no event builds from a line without.
const timestampedLinePattern = /^\d{2}:\d{2}:\d{2}\.\d+ \(\d+\)\|.*/m;
const gmtOffsetPattern = /^GMT([+-])(\d{2}):(\d{2})$/;

/**
 * Minutes east of UTC, with the spelling they were read from. The header states `GMTZ` rather than
 * `GMT+00:00` for UTC.
 * @returns null when the header stated no offset this can read.
 */
function parseGmtOffset(text: string): { minutes: number; text: string } | null {
  if (text === 'GMTZ') {
    return { minutes: 0, text };
  }

  const match = text.match(gmtOffsetPattern);
  if (!match) {
    return null;
  }

  const minutes = Number.parseInt(match[2] ?? '0', 10) * 60 + Number.parseInt(match[3] ?? '0', 10);
  return { minutes: match[1] === '-' ? -minutes : minutes, text };
}

/**
 * Reads the `USER_INFO` header line: id, user name, timezone label and offset.
 * @returns null when the log states no user.
 */
function parseUserInfo(firstLine: string | undefined): UserInfo | null {
  // The first timestamped line only, so a USER_INFO quoted later cannot stand in for the header.
  const parts = firstLine?.split('|');
  if (parts?.[1] !== 'USER_INFO') {
    return null;
  }

  return {
    // An empty field between pipes states nothing either.
    id: parts[3] || null,
    userName: parts[4] || null,
    timezone: parts[5] ? parseTimezone(parts[5], parts[6]) : null,
  };
}

/**
 * Field 6 is '(GMT-08:00) Pacific Standard Time (America/Los_Angeles)', or a bare, sometimes
 * localised, label with either part missing. Read with string scans, not a regex, so a hostile
 * field cannot make the parse slow.
 */
function parseTimezone(field: string, offsetField: string | undefined): LogTimezone {
  const prefixEnd = field.startsWith('(GMT') ? field.indexOf(')') : -1;
  const gmtPrefix = prefixEnd < 0 ? '' : field.slice(1, prefixEnd);
  const timezone = prefixEnd < 0 ? field : field.slice(prefixEnd + 1);
  // The last bracket, because an IANA name can hold slashes but no brackets.
  const open = timezone.lastIndexOf('(');
  const named =
    open > 0 && timezone[open - 1] === ' ' && timezone.indexOf(')', open) === timezone.length - 1;
  // The label states the offset too, so a log with no offset column is still readable.
  const offset = parseGmtOffset(offsetField ?? '') ?? parseGmtOffset(gmtPrefix);
  return {
    text: field,
    label: (named ? timezone.slice(0, open) : timezone).trim() || null,
    name: named ? timezone.slice(open + 1, -1) : null,
    offsetMinutes: offset?.minutes ?? null,
    offsetText: offset?.text ?? null,
  };
}

const logLevels = new Set<string>(Object.values(LOG_LEVEL));

// A settings line directly followed by a timestamped line: how each pasted log begins.
const logHeaderPattern =
  /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+\r?\n\d{2}:\d{2}:\d{2}\.\d+ \(\d+\)\|/gm;
const nanosPattern = /^\d{2}:\d{2}:\d{2}\.\d+ \((\d+)\)\|/;

/**
 * Each log opens with a settings line and restarts its nanosecond counter. So a settings line whose
 * next line is earlier than the last event opens a second log. A settings line alone is not enough:
 * a debug message can quote one, and then the counter keeps rising.
 */
function opensNextLog(line: string, log: string, nextStart: number, lastEntry: LogEvent): boolean {
  // Cheap test first: a timestamped line has ':' third, and this runs on every line.
  if (line.charCodeAt(2) === 58 || !settingsPattern.test(line)) {
    return false;
  }
  const nanos = log.slice(nextStart, nextStart + 40).match(nanosPattern)?.[1];
  return nanos !== undefined && Number(nanos) < lastEntry.timestamp;
}

const skippedBytesPattern = /^\*\*\* Skipped ([\d,]+) bytes/;
// The exact forms only, so a debug message that quotes the words stays text.
const truncationMarkerPattern =
  /^(?:\*\*\* Skipped [\d,]+ bytes of detailed log|\*+ MAXIMUM DEBUG LOG SIZE REACHED \*+) *$/;

function isTruncationMarker(line: string): boolean {
  // '*' first: a cheap test, because this runs on every wrapped line.
  return line.charCodeAt(0) === 42 && truncationMarkerPattern.test(line);
}

/** The platform states the dropped size on the skip line itself, with thousands separators. */
function parseSkippedBytes(line: string): number | undefined {
  const match = line.match(skippedBytesPattern);
  return match?.[1] ? Number.parseInt(match[1].replaceAll(',', ''), 10) : undefined;
}

/**
 * Takes string input of a log and returns the ApexLog class, which represents a log tree
 * @param {string} logData
 * @returns {ApexLog}
 */
export function parse(logData: string): ApexLog {
  return new ApexLogParser().parse(logData);
}

/**
 * Stateful parsing engine. Prefer the `parse` function: it drives this class and returns an
 * `ApexLog` that already carries the governor limits, log issues and namespaces accumulated here.
 * The class is public because every event constructor takes one, so code that builds events needs
 * it. Its fields are parser state, not API. Construct one per log if you build events against it
 * yourself.
 */
export class ApexLogParser {
  logIssues: LogIssue[] = [];
  parsingErrors: string[] = [];
  maxSizeTimestamp: number | null = null;
  /** Bytes the platform reported skipped, by the issue that reports the skip. */
  private readonly skippedBytesByIssue = new Map<LogIssue, number>();
  /** Events the parser could not terminate because the log stopped inside them. */
  private readonly truncatedEvents: LogEvent[] = [];
  reasons: Set<string> = new Set<string>();
  lastTimestamp = 0;
  discontinuity = false;
  /** Running live heap (signed allocation deltas) maintained in log order. */
  runningHeap = 0;
  namespaces: Set<string> = new Set<string>();
  /** Every event created during this parse, indexed by `LogEvent.eventIndex`. */
  eventsById: LogEvent[] = [];
  /** Every exception event (EXCEPTION_THROWN, FATAL_ERROR) in log order. */
  exceptions: LogEvent[] = [];
  /** Every `CODE_UNIT_STARTED` event in log order. */
  readonly codeUnits: CodeUnitStartedLine[] = [];
  readonly governorSnapshots: GovernorSnapshot[] = [];

  /**
   * Flow elements that may report their own database usage, in log order. Their usage is attributed
   * once the tree is aggregated - see {@link applyFlowDbResiduals}.
   */
  readonly flowDbElements: LogEvent[] = [];

  /**
   * Takes string input of a log and returns the ApexLog class, which represents a log tree
   * @param {string} debugLog
   * @returns {ApexLog}
   */
  parse(debugLog: string): ApexLog {
    // Nothing resets the fields below, and every event constructor pushes into them, so reusing an
    // instance would parse the new log on top of the previous one. Construct through
    // `this.constructor` so a subclass still parses with its own overrides.
    return new (this.constructor as typeof ApexLogParser)().parseLog(debugLog);
  }

  private parseLog(debugLog: string): ApexLog {
    const firstLine = debugLog.match(timestampedLinePattern);
    const eventsStart = firstLine?.index;
    const lineGenerator = this.generateLogLines(debugLog, eventsStart ?? 0);
    const apexLog = this.toLogTree(lineGenerator);
    apexLog.size = utf8ByteLength(debugLog);
    // With no timestamped line, the header is the whole text.
    const { levels, settings } = this.parseDebugSettings(debugLog.slice(0, eventsStart));
    apexLog.debugLevels = levels;
    apexLog.debugLevelSettings = settings;
    apexLog.userInfo = parseUserInfo(firstLine?.[0]);
    apexLog.entryPoints = findEntryPoints(apexLog, this.codeUnits);
    apexLog.logIssues = this.logIssues;
    apexLog.parsingErrors = this.parsingErrors;
    apexLog.namespaces = Array.from(this.namespaces);
    apexLog.eventsById = this.eventsById;
    apexLog.exceptions = this.exceptions;

    apexLog.governorLimits = deriveGovernorLimits(this.governorSnapshots, apexLog.heapPeak);
    this.resolveIssueEndTimes(apexLog);

    apexLog.truncation = this.buildTruncation();
    apexLog.truncatedEvents = this.truncatedEvents;
    // A region is the only evidence the platform dropped log content; an unterminated event is not,
    // because a log can simply stop mid-frame.
    apexLog.isTruncated = apexLog.truncation.regions.length > 0;

    return apexLog;
  }

  /**
   * Assigns an `endTime` to truncation issues that can be bounded, so the timeline only
   * shades the untrusted region instead of everything up to the next marker.
   *
   * - `Skipped-Lines` (mid-log): ends at the first following *entry* event (one with
   *   `exitTypes`), because that opens a fresh, fully-present subtree where trust resumes.
   *   A detail line such as `HEAP_ALLOCATE` is ignored — it may be nested under a parent
   *   whose entry was deleted.
   * - `Max-Size-reached`: ends at the first event past the truncated region, because the
   *   next surviving line is a preserved event and is trusted (e.g. a trailing
   *   `FATAL_ERROR`). The truncated node's own remnants are collapsed onto the truncation
   *   timestamp, so we take the first later event (`timestamp > startTime`).
   * - Other issues stay point-in-time (`endTime` undefined).
   */
  private resolveIssueEndTimes(apexLog: ApexLog) {
    const events = this.eventsById;
    const logEndTime = apexLog.exitStamp || 0;
    for (const issue of this.logIssues) {
      const startIndex = (issue.eventIndex ?? -1) + 1;
      if (issue.summary === 'Skipped-Lines') {
        let endTime = logEndTime;
        for (let i = startIndex; i < events.length; i++) {
          const event = events[i];
          if (event && event.exitTypes.length > 0) {
            endTime = event.timestamp;
            break;
          }
        }
        issue.endTime = endTime;
      } else if (issue.summary === 'Max-Size-reached') {
        const startTime = issue.startTime ?? 0;
        let endTime = logEndTime;
        for (let i = startIndex; i < events.length; i++) {
          const event = events[i];
          if (event && event.timestamp > startTime) {
            endTime = event.timestamp;
            break;
          }
        }
        issue.endTime = endTime;
      }
    }
  }

  /**
   * Projects the truncation issues into regions, so a boundary is stated once. Runs after
   * `resolveIssueEndTimes`, and inherits the issue order, which is log order.
   */
  private buildTruncation(): Truncation {
    const regions = this.logIssues
      .filter((issue) => truncationKinds[issue.summary])
      .map((issue) => ({
        kind: truncationKinds[issue.summary] as TruncationRegion['kind'],
        startTime: issue.startTime ?? 0,
        endTime: issue.endTime,
        eventIndex: issue.eventIndex,
        skippedBytes: this.skippedBytesByIssue.get(issue),
      }));
    return {
      regions,
      totalSkippedBytes: regions.reduce((total, region) => total + (region.skippedBytes ?? 0), 0),
    };
  }

  /**
   * Applies a signed heap allocation to the running live-heap total (a negative `bytes` is a
   * deallocation) and returns the resulting live-heap level, clamped at 0. Called by the heap
   * allocation leaf events in log order; the returned value seeds their `heapPeak`, which is
   * then rolled up (by max) to the enclosing methods in {@link aggregateTotals}.
   */
  trackHeapAllocation(bytes: number): number {
    // Clamped, so a free the log kept without its allocation cannot swallow later allocations.
    this.runningHeap = Math.max(0, this.runningHeap + bytes);
    return this.runningHeap;
  }

  private parseLine(line: string, lastEntry: LogEvent | null): LogEvent | null {
    const parts = line.split('|');
    const type = parts[1] ?? '';

    const metaCtor = getLogEventClass(type as LogEventType);
    if (metaCtor) {
      parts[1] = eventNames.get(type) ?? type;
      const entry = new metaCtor(this, parts);
      entry.logLine = line;
      return entry;
    }

    const hasType = !!(type && typePattern.test(type));
    if (!hasType && lastEntry?.acceptsText && !isTruncationMarker(line)) {
      // wrapped text from the previous entry?
      lastEntry.text += '\n' + line;
    } else if (hasType) {
      const message = `Unsupported log event name: ${type}`;
      if (!this.parsingErrors.includes(message)) {
        this.parsingErrors.push(message);
      }
    } else if (lastEntry && line.startsWith('*** Skipped')) {
      const issue = this.addLogIssue(
        lastEntry.timestamp,
        lastEntry.eventIndex,
        'Skipped-Lines',
        `${line}. A section of the log has been skipped and the log has been truncated. Full details of this section of log can not be provided.`,
        'skip',
      );
      const skippedBytes = parseSkippedBytes(line);
      if (issue && skippedBytes !== undefined) {
        this.skippedBytesByIssue.set(issue, skippedBytes);
      }
    } else if (lastEntry && line.indexOf('MAXIMUM DEBUG LOG SIZE REACHED') !== -1) {
      this.addLogIssue(
        lastEntry.timestamp,
        lastEntry.eventIndex,
        'Max-Size-reached',
        'The maximum log size has been reached. Part of the log has been truncated.',
        'skip',
      );
      this.maxSizeTimestamp = lastEntry.timestamp;
    } else if (!hasType && settingsPattern.test(line)) {
      // skip an unexpected settings line
    } else {
      this.parsingErrors.push(`Invalid log line: ${line}`);
    }

    return null;
  }

  private afterParse(entry: LogEvent, lastEntry: LogEvent | null) {
    lastEntry?.onAfter?.(this, entry);
    if (entry.namespace) {
      this.namespaces.add(entry.namespace);
    }
  }

  private *generateLogLines(log: string, startIndex: number): Generator<LogEvent> {
    const hascrlf = log.indexOf('\r\n', startIndex) > -1;
    let lastEntry: LogEvent | null = null;
    let lfIndex = log.indexOf('\n', startIndex);
    let crlfIndex = -1;

    while (startIndex < log.length) {
      const isLastLine = lfIndex === -1;
      let eolIndex = isLastLine ? log.length : lfIndex;
      if (hascrlf && !isLastLine && eolIndex > crlfIndex) {
        crlfIndex = log.indexOf('\r', eolIndex - 1);
        eolIndex = crlfIndex + 1 === lfIndex ? crlfIndex : lfIndex;
      }
      const line = log.slice(startIndex, eolIndex);
      if (line) {
        // ignore blank lines
        if (lastEntry && !isLastLine && opensNextLog(line, log, lfIndex + 1, lastEntry)) {
          this.reportMultipleLogs(lastEntry, log, startIndex);
          break;
        }
        const entry = this.parseLine(line, lastEntry);
        if (entry) {
          this.afterParse(entry, lastEntry);
          lastEntry = entry;
          yield entry;
        }
      }
      if (isLastLine) {
        break;
      }
      startIndex = lfIndex + 1;
      lfIndex = log.indexOf('\n', startIndex);
    }

    // Nothing follows the last event, so only the end of the log can close it.
    lastEntry?.onAfter?.(this);
  }

  private toLogTree(lineGenerator: Generator<LogEvent>) {
    const rootMethod = new ApexLog(this),
      stack: LogEvent[] = [];
    let line: LogEvent | null;

    const lineIter = new LineIterator(lineGenerator);

    while ((line = lineIter.fetch())) {
      if (line.isParent) {
        this.parseTree(line, lineIter, stack);
      }
      line.parent = rootMethod;
      rootMethod.children.push(line);
    }

    rootMethod.setTimes();
    this.mergeManagedPackageEvents(rootMethod);
    this.aggregateTotals();
    applyFlowDbResiduals(this.flowDbElements);
    return rootMethod;
  }

  private parseTree(currentLine: LogEvent, lineIter: LineIterator, stack: LogEvent[]) {
    this.lastTimestamp = currentLine.timestamp;
    currentLine.namespace ||= 'default';

    const isEntry = currentLine.exitTypes.length;
    if (isEntry) {
      const exitOnNextLine = currentLine.nextLineIsExit;
      let nextLine;
      let newExecution = false;

      stack.push(currentLine);

      while ((nextLine = lineIter.peek())) {
        // discontinuities are stack unwinding (caused by Exceptions)
        this.discontinuity ||= nextLine.discontinuity; // start unwinding stack

        // Exit Line has been found no more work needed
        if (
          !exitOnNextLine &&
          !nextLine.nextLineIsExit &&
          nextLine.isExit &&
          !nextLine.exitTypes.length &&
          this.endMethod(currentLine, nextLine, lineIter, stack)
        ) {
          // the method wants to see the exit line
          currentLine.onEnd?.(nextLine, stack);
          break;
        } else if (
          exitOnNextLine &&
          (nextLine.nextLineIsExit || nextLine.isExit || nextLine.exitTypes.length > 0)
        ) {
          currentLine.exitStamp = nextLine.timestamp;
          currentLine.onEnd?.(nextLine, stack);
          break;
        } else if (
          this.discontinuity &&
          this.maxSizeTimestamp &&
          nextLine.timestamp > this.maxSizeTimestamp
        ) {
          // The current line was truncated (we did not find the exit line before the end of log) and there was a discontinuity
          currentLine.isTruncated = true;
          break;
        } else if (nextLine.type === 'EXECUTION_STARTED') {
          // An execution is always top level, so every frame still open lost its exit.
          newExecution = true;
          this.discontinuity = false; // the new execution starts with a fresh stack
          break;
        }

        lineIter.fetch(); // it's a child - consume the line
        this.lastTimestamp = nextLine.timestamp;
        nextLine.namespace ||= currentLine.namespace || 'default';
        nextLine.parent = currentLine;
        currentLine.children.push(nextLine);

        if (nextLine.isParent) {
          this.parseTree(nextLine, lineIter, stack);
        }
      }

      // End of line error handling. We have finished processing this log line and either got to the end
      // of the log without finding an exit line or the current line was truncated)
      if (!nextLine || newExecution || currentLine.isTruncated) {
        // truncated method - terminate at the end of the log
        // A child can close on a line this frame never consumed, so never end before it.
        const lastChild = currentLine.children.at(-1);
        currentLine.exitStamp = Math.max(
          this.lastTimestamp,
          lastChild?.exitStamp ?? lastChild?.timestamp ?? currentLine.timestamp,
        );

        // we found an entry event on its own e.g a `METHOD_ENTRY` without a `METHOD_EXIT` and got to the end of the log
        this.addLogIssue(
          currentLine.exitStamp,
          currentLine.eventIndex,
          'Unexpected-End',
          'An entry event was found without a corresponding exit event e.g a `METHOD_ENTRY` event without a `METHOD_EXIT`',
          'unexpected',
        );

        if (currentLine.isTruncated) {
          this.updateLogIssue(
            currentLine.exitStamp,
            currentLine.eventIndex,
            'Max-Size-reached',
            'The maximum log size has been reached. Part of the log has been truncated.',
            'skip',
          );
          this.maxSizeTimestamp = currentLine.exitStamp;
        }
        currentLine.isTruncated = true;
        this.truncatedEvents.push(currentLine);
      }

      stack.pop();
      currentLine.recalculateDurations();
    }
  }

  private isMatchingEnd(startMethod: LogEvent, endLine: LogEvent) {
    return !!(
      endLine.type &&
      startMethod.exitTypes.includes(endLine.type) &&
      (endLine.lineNumber === startMethod.lineNumber ||
        !endLine.lineNumber ||
        !startMethod.lineNumber)
    );
  }

  private endMethod(
    startMethod: LogEvent,
    endLine: LogEvent,
    lineIter: LineIterator,
    stack: LogEvent[],
  ) {
    startMethod.exitStamp = endLine.timestamp;

    // is this a 'good' end line?
    if (this.isMatchingEnd(startMethod, endLine)) {
      this.discontinuity = false; // end stack unwinding
      lineIter.fetch(); // consume the line
      return true; // success
    } else if (this.discontinuity) {
      return true; // exception - unwind
    } else {
      if (stack.some((m) => this.isMatchingEnd(m, endLine))) {
        return true; // we match a method further down the stack - unwind
      }
      // we found an exit event on its own e.g a `METHOD_EXIT` without a `METHOD_ENTRY`
      this.addLogIssue(
        endLine.timestamp,
        endLine.eventIndex,
        'Unexpected-Exit',
        'An exit event was found without a corresponding entry event e.g a `METHOD_EXIT` event without a `METHOD_ENTRY`',
        'unexpected',
      );
      return false; // we have no matching method - ignore
    }
  }

  private aggregateTotals() {
    // Each event is created after its parent, so walking them backwards totals every child first.
    const events = this.eventsById;
    let i = events.length;
    while (i--) {
      const parent = events[i];
      if (!parent?.children.length) {
        continue;
      }

      // Sum into locals and write each parent field once: a parent read per child is megamorphic.
      const children = parent.children;
      let dml = 0;
      let soql = 0;
      let sosl = 0;
      let dmlRows = 0;
      let soqlRows = 0;
      let soslRows = 0;
      let thrown = 0;
      let heapNet = 0;
      let heapGross = 0;
      let heapNetSelf = 0;
      let heapGrossSelf = 0;
      let childTime = 0;
      let heapPeak = parent.heapPeak;
      let j = children.length;
      while (j--) {
        const child = children[j];
        if (!child) {
          continue;
        }
        dml += child.dmlCount.total;
        soql += child.soqlCount.total;
        sosl += child.soslCount.total;
        dmlRows += child.dmlRowCount.total;
        soqlRows += child.soqlRowCount.total;
        soslRows += child.soslRowCount.total;
        childTime += child.duration.total;
        thrown += child.thrownCount.total;
        heapNet += child.heapAllocated.total;
        heapGross += child.heapGross.total;
        // Direct/self heap: attribute only leaf heap children (which are not `isParent`) to the
        // enclosing method, so `.self` = bytes allocated by this method's own body, excluding
        // sub-methods.
        if (!child.isParent) {
          heapNetSelf += child.heapAllocated.self;
          heapGrossSelf += child.heapGross.self;
        }
        // Peak live heap composes by max (not sum): a parent's peak is the highest
        // reached anywhere in its subtree, so root.heapPeak = the transaction peak.
        if (child.heapPeak > heapPeak) {
          heapPeak = child.heapPeak;
        }
      }
      parent.dmlCount.total += dml;
      parent.soqlCount.total += soql;
      parent.soslCount.total += sosl;
      parent.dmlRowCount.total += dmlRows;
      parent.soqlRowCount.total += soqlRows;
      parent.soslRowCount.total += soslRows;
      parent.duration.self -= childTime;
      parent.thrownCount.total += thrown;
      parent.heapAllocated.total += heapNet;
      parent.heapGross.total += heapGross;
      parent.heapAllocated.self += heapNetSelf;
      parent.heapGross.self += heapGrossSelf;
      parent.heapPeak = heapPeak;
    }
  }

  private mergeManagedPackageEvents(root: LogEvent) {
    const stack: LogEvent[] = [root];

    while (stack.length) {
      const node = stack.pop()!;
      const children = node.children;
      const len = children.length;
      let write = 0;
      let lastPkg: LogEvent | null = null;

      for (let i = 0; i < len; i++) {
        const child = children[i];
        if (!child) {
          continue;
        }

        const isPkg = child.type === 'ENTERING_MANAGED_PKG';
        if (lastPkg && child.isParent) {
          // merge consecutive pkg events (same namespace)
          if (isPkg && child.namespace === lastPkg.namespace) {
            lastPkg.exitStamp = child.exitStamp || child.timestamp;

            // Currently pkg events can not have children (no exit event) but if they ever do we need to move the children to the lastPkg event. The commented code below does that.
            // Revived, it should also empty child.children, or aggregateTotals totals the dropped event.

            // // Move children from the discarded package to the kept package
            // for (const childOfDiscarded of child.children) {
            //   childOfDiscarded.parent = lastPkg;
            //   lastPkg.children.push(childOfDiscarded);

            //   // If the moved child is also a parent, we need to process it recursively
            //   if (childOfDiscarded.isParent) {
            //     stack.push(childOfDiscarded);
            //   }
            // }

            continue; // skip writing this child
          } else if (!isPkg && child.exitStamp) {
            // pkg merge sequence ends
            lastPkg.recalculateDurations();
            lastPkg = null;
          }
        }

        // First timing we see a pkg event or found a pkg event with a different namespace
        if (isPkg) {
          // done merging to the last pkg event, make sure the durations are correct
          lastPkg?.recalculateDurations();
          lastPkg = child;
        }

        if (child.isParent) {
          stack.push(child);
        }

        // keep this child by rewriting in place
        children[write++] = child;
      }

      // truncate array to new length
      if (write < children.length) {
        children.length = write;
        lastPkg?.recalculateDurations();
      }
    }
  }

  /** Runs once, only for a text that holds more than one log, so the scan of the rest is cheap. */
  private reportMultipleLogs(lastEntry: LogEvent, log: string, nextLogStart: number) {
    // At least 2: this runs only once a second log was found.
    const count = Math.max(2, 1 + (log.slice(nextLogStart).match(logHeaderPattern)?.length ?? 0));
    this.addLogIssue(
      lastEntry.timestamp,
      lastEntry.eventIndex,
      'Multiple-Logs',
      `The text holds ${count} logs. Only the first log was parsed. Open each log on its own.`,
      'error',
    );
  }

  /** @returns the issue as stored, or undefined when an issue with the same identity is held. */
  public addLogIssue(
    startTime: number,
    eventIndex: number | undefined,
    summary: string,
    description: string,
    type: IssueType,
  ): LogIssue | undefined {
    const key = issueKey(type, summary);
    if (this.reasons.has(key) && !alwaysReportedSummaries.has(summary)) {
      return undefined;
    }

    this.reasons.add(key);
    const issue: LogIssue = {
      startTime: startTime,
      eventIndex: eventIndex,
      summary: summary,
      description: description,
      type: type,
    };
    this.logIssues.push(issue);
    this.logIssues.sort((a, b) => (a.startTime || 0) - (b.startTime || 0));
    return issue;
  }

  private updateLogIssue(
    startTime: number,
    eventIndex: number | undefined,
    summary: string,
    description: string,
    type: IssueType,
  ) {
    const key = issueKey(type, summary);
    const elem = this.logIssues.findIndex((item) => issueKey(item.type, item.summary) === key);
    if (elem > -1) {
      this.logIssues.splice(elem, 1);
    }
    this.reasons.delete(key);

    this.addLogIssue(startTime, eventIndex, summary, description, type);
  }

  private parseDebugSettings(header: string): {
    levels: DebugLevels;
    settings: DebugLevelSetting[];
  } {
    const levels: DebugLevels = {};
    const settings: DebugLevelSetting[] = [];
    const line = header.match(settingsPattern)?.[0];
    if (!line) {
      return { levels, settings };
    }

    for (const entry of line.substring(line.indexOf(' ') + 1).split(';')) {
      if (!entry) {
        continue;
      }

      // At the first comma only, so the level keeps whatever the entry stated after it.
      const comma = entry.indexOf(',');
      const token = comma < 0 ? entry : entry.slice(0, comma);
      const level = comma < 0 ? null : entry.slice(comma + 1) || null;
      const category = debugLevelKeyByToken.get(token) ?? null;
      settings.push({ token, level, category });
      // An unknown category is data the caller can still show, not a parse error.
      if (!category) {
        continue;
      }
      if (level && logLevels.has(level)) {
        levels[category] = level as LogLevel;
      } else {
        this.parsingErrors.push(`Unsupported debug level: ${entry}`);
      }
    }
    return { levels, settings };
  }
}

export class LineIterator {
  next: LogEvent | null;
  lineGenerator: Generator<LogEvent>;

  constructor(lineGenerator: Generator<LogEvent>) {
    this.lineGenerator = lineGenerator;
    this.next = this.lineGenerator.next().value;
  }

  peek(): LogEvent | null {
    return this.next;
  }

  fetch(): LogEvent | null {
    const result = this.next;
    this.next = this.lineGenerator.next().value;
    return result;
  }
}
