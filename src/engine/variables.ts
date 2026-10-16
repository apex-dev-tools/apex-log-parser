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
  private readonly declaredName: Int32Array;
  private readonly declaredType: Int32Array;
  private readonly declaredStatic: Uint8Array;
  private readonly nameKind: Uint8Array;
  /** The id of the name `this`, or `NONE` when no line names it. */
  private readonly thisName: number;
  private readonly bytes: Uint8Array;
  private readonly fields: ByteFields;
  /** Each frame's class, by frame row, read on first ask. */
  private readonly classes = new Map<number, number>();
  /** Each frame's own lines, by frame row: a write's ordinal, or a declaration's plus the write count. */
  private readonly ownStart: Int32Array;
  private readonly own: Int32Array;
  /** Each frame's writes to `this` and its fields, by frame row. */
  private readonly objectStart: Int32Array;
  private readonly objectWrites: Int32Array;
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
    const own = grouped(count, lines, (line) => parent[lineRow(line)]!);
    // Each frame's writes to its own object, apart, so a caller frame is read without its locals.
    const objectLines = new Int32Array(W);
    let objectCount = 0;
    for (let w = 0; w < W; w++) {
      const kind = writeName[w] === NONE ? NONE : nameKind[writeName[w]!]!;
      if (kind === NAME_KIND.this || kind === NAME_KIND.field) objectLines[objectCount++] = w;
    }
    const objects = grouped(
      count,
      objectLines.subarray(0, objectCount),
      (w) => parent[writes[w]!]!,
    );
    // A field write reports the object the field belongs to: its writes by object, then by name.
    const fieldLines = objectLines
      .subarray(0, objectCount)
      .filter((w) => nameKind[writeName[w]!] === NAME_KIND.field && writeOwner[w] !== NONE);
    const byName = grouped(strings.size, fieldLines, (w) => writeName[w]!).items;
    const owners = grouped(strings.size, byName, (w) => writeOwner[w]!);
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
    this.declaredName = declaredName;
    this.declaredType = declaredType;
    this.declaredStatic = declaredStatic;
    this.nameKind = nameKind;
    this.thisName = thisName;
    this.bytes = bytes;
    this.fields = fields;
    this.ownStart = own.start;
    this.own = own.items;
    this.objectStart = objects.start;
    this.objectWrites = objects.items;
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
      const first = this.ownStart[frame]!;
      if (first < this.ownStart[frame + 1]! && this.lineRow(this.own[first]!) <= cut) return frame;
    }
    return innermost > 0 ? innermost : NONE;
  }

  /**
   * What the frame holds by `cut`. Its locals: each name's last write, and each name it declared and
   * never wrote, with its earliest declaration; not `this`, and not a field or static, whose names
   * hold a `.`. And its last write to `this`, with the type it declared `this` as.
   */
  scope(frame: number, cut: number): FrameScope {
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
        if (name === NONE || this.declaredStatic[s] || nameKind[name] === NAME_KIND.static)
          continue;
        if (nameKind[name] === NAME_KIND.field) continue;
        if (declared[name] !== mark && name !== this.thisName) names.push(name);
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
    const thisWrite = this.lastObjectWrite(frame, cut, NAME_KIND.this);
    const thisName = this.thisName;
    return {
      locals: out,
      this:
        thisWrite === NONE
          ? null
          : {
              name: thisName,
              write: thisWrite,
              declaration: declared[thisName] === mark ? declaredAt[thisName]! : NONE,
            },
    };
  }

  /**
   * The fields of the object `frame` runs on, by `cut`: the last write to each. From every frame from
   * `innermost` up of the same class, as one object's methods share its fields, and from writes the
   * log grouped under the object's address, as a constructor that returned set them. A frame on
   * another object of the class is left out. The latest write wins.
   */
  objectFields(innermost: number, frame: number, cut: number): FoundVariable[] {
    const { parent } = this.store;
    const { writes, writeName, nameKind, objectStart, objectWrites } = this;
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
      const lo = objectStart[f]!;
      for (
        let k = upperBound(objectWrites, lo, objectStart[f + 1]!, writes, cut) - 1;
        k >= lo;
        k--
      ) {
        // k is inside the frame's run
        const w = objectWrites[k]!;
        if (nameKind[writeName[w]!] === NAME_KIND.field) take(w);
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

  /** The frame's last write by `cut` to `this`, or to a field if `kind` says so, or `NONE`. */
  private lastObjectWrite(frame: number, cut: number, kind: number): number {
    const { objectStart, objectWrites, writes, writeName, nameKind } = this;
    const lo = objectStart[frame]!;
    for (
      let k = upperBound(objectWrites, lo, objectStart[frame + 1]!, writes, cut) - 1;
      k >= lo;
      k--
    ) {
      // k is inside the frame's run
      const w = objectWrites[k]!;
      if (nameKind[writeName[w]!] === kind) return w;
    }
    return NONE;
  }

  /** The object the frame runs on by `cut`: the address its latest `this` or field write reports. */
  private objectOf(frame: number, cut: number): number {
    const { objectStart, objectWrites, writes, writeOwner } = this;
    const lo = objectStart[frame]!;
    for (
      let k = upperBound(objectWrites, lo, objectStart[frame + 1]!, writes, cut) - 1;
      k >= lo;
      k--
    ) {
      // k is inside the frame's run
      const owner = writeOwner[objectWrites[k]!]!;
      if (owner !== NONE) return owner;
    }
    return NONE;
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
