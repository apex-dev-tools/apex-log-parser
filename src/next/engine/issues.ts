/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

export type IssueType = 'unexpected' | 'error' | 'skip' | 'fatal';

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
    };
    // After every issue that starts no later, as a stable sort of the appended list would place it.
    let at = this.list.length;
    while (at > 0 && this.list[at - 1]!.startTime > startTime) at--;
    this.list.splice(at, 0, issue);
    return issue;
  }

  /** Replaces the held issue of the same type and summary. */
  replace(startTime: number, id: number, text: IssueText): void {
    const key = `${text.type}:${text.summary}`;
    const at = this.list.findIndex((issue) => `${issue.type}:${issue.summary}` === key);
    if (at > -1) this.list.splice(at, 1);
    this.keys.delete(key);
    this.add(startTime, id, text);
  }
}
