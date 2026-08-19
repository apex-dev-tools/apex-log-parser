/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */

import {
  ApexLog,
  CodeUnitStartedLine,
  ExecutionStartedLine,
  type LogEvent,
  applyFlowDbResiduals,
} from './LogEvents.js';
import { getLogEventClass } from './LogLineMapping.js';
import { deriveGovernorLimits } from './limits.js';
import { LOG_LEVEL } from './types.js';
import type {
  DebugLevels,
  GovernorSnapshot,
  IssueType,
  LogEventType,
  LogIssue,
  LogLevel,
  Truncation,
  TruncationRegion,
  UserInfo,
} from './types.js';

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

/**
 * The first code unit, which is what the transaction ran. It sits under `EXECUTION_STARTED` in most
 * logs, but directly on the root in a log that holds no `EXECUTION_STARTED`. One level deep only.
 */
function findEntryPoint(root: ApexLog): CodeUnitStartedLine | null {
  for (const child of root.children) {
    if (child instanceof CodeUnitStartedLine) {
      return child;
    }
    if (child instanceof ExecutionStartedLine) {
      for (const event of child.children) {
        if (event instanceof CodeUnitStartedLine) {
          return event;
        }
      }
    }
  }
  return null;
}

/** The settings line names each category with a log token, which is not the `DebugLevels` property. */
const debugLevelKeyByToken: Record<string, keyof DebugLevels> = {
  APEX_CODE: 'apexCode',
  APEX_PROFILING: 'apexProfiling',
  CALLOUT: 'callout',
  DATA_ACCESS: 'dataAccess',
  DB: 'database',
  NBA: 'nba',
  SYSTEM: 'system',
  VALIDATION: 'validation',
  VISUALFORCE: 'visualforce',
  WAVE: 'wave',
  WORKFLOW: 'workflow',
};

// Read from the log text, not from an event: `generateLogLines` starts at `EXECUTION_STARTED`, so
// the header line never reaches `UserInfoLine`. Only a timestamped line matches.
const userInfoPattern = /^\d{2}:\d{2}:\d{2}\.\d+(?: \(\d+\))?\|USER_INFO\|.*/m;
// Field 6 is '(GMT-08:00) Pacific Standard Time (America/Los_Angeles)', or a bare, sometimes
// localised, label with either part missing. Read the two parts apart, so one absent part does not
// leave the other in the label.
const gmtPrefixPattern = /^\((GMT[^)]*)\)\s*/;
// Last group, because an IANA name can hold slashes.
const ianaNamePattern = /\s\(([^)]*)\)$/;
const gmtOffsetPattern = /^GMT([+-])(\d{2}):(\d{2})$/;

/**
 * Minutes east of UTC. The header states `GMTZ` rather than `GMT+00:00` for UTC.
 * @returns null when the header stated no offset this can read.
 */
function parseGmtOffset(offset: string): number | null {
  if (offset === 'GMTZ') {
    return 0;
  }

  const match = offset.match(gmtOffsetPattern);
  if (!match) {
    return null;
  }

  const minutes = Number.parseInt(match[2] ?? '0', 10) * 60 + Number.parseInt(match[3] ?? '0', 10);
  return match[1] === '-' ? -minutes : minutes;
}

/**
 * Reads the `USER_INFO` header line: id, user name, timezone label and offset.
 * @returns null when the log states no user.
 */
function parseUserInfo(log: string): UserInfo | null {
  // Header region only, so a USER_DEBUG message that quotes a whole log, timestamped lines
  // included, cannot stand in for a header the log never stated.
  const executionStarted = log.indexOf('|EXECUTION_STARTED');
  const header = executionStarted < 0 ? log : log.slice(0, executionStarted);
  const line = header.match(userInfoPattern)?.[0];
  if (!line) {
    return null;
  }

  const parts = line.split('|');
  const field = parts[5] ?? '';
  const gmtPrefix = field.match(gmtPrefixPattern);
  const timezone = field.slice(gmtPrefix?.[0]?.length ?? 0);
  const named = timezone.match(ianaNamePattern);
  return {
    id: parts[3] ?? '',
    userName: parts[4] ?? '',
    timezone: {
      label: timezone.replace(ianaNamePattern, '').trim(),
      name: named?.[1] ?? null,
      // The label states the offset too, so a log with no offset column is still readable.
      offsetMinutes: parseGmtOffset(parts[6] ?? '') ?? parseGmtOffset(gmtPrefix?.[1] ?? ''),
    },
  };
}

const logLevels = new Set<string>(Object.values(LOG_LEVEL));

const skippedBytesPattern = /^\*\*\* Skipped ([\d,]+) bytes/;

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
 * Stateful parsing engine. Prefer the `parse` function — it drives this class and returns an
 * `ApexLog` that already carries the governor limits, log issues and namespaces accumulated here.
 * The class is public because every event constructor takes one, so code that builds events needs
 * it. Its fields are parser state, not API: `parse` parses on a fresh instance every call, so the
 * fields of the instance you call it on stay empty.
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
  /** Running live heap (signed HEAP_ALLOCATE deltas) maintained in log order. */
  runningHeap = 0;
  namespaces: Set<string> = new Set<string>();
  /** Every event created during this parse, indexed by `LogEvent.eventIndex`. */
  eventsById: LogEvent[] = [];
  /** Every exception event (EXCEPTION_THROWN, FATAL_ERROR) in log order. */
  exceptions: LogEvent[] = [];
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
    // Nothing resets the fields below, and every event constructor pushes into them, so a second
    // call on the same instance would parse the new log on top of the previous one. Give each call
    // its own parser instead.
    return new ApexLogParser().parseLog(debugLog);
  }

  private parseLog(debugLog: string): ApexLog {
    const lineGenerator = this.generateLogLines(debugLog);
    const apexLog = this.toLogTree(lineGenerator);
    apexLog.size = debugLog.length;
    apexLog.debugLevels = this.getDebugLevels(debugLog);
    apexLog.userInfo = parseUserInfo(debugLog);
    apexLog.entryPoint = findEntryPoint(apexLog);
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
    this.runningHeap += bytes;
    return Math.max(0, this.runningHeap);
  }

  private parseLine(line: string, lastEntry: LogEvent | null): LogEvent | null {
    const parts = line.split('|');
    const type = parts[1] ?? '';

    const metaCtor = getLogEventClass(type as LogEventType);
    if (metaCtor) {
      const entry = new metaCtor(this, parts);
      entry.logLine = line;
      lastEntry?.onAfter?.(this, entry);
      if (entry.namespace) {
        this.namespaces.add(entry.namespace);
      }
      return entry;
    }

    const hasType = !!(type && typePattern.test(type));
    if (!hasType && lastEntry?.acceptsText) {
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

  private *generateLogLines(log: string): Generator<LogEvent> {
    let startIndex = log.search(/^\d{2}:\d{2}:\d{2}.\d{1} \(\d+\)\|EXECUTION_STARTED$/m);
    if (startIndex === -1) {
      startIndex = 0;
    }

    const hascrlf = log.indexOf('\r\n', startIndex) > -1;
    let lastEntry = null;
    let lfIndex = log.indexOf('\n', startIndex);
    let eolIndex = lfIndex;
    let crlfIndex = -1;

    while (eolIndex !== -1) {
      if (hascrlf && eolIndex > crlfIndex) {
        crlfIndex = log.indexOf('\r', eolIndex - 1);
        eolIndex = crlfIndex + 1 === eolIndex ? crlfIndex : lfIndex;
      }
      const line = log.slice(startIndex, eolIndex);
      if (line) {
        // ignore blank lines
        const entry = this.parseLine(line, lastEntry);
        if (entry) {
          lastEntry = entry;
          yield entry;
        }
      }
      startIndex = lfIndex + 1;
      lfIndex = eolIndex = log.indexOf('\n', startIndex);
    }

    // Parse the last line
    const line = log.slice(startIndex, log.length);
    if (line) {
      // ignore blank lines
      const entry = this.parseLine(line, lastEntry);
      if (entry) {
        entry?.onAfter?.(this);
        yield entry;
      }
    }
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
    this.aggregateTotals([rootMethod]);
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
      if (!nextLine || currentLine.isTruncated) {
        // truncated method - terminate at the end of the log
        currentLine.exitStamp = this.lastTimestamp ?? currentLine.timestamp;

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

  private flattenByDepth(nodes: LogEvent[]) {
    const result = new Map<number, LogEvent[]>();

    let currentDepth = 0;
    let currentNodes = nodes.filter((n) => n.children.length);
    let len = currentNodes.length;
    while (len) {
      result.set(currentDepth++, currentNodes);

      const children: LogEvent[] = [];
      while (len--) {
        const node = currentNodes[len];
        if (!node?.children) {
          continue;
        }

        let i = node.children.length;
        while (i--) {
          const c = node.children[i];
          if (c?.children.length) {
            children.push(c);
          }
        }
      }

      currentNodes = children;
      len = currentNodes.length;
    }

    return result;
  }

  private aggregateTotals(nodes: LogEvent[]) {
    const len = nodes.length;
    if (!len) {
      return;
    }

    // This method purposely processes the children at the lowest depth first in bulk to avoid as much recursion as possible. This increases performance to be just over ~3 times faster or ~70% faster.

    // collect all children for the supplied nodes by depth.
    const nodesByDepth = this.flattenByDepth(nodes);
    let depth = nodesByDepth.size;
    while (depth--) {
      const nds = nodesByDepth.get(depth);
      if (!nds) {
        continue;
      }
      let i = nds.length;
      while (i--) {
        const parent = nds[i];
        if (!parent?.children) {
          continue;
        }

        let j = parent.children.length;
        while (j--) {
          const child = parent.children[j];
          if (!child) {
            continue;
          }
          parent.dmlCount.total += child.dmlCount.total;
          parent.soqlCount.total += child.soqlCount.total;
          parent.soslCount.total += child.soslCount.total;
          parent.dmlRowCount.total += child.dmlRowCount.total;
          parent.soqlRowCount.total += child.soqlRowCount.total;
          parent.soslRowCount.total += child.soslRowCount.total;
          parent.duration.self -= child.duration.total;
          parent.thrownCount.total += child.thrownCount.total;
          parent.heapAllocated.total += child.heapAllocated.total;
          parent.heapGross.total += child.heapGross.total;
          // Direct/self heap: attribute only leaf allocation children (HEAP_ALLOCATE /
          // BULK_HEAP_ALLOCATE, which are not `isParent`) to the enclosing method, so
          // `.self` = bytes allocated by this method's own body, excluding sub-methods.
          if (!child.isParent) {
            parent.heapAllocated.self += child.heapAllocated.self;
            parent.heapGross.self += child.heapGross.self;
          }
          // Peak live heap composes by max (not sum): a parent's peak is the highest
          // reached anywhere in its subtree, so root.heapPeak = the transaction peak.
          if (child.heapPeak > parent.heapPeak) {
            parent.heapPeak = child.heapPeak;
          }
        }
      }
    }
    nodesByDepth.clear();
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

  private getDebugLevels(log: string): DebugLevels {
    const match = log.match(settingsPattern);
    if (!match) {
      return {};
    }

    const settings = match[0];
    const levels: DebugLevels = {};
    for (const entry of settings.substring(settings.indexOf(' ') + 1).split(';')) {
      if (!entry) {
        continue;
      }

      const [token, level] = entry.split(',');
      const key = token ? debugLevelKeyByToken[token] : undefined;
      if (!key) {
        this.parsingErrors.push(`Unsupported debug log category: ${token}`);
      } else if (!level || !logLevels.has(level)) {
        this.parsingErrors.push(`Unsupported debug level: ${entry}`);
      } else {
        levels[key] = level as LogLevel;
      }
    }
    return levels;
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
