/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  addressPipe,
  DOT,
  indexOfByte,
  isAddress,
  LPAREN,
  lastIndexOfByte,
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
const METHOD = idOfType('METHOD_ENTRY');
const CONSTRUCTOR = idOfType('CONSTRUCTOR_ENTRY');
const SIGNATURE = fieldPosition(METHOD, 'signature').at;
const CLASS_NAME = fieldPosition(CONSTRUCTOR, 'className').at;

/** What a variable's name makes it. Each distinct name is read once. */
const NAME_KIND = { local: 0, this: 1, field: 2, static: 3 } as const;

/** One name a query found: its last write and its earliest declaration, by ordinal, or `NONE`. */
export interface FoundVariable {
  readonly name: number;
  readonly write: number;
  readonly declaration: number;
}

/** What a frame holds itself by a cut: its locals, and its last write to `this`, if any. */
export interface FrameScope {
  readonly locals: FoundVariable[];
  readonly this: FoundVariable | null;
}

/** What the log holds for one address by a cut, by ordinal, or `NONE`. */
export interface FoundObject {
  /** The class of the object living at the address by then, as its frame declared `this`. */
  readonly className: number;
  /** The last write by then that states the object's value. */
  readonly write: number;
  /** The row of the first write that states it, when none does by then. */
  readonly laterAt: number;
  readonly fields: FoundVariable[];
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
  private readonly declaredType: Int32Array;
  private readonly nameKind: Uint8Array;
  private readonly bytes: Uint8Array;
  private readonly fields: ByteFields;
  /** Each frame's class, by frame row, read on first ask. */
  private readonly classes = new Map<number, number>();
  /** The row of each frame's first variable line, by frame row, or `NONE`. */
  private readonly frameFirst: Int32Array;
  /** Where each frame's name runs start, by frame row; a frame's runs are sorted by name. */
  private readonly frameNames: Int32Array;
  /** Each name run's name, where its lines start, and where its writes start. */
  private readonly nameRunName: Int32Array;
  private readonly nameRunStart: Int32Array;
  private readonly nameRunWrites: Int32Array;
  /** A frame's lines for one name: its declarations, as ordinals past the writes, then its writes. */
  private readonly nameLines: Int32Array;
  /** Field writes by the object they report, then by field name, each in log order. */
  private readonly ownerStart: Int32Array;
  private readonly ownerWrites: Int32Array;
  /** Writes that state an object's value, by the address the line reports, each in log order. */
  private readonly describedStart: Int32Array;
  private readonly describedWrites: Int32Array;
  /** Each address's runs, one per object that lived there, in log order: where each starts and its class. */
  private readonly runStart: Int32Array;
  private readonly runs: Int32Array;
  private readonly runAt: Int32Array;
  private readonly runClass: Int32Array;
  /** Each address id by its text, made on the first `addressOf`. */
  private addresses: Map<string, number> | null = null;
  /** Each static's name id, by static ordinal. */
  private readonly staticNames: Int32Array;
  /** Each static's writes, by static ordinal, in log order. */
  private readonly staticStart: Int32Array;
  private readonly staticWrites: Int32Array;
  /** Each static's earliest declaration, by static ordinal, or `NONE`. */
  private readonly staticDeclaration: Int32Array;

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
    let thisName = NONE;
    const nameOf = (s: number, e: number): number => {
      const before = strings.size;
      const id = strings.intern(s, e);
      if (id === before) {
        // Addresses and types share the table, so a new name can skip ids past the end.
        if (id >= nameKind.length)
          nameKind = resized(nameKind, Math.max(id + 1, nameKind.length * 2));
        nameKind[id] = kindOf(bytes, s, e);
        if (nameKind[id] === NAME_KIND.this) thisName = id;
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

    // Each frame's lines, merged from the two lists in log order.
    const lines = new Int32Array(W + S);
    for (let w = 0, s = 0; w < W || s < S; ) {
      const takeWrite = s >= S || (w < W && writes[w]! < declarations[s]!);
      lines[w + s] = takeWrite ? w++ : W + s++;
    }
    const lineRow = (line: number): number => (line < W ? writes[line]! : declarations[line - W]!);
    const lineName = (line: number): number =>
      line < W ? writeName[line]! : declaredName[line - W]!;
    const frameFirst = new Int32Array(count).fill(NONE);
    for (const line of lines) {
      const frame = parent[lineRow(line)]!;
      if (frameFirst[frame] === NONE) frameFirst[frame] = lineRow(line);
    }
    // Each frame's lines by name, declarations then writes, each in log order: so a name's earliest
    // declaration and its last write by a cut are one read each, however many lines the frame holds.
    // A static is read log-wide instead.
    const scoped = lines.filter((line) => {
      const name = lineName(line);
      if (name === NONE || nameKind[name] === NAME_KIND.static) return false;
      return line < W || !declaredStatic[line - W];
    });
    const byKind = grouped(2, scoped, (line) => (line < W ? 1 : 0)).items;
    const byLineName = grouped(strings.size, byKind, lineName).items;
    const nameLines = grouped(count, byLineName, (line) => parent[lineRow(line)]!).items;
    const runName: number[] = [];
    const runFirst: number[] = [];
    const runWrites: number[] = [];
    const frameNames = new Int32Array(count + 1);
    for (let k = 0; k < nameLines.length; k++) {
      // k is inside nameLines
      const line = nameLines[k]!;
      const frame = parent[lineRow(line)]!;
      const name = lineName(line);
      const prev = k > 0 ? nameLines[k - 1]! : NONE;
      if (prev === NONE || parent[lineRow(prev)] !== frame || lineName(prev) !== name) {
        runName.push(name);
        runFirst.push(k);
        runWrites.push(NONE);
        frameNames[frame + 1]!++;
      }
      if (line < W && runWrites[runWrites.length - 1] === NONE) runWrites[runWrites.length - 1] = k;
    }
    runFirst.push(nameLines.length);
    for (let r = 0; r < runWrites.length; r++) {
      // A run with no write has its writes start at its end
      if (runWrites[r] === NONE) runWrites[r] = runFirst[r + 1]!;
    }
    for (let frame = 0; frame < count; frame++) frameNames[frame + 1]! += frameNames[frame]!;
    // A field write reports the object the field belongs to: its writes by object, then by name.
    const fieldLines = new Int32Array(W);
    let fieldCount = 0;
    for (let w = 0; w < W; w++) {
      const name = writeName[w]!;
      if (name !== NONE && nameKind[name] === NAME_KIND.field && writeOwner[w] !== NONE)
        fieldLines[fieldCount++] = w;
    }
    const byName = grouped(strings.size, fieldLines.subarray(0, fieldCount), (w) => writeName[w]!);
    const owners = grouped(strings.size, byName.items, (w) => writeOwner[w]!);
    // Any other write that reports an address states that object's value, unless the value is itself one.
    const describing = new Int32Array(W);
    let describingCount = 0;
    for (let w = 0; w < W; w++) {
      const name = writeName[w]!;
      if (name === NONE || nameKind[name] === NAME_KIND.field) continue;
      if (writeOwner[w] !== NONE && writeValueAddress[w] === NONE)
        describing[describingCount++] = w;
    }
    const described = grouped(strings.size, describing.subarray(0, describingCount), (w) => {
      // Every describing write reports an address
      return writeOwner[w]!;
    });
    // A `this` write in a frame that declared `this` names the class of the object at its address.
    // An address is reused once its object is gone, so each object is a run, from that write to the
    // end of its frame. A write inside the last run adds none: a superclass constructor runs on the
    // object inside the subclass's. Only a construction starts a later run, as a method declares
    // `this` as the type it was compiled against.
    const { subtreeEnd, type } = store;
    const declaredThis = new Map<number, number>();
    const lastUntil = new Int32Array(strings.size).fill(NONE);
    const runWrite: number[] = [];
    const runUntil: number[] = [];
    const runType: number[] = [];
    for (const line of lines) {
      const row = lineRow(line);
      // Each row's parent is a frame row or the log
      const frame = parent[row]!;
      if (line >= W) {
        const d = line - W;
        if (declaredName[d] === thisName && declaredType[d] !== NONE && !declaredStatic[d])
          declaredThis.set(frame, declaredType[d]!);
        continue;
      }
      const owner = writeOwner[line]!;
      const cls = declaredThis.get(frame);
      if (writeName[line] !== thisName || owner === NONE || cls === undefined) continue;
      const last = lastUntil[owner]!;
      if (last !== NONE && (row <= last || type[frame] !== CONSTRUCTOR)) continue;
      lastUntil[owner] = subtreeEnd[frame]! - 1;
      runWrite.push(line);
      runUntil.push(subtreeEnd[frame]! - 1);
      runType.push(cls);
    }
    const runIds = Int32Array.from(runWrite.keys());
    const runs = grouped(strings.size, runIds, (r) => {
      // Every run's write reports an address
      return writeOwner[runWrite[r]!]!;
    });

    // A static lives for the transaction, so its writes are one list per name, wherever made.
    const staticOf = new Int32Array(strings.size).fill(NONE);
    let statics = 0;
    for (let w = 0; w < W; w++) {
      const name = writeName[w]!;
      if (name !== NONE && nameKind[name] === NAME_KIND.static && staticOf[name] === NONE)
        staticOf[name] = statics++;
    }
    for (let s = 0; s < S; s++) {
      const name = declaredName[s]!;
      if (name !== NONE && declaredStatic[s] && staticOf[name] === NONE) staticOf[name] = statics++;
    }
    const staticNames = new Int32Array(statics);
    for (let name = 0; name < staticOf.length; name++) {
      // name is a string id
      if (staticOf[name] !== NONE) staticNames[staticOf[name]!] = name;
    }
    const staticLines = new Int32Array(W);
    let staticCount = 0;
    for (let w = 0; w < W; w++) {
      const name = writeName[w]!;
      if (name !== NONE && nameKind[name] === NAME_KIND.static) staticLines[staticCount++] = w;
    }
    const staticWrites = grouped(statics, staticLines.subarray(0, staticCount), (w) => {
      // Every static write's name has a static ordinal
      return staticOf[writeName[w]!]!;
    });
    const staticDeclaration = new Int32Array(statics).fill(NONE);
    for (let s = 0; s < S; s++) {
      const name = declaredName[s]!;
      // In log order, so the first kept is the earliest: where the static comes into scope.
      if (name !== NONE && declaredStatic[s] && staticDeclaration[staticOf[name]!] === NONE)
        staticDeclaration[staticOf[name]!] = s;
    }

    this.store = store;
    this.strings = strings;
    this.writes = writes;
    this.writeName = writeName;
    this.writeOwner = writeOwner;
    this.writeValueAddress = writeValueAddress;
    this.declarations = declarations;
    this.declaredType = declaredType;
    this.nameKind = nameKind;
    this.bytes = bytes;
    this.fields = fields;
    this.frameFirst = frameFirst;
    this.frameNames = frameNames;
    this.nameRunName = Int32Array.from(runName);
    this.nameRunStart = Int32Array.from(runFirst);
    this.nameRunWrites = Int32Array.from(runWrites);
    this.nameLines = nameLines;
    this.ownerStart = owners.start;
    this.ownerWrites = owners.items;
    this.describedStart = described.start;
    this.describedWrites = described.items;
    this.runStart = runs.start;
    this.runs = runs.items;
    this.runAt = Int32Array.from(runWrite, (w) => writes[w]!);
    this.runClass = Int32Array.from(runType);
    this.staticNames = staticNames;
    this.staticStart = staticWrites.start;
    this.staticWrites = staticWrites.items;
    this.staticDeclaration = staticDeclaration;
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

  /** The frame an event is in: itself for a frame, else its parent, which is 0 at the top. */
  innermostFrame(id: number): number {
    // id is a row
    return isFrameRow(this.store, id) ? id : this.store.parent[id]!;
  }

  /**
   * The frame whose variables an event sees: the nearest frame at or above it with a variable line
   * of its own by `cut`. A query or a system call has no locals: the Apex frame that issued it
   * does. The innermost frame when none has one; `NONE` when the event is in no frame.
   */
  recordingFrame(id: number, cut: number): number {
    const { parent } = this.store;
    const innermost = this.innermostFrame(id);
    // Each parent but the log's is a row
    for (let frame = innermost; frame > 0; frame = parent[frame]!) {
      const first = this.frameFirst[frame]!;
      if (first !== NONE && first <= cut) return frame;
    }
    return innermost > 0 ? innermost : NONE;
  }

  /**
   * What the frame holds by `cut`. Its locals: each name's last write, and each name it declared and
   * never wrote, with its earliest declaration; not `this`, and not a field or static, whose names
   * hold a `.`. And its last write to `this`, with the type it declared `this` as.
   */
  scope(frame: number, cut: number): FrameScope {
    const { nameKind, nameRunName, nameLines, writes, declarations, frameNames } = this;
    const W = writes.length;
    const locals: FoundVariable[] = [];
    let self: FoundVariable | null = null;
    for (let r = frameNames[frame]!; r < frameNames[frame + 1]!; r++) {
      // r is one of the frame's runs, so every per-run array holds it
      const name = nameRunName[r]!;
      const kind = nameKind[name];
      if (kind === NAME_KIND.field) continue;
      const write = this.lastWrite(r, cut);
      const first = this.nameRunStart[r]!;
      const declared = first < this.nameRunWrites[r]! ? nameLines[first]! - W : NONE;
      const declaration = declared !== NONE && declarations[declared]! <= cut ? declared : NONE;
      if (kind === NAME_KIND.this) {
        if (write !== NONE) self = { name, write, declaration };
      } else if (write !== NONE || declaration !== NONE) {
        locals.push({ name, write, declaration });
      }
    }
    return { locals, this: self };
  }

  /**
   * The fields of the object `frame` runs on, by `cut`: the last write to each. From every frame from
   * `innermost` up of the same class, as one object's methods share its fields, and from writes the
   * log grouped under the object's address, as a constructor that returned set them. A frame on
   * another object of the class is left out. The latest write wins.
   */
  objectFields(innermost: number, frame: number, cut: number): FoundVariable[] {
    const { parent } = this.store;
    const { writes, writeName, nameKind, frameNames, nameRunName } = this;
    const latest = new Map<number, number>();
    const take = (w: number): void => {
      // A field write has a name
      const name = writeName[w]!;
      const held = latest.get(name);
      if (held === undefined || writes[held]! < writes[w]!) latest.set(name, w);
    };
    const object = this.objectOf(frame, cut);
    const cls = this.classOf(frame);
    for (let f = innermost; f > 0; f = parent[f]!) {
      if (f !== frame && (cls === NONE || this.classOf(f) !== cls)) continue;
      const theirs = f === frame ? object : this.objectOf(f, cut);
      if (object !== NONE && theirs !== NONE && object !== theirs) continue;
      for (let r = frameNames[f]!; r < frameNames[f + 1]!; r++) {
        // r is one of the frame's runs
        if (nameKind[nameRunName[r]!] !== NAME_KIND.field) continue;
        const w = this.lastWrite(r, cut);
        if (w !== NONE) take(w);
      }
    }
    if (object !== NONE) this.ownerFields(object, cut, take);
    return [...latest.values()].map((w) => ({ name: writeName[w]!, write: w, declaration: NONE }));
  }

  /** The id of an address the log writes, or `NONE`. */
  addressOf(text: string): number {
    if (!this.addresses) {
      const addresses = new Map<string, number>();
      for (const ids of [this.writeOwner, this.writeValueAddress]) {
        for (const id of ids) if (id !== NONE) addresses.set(this.strings.text(id), id);
      }
      this.addresses = addresses;
    }
    return this.addresses.get(text) ?? NONE;
  }

  /**
   * What the log holds for the object at `address` by `cut`: the class of the object living there,
   * the last write that states its value, or where the first one is when none does by then, and
   * its fields. Null when the log holds none of these for the address.
   */
  objectAt(address: number, cut: number): FoundObject | null {
    const { describedStart, describedWrites, writes, runStart, ownerStart } = this;
    const lo = describedStart[address]!;
    const hi = describedStart[address + 1]!;
    if (
      lo === hi &&
      runStart[address] === runStart[address + 1] &&
      ownerStart[address] === ownerStart[address + 1]
    )
      return null;
    const last = upperBound(describedWrites, lo, hi, writes, cut) - 1;
    const write = last >= lo ? describedWrites[last]! : NONE;
    const run = this.runOf(address, cut);
    const fields: FoundVariable[] = [];
    this.ownerFields(address, cut, (w) =>
      fields.push({ name: this.writeName[w]!, write: w, declaration: NONE }),
    );
    return {
      className: run === NONE ? NONE : this.runClass[run]!,
      write,
      laterAt: write === NONE && lo < hi ? writes[describedWrites[lo]!]! : NONE,
      fields,
    };
  }

  /**
   * Hands `take` the last write by `cut` to each field of the object at `address`. Where the address
   * held an earlier object, only writes from this object's run on count.
   */
  private ownerFields(address: number, cut: number, take: (w: number) => void): void {
    const { ownerStart, ownerWrites, writeName, writes, runStart, runs } = this;
    const run = this.runOf(address, cut);
    const from = run !== NONE && run !== runs[runStart[address]!] ? this.runAt[run]! : 0;
    const end = ownerStart[address + 1]!;
    // One run per field name inside the object's run, each in log order.
    for (let lo = ownerStart[address]!; lo < end; ) {
      const name = writeName[ownerWrites[lo]!]!;
      let hi = lo + 1;
      while (hi < end && writeName[ownerWrites[hi]!] === name) hi++;
      const last = upperBound(ownerWrites, lo, hi, writes, cut) - 1;
      if (last >= lo && writes[ownerWrites[last]!]! >= from) take(ownerWrites[last]!);
      lo = hi;
    }
  }

  /** The run of the object living at `address` by `cut`, or `NONE` before the log names one. */
  private runOf(address: number, cut: number): number {
    const { runStart, runs, runAt } = this;
    const lo = runStart[address]!;
    const after = upperBound(runs, lo, runStart[address + 1]!, runAt, cut);
    return after > lo ? runs[after - 1]! : NONE;
  }

  /**
   * Every static by `cut`: its last write, with its earliest declaration, or a declaration by then
   * and no write. A static lives for the transaction, so a write in any frame counts.
   */
  statics(cut: number): FoundVariable[] {
    const { staticNames, staticStart, staticWrites, staticDeclaration, writes, declarations } =
      this;
    const out: FoundVariable[] = [];
    for (let p = 0; p < staticNames.length; p++) {
      // p is a static ordinal, so every per-static array holds it
      const lo = upperBound(staticWrites, staticStart[p]!, staticStart[p + 1]!, writes, cut);
      const declaration = staticDeclaration[p]!;
      const write = lo > staticStart[p]! ? staticWrites[lo - 1]! : NONE;
      if (write === NONE && (declaration === NONE || declarations[declaration]! > cut)) continue;
      out.push({ name: staticNames[p]!, write, declaration });
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

  /** The address write `w`'s value is, where the log wrote one in place of the value; else `NONE`. */
  valueAddress(w: number): number {
    // w is a write ordinal
    return this.writeValueAddress[w]!;
  }

  /** The type declaration `s` states, or `NONE`. */
  declarationType(s: number): number {
    // s is a declaration ordinal
    return this.declaredType[s]!;
  }

  /** Name run `r`'s last write by `cut`, or `NONE`. */
  private lastWrite(r: number, cut: number): number {
    const split = this.nameRunWrites[r]!;
    // r is a run, and nameRunStart has an entry past the last run
    const last = upperBound(this.nameLines, split, this.nameRunStart[r + 1]!, this.writes, cut) - 1;
    return last >= split ? this.nameLines[last]! : NONE;
  }

  /** The object the frame runs on by `cut`: the address its latest `this` or field write reports. */
  private objectOf(frame: number, cut: number): number {
    const { frameNames, nameRunName, nameRunWrites, nameLines, nameKind, writes, writeOwner } =
      this;
    let object = NONE;
    let latest = -1;
    for (let r = frameNames[frame]!; r < frameNames[frame + 1]!; r++) {
      // r is one of the frame's runs
      const kind = nameKind[nameRunName[r]!];
      if (kind !== NAME_KIND.this && kind !== NAME_KIND.field) continue;
      const split = nameRunWrites[r]!;
      const end = upperBound(nameLines, split, this.nameRunStart[r + 1]!, writes, cut);
      // A field write can report no address, so the run's last write that does.
      for (let k = end - 1; k >= split; k--) {
        const w = nameLines[k]!;
        if (writeOwner[w] === NONE) continue;
        if (writes[w]! > latest) {
          latest = writes[w]!;
          object = writeOwner[w]!;
        }
        break;
      }
    }
    return object;
  }

  /**
   * The class a frame runs in: a constructor's `className`, or a method's signature up to its name.
   * `NONE` for any other frame.
   */
  private classOf(frame: number): number {
    let cls = this.classes.get(frame);
    if (cls === undefined) {
      cls = NONE;
      const { type, start, end } = this.store;
      const bytes = this.bytes;
      // frame is a row
      const t = type[frame]!;
      if (t === METHOD || t === CONSTRUCTOR) {
        const f = this.fields;
        f.resetRow(start[frame]!, end[frame]!);
        const at = t === METHOD ? SIGNATURE : CLASS_NAME;
        const s = f.startOf(at);
        let e = f.endOf(at);
        if (s >= 0 && t === METHOD) {
          const paren = indexOfByte(bytes, LPAREN, s, e);
          e = lastIndexOfByte(bytes, DOT, s, paren < 0 ? e : paren);
        }
        if (s >= 0 && e > s) cls = this.strings.intern(s, e);
      }
      this.classes.set(frame, cls);
    }
    return cls;
  }
}

/** `items` as one list per key, each in the order given: count, prefix sum, fill. */
function grouped(
  keys: number,
  items: Int32Array,
  keyOf: (item: number) => number,
): { start: Int32Array; items: Int32Array } {
  const start = new Int32Array(keys + 1);
  // Each item's key is below keys
  for (const item of items) start[keyOf(item) + 1]!++;
  for (let k = 0; k < keys; k++) start[k + 1]! += start[k]!;
  const next = start.slice(0, keys);
  const out = new Int32Array(items.length);
  for (const item of items) out[next[keyOf(item)]!++] = item;
  return { start, items: out };
}

/** Where in `ids[lo..hi)`, ordinals in log order, the first whose row is past `cut` is. */
function upperBound(
  ids: Int32Array,
  lo: number,
  hi: number,
  rows: Int32Array,
  cut: number,
): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    // mid is inside the run, and each id in it is an ordinal of rows
    if (rows[ids[mid]!]! <= cut) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function kindOf(bytes: Uint8Array, start: number, end: number): number {
  if (spellsAscii(bytes, start, end, 'this')) return NAME_KIND.this;
  if (startsWithAscii(bytes, start, end, 'this.')) return NAME_KIND.field;
  return indexOfByte(bytes, DOT, start, end) < 0 ? NAME_KIND.local : NAME_KIND.static;
}
