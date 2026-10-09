/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Store } from '../store/store.js';

/** The kinds of log issue. */
export const ISSUE_TYPE = {
  Unexpected: 'unexpected',
  Error: 'error',
  Skip: 'skip',
  Fatal: 'fatal',
} as const;

export type IssueType = (typeof ISSUE_TYPE)[keyof typeof ISSUE_TYPE];

/** The ways the platform drops part of a log. */
export const TRUNCATION_KIND = {
  SkippedLines: 'skipped-lines',
  MaxSize: 'max-size',
} as const;

/** How the platform dropped part of a log. */
export type TruncationKind = (typeof TRUNCATION_KIND)[keyof typeof TRUNCATION_KIND];

/** Something wrong or missing in the log that the caller should know. */
export interface Issue {
  /** Nanoseconds. */
  startTime: number;
  /** Nanoseconds; null when the issue is at one point in time. */
  endTime: number | null;
  /** The id of the event the issue is about. */
  id: number;
  /** The type of the exit line that closed `id`, when the issue is about that line; else null. */
  exitType: number | null;
  summary: string;
  description: string;
  type: IssueType;
  /** The bytes the platform states it dropped, for a skipped block; else null. */
  skippedBytes: number | null;
  /** The first row the log states after the line the issue is on. Where an end time search starts. */
  after: number;
}

/** A part of the log the platform dropped, from its issue. */
export interface TruncationRegion {
  kind: TruncationKind;
  /** Nanoseconds. */
  startTime: number;
  /** Nanoseconds: where the log can be trusted again. */
  endTime: number;
  id: number;
  exitType: number | null;
  skippedBytes: number | null;
}

/** Every region the platform dropped, in log order. */
export interface Truncation {
  regions: TruncationRegion[];
  totalSkippedBytes: number;
}

/** What an issue says, apart from where and when. */
export interface IssueText {
  readonly summary: string;
  readonly description: string;
  readonly type: IssueType;
}

/** The issues whose text never varies. */
export const ISSUE: Readonly<Record<'unexpectedEnd' | 'unexpectedExit' | 'maxSize', IssueText>> = {
  unexpectedEnd: {
    summary: 'Unexpected-End',
    description:
      'An entry event was found without a corresponding exit event e.g a `METHOD_ENTRY` event without a `METHOD_EXIT`',
    type: 'unexpected',
  },
  unexpectedExit: {
    summary: 'Unexpected-Exit',
    description:
      'An exit event was found without a corresponding entry event e.g a `METHOD_EXIT` event without a `METHOD_ENTRY`',
    type: 'unexpected',
  },
  maxSize: {
    summary: 'Max-Size-reached',
    description: 'The maximum log size has been reached. Part of the log has been truncated.',
    type: 'skip',
  },
};

// Every skipped block is its own region, so these are never deduplicated.
const ALWAYS_REPORTED = new Set(['Skipped-Lines']);

/** The log's issues, one per type and summary, ordered by start time and then by arrival. */
export class Issues {
  readonly list: Issue[] = [];
  private readonly keys = new Set<string>();

  /** The issue as stored, or null when one of the same type and summary is held. */
  add(startTime: number, id: number, { summary, description, type }: IssueText): Issue | null {
    const key = `${type}:${summary}`;
    if (this.keys.has(key) && !ALWAYS_REPORTED.has(summary)) return null;
    this.keys.add(key);
    const issue: Issue = {
      startTime,
      endTime: null,
      id,
      exitType: null,
      summary,
      description,
      type,
      skippedBytes: null,
      after: id + 1,
    };
    // After every issue that starts no later, as a stable sort of the appended list would place it.
    let at = this.list.length;
    while (at > 0 && this.list[at - 1]!.startTime > startTime) at--;
    this.list.splice(at, 0, issue);
    return issue;
  }

  /** Replaces the held issue of the same type and summary, and returns the new one. */
  replace(startTime: number, id: number, text: IssueText): Issue | null {
    const key = `${text.type}:${text.summary}`;
    const at = this.list.findIndex((issue) => `${issue.type}:${issue.summary}` === key);
    if (at > -1) this.list.splice(at, 1);
    this.keys.delete(key);
    return this.add(startTime, id, text);
  }
}

const KIND: Readonly<Record<string, TruncationKind>> = {
  'Skipped-Lines': 'skipped-lines',
  'Max-Size-reached': 'max-size',
};

/**
 * The issues' end times, then their regions. A skipped block ends at the next row that
 * opens a frame, because a whole subtree starts there. The engine ends the maximum size at the
 * next event after its time, as it places events, since exit lines get no row. Either ends at
 * `logEnd` (nanoseconds) when nothing does.
 */
export function truncationOf(
  issues: Issues,
  store: Store,
  opensFrame: (id: number) => boolean,
  logEnd: number,
): Truncation {
  const regions: TruncationRegion[] = [];
  let totalSkippedBytes = 0;
  for (const issue of issues.list) {
    const kind = KIND[issue.summary];
    if (!kind) continue;
    let endTime = issue.endTime ?? logEnd;
    if (kind === 'skipped-lines') {
      endTime = logEnd;
      for (let id = issue.after; id < store.count; id++) {
        if (opensFrame(id)) {
          // id < count, so it is a row
          endTime = store.timestamp[id]!;
          break;
        }
      }
    }
    issue.endTime = endTime;
    const { startTime, id, exitType, skippedBytes } = issue;
    regions.push({ kind, startTime, endTime, id, exitType, skippedBytes });
    totalSkippedBytes += skippedBytes ?? 0;
  }
  return { regions, totalSkippedBytes };
}
