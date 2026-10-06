/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogEvent } from '../index.js';
import { parse } from '../index.js';

export type ProfileName = 'small' | 'developer' | 'large';

/** The size band each profile stands for, by its lower bound in UTF-8 bytes. */
export const profileBands: Readonly<Record<ProfileName, number>> = {
  small: 0,
  developer: 1_000_000,
  // Past the 20 MB default limit, read as bytes or MiB, so a log cut at the limit is a developer log.
  large: 21_000_000,
};

/** What a set of logs is made of, so a synthetic log can be compared with real ones. */
export interface LogShape {
  /** Events of each type per million events, most frequent first. Shares that round to 0 are dropped. */
  weights: Record<string, number>;
  /** Mean wrapped lines per event, rounded, for each type whose mean rounds to at least one. */
  wrappedLinesPerEvent: Record<string, number>;
  /** Characters of log text per event. */
  charsPerEvent: number;
  /** Percent of event and wrapped lines that are wrapped. */
  wrappedLinePercent: number;
  /** Mean depth of an event in the tree; a top-level event is 1. */
  meanDepth: number;
  logs: number;
}

// The parser joins each wrapped line onto its event's text with '\n'.
function countLines(text: string): number {
  let count = 0;
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) count++;
  return count;
}

export class LogTally {
  private readonly counts = new Map<string, number>();
  private readonly wrapped = new Map<string, number>();
  private chars = 0;
  private events = 0;
  private wrappedLines = 0;
  private nodes = 0;
  private depthSum = 0;
  private logs = 0;

  /** Adds the log, unless it holds no events, as a text that is not a debug log holds none. */
  add(log: string): void {
    const apexLog = parse(log);
    if (!apexLog.children.length) return;
    this.logs++;
    this.chars += log.length;
    for (const { type, text } of apexLog.eventsById) {
      // The root has no type.
      if (!type) continue;
      this.events++;
      this.counts.set(type, (this.counts.get(type) ?? 0) + 1);
      const lines = countLines(text);
      this.wrappedLines += lines;
      this.wrapped.set(type, (this.wrapped.get(type) ?? 0) + lines);
    }
    const walk = (event: LogEvent, depth: number): void => {
      for (const child of event.children) {
        this.nodes++;
        this.depthSum += depth;
        walk(child, depth + 1);
      }
    };
    walk(apexLog, 1);
  }

  shape(): LogShape {
    if (!this.events) throw new Error('The logs hold no events');
    const round = (value: number) => Math.round(value * 10) / 10;
    const perType = (total: (type: string, count: number) => number) =>
      [...this.counts].map(([type, count]): [string, number] => [type, total(type, count)]);
    return {
      weights: Object.fromEntries(
        perType((_, count) => Math.round((count / this.events) * 1_000_000))
          .filter(([, weight]) => weight > 0)
          .sort(([, a], [, b]) => b - a),
      ),
      wrappedLinesPerEvent: Object.fromEntries(
        perType((type, count) => Math.round((this.wrapped.get(type) ?? 0) / count))
          .filter(([, lines]) => lines > 0)
          .sort(([, a], [, b]) => b - a),
      ),
      charsPerEvent: Math.round(this.chars / this.events),
      wrappedLinePercent: round((this.wrappedLines / (this.events + this.wrappedLines)) * 100),
      meanDepth: round(this.depthSum / this.nodes),
      logs: this.logs,
    };
  }
}
