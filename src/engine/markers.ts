/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { COLON, ZERO } from '../bytes/ascii.js';
import { ByteFields } from '../bytes/cursor.js';
import { lineText, timestampClose } from '../bytes/lines.js';
import type { Source } from '../bytes/source.js';
import { eventText } from '../catalog/catalog.js';
import type { LimitSnapshot } from '../limits.js';
import { limitsOfBlock } from '../limits.js';
import type { Store } from '../store/store.js';
import { NONE } from '../store/store.js';
import type { StringTable } from '../store/strings.js';
import { SETTINGS_LINE } from './header.js';
import type { Issue, IssueText, IssueType } from './issues.js';
import { ISSUE, Issues } from './issues.js';
import { HOOK_ID } from './tables.js';

// Looser than TRUNCATION_MARKER: a line only reaches these tests when it is not text.
const MAX_SIZE = 'MAXIMUM DEBUG LOG SIZE REACHED';
const SKIPPED = '*** Skipped';
const SKIPPED_BYTES = /^\*\*\* Skipped ([\d,]+) bytes/;

/**
 * What the log states about itself, apart from its events: the issues, the parsing errors and the
 * limit blocks. The builder calls it off the hot path, on lines that are no event and no text, and
 * on event types with a hook. `at`, `id` and `exitType` name the last event, which a marker line
 * after it is on: `exitType` is the type of the exit line folded into `id`, or null.
 */
export class LogMarkers {
  readonly issues: Issues = new Issues();
  readonly parsingErrors: string[] = [];
  /** The `LIMIT_USAGE_FOR_NS` blocks, in log order. */
  readonly snapshots: LimitSnapshot[] = [];
  private readonly source: Source;
  private readonly store: Store;
  private readonly strings: StringTable;
  /** The hooks' own cursor, so a hook never moves the one the next line was read with. */
  private readonly hookFields: ByteFields;
  private readonly unsupported = new Set<string>();
  /** Max-Size-reached issues the next event after their time ends. */
  private pendingMaxSize: Issue[] = [];

  constructor(source: Source, store: Store, strings: StringTable) {
    this.source = source;
    this.store = store;
    this.strings = strings;
    this.hookFields = new ByteFields(source);
  }

  /** A Max-Size-reached issue waits for the next event after its time. */
  get waiting(): boolean {
    return this.pendingMaxSize.length > 0;
  }

  /** A parsing error for the line in bytes `start` to `end`. */
  lineError(label: string, start: number, end: number): void {
    this.parsingErrors.push(`${label}: ${this.source.text(start, end)}`);
  }

  /** An event name, in bytes `start` to `end`, that the catalog does not hold: one error per name. */
  unsupportedType(start: number, end: number): void {
    const message = `Unsupported log event name: ${this.source.text(start, end)}`;
    if (this.unsupported.has(message)) return;
    this.unsupported.add(message);
    this.parsingErrors.push(message);
  }

  /**
   * A line, bytes `start` to `end`, that is no event and not the last event's text: a marker or an
   * error. `id` is `NONE` before the first event. True when it states the log's maximum size.
   */
  otherLine(start: number, end: number, at: number, id: number, exitType: number | null): boolean {
    const text = this.source.text(start, end);
    if (id === NONE) {
      if (!SETTINGS_LINE.test(text)) this.parsingErrors.push(`Invalid log line: ${text}`);
      return false;
    }
    if (text.startsWith(SKIPPED)) {
      const issue = this.after(
        {
          summary: 'Skipped-Lines',
          description: `${text}. A section of the log has been skipped and the log has been truncated. Full details of this section of log can not be provided.`,
          type: 'skip',
        },
        at,
        id,
        exitType,
      );
      const skipped = text.match(SKIPPED_BYTES)?.[1];
      if (issue && skipped) issue.skippedBytes = Number.parseInt(skipped.replaceAll(',', ''), 10);
      return false;
    }
    if (text.includes(MAX_SIZE)) {
      this.maxSize(at, id, exitType);
      return true;
    }
    if (!SETTINGS_LINE.test(text)) this.parsingErrors.push(`Invalid log line: ${text}`);
    return false;
  }

  /** The log reached its maximum size after the last event. */
  maxSize(at: number, id: number, exitType: number | null): void {
    const issue = this.after(ISSUE.maxSize, at, id, exitType);
    if (issue) this.pendingMaxSize.push(issue);
  }

  /** The log does not close frame `id`, which it ends at `exitStamp` (nanoseconds). */
  unexpectedEnd(exitStamp: number, id: number, atMaxSize: boolean): void {
    this.issues.add(exitStamp, id, ISSUE.unexpectedEnd);
    if (!atMaxSize) return;
    // Replaced, so it follows the Unexpected-End issue at the same time.
    const issue = this.issues.replace(exitStamp, id, ISSUE.maxSize);
    if (issue) this.pendingMaxSize.push(issue);
  }

  /** The maximum size ends at the next event after it, an exit line or a merged entry too. */
  endMaxSize(at: number): void {
    this.pendingMaxSize = this.pendingMaxSize.filter((issue) => {
      if (at <= issue.startTime) return true;
      issue.endTime = at;
      return false;
    });
  }

  /** The Multiple-Logs issue, with the number of logs from the one at byte `start` on. */
  multipleLogs(start: number, at: number, id: number, exitType: number | null): void {
    const source = this.source;
    const bytes = source.bytes;
    let count = 1;
    for (let line = start; line < bytes.length; ) {
      const eol = source.lineEnd(line);
      if (eol < 0) break;
      // Byte tests before the decode: a settings line starts with a digit, and a timestamp's third byte is ':'.
      // line < length, so it is a byte
      const first = bytes[line]! - ZERO;
      if (
        first >= 0 &&
        first <= 9 &&
        bytes[line + 2] !== COLON &&
        timestampClose(bytes, eol + 1) >= 0 &&
        SETTINGS_LINE.test(lineText(source, line))
      )
        count++;
      line = eol + 1;
    }
    this.after(
      {
        summary: 'Multiple-Logs',
        // At least 2: this runs only once a second log was found.
        description: `The text holds ${Math.max(2, count)} logs. Only the first log was parsed. Open each log on its own.`,
        type: 'error',
      },
      at,
      id,
      exitType,
    );
  }

  /** Runs `hook`, a `HOOK_ID`, on row `id` of `type`, once its whole text is read. */
  hook(hook: number, type: number, id: number): void {
    const store = this.store;
    const fields = this.hookFields;
    // id was placed, so every column holds it
    fields.resetRow(store.start[id]!, store.end[id]!);
    const text = eventText(type, fields) ?? '';
    const timestamp = store.timestamp[id]!;
    if (hook === HOOK_ID.limitSnapshot) {
      const ns = store.namespace[id]!;
      // The limits rule always states one, so NONE is its 'default'.
      const namespace = ns === NONE ? 'default' : this.strings.text(ns);
      this.snapshots.push({ timestamp, namespace, limits: limitsOfBlock(text) });
    } else if (hook === HOOK_ID.fatal) {
      this.textIssue(timestamp, id, text, 'fatal');
    } else if (text.includes('System.LimitException')) {
      this.textIssue(timestamp, id, text, 'error');
    }
  }

  /** An issue on the last event, from a line after it: the search for its end starts after it. */
  private after(text: IssueText, at: number, id: number, exitType: number | null): Issue | null {
    const issue = this.issues.add(at, id, text);
    if (issue) {
      issue.exitType = exitType;
      issue.after = this.store.count;
    }
    return issue;
  }

  /** An issue from an event's text: its first line is the summary. */
  private textIssue(timestamp: number, id: number, text: string, type: IssueType): void {
    const lf = text.indexOf('\n');
    const summary = (lf < 0 ? text : text.slice(0, lf)).trim();
    const description = lf < 0 ? '' : text.slice(lf + 1).trim();
    this.issues.add(timestamp, id, { summary, description, type });
  }
}
