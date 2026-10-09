/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** A truncation marker line, in its exact forms only, so a debug message that quotes it stays text. */
export const TRUNCATION_MARKER: RegExp =
  /^(?:\*\*\* Skipped [\d,]+ bytes of detailed log|\*+ MAXIMUM DEBUG LOG SIZE REACHED \*+) *$/;

const TYPE_LIKE = /^[A-Z_]+$/;

/** Field 1 of `line` looks like an event name, so the line is never another event's text. */
export function statesType(line: string): boolean {
  const first = line.indexOf('|');
  if (first < 0) return false;
  const second = line.indexOf('|', first + 1);
  return TYPE_LIKE.test(line.slice(first + 1, second < 0 ? undefined : second));
}

/**
 * The continuation lines in `text`, joined: without CRs, empty lines,
 * truncation markers, or lines that look like an event. The engine's byte range spans them all.
 */
export function continuationText(text: string): string {
  const clean =
    text.indexOf('\r') < 0 &&
    text.indexOf('\n\n') < 0 &&
    text.indexOf('|') < 0 &&
    text.indexOf('\n*') < 0 &&
    text[0] !== '\n' &&
    text[0] !== '*' &&
    text.at(-1) !== '\n';
  if (clean) return text;
  const lines = text.split('\n');
  // Only a CR before an LF ends a line; the log's last line keeps its CR, as in v0.
  return lines
    .map((line, i) => (i < lines.length - 1 && line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line !== '' && !TRUNCATION_MARKER.test(line) && !statesType(line))
    .join('\n');
}
