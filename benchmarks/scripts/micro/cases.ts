/**
 * Micro-benchmark cases that settle the new engine's low-level choices. Each case is a pure
 * function of the log's bytes or text and returns a checksum, so the work cannot be optimised away
 * and cases that should agree can be checked against each other.
 *
 * No imports: `micro.ts` runs the same cases in Node and inlines this file into a Chromium page.
 */

export interface Case {
  /** The question this case answers, e.g. `newline`. Cases in one group are compared. */
  group: string;
  name: string;
  /** Cases with the same key must give the same checksum. Cases without one are not compared. */
  agree: string | null;
  /** The case needs Node's `Buffer`; skipped in a browser. */
  nodeOnly: boolean;
  /** Prepared once, not timed. */
  setup(input: Input): unknown;
  run(prepared: unknown): number;
}

export interface Input {
  bytes: Uint8Array;
  /** The decoded log. Decoded on first read, so a case that never reads it does not pay. */
  readonly text: string;
  /** Node's `Buffer` over the same bytes. Read only by `nodeOnly` cases. */
  buffer: NodeBuffer | null;
}

interface NodeBuffer extends Uint8Array {
  latin1Slice(start: number, end: number): string;
}

interface CaseSpec<P> {
  agree?: string;
  nodeOnly?: boolean;
  setup: (input: Input) => P;
  run: (prepared: P) => number;
}

/** Ties each case's `setup` to its `run`, so neither needs a cast. */
function kase<P>(group: string, name: string, spec: CaseSpec<P>): Case {
  return {
    group,
    name,
    agree: spec.agree ?? null,
    nodeOnly: spec.nodeOnly ?? false,
    setup: spec.setup,
    run: spec.run as (prepared: unknown) => number,
  };
}

const LF = 10;
const COLON = 58;
const PIPE = 124;
const OPEN = 40;
const CLOSE = 41;

// ---- newline search ----

function countLinesIndexOf(bytes: Uint8Array): number {
  let n = 0;
  for (let pos = bytes.indexOf(LF); pos !== -1; pos = bytes.indexOf(LF, pos + 1)) n++;
  return n;
}

function countLinesLoop(bytes: Uint8Array): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === LF) n++;
  return n;
}

const ONES = 0x01010101;
const HIGHS = 0x80808080;
const LFS = 0x0a0a0a0a;

interface Words {
  bytes: Uint8Array;
  /** The same buffer, four bytes at a time. */
  words: Uint32Array;
}

/** The next `\n` at or after `from`, four bytes at a time. */
function nextNewlineSwar({ bytes, words }: Words, from: number): number {
  const len = bytes.length;
  let i = from;
  // Byte by byte up to a word boundary.
  while (i < len && (bytes.byteOffset + i) & 3) {
    if (bytes[i] === LF) return i;
    i++;
  }
  let w = (bytes.byteOffset + i) >> 2;
  const end = (bytes.byteOffset + len) >> 2;
  for (; w < end; w++) {
    // words[w] is inside the bounds: w < end
    const x = words[w]! ^ LFS;
    if (((x - ONES) & ~x & HIGHS) !== 0) {
      i = (w << 2) - bytes.byteOffset;
      for (let k = 0; k < 4; k++) if (bytes[i + k] === LF) return i + k;
    }
  }
  for (i = (end << 2) - bytes.byteOffset; i < len; i++) if (bytes[i] === LF) return i;
  return -1;
}

function countLinesSwar(p: Words): number {
  let n = 0;
  for (let pos = nextNewlineSwar(p, 0); pos !== -1; pos = nextNewlineSwar(p, pos + 1)) n++;
  return n;
}

function countLinesString(text: string): number {
  let n = 0;
  for (let pos = text.indexOf('\n'); pos !== -1; pos = text.indexOf('\n', pos + 1)) n++;
  return n;
}

// ---- a scan shaped like the real one: line ends, timestamp check, nanoseconds, name hash ----
// One copy per newline search, each calling it directly, so no variant pays for an extra call per
// line. The bodies are otherwise identical.

function scanBytesIndexOf(bytes: Uint8Array): number {
  const len = bytes.length;
  let sum = 0;
  let pos = 0;
  while (pos < len) {
    let eol = bytes.indexOf(LF, pos);
    if (eol < 0) eol = len;
    sum = (sum + lineSum(bytes, pos, eol)) | 0;
    pos = eol + 1;
  }
  return sum;
}

function scanBytesSwar(p: Words): number {
  const len = p.bytes.length;
  let sum = 0;
  let pos = 0;
  while (pos < len) {
    let eol = nextNewlineSwar(p, pos);
    if (eol < 0) eol = len;
    sum = (sum + lineSum(p.bytes, pos, eol)) | 0;
    pos = eol + 1;
  }
  return sum;
}

/** The timestamp and name hash of one line, or 0 when it is not timestamped. */
function lineSum(bytes: Uint8Array, pos: number, eol: number): number {
  if (bytes[pos + 2] !== COLON || bytes[pos + 5] !== COLON) return 0;
  let i = pos + 8;
  while (i < eol && bytes[i] !== OPEN) i++;
  i++;
  let t = 0;
  let c = 0;
  while (i < eol && (c = bytes[i]!) !== CLOSE) {
    t = t * 10 + (c - 48);
    i++;
  }
  i += 2;
  let h = 0;
  while (i < eol && (c = bytes[i]!) !== PIPE) {
    h = (Math.imul(h, 31) + c) | 0;
    i++;
  }
  return (h + (t % 1000)) | 0;
}

function scanString(text: string): number {
  const len = text.length;
  let sum = 0;
  let pos = 0;
  while (pos < len) {
    let eol = text.indexOf('\n', pos);
    if (eol < 0) eol = len;
    sum = (sum + lineSumString(text, pos, eol)) | 0;
    pos = eol + 1;
  }
  return sum;
}

function lineSumString(text: string, pos: number, eol: number): number {
  if (text.charCodeAt(pos + 2) !== COLON || text.charCodeAt(pos + 5) !== COLON) return 0;
  let i = pos + 8;
  while (i < eol && text.charCodeAt(i) !== OPEN) i++;
  i++;
  let t = 0;
  let c = 0;
  while (i < eol && (c = text.charCodeAt(i)) !== CLOSE) {
    t = t * 10 + (c - 48);
    i++;
  }
  i += 2;
  let h = 0;
  while (i < eol && (c = text.charCodeAt(i)) !== PIPE) {
    h = (Math.imul(h, 31) + c) | 0;
    i++;
  }
  return (h + (t % 1000)) | 0;
}

// ---- column growth: append one row per line to 6 columns ----

const COLUMNS = 6;

interface ResizableCtor {
  new (
    length: number,
    options: { maxByteLength: number },
  ): ArrayBuffer & { resize(n: number): void };
}

/** Null where the runtime has no resizable ArrayBuffer. */
const Resizable =
  'resize' in ArrayBuffer.prototype ? (ArrayBuffer as unknown as ResizableCtor) : null;

function appendDoubling(rows: number): number {
  let cap = 1024;
  let cols = Array.from({ length: COLUMNS }, () => new Float64Array(cap));
  for (let r = 0; r < rows; r++) {
    if (r === cap) {
      cap *= 2;
      cols = cols.map((c) => {
        const g = new Float64Array(cap);
        g.set(c);
        return g;
      });
    }
    for (let k = 0; k < COLUMNS; k++) cols[k]![r] = r + k;
  }
  return sumColumns(cols, rows, 997);
}

function appendResizable(rows: number): number {
  // its setup, needsResizable, has thrown where Resizable is null
  const Ctor = Resizable!;
  let cap = 1024;
  const buffers = Array.from(
    { length: COLUMNS },
    () => new Ctor(cap * 8, { maxByteLength: Math.min(2 ** 31 - 1, rows * 16) }),
  );
  // Length-tracking views: they grow with their buffer.
  const cols = buffers.map((b) => new Float64Array(b));
  for (let r = 0; r < rows; r++) {
    if (r === cap) {
      cap *= 2;
      for (const b of buffers) b.resize(cap * 8);
    }
    for (let k = 0; k < COLUMNS; k++) cols[k]![r] = r + k;
  }
  return sumColumns(cols, rows, 997);
}

function appendPresized(rows: number): number {
  const cols = Array.from({ length: COLUMNS }, () => new Float64Array(rows));
  for (let r = 0; r < rows; r++) for (let k = 0; k < COLUMNS; k++) cols[k]![r] = r + k;
  return sumColumns(cols, rows, 997);
}

function sumColumns(cols: Float64Array[], rows: number, step: number): number {
  let s = 0;
  for (const c of cols) for (let r = 0; r < rows; r += step) s += c[r]!;
  return s;
}

interface Filled {
  rows: number;
  cols: Float64Array[];
}

// ---- short-string decode: one field per line, as a node getter would ----

interface Ranges {
  bytes: Uint8Array;
  /** Start and end of each field, in pairs. */
  ranges: Uint32Array;
}

/** Byte ranges of the 4th `|` field of each line that has one: a METHOD_ENTRY signature, a SOQL query, … */
function fieldRanges(bytes: Uint8Array): Uint32Array {
  const out: number[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    let eol = bytes.indexOf(LF, pos);
    if (eol < 0) eol = bytes.length;
    let f = 0;
    let start = -1;
    for (let i = pos; i < eol; i++) {
      if (bytes[i] !== PIPE) continue;
      if (++f === 4) start = i + 1;
      else if (f === 5) {
        out.push(start, i);
        start = -1;
        break;
      }
    }
    if (start >= 0) out.push(start, bytes[eol - 1] === 13 ? eol - 1 : eol);
    pos = eol + 1;
  }
  return Uint32Array.from(out);
}

function decodeTextDecoder({ bytes, ranges }: Ranges): number {
  const d = new TextDecoder();
  let n = 0;
  for (let i = 0; i < ranges.length; i += 2)
    n += d.decode(bytes.subarray(ranges[i]!, ranges[i + 1]!)).length;
  return n;
}

function decodeFromCharCode({ bytes, ranges }: Ranges): number {
  const d = new TextDecoder();
  let n = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    const s = ranges[i]!;
    const e = ranges[i + 1]!;
    n += (e - s > 200 ? d.decode(bytes.subarray(s, e)) : asciiOrDecode(bytes, s, e, d)).length;
  }
  return n;
}

/** ASCII by `fromCharCode`, falling back to `TextDecoder` at the first byte above 127. */
function asciiOrDecode(bytes: Uint8Array, s: number, e: number, d: TextDecoder): string {
  let out = '';
  for (let i = s; i < e; i++) {
    const c = bytes[i]!;
    if (c > 127) return d.decode(bytes.subarray(s, e));
    out += String.fromCharCode(c);
  }
  return out;
}

function decodeApply({ bytes, ranges }: Ranges): number {
  const d = new TextDecoder();
  let n = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    const s = ranges[i]!;
    const e = ranges[i + 1]!;
    const sub = bytes.subarray(s, e);
    let ascii = true;
    for (let k = 0; k < sub.length; k++)
      if (sub[k]! > 127) {
        ascii = false;
        break;
      }
    n += (
      ascii && e - s < 4096
        ? String.fromCharCode.apply(null, sub as unknown as number[])
        : d.decode(sub)
    ).length;
  }
  return n;
}

function decodeLatin1Slice({
  buffer,
  ranges,
}: {
  buffer: NodeBuffer;
  ranges: Uint32Array;
}): number {
  let n = 0;
  for (let i = 0; i < ranges.length; i += 2)
    n += buffer.latin1Slice(ranges[i]!, ranges[i + 1]!).length;
  return n;
}

// ---- the same fields from a string input: slices, no decode ----

interface TextRanges {
  text: string;
  ranges: Uint32Array;
}

/** As `fieldRanges`, in UTF-16 units of the decoded text. */
function fieldRangesText(text: string): Uint32Array {
  const out: number[] = [];
  let pos = 0;
  while (pos < text.length) {
    let eol = text.indexOf('\n', pos);
    if (eol < 0) eol = text.length;
    let f = 0;
    let start = -1;
    for (let i = text.indexOf('|', pos); i !== -1 && i < eol; i = text.indexOf('|', i + 1)) {
      if (++f === 4) start = i + 1;
      else if (f === 5) {
        out.push(start, i);
        start = -1;
        break;
      }
    }
    if (start >= 0) out.push(start, text.charCodeAt(eol - 1) === 13 ? eol - 1 : eol);
    pos = eol + 1;
  }
  return Uint32Array.from(out);
}

function sliceFields({ text, ranges }: TextRanges): number {
  let n = 0;
  for (let i = 0; i < ranges.length; i += 2) n += text.slice(ranges[i]!, ranges[i + 1]!).length;
  return n;
}

// ---- interning the same fields: distinct strings and their ids ----

function internByMap({ bytes, ranges }: Ranges): number {
  const d = new TextDecoder();
  const ids = new Map<string, number>();
  let sum = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    const s = d.decode(bytes.subarray(ranges[i]!, ranges[i + 1]!));
    let id = ids.get(s);
    if (id === undefined) ids.set(s, (id = ids.size));
    sum = (sum + id) | 0;
  }
  return sum + ids.size;
}

function internBySlice({ text, ranges }: TextRanges): number {
  const ids = new Map<string, number>();
  let sum = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    const s = text.slice(ranges[i]!, ranges[i + 1]!);
    let id = ids.get(s);
    if (id === undefined) ids.set(s, (id = ids.size));
    sum = (sum + id) | 0;
  }
  return sum + ids.size;
}

function internByHash({ bytes, ranges }: Ranges): number {
  let size = 1 << 12;
  let table = new Int32Array(size).fill(-1);
  let starts = new Uint32Array(1024);
  let ends = new Uint32Array(1024);
  let hashes = new Int32Array(1024);
  let count = 0;
  let sum = 0;
  for (let i = 0; i < ranges.length; i += 2) {
    const a = ranges[i]!;
    const b = ranges[i + 1]!;
    let h = 0;
    for (let k = a; k < b; k++) h = (Math.imul(h, 31) + bytes[k]!) | 0;
    let slot = h & (size - 1);
    let id = -1;
    for (let e = table[slot]!; e !== -1; slot = (slot + 1) & (size - 1), e = table[slot]!) {
      if (
        hashes[e] === h &&
        ends[e]! - starts[e]! === b - a &&
        sameBytes(bytes, starts[e]!, a, b - a)
      ) {
        id = e;
        break;
      }
    }
    if (id < 0) {
      if (count === starts.length) {
        starts = grow(starts);
        ends = grow(ends);
        hashes = grow(hashes);
      }
      id = count++;
      starts[id] = a;
      ends[id] = b;
      hashes[id] = h;
      table[slot] = id;
      if (count * 2 > size) {
        size *= 2;
        table = new Int32Array(size).fill(-1);
        for (let e = 0; e < count; e++) {
          let s = hashes[e]! & (size - 1);
          while (table[s] !== -1) s = (s + 1) & (size - 1);
          table[s] = e;
        }
      }
    }
    sum = (sum + id) | 0;
  }
  return sum + count;
}

function sameBytes(bytes: Uint8Array, x: number, y: number, n: number): boolean {
  for (let k = 0; k < n; k++) if (bytes[x + k] !== bytes[y + k]) return false;
  return true;
}

function grow<T extends Uint32Array | Int32Array>(a: T): T {
  const b = new (a.constructor as new (n: number) => T)(a.length * 2);
  b.set(a);
  return b;
}

// ---- the cases ----

const rowsOf = (input: Input): number => countLinesIndexOf(input.bytes);
// Every runtime the harness targets has resizable buffers, so a missing one is an error, not a skip.
const needsResizable = (input: Input): number => {
  if (!Resizable) throw new Error('This runtime has no resizable ArrayBuffer');
  return rowsOf(input);
};
const withWords = (input: Input): Words => ({
  bytes: input.bytes,
  words: new Uint32Array(input.bytes.buffer, 0, input.bytes.buffer.byteLength >> 2),
});
const withRanges = (input: Input): Ranges => ({
  bytes: input.bytes,
  ranges: fieldRanges(input.bytes),
});
const withTextRanges = (input: Input): TextRanges => ({
  text: input.text,
  ranges: fieldRangesText(input.text),
});
// nodeOnly cases run only where buffer is set
const nodeBuffer = (input: Input): NodeBuffer => input.buffer!;
const filled = (input: Input, column: (rows: number) => Float64Array): Filled => {
  const rows = rowsOf(input);
  return { rows, cols: Array.from({ length: COLUMNS }, () => column(rows).fill(1)) };
};
const readFilled = ({ rows, cols }: Filled): number => sumColumns(cols, rows, 1);

export const CASES: readonly Case[] = [
  kase('newline', 'Uint8Array.indexOf', {
    agree: 'lines',
    setup: (i) => i.bytes,
    run: countLinesIndexOf,
  }),
  kase('newline', 'Buffer.indexOf (Node)', {
    agree: 'lines',
    nodeOnly: true,
    setup: nodeBuffer,
    run: countLinesIndexOf,
  }),
  kase('newline', 'SWAR, 4 bytes', { agree: 'lines', setup: withWords, run: countLinesSwar }),
  kase('newline', 'byte loop', { agree: 'lines', setup: (i) => i.bytes, run: countLinesLoop }),
  kase('newline', 'String.indexOf', {
    agree: 'lines',
    setup: (i) => i.text,
    run: countLinesString,
  }),

  kase('decode', 'TextDecoder.decode, whole log', {
    setup: (i) => i.bytes,
    run: (b) => new TextDecoder().decode(b).length,
  }),
  kase('decode', 'TextEncoder.encode, whole log (string to bytes)', {
    setup: (i) => i.text,
    run: (t) => new TextEncoder().encode(t).length,
  }),

  kase('scan', 'bytes, Uint8Array.indexOf', {
    agree: 'scan',
    setup: (i) => i.bytes,
    run: scanBytesIndexOf,
  }),
  kase('scan', 'bytes, Buffer.indexOf (Node)', {
    agree: 'scan',
    nodeOnly: true,
    setup: nodeBuffer,
    run: scanBytesIndexOf,
  }),
  kase('scan', 'bytes, SWAR', { agree: 'scan', setup: withWords, run: scanBytesSwar }),
  // Agrees with the byte scans only on an ASCII log, so it is not compared with them.
  kase('scan', 'string, charCodeAt', { setup: (i) => i.text, run: scanString }),

  kase('grow', 'grow by doubling (copy)', { agree: 'grow', setup: rowsOf, run: appendDoubling }),
  kase('grow', 'resizable ArrayBuffer', {
    agree: 'grow',
    setup: needsResizable,
    run: appendResizable,
  }),
  kase('grow', 'presized to the row count', { agree: 'grow', setup: rowsOf, run: appendPresized }),

  kase('read', 'fixed-length views', {
    agree: 'read',
    setup: (i) => filled(i, (rows) => new Float64Array(rows)),
    run: readFilled,
  }),
  kase('read', 'length-tracking views', {
    agree: 'read',
    setup: (i) => {
      needsResizable(i);
      // needsResizable has thrown where Resizable is null
      const Ctor = Resizable!;
      return filled(
        i,
        (rows) => new Float64Array(new Ctor(rows * 8, { maxByteLength: rows * 16 })),
      );
    },
    run: readFilled,
  }),

  kase('short decode', 'TextDecoder per field', { setup: withRanges, run: decodeTextDecoder }),
  kase('short decode', 'fromCharCode loop ≤200 B, else TextDecoder', {
    setup: withRanges,
    run: decodeFromCharCode,
  }),
  kase('short decode', 'fromCharCode.apply if ASCII', { setup: withRanges, run: decodeApply }),
  kase('short decode', 'String.slice per field (string input; pins the source)', {
    setup: withTextRanges,
    run: sliceFields,
  }),
  kase('short decode', 'Buffer.latin1Slice (Node)', {
    nodeOnly: true,
    setup: (i) => ({ buffer: nodeBuffer(i), ranges: fieldRanges(i.bytes) }),
    run: decodeLatin1Slice,
  }),

  kase('intern', 'decode, then Map<string>', {
    agree: 'intern',
    setup: withRanges,
    run: internByMap,
  }),
  kase('intern', 'hash bytes, verify, no decode', {
    agree: 'intern',
    setup: withRanges,
    run: internByHash,
  }),
  kase('intern', 'slice, then Map<string> (string input)', {
    setup: withTextRanges,
    run: internBySlice,
  }),
];

/** Times one case: two warm-up runs, then the median of `runs`. */
export function timeCase(
  c: Case,
  input: Input,
  runs: number,
  now: () => number,
): { ms: number; check: number } {
  const prepared = c.setup(input);
  let check = 0;
  for (let i = 0; i < 2; i++) check = c.run(prepared);
  const times: number[] = [];
  for (let i = 0; i < Math.max(1, runs); i++) {
    const t = now();
    check = c.run(prepared);
    times.push(now() - t);
  }
  times.sort((a, b) => a - b);
  // times holds at least one run, so the middle index is inside the bounds
  return { ms: times[times.length >> 1]!, check };
}
