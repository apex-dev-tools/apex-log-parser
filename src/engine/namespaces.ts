/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import {
  COLON,
  countByte,
  DOT,
  findAscii,
  indexOfByte,
  LPAREN,
  lastIndexOfByte,
  PIPE,
  RPAREN,
  SLASH,
  spellsAscii,
  startsWithAscii,
} from '../bytes/ascii.js';
import type { ByteFields } from '../bytes/cursor.js';
import type { Source } from '../bytes/source.js';
import { HIGHS, ONES, PIPES } from '../bytes/words.js';
import type { NamespaceRule } from '../catalog/catalog.js';
import { NONE } from '../store/store.js';
import type { StringTable } from '../store/strings.js';

/** The line states no namespace, so the event takes its frame's. */
export const UNSTATED = -1;
/** The default namespace, `DEFAULT_NAMESPACE`: the event never takes its frame's. */
export const DEFAULT = -2;

/**
 * `ApexEvent.namespace` for code in no package, and for an event that is always in it, as
 * `DML_BEGIN`. The log names it so too, as in `LIMIT_USAGE_FOR_NS`.
 */
export const DEFAULT_NAMESPACE: 'default' = 'default';

/** A namespace as the store holds it, `NONE` for the default, as text. */
export function namespaceText(strings: StringTable, ns: number): string {
  return ns === NONE ? DEFAULT_NAMESPACE : strings.text(ns);
}

/** A rule's id in `RULE`, so the engine switches on a number. */
export const RULE: { readonly [R in NamespaceRule]: number } = {
  none: 1,
  method: 2,
  methodExit: 3,
  constructor: 4,
  codeUnit: 5,
  package: 6,
  limits: 7,
};

const TYPE_FOR_NAME = 'System.Type.forName(';
const APEX_SCHEME = 'apex://';
const UNIT_TYPES = [
  'EventService',
  'Validation',
  'Workflow',
  'Flow',
  'VF',
  'apex',
  '__sfdc_trigger',
];

const LPARENS = 0x28282828;
const DOTS = 0x2e2e2e2e;

/**
 * Each event's own namespace, by pre-0.4 rules, read from the line's bytes. A rule that looks a
 * namespace up asks whether the log stated it before this line.
 */
export class Namespaces {
  /** Every namespace stated so far, in the order the log first states them; `NONE` is default. */
  readonly order: number[] = [];
  private readonly bytes: Uint8Array;
  private readonly words: DataView;
  private readonly strings: StringTable;
  private seen: Uint8Array = new Uint8Array(64);
  private defaultSeen = false;
  private defaultListed = false;
  // The last prefix found stated; a length of 0 matches none. A stated namespace stays stated.
  private lastStart = 0;
  private lastLen = 0;
  private lastNamespace = UNSTATED;

  constructor(source: Source, strings: StringTable) {
    this.bytes = source.bytes;
    this.words = source.words;
    this.strings = strings;
  }

  /** The namespace the line states by `rule` (a `RULE` id), reading the positions it names. */
  read(rule: number, fields: ByteFields, positions: readonly number[]): number {
    let ns: number;
    switch (rule) {
      case RULE.none:
        ns = DEFAULT;
        break;
      case RULE.method:
        ns = this.method(fields, positions[0] ?? -1);
        break;
      case RULE.methodExit:
        ns = this.methodExit(fields, positions[0] ?? -1, positions[1] ?? -1);
        break;
      case RULE.constructor:
        ns = this.constructorOf(fields, positions[0] ?? -1);
        break;
      case RULE.codeUnit:
        ns = this.codeUnit(fields, positions[0] ?? -1, positions[1] ?? -1, positions[2] ?? -1);
        break;
      case RULE.package:
        ns = this.packageOf(fields, positions[0] ?? -1);
        break;
      case RULE.limits:
        ns = this.limits(fields, positions[0] ?? -1);
        break;
      default:
        return UNSTATED;
    }
    this.note(ns);
    return ns;
  }

  /** Lists the default namespace in `order`; it does not count as stated, as `read` does. */
  listDefault(): void {
    if (this.defaultListed) return;
    this.defaultListed = true;
    this.order.push(NONE);
  }

  private note(ns: number): void {
    if (ns === DEFAULT) {
      this.defaultSeen = true;
      this.listDefault();
      return;
    }
    if (ns < 0) return;
    if (ns >= this.seen.length) {
      const grown = new Uint8Array(Math.max(ns + 1, this.seen.length * 2));
      grown.set(this.seen);
      this.seen = grown;
    }
    if (this.seen[ns]) return;
    this.seen[ns] = 1;
    this.order.push(ns);
  }

  /** Bytes `start` to `end` as a namespace the log stated before this line, or `UNSTATED`. */
  private stated(start: number, end: number): number {
    if (start >= end) return UNSTATED;
    const bytes = this.bytes;
    const len = end - start;
    if (len === this.lastLen) {
      const last = this.lastStart;
      let k = 0;
      while (k < len && bytes[last + k] === bytes[start + k]) k++;
      if (k === len) return this.lastNamespace;
    }
    if (spellsAscii(bytes, start, end, DEFAULT_NAMESPACE))
      return this.defaultSeen ? DEFAULT : UNSTATED;
    const id = this.strings.lookup(start, end);
    if (id < 0 || this.seen[id] !== 1) return UNSTATED;
    this.lastStart = start;
    this.lastLen = len;
    this.lastNamespace = id;
    return id;
  }

  /** The namespace in bytes `start` to `end`: none when empty, and `'default'` as `DEFAULT`. */
  private id(start: number, end: number): number {
    if (start >= end) return UNSTATED;
    if (spellsAscii(this.bytes, start, end, DEFAULT_NAMESPACE)) return DEFAULT;
    return this.strings.intern(start, end);
  }

  private method(fields: ByteFields, signature: number): number {
    const s = fields.startOf(signature);
    if (s < 0) return UNSTATED;
    // Not endOf, which scans the whole field; the loops stop at '|'.
    const lineEnd = fields.lineEnd;
    if (startsWithAscii(this.bytes, s, lineEnd, TYPE_FOR_NAME)) return UNSTATED;
    // The first '(', the first '.' anywhere, and the dots before the '('.
    const bytes = this.bytes;
    let bracket = -1;
    let dot = -1;
    let dotsBefore = 0;
    let i = s;
    // 4 bytes a step up to the first '(' or '|'; the byte loop below reads on from that byte.
    const words = this.words;
    for (; i + 4 <= lineEnd; i += 4) {
      // The masks are as in words.ts.
      const w = words.getInt32(i, true);
      const p = w ^ LPARENS;
      const q = w ^ PIPES;
      const d = w ^ DOTS;
      const stops = (~(((p | HIGHS) - ONES) | p) & HIGHS) | (~(((q | HIGHS) - ONES) | q) & HIGHS);
      const stop = stops & -stops;
      // Only the dots before the stop, when the word has one.
      const dots = ~(((d | HIGHS) - ONES) | d) & HIGHS & (stop ? stop - 1 : -1);
      if (dots) {
        if (dot < 0) dot = i + 3 - (Math.clz32(dots & -dots) >>> 3);
        // Each marked byte as a 1 in its byte, summed into the top byte.
        dotsBefore += Math.imul((dots >>> 7) & ONES, ONES) >>> 24;
      }
      if (stop) {
        i += 3 - (Math.clz32(stop) >>> 3);
        break;
      }
    }
    for (; i < lineEnd && (bracket < 0 || dot < 0); i++) {
      const c = bytes[i];
      if (c === PIPE) break;
      else if (c === LPAREN) bracket = i;
      else if (c === DOT) {
        if (dot < 0) dot = i;
        if (bracket < 0) dotsBefore++;
      }
    }
    if (bracket < 0 || dot < 0) return UNSTATED;
    const known = this.stated(s, dot);
    if (known !== UNSTATED) return known;
    // With a dot before the '(', the first dot is the end of the first part.
    if (dotsBefore === 3) return this.id(s, dot);
    return dotsBefore === 1 ? DEFAULT : UNSTATED;
  }

  /** A method exit names a class, not a method, the first time the class is used. */
  private methodExit(fields: ByteFields, classId: number, signature: number): number {
    let field = signature;
    if (fields.startOf(field) < 0) field = classId;
    const s = fields.startOf(field);
    if (s < 0) return UNSTATED;
    const e = fields.endOf(field);
    if (e > s && this.bytes[e - 1] === RPAREN) return UNSTATED;
    const dot = indexOfByte(this.bytes, DOT, s, e);
    return dot < 0 ? UNSTATED : this.id(s, dot);
  }

  private constructorOf(fields: ByteFields, className: number): number {
    const s = fields.startOf(className);
    if (s < 0) return UNSTATED;
    const e = fields.endOf(className);
    const dot = indexOfByte(this.bytes, DOT, s, e);
    // The pre-0.4 slice(0, indexOf('.')): with no dot, every byte but the last.
    const possible = dot < 0 ? e - 1 : dot;
    const known = this.stated(s, possible);
    if (known !== UNSTATED) return known;
    // An inner class with a namespace: ns.Outer.Inner.
    return countByte(this.bytes, DOT, s, e) === 2 ? this.id(s, dot) : UNSTATED;
  }

  private codeUnit(fields: ByteFields, unit: number, name: number, typeRef: number): number {
    // The pre-0.4 `a || b || c`: the first of them that is not empty.
    const typeField = this.firstStated(fields, typeRef, name, unit);
    const ts = typeField < 0 ? 0 : fields.startOf(typeField);
    const te = typeField < 0 ? 0 : fields.endOf(typeField);
    let sep = indexOfByte(this.bytes, COLON, ts, te);
    if (sep < 0) sep = indexOfByte(this.bytes, SLASH, ts, te);
    const unitType = sep < 0 ? '' : this.unitType(ts, sep);
    const nameField = this.firstStated(fields, name, unit);
    let ns = 0;
    let ne = 0;
    if (nameField >= 0) {
      ns = fields.startOf(nameField);
      ne = fields.endOf(nameField);
    } else if (sep >= 0) {
      ns = ts;
      ne = sep;
    }

    let found = UNSTATED;
    switch (unitType) {
      case 'EventService':
        found = this.objectNamespace(sep + 1, te);
        break;
      case 'Validation':
      case 'Workflow':
      case 'Flow':
        break;
      case 'VF':
        found = this.vfNamespace(ns, ne);
        break;
      case 'apex': {
        const dot = indexOfByte(this.bytes, DOT, ns, ne);
        if (dot < 0) break;
        const scheme = findAscii(this.bytes, APEX_SCHEME, ns, ne);
        // The pre-0.4 indexOf('apex://') + 7 is 6 when the name has no scheme.
        const from = scheme < 0 ? ns + 6 : scheme + APEX_SCHEME.length;
        found = from < dot ? this.id(from, dot) : UNSTATED;
        break;
      }
      case '__sfdc_trigger': {
        const ref = fields.startOf(typeRef);
        if (ref < 0) break;
        const refEnd = fields.endOf(typeRef);
        if (countByte(this.bytes, SLASH, ref, refEnd) !== 2) break;
        const first = indexOfByte(this.bytes, SLASH, ref, refEnd);
        found = this.id(first + 1, indexOfByte(this.bytes, SLASH, first + 1, refEnd));
        break;
      }
      default: {
        const bracket = lastIndexOfByte(this.bytes, LPAREN, ns, ne);
        // The pre-0.4 parser split the name up to and including its last '(' on '.'.
        const end = bracket < 0 ? ne : bracket + 1;
        const parts = countByte(this.bytes, DOT, ns, end) + 1;
        // With two parts, the second ends at `end`; a dot there leaves it empty, never '('.
        const secondIsCall = end > ns && this.bytes[end - 1] === LPAREN;
        if (parts === 3 || (parts === 2 && !secondIsCall)) {
          const dot = indexOfByte(this.bytes, DOT, ns, end);
          found = dot < 0 ? UNSTATED : this.id(ns, dot);
        }
      }
    }
    return found === UNSTATED ? DEFAULT : found;
  }

  /** An object's namespace: the prefix before `__`, or `'default'` without one. */
  private objectNamespace(start: number, end: number): number {
    if (start >= end) return UNSTATED;
    const sep = findAscii(this.bytes, '__', start, end);
    return sep < 0 ? DEFAULT : this.id(start, sep);
  }

  /** A VF page's namespace: between the second `/` and the first `__`. */
  private vfNamespace(start: number, end: number): number {
    const sep = findAscii(this.bytes, '__', start, end);
    if (sep < 0) return DEFAULT;
    const first = indexOfByte(this.bytes, SLASH, start, end);
    if (first < 0) return DEFAULT;
    const second = indexOfByte(this.bytes, SLASH, first + 1, end);
    if (second < 0) return DEFAULT;
    // The pre-0.4 substring() swapped its bounds when the first is the larger.
    const from = second + 1;
    return this.id(Math.min(from, sep), Math.max(from, sep));
  }

  /** A package's last dotted part. */
  private packageOf(fields: ByteFields, field: number): number {
    const s = fields.startOf(field);
    if (s < 0) return UNSTATED;
    const e = fields.endOf(field);
    const dot = lastIndexOfByte(this.bytes, DOT, s, e);
    return this.id(dot < 0 ? s : dot + 1, e);
  }

  /** A limit block's name without its brackets, or `'default'`. */
  private limits(fields: ByteFields, field: number): number {
    let s = fields.startOf(field);
    if (s < 0) return DEFAULT;
    let e = fields.endOf(field);
    const bytes = this.bytes;
    while (s < e && (bytes[s] === LPAREN || bytes[s] === RPAREN)) s++;
    while (e > s && (bytes[e - 1] === LPAREN || bytes[e - 1] === RPAREN)) e--;
    const id = this.id(s, e);
    return id === UNSTATED ? DEFAULT : id;
  }

  /** The first of `positions` whose field is not empty, or -1. */
  private firstStated(fields: ByteFields, ...positions: number[]): number {
    for (const p of positions) {
      const s = fields.startOf(p);
      if (s >= 0 && fields.endOf(p) > s) return p;
    }
    return -1;
  }

  /** The code unit type the bytes spell, or `''` for any other. */
  private unitType(start: number, end: number): string {
    for (const type of UNIT_TYPES) if (spellsAscii(this.bytes, start, end, type)) return type;
    return '';
  }
}
