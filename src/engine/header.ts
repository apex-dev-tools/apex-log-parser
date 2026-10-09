/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { DebugCategory, Level } from '../catalog/types.js';
import { DEBUG_CATEGORY, LEVEL } from '../catalog/types.js';

/** One `TOKEN,LEVEL` entry of the header's settings line, as the log states it. */
export interface DebugLevelSetting {
  token: string;
  /** Null when the entry states none. */
  level: string | null;
  /** Null for a token this parser does not know. */
  category: DebugCategory | null;
}

/** The settings line: the level per known category, and every entry as stated. */
export interface DebugSettings {
  /** An absent category is one the header declared no level for. */
  levels: Partial<Record<DebugCategory, Level>>;
  settings: DebugLevelSetting[];
  /** An `Unsupported debug level` message per known category with a level this parser does not know. */
  errors: string[];
}

/** The time zone the `USER_INFO` line states. */
export interface LogTimezone {
  text: string;
  label: string | null;
  /** The IANA name, as `America/Los_Angeles`. */
  name: string | null;
  /** Minutes east of UTC. */
  offsetMinutes: number | null;
  offsetText: string | null;
}

/** The user the `USER_INFO` line states. */
export interface UserInfo {
  id: string | null;
  userName: string | null;
  timezone: LogTimezone | null;
}

/** A settings line: the version, then `TOKEN,LEVEL` entries split by `;`. */
export const SETTINGS_LINE: RegExp = /^\d+\.\d+\sAPEX_CODE,\w+;APEX_PROFILING,.+$/;

const LEVELS: ReadonlySet<string> = new Set<string>(Object.values(LEVEL));
const CATEGORY_BY_TOKEN: ReadonlyMap<string, DebugCategory> = new Map(
  Object.entries(DEBUG_CATEGORY),
);
const GMT_OFFSET = /^GMT([+-])(\d{2}):(\d{2})$/;
const WALL_CLOCK = /^(\d{1,2}):(\d{2}):(\d{2})\.(\d+)\s/;

/** The debug levels: the first settings line of the header text. */
export function debugSettings(header: string): DebugSettings {
  const levels: Partial<Record<DebugCategory, Level>> = {};
  const settings: DebugLevelSetting[] = [];
  const errors: string[] = [];
  const text = header
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .find((line) => SETTINGS_LINE.test(line));
  if (!text) return { levels, settings, errors };
  for (const entry of text.slice(text.indexOf(' ') + 1).split(';')) {
    if (!entry) continue;
    // At the first comma only, so the level keeps whatever the entry stated after it.
    const comma = entry.indexOf(',');
    const token = comma < 0 ? entry : entry.slice(0, comma);
    const level = comma < 0 ? null : entry.slice(comma + 1) || null;
    const category = CATEGORY_BY_TOKEN.get(token) ?? null;
    settings.push({ token, level, category });
    // An unknown category is data the caller can still show, not an error.
    if (!category) continue;
    if (level && LEVELS.has(level)) levels[category] = level as Level;
    else errors.push(`Unsupported debug level: ${entry}`);
  }
  return { levels, settings, errors };
}

/** The user a first line of `USER_INFO` states, or null for any other first line. */
export function userInfo(firstLine: string): UserInfo | null {
  const parts = firstLine.split('|');
  if (parts[1] !== 'USER_INFO') return null;
  return {
    // An empty field between pipes states nothing either.
    id: parts[3] || null,
    userName: parts[4] || null,
    timezone: parts[5] ? timezoneOf(parts[5], parts[6]) : null,
  };
}

/** Milliseconds since midnight, from a line's `HH:MM:SS.f`, or null. */
export function wallClock(line: string): number | null {
  const match = WALL_CLOCK.exec(line);
  if (!match) return null;
  // The pattern matched each group.
  const [, h, m, s, f] = match as unknown as [string, string, string, string, string];
  return (Number(h) * 3600 + Number(m) * 60 + Number(s)) * 1000 + Number(f.padEnd(3, '0'));
}

/** Minutes east of UTC, with the spelling read; the header states `GMTZ` for UTC. */
function gmtOffset(text: string): { minutes: number; text: string } | null {
  if (text === 'GMTZ') return { minutes: 0, text };
  const match = GMT_OFFSET.exec(text);
  if (!match) return null;
  const minutes = Number.parseInt(match[2] ?? '0', 10) * 60 + Number.parseInt(match[3] ?? '0', 10);
  return { minutes: match[1] === '-' ? -minutes : minutes, text };
}

/**
 * `(GMT-08:00) Pacific Standard Time (America/Los_Angeles)`, or a bare, sometimes localised,
 * label with either part missing. String scans, not a regex, so a hostile field cannot make the
 * parse slow.
 */
function timezoneOf(field: string, offsetField: string | undefined): LogTimezone {
  const prefixEnd = field.startsWith('(GMT') ? field.indexOf(')') : -1;
  const gmtPrefix = prefixEnd < 0 ? '' : field.slice(1, prefixEnd);
  const zone = prefixEnd < 0 ? field : field.slice(prefixEnd + 1);
  // The last bracket, because an IANA name can hold slashes but no brackets.
  const open = zone.lastIndexOf('(');
  const named = open > 0 && zone[open - 1] === ' ' && zone.indexOf(')', open) === zone.length - 1;
  // The label states the offset too, so a log with no offset column is still readable.
  const offset = gmtOffset(offsetField ?? '') ?? gmtOffset(gmtPrefix);
  return {
    text: field,
    label: (named ? zone.slice(0, open) : zone).trim() || null,
    name: named ? zone.slice(open + 1, -1) : null,
    offsetMinutes: offset?.minutes ?? null,
    offsetText: offset?.text ?? null,
  };
}
