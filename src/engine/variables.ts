/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  addressPipe,
  DOT,
  indexOfByte,
  isAddress,
  spellsAscii,
  startsWithAscii,
} from '../bytes/ascii.js';
import { ByteFields } from '../bytes/cursor.js';
import type { Source } from '../bytes/source.js';
import { fieldPosition, idOfType } from '../catalog/catalog.js';
import { resized } from '../store/columns.js';
import type { Store } from '../store/store.js';
import { NONE } from '../store/store.js';
import { StringTable } from '../store/strings.js';
import { isFrameRow } from './tables.js';

const ASSIGNMENT = idOfType('VARIABLE_ASSIGNMENT');
const DECLARATION = idOfType('VARIABLE_SCOPE_BEGIN');
const WRITE_NAME = fieldPosition(ASSIGNMENT, 'name').at;
const WRITE_VALUE = fieldPosition(ASSIGNMENT, 'value').at;
const DECLARED_NAME = fieldPosition(DECLARATION, 'name').at;
const DECLARED_TYPE = fieldPosition(DECLARATION, 'type').at;
const DECLARED_STATIC = fieldPosition(DECLARATION, 'isStatic').at;

/** What a variable's name makes it. Each distinct name is read once. */
const NAME_KIND = { local: 0, this: 1, field: 2, static: 3 } as const;

/** One name a query found: its last write and its earliest declaration, by ordinal, or `NONE`. */
export interface FoundVariable {
  readonly name: number;
  readonly write: number;
  readonly declaration: number;
}

/**
 * The variable lines of one log, indexed so a query searches rather than walks: each write's name
 * and addresses, each declaration's name and type, and each frame's own lines in log order. Ids
 * are in log order, so every list fills sorted. Strings stay byte ranges until a caller reads one.
 */
export class VariableIndex {
  /** Names, addresses and declared types, interned apart from the build's own table. */
  readonly strings: StringTable;
  private readonly store: Store;
  /** Each write's row, in log order; a write's ordinal is its place here. */
  private readonly writes: Int32Array;
  private readonly writeName: Int32Array;
  /** The address the line reports after the value: on a `this.<field>` line, the field's owner. */
  private readonly writeOwner: Int32Array;
  /** The value, where the log wrote an address in place of a value it could not serialise. */
  private readonly writeValueAddress: Int32Array;
  private readonly declarations: Int32Array;
  private readonly declaredName: Int32Array;
  private readonly declaredType: Int32Array;
  private readonly declaredStatic: Uint8Array;
  private readonly nameKind: Uint8Array;
  /** Each frame's own lines, by frame row: a write's ordinal, or a declaration's plus the write count. */
  private readonly ownStart: Int32Array;
  private readonly own: Int32Array;
  /** Per-query marks by string id: equal to `query` once seen in the current query. */
  private readonly written: Int32Array;
  private readonly declared: Int32Array;
  private readonly declaredAt: Int32Array;
  private query = 0;

  private constructor(store: Store, source: Source) {
    const { start, end, parent, count } = store;
    const bytes = source.bytes;
    const strings = new StringTable(source);
    const fields = new ByteFields(source);
    const writes = store.rowsOfType(ASSIGNMENT);
    const declarations = store.rowsOfType(DECLARATION);
    const W = writes.length;
    const S = declarations.length;
    let nameKind = new Uint8Array(256);
    const nameOf = (s: number, e: number): number => {
      const before = strings.size;
      const id = strings.intern(s, e);
      if (id === before) {
        if (id === nameKind.length) nameKind = resized(nameKind, id * 2);
        nameKind[id] = kindOf(bytes, s, e);
      }
      return id;
    };

    const writeName = new Int32Array(W).fill(NONE);
    const writeOwner = new Int32Array(W).fill(NONE);
    const writeValueAddress = new Int32Array(W).fill(NONE);
    for (let w = 0; w < W; w++) {
      // Every entry of rowsOfType is a row
      const row = writes[w]!;
      fields.resetRow(start[row]!, end[row]!);
      const valueStart = fields.startOf(WRITE_VALUE);
      // With no value field, the line names no write.
      if (valueStart < 0) continue;
      writeName[w] = nameOf(fields.startOf(WRITE_NAME), fields.endOf(WRITE_NAME));
      const lineEnd = fields.lineEnd;
      const pipe = addressPipe(bytes, valueStart, lineEnd);
      const valueEnd = pipe < 0 ? lineEnd : pipe;
      if (pipe >= 0 && pipe + 1 < lineEnd) writeOwner[w] = strings.intern(pipe + 1, lineEnd);
      if (isAddress(bytes, valueStart, valueEnd))
        writeValueAddress[w] = strings.intern(valueStart, valueEnd);
    }

    const declaredName = new Int32Array(S).fill(NONE);
    const declaredType = new Int32Array(S).fill(NONE);
    const declaredStatic = new Uint8Array(S);
    for (let s = 0; s < S; s++) {
      // Every entry of rowsOfType is a row
      const row = declarations[s]!;
      fields.resetRow(start[row]!, end[row]!);
      const nameStart = fields.startOf(DECLARED_NAME);
      if (nameStart < 0) continue;
      declaredName[s] = nameOf(nameStart, fields.endOf(DECLARED_NAME));
      const typeStart = fields.startOf(DECLARED_TYPE);
      const typeEnd = fields.endOf(DECLARED_TYPE);
      if (typeStart >= 0 && typeStart < typeEnd)
        declaredType[s] = strings.intern(typeStart, typeEnd);
      const staticStart = fields.startOf(DECLARED_STATIC);
      declaredStatic[s] =
        staticStart >= 0 && spellsAscii(bytes, staticStart, fields.endOf(DECLARED_STATIC), 'true')
          ? 1
          : 0;
    }

    // Count, prefix sum, fill: each frame's lines, merged from the two lists in log order.
    const ownStart = new Int32Array(count + 1);
    for (let w = 0; w < W; w++) ownStart[parent[writes[w]!]! + 1]!++;
    for (let s = 0; s < S; s++) ownStart[parent[declarations[s]!]! + 1]!++;
    for (let row = 0; row < count; row++) ownStart[row + 1]! += ownStart[row]!;
    const next = ownStart.slice(0, count);
    const own = new Int32Array(W + S);
    for (let w = 0, s = 0; w < W || s < S; ) {
      const takeWrite = s >= S || (w < W && writes[w]! < declarations[s]!);
      const row = takeWrite ? writes[w]! : declarations[s]!;
      own[next[parent[row]!]!++] = takeWrite ? w++ : W + s++;
    }

    this.store = store;
    this.strings = strings;
    this.writes = writes;
    this.writeName = writeName;
    this.writeOwner = writeOwner;
    this.writeValueAddress = writeValueAddress;
    this.declarations = declarations;
    this.declaredName = declaredName;
    this.declaredType = declaredType;
    this.declaredStatic = declaredStatic;
    this.nameKind = nameKind;
    this.ownStart = ownStart;
    this.own = own;
    this.written = new Int32Array(strings.size);
    this.declared = new Int32Array(strings.size);
    this.declaredAt = new Int32Array(strings.size);
  }

  /** The index of the log's variable lines; null when the log has none, so states no variables. */
  static of(store: Store, source: Source): VariableIndex | null {
    if (!store.rowsOfType(ASSIGNMENT).length && !store.rowsOfType(DECLARATION).length) return null;
    return new VariableIndex(store, source);
  }

  /** The last row an event's variables read: a frame reads as it finished, a leaf as the log reached it. */
  cutOf(id: number): number {
    // id is a row
    return isFrameRow(this.store, id) ? this.store.subtreeEnd[id]! - 1 : id;
  }

  /**
   * The frame whose variables an event sees: the nearest frame at or above it with a variable line
   * of its own by `cut`. A query or a system call has no locals: the Apex frame that issued it
   * does. The innermost frame when none has one; `NONE` when the event is in no frame.
   */
  recordingFrame(id: number, cut: number): number {
    const { parent } = this.store;
    // id is a row, and so is each parent but the log's
    const innermost = isFrameRow(this.store, id) ? id : parent[id]!;
    for (let frame = innermost; frame > 0; frame = parent[frame]!) {
      const first = this.ownStart[frame]!;
      if (first < this.ownStart[frame + 1]! && this.lineRow(this.own[first]!) <= cut) return frame;
    }
    return innermost > 0 ? innermost : NONE;
  }

  /**
   * The frame's locals by `cut`: each name's last write, and each name it declared and never wrote,
   * with its earliest declaration. Not `this`, and not a field or static, whose names hold a `.`.
   */
  locals(frame: number, cut: number): FoundVariable[] {
    const mark = ++this.query;
    const { written, declared, declaredAt, nameKind, writeName, declaredName } = this;
    const W = this.writes.length;
    const lo = this.ownStart[frame]!;
    const found: number[] = [];
    const names: number[] = [];
    // Backwards from the cut, so a name's first write seen is its last.
    for (let k = this.ownBefore(frame, cut) - 1; k >= lo; k--) {
      // k is inside the frame's run
      const line = this.own[k]!;
      if (line < W) {
        const name = writeName[line]!;
        if (name === NONE || nameKind[name] !== NAME_KIND.local || written[name] === mark) continue;
        written[name] = mark;
        found.push(name, line);
      } else {
        const s = line - W;
        const name = declaredName[s]!;
        if (name === NONE || this.declaredStatic[s] || nameKind[name] !== NAME_KIND.local) continue;
        if (declared[name] !== mark) names.push(name);
        declared[name] = mark;
        // Backwards, so the earliest declaration is the one left.
        declaredAt[name] = s;
      }
    }
    const out: FoundVariable[] = [];
    for (let i = 0; i < found.length; i += 2) {
      const name = found[i]!;
      out.push({
        name,
        write: found[i + 1]!,
        declaration: declared[name] === mark ? declaredAt[name]! : NONE,
      });
    }
    for (const name of names) {
      if (written[name] !== mark) out.push({ name, write: NONE, declaration: declaredAt[name]! });
    }
    return out;
  }

  /** The row of write `w`. */
  writeRow(w: number): number {
    // w is a write ordinal
    return this.writes[w]!;
  }

  /** The object write `w`'s value is, to read it at: the value itself where the log wrote an address, else the address it reports. */
  writeAddress(w: number): number {
    // w is a write ordinal
    const value = this.writeValueAddress[w]!;
    return value === NONE ? this.writeOwner[w]! : value;
  }

  /** The type declaration `s` states, or `NONE`. */
  declarationType(s: number): number {
    // s is a declaration ordinal
    return this.declaredType[s]!;
  }

  /** Where in the frame's run its lines after `cut` start. */
  private ownBefore(frame: number, cut: number): number {
    let lo = this.ownStart[frame]!;
    let hi = this.ownStart[frame + 1]!;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      // mid is inside the frame's run
      if (this.lineRow(this.own[mid]!) <= cut) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private lineRow(line: number): number {
    const W = this.writes.length;
    // A line is a write ordinal, or a declaration ordinal past the writes
    return line < W ? this.writes[line]! : this.declarations[line - W]!;
  }
}

function kindOf(bytes: Uint8Array, start: number, end: number): number {
  if (spellsAscii(bytes, start, end, 'this')) return NAME_KIND.this;
  if (startsWithAscii(bytes, start, end, 'this.')) return NAME_KIND.field;
  return indexOfByte(bytes, DOT, start, end) < 0 ? NAME_KIND.local : NAME_KIND.static;
}
