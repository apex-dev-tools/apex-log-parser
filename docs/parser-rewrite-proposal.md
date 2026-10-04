# Parser rewrite: research and proposal

Status: research, for discussion under #37. Nothing here is merged code.

The question: if we rewrote the parser from scratch, kept the same information, and allowed
anything (async, streams, lazy trees, workers, WASM, a new API), what would we build?

## TL;DR

Build it the way the fastest modern parsers are built (oxc, Lezer, simdjson). There are three layers:

1. **A byte scanner.** It reads a `Uint8Array`, or a stream of chunks, and never decodes the whole
   log to a string. It never calls `split`, and it allocates nothing per line.
2. **A columnar event store.** One row per log line, in log order, kept in typed arrays: type id,
   byte offset, timestamps, parent, subtree end, depth, line number, namespace id, and the rollup
   totals. The tree is implicit: rows are in prefix order, and each row knows where its subtree
   ends. Totals are computed when a frame closes, in the same pass.
3. **Lazy, typed views.** A node object exists only when a consumer asks for one. Its fields are
   decoded from the source bytes on first read. One declarative schema generates the runtime
   decoders and a TypeScript interface per event. That interface narrows by `type`, names every
   field, and limits `children` to the types a parent can actually hold.

All three layers are **monomorphic by construction**: typed arrays, per-type behaviour as tables
indexed by type id, and one node class. The per-event variety lives only in TypeScript. That
one-class rule matters: a prototype per event type measures 2× *slower* than today. See
[Monomorphism](#8-monomorphism).

The store is a few `ArrayBuffer`s, so it **transfers to and from a worker at no cost**. That one
property is what makes `parseInWorker`, `parseAsync` with progress, streaming, and disk caching
in MCP practical. Today none of them is.

On a 100 MB log, today's parser takes **~3.2 s to return and keeps ~1.1 GB**. A fuller prototype
returns in **~0.45–0.53 s with ~80 MB of columns**. It keeps every line as a row and includes
wrapped text, interned names, every counter, heap peak and per-type indexes. Rollups happen
during the scan, so the root's total time and a whole flame chart cost nothing extra after it
returns. In a worker, the main thread is blocked for **3.5 ms at worst**. See
[What a consumer waits for](#11-what-a-consumer-waits-for). The full implementation should land at
**6–8× faster to a drawn timeline, with about 6× less memory including the source bytes**
(~13× for the tree alone).

Skip WASM for now; the reasons are under [WASM](#71-wasm). Keep the store layout stable, so a WASM
scanner could replace the JS one later without changing the API.

## 1. What we measured

Method: synthetic logs from the generator in #106 (`largeLogs`), whose event mix comes from real
logs. Node 22, Linux container, median of 3–5 runs after warm-up, `--expose-gc`. "Retained" is
`heapUsed + arrayBuffers` after a GC, excluding the input itself.

| 100 MB log (869k events)                         |    Time | Retained |
| ------------------------------------------------ | ------: | -------: |
| `parse()` today (`main`)                          | 2,926 ms | 1,100 MB |
| `readFileSync(path, 'utf8')`: the decode MCP does |   207 ms |        — |
| `TextDecoder.decode(bytes)`                       |    75 ms |        — |
| `indexOf('\n')` over the string: the floor        |    26 ms |        0 |
| slice + `split('\|')` of every line, nothing else  |   231 ms |        0 |
| Columnar prototype, string input (`charCodeAt`)   |   147 ms |    30 MB |
| **Columnar prototype, `Uint8Array` input**        | **97 ms** | **30 MB** |
| `structuredClone` of one plain object per event   | 3,052 ms |        — |
| `structuredClone` of the prototype's columns      |    21 ms |        — |

At 20 MB: today 743 ms / 259 MB, prototype 26 ms / 15 MB.

How to read this:

- **Today's cost is allocation, not scanning.** Splitting every line alone costs 231 ms, and the
  full parse takes 12× that. The prototype parses the same structure and allocates almost nothing.
- **Bytes beat strings.** The byte scanner is about 1.5× faster than the same code over a string,
  and it skips the decode entirely (75–207 ms at 100 MB). A string with one non-Latin-1 character
  also doubles in memory, because V8 stores the whole string two-byte. A `Uint8Array` never does.
- **A worker cannot help today's tree.** Cloning an object-per-event tree takes longer than
  parsing it (3.0 s). Columns clone in 21 ms, and a transfer takes ~0 ms.

The prototype is a floor, not a forecast. It omits text fields, namespaces, issues, limits,
truncation and package merging, and its exit matching is simplified. Its loop is in the
[appendix](#appendix-prototype-core-loop).

### 1.1 What a consumer waits for

The first table times the scan alone. This one times what a UI or MCP actually does after a
parse, using a fuller prototype ("v2") that is closer to the proposal:

- every line is a row, so `eventIndex` is kept
- the real exit, `nextLineIsExit` and `acceptsText` rules, read from today's classes
- wrapped lines
- interned labels and namespaces
- all 8 counters, heap net and peak, and self duration
- per-type indexes
- arrays sized once from the byte length

It still omits issues, limits, truncation, package merge and per-event text rules. It is not
tuned beyond the profile pass: about 22% of its time is still closures.

| 100 MB log | Today | v2 |
| --- | ---: | ---: |
| Parse returns | 3,243 ms | 454–528 ms |
| … then the root's total time | +0, because totals are post-passes inside `parse` | +0, because totals roll up during the scan |
| … then a flame chart: every frame's rect and depth | +343 ms walking objects, labels included | +0–30 ms reading columns |
| … then a flame chart with every label | included above | +0–30 ms, because labels are interned |
| … then a node object for **every** row, walked by `children`, with label | — | +200 ms (658 ms in total) |
| … then decode the raw text of every row (worst case) | — | +330 ms (783 ms in total) |
| MCP path: read the file, then parse | 3,731 ms | 652 ms |
| In a worker: transfer in, scan, transfer out | not viable (3 s to clone) | 475 ms, worst main-thread gap 3.5 ms |
| Retained | 1,100 MB plus the pinned string | ~80 MB of columns plus 100 MB of source bytes |

At 20 MB: today 826 ms (882 ms with a full walk); v2 75–88 ms with a flame chart, 136 ms with an
object per row, and 114 ms as a worker round trip.

What the numbers mean for "lazy":

- **The structure is not lazy.** The scan builds the whole tree, every rollup and every index
  before it returns. That is what makes the root's total, `ofType` and the flame chart free
  afterwards.
- **Objects and strings are lazy.** A consumer pays for them only when it reads them. The worst
  case, an object for every row, still lands 5× under today's parse.
- **Rendering from columns costs about nothing.** A flame chart that reads `timestamp`,
  `exitStamp` and `depth` straight from the arrays adds no measurable time. Built from node
  objects it adds ~200 ms at 100 MB. That is why `log.columns` is public.
- **The worker hides the rest.** The scan time stays the same, but the UI is never blocked for
  more than a few milliseconds, and with streaming it can draw before the end arrives.

### 1.2 Output shape (v3)

The refactor may change the output's shape, so the shape was measured too. At 100 MB:

- exit lines are 41% of rows;
- only 0.6% of frames have any non-zero SOQL/DML/SOSL/thrown count.

Prototype v3 folds each exit into its entry row, keeping the exit's byte offset, and stores the
counts in a sparse pool. That took the scan from 385–433 ms to **240 ms** and the columns from 90
to **41 MB**, with identical root totals. Per-method stats (calls, self, total), computed during
the scan, add ~5%. A frames-only projection cuts the columns to 29 MB.

Against today, that is ~11× faster and ~27× smaller for the tree. The full list of shape changes
is in `docs/parser-rewrite-agent-brief.md` §5.11:

- sparse rollups;
- aggregates shipped built-in;
- dictionary-encoded strings;
- projection;
- a frames table;
- Arrow-compatible columns, with Perfetto and speedscope export;
- a storeless visitor.

## 2. Where the time and memory go today

The numbers are per event: about 1.27 KB retained on a 100 MB log.

- **13+ objects per event.** A `LogEvent` instance, 11 `SelfTotal` objects (`duration`,
  `dmlCount`, …), a `children` array and an `exitTypes` array. Most events are leaves that never
  use any of them.
- **The `parts` array from `split('|')`**, plus a string per field, on every line.
- **`logLine` and `text` strings.** A `slice` of 13 characters or more is a V8 *sliced string*, so
  the tree pins the whole source string for as long as it lives
  ([V8 issue 2869](https://groups.google.com/g/v8-reviews/c/93uSOHcIZW8)).
- **175 classes.** Every hot access site is megamorphic: one class per type reads a field 2.2×
  slower than one class for all ([Monomorphism](#8-monomorphism)). #109 notes that this cannot be
  fixed without one event class, which is an API break.
- **Separate passes** for times, package merge, totals, flow residuals and issue end times. #109
  merges some of them.
- **Boxed doubles.** #107 found that nanosecond durations force V8 to box the counters that share
  their shape.
- **Synchronous, on the caller's thread, from one string.** The analyzer's webview freezes, and
  MCP reads the whole file into a string first (#37).

#107 and #109 take the gains that need no API change: about 28% faster and 27% less heap. Every
remaining cause above is structural.

## 3. Prior art

| Project | Technique | What we take |
| --- | --- | --- |
| **oxc** (Rust → JS) | The AST is written to one raw buffer and deserialised lazily in JS. Only the nodes a visitor touches become objects; [~3× faster than eager deserialisation, and transfer cost near zero](https://oxc.rs/blog/2025-10-09-oxlint-js-plugins.html). | A buffer is the source of truth; objects are an on-demand view. |
| **Lezer** (CodeMirror) | [`TreeBuffer`](https://lezer.codemirror.net/docs/ref/): `(type, start, end, endIndex)` quads in a typed array, nodes in prefix order, and the parent's `endIndex` bounding its children. `SyntaxNode` objects are created on demand; `TreeCursor` walks with no allocation. | Prefix-order rows with a subtree end. Two access styles: ergonomic nodes and an allocation-free cursor. |
| **simdjson** | Stage 1 finds structural characters in bulk; stage 2 builds a flat "tape" of fixed-width records. Strings stay as offsets. | Scan for `\n` and `\|` with native `indexOf` (memchr), and keep fixed-width rows that reference the source. |
| **uDSV** | [The fastest JS CSV parser](https://github.com/leeoniya/uDSV): code specialised per shape, no per-field allocation on the hot path, incremental chunk input. | One specialised loop per input kind (bytes or string), with chunked input. |
| **acorn, meriyah, esbuild** | Hand-written scanners that switch on char codes, never on regexes or `split`. Token values are sliced only when needed. | Dispatch on char codes. The only regexes are on cold paths (the header). |
| **tree-sitter (WASM)** | A cursor API over a native tree, with node objects created per access. | The cursor model, and evidence that WASM pays off only when the scanner is the bottleneck. |

All of them separate **finding the structure**, which must be fast and allocation-free, from
**reading values**, which is lazy and pays only for what is used.

## 4. Proposed architecture

```text
 bytes / chunks ──► Scanner ──► EventStore (typed-array columns, prefix order)
  (Uint8Array,        │            │  + string table (interned names)
   ReadableStream,    │            │  + side tables: issues, limits, truncation
   Blob, file)        │            ▼
                      │        ApexLog facade ──► lazy Node views (typed by schema)
                      │            │          ──► Cursor (zero-alloc walk)
                      │            │          ──► ofType / visit / at(time) / search
                      └─ runs in a worker or time-sliced; the store transfers as ArrayBuffers
```

### 4.1 Scanner

- Input is bytes. A `string` input is accepted, but read through a `charCodeAt` loop
  specialised for strings, not through a generic accessor.
- Each line: `indexOf(10)` for the end of the line. Check `HH:MM:SS.f (`, read the nanosecond
  counter digit by digit, and hash the event name from its bytes into a perfect-hash table of
  type ids. No substring and no `Map<string>` lookup. Read the `[123]` line number in the same
  pass.
- A line that is not timestamped is either a continuation of the previous row (wrapped text, so
  extend that row's end offset), a truncation marker (first byte `*`), or a second log's settings
  line. These are the same rules as today, tested in the same order.
- **Entry/exit matching and the stack** work on type ids and line numbers in an `Int32Array`
  stack, with the same unwinding rules as `parseTree`/`endMethod`, written once as an explicit
  state machine with no recursion.
- **Rollups when a frame closes.** When a frame pops: set the exit timestamp and subtree end, add
  its totals to the parent's, subtract its duration from the parent's self time, and max its
  `heapPeak` into the parent's. Package merge and flow residuals run at the same point. Issue end
  times resolve when the next qualifying row arrives. There are no post-passes.
- **Chunked input.** The scanner keeps the partial last line of a chunk and resumes there. With a
  known size (`Blob.size`, `fs.stat`), the source buffer is allocated once. Otherwise it grows by
  doubling, so a row's offsets never cross a chunk.

### 4.2 Event store

Struct-of-arrays, one row per log line, `row === eventIndex` (the same stable id as today):

| Column | Type | Note |
| --- | --- | --- |
| `type` | `Uint16Array` | id into the schema |
| `start`, `end` | `Uint32Array` | byte range of the line, including wrapped lines |
| `timestamp`, `exitStamp` | `Float64Array` | ns. A double holds the counter exactly. |
| `parent`, `subtreeEnd` | `Int32Array` | children are `row+1 … subtreeEnd`, and the next sibling is `subtreeEnd` |
| `depth` | `Uint16Array` | flame charts read it directly |
| `lineNumber` | `Int32Array` | sentinels for `EXTERNAL` and `null` |
| `namespace` | `Uint16Array` | id into the string table |
| `flags` | `Uint8Array` | exit, truncated, discontinuity, … |
| rollups | `Float64Array` / `Int32Array` | totals only. *Self* derives from the row's own type for leaves, and from the duration subtraction for frames. Columns are dense for frames and absent for leaves, through a frame-row index. |

Exit lines stay rows, so `eventIndex` keeps today's meaning. They are flagged and skipped when
iterating children; a matched entry's exit row is `subtreeEnd - 1`.

**Strings.** Names that repeat (method signatures, class names, namespaces, object types) are
interned while scanning, keyed by a hash of their bytes, into one string table: 51k
`METHOD_ENTRY` lines hold a few thousand distinct signatures. Free text (`USER_DEBUG` messages,
SOQL, variable values) stays as a byte range and is decoded with `TextDecoder` on first read.
Lines are almost always ASCII, so they take a Latin-1 fast path.

**Size.** About 60–80 bytes per row plus the source bytes. That is ~150 MB in total for a 100 MB
log, against ~1.1 GB plus the pinned 100–200 MB string today. `retainSource: false` drops the
source for callers that only need the tree and the interned names.

### 4.3 Views: nodes, cursor, lists

- **`Node<K>`**, the ergonomic view. `log.node(i)` creates a tiny object (`store`, `row`) on
  first access and caches it in a sparse array, so `===` and `Map` keys keep working in UIs.
  Every node is an instance of **one** class, and every field getter lives on that one
  prototype. Each getter decodes through a table indexed by type id, so property access stays
  monomorphic. The per-event types exist only for TypeScript (see [Monomorphism](#8-monomorphism)).
  Only nodes a consumer touches ever exist.
- **`Cursor`** has no allocation: `firstChild()`, `nextSibling()`, `parent()`, `type`,
  `timestamp`, and so on. Rollups, exports and the variables index (#72) use it. It is iterative,
  so a deep log cannot overflow the stack (#34).
- **`EventList<K>`** is what `ofType` returns: an iterable, array-like view over a `Uint32Array`
  of rows, with `length`, `at`, `map`, `filter` and `toArray`. Per-type indexes are built in the
  scanning pass (#34).
- **`log.columns`** gives read-only typed arrays for consumers that render. A timeline or flame
  chart reads `timestamp`, `exitStamp`, `depth` and `type` straight into canvas or WebGL with no
  objects at all. This is the largest win available to the analyzer's UI.

### 4.4 One schema for runtime and types

One declarative table per event replaces 175 classes, `LogLineMapping` and the hand-maintained
`_logEventNames`. Part of it is generated from `data/salesforce-debug-log-events.json`; the rest
is hand-written overrides. It states the category, level, shape, exit, allowed children, named
fields with their decoders, and doc comments. Codegen emits:

- the runtime decoder table and type-id perfect hash,
- **a named, documented `interface` per event**, plus the `ApexEvent` union and `EventMap`. Named
  interfaces read better on hover than deep conditional types, keep `tsc` fast, and satisfy
  `isolatedDeclarations`. Doc comments per field close #71.

**Shapes and limited children.** Every event has one of three shapes:

- **leaf**: no `children` property at all. This covers most events.
- **scope**: any child (`METHOD_ENTRY`, `CODE_UNIT_STARTED`, …). An Apex method really can
  contain almost anything.
- **container**: a closed list (`SOQL_EXECUTE_BEGIN` → `SOQL_EXECUTE_EXPLAIN`,
  `CUMULATIVE_LIMIT_USAGE` → `LIMIT_USAGE_FOR_NS`, flow interview groups, …).

A child-type limit is only true if the parser enforces it, because logs truncate and lose exits.
When a row of a type a container does not allow appears inside it, the scanner closes the
container as unterminated (the existing `Unexpected-End` issue) and gives the row to the
container's parent. The container lists come from measurement: a script reports the
parent→child type pairs seen across the private corpus, and an event becomes a container only
when the corpus shows that list closed.

The sketch below typechecks under `strict` and `noUncheckedIndexedAccess`, including the three
`@ts-expect-error` lines. The real version would be generated named interfaces, not this
inference.

```ts
const events = {
  METHOD_ENTRY: { shape: 'scope', exit: 'METHOD_EXIT',
    fields: { lineNumber: lineNo(2), classId: str(3), signature: rest(4) } },
  SOQL_EXECUTE_BEGIN: { shape: 'container', exit: 'SOQL_EXECUTE_END',
    children: ['SOQL_EXECUTE_EXPLAIN'],
    fields: { lineNumber: lineNo(2), aggregations: int(3), query: rest(4) } },
  SOQL_EXECUTE_EXPLAIN: { shape: 'leaf', fields: { lineNumber: lineNo(2), plan: rest(3) } },
  DML_BEGIN: { shape: 'container', exit: 'DML_END', children: [],
    fields: { lineNumber: lineNo(2), operation: str(3), objectType: str(4), rows: int(5) } },
  USER_DEBUG: { shape: 'leaf', fields: { lineNumber: lineNo(2), level: str(3), message: rest(4) } },
  // …
} as const satisfies Record<string, Spec>;

type ChildTypeOf<K extends EventType> =
  Events[K]['shape'] extends 'leaf' ? never
  : Events[K] extends { readonly children: readonly (infer C)[] } ? C & EventType
  : EventType;

type ParentPart<K extends EventType> = [ChildTypeOf<K>] extends [never]
  ? { readonly hasChildren: false }
  : { readonly children: readonly NodeOf<ChildTypeOf<K>>[];
      childrenOfType<C extends ChildTypeOf<K>>(type: C): readonly NodeOf<C>[] };

export type Node<K extends EventType> = NodeBase<K> & FieldsOf<K> & ParentPart<K>;
type NodeOf<K extends EventType> = K extends EventType ? Node<K> : never; // a discriminated union

// What a consumer writes. No casts.
for (const q of log.ofType('SOQL_EXECUTE_BEGIN')) {
  q.query;                                  // string | null
  for (const c of q.children) c.plan;       // children can only be SOQL_EXECUTE_EXPLAIN
}
log.visit({ DML_BEGIN: (d) => d.rows, METHOD_ENTRY: (m) => m.signature });
for (const n of log.root.children) {
  switch (n.type) {
    case 'USER_DEBUG': n.message; break;    // narrowed by the discriminant
  }
  if (is(n, 'HEAP_ALLOCATE')) n.bytes;      // type guard
}
// @ts-expect-error a leaf has no children
log.ofType('USER_DEBUG')[0]!.children;
// @ts-expect-error DML_BEGIN does not hold METHOD_ENTRY
log.ofType('DML_BEGIN')[0]!.childrenOfType('METHOD_ENTRY');
// @ts-expect-error a field from another event
log.ofType('METHOD_ENTRY')[0]!.query;
```

The schema also fixes the classification (#35). A total `kind` (`frame`, `execution`,
`package-boundary`, `soql`, `sosl`, `dml`, …) is declared per event, and a missing one fails
codegen.

The "report what the log stated" rule maps directly onto decoders: a missing field decodes to
`null`, never to `''` or `0`.

## 5. API

```ts
// Sync: small logs, tests, scripts. Same engine.
parse(input: string | Uint8Array, options?): ApexLog;

// Time-sliced on the calling thread. Yields every `sliceMs` and reports progress.
parseAsync(input: string | Uint8Array | Blob | ReadableStream<Uint8Array>
                | AsyncIterable<Uint8Array | string>,
           options?: { signal?: AbortSignal; sliceMs?: number;
                       onProgress?(p: { bytes: number; totalBytes?: number; events: number }): void }
): Promise<ApexLog>;

// In a worker. Bytes go in by transfer and the store comes back by transfer; O(1) on the main thread.
parseInWorker(input, options?): Promise<ApexLog>;
createParserPool({ size?, workerUrl? }): ParserPool;   // reuse workers across logs

// Streaming with partial results: a UI can draw the top of the log before the end arrives.
const builder = createLogBuilder(options);
builder.push(chunk);  builder.snapshot();  builder.finish();

// Persist and restore, for MCP's cache: no reparse, and the memory is the buffers themselves.
log.toBuffers(): ArrayBuffer[];   ApexLog.fromBuffers(buffers): ApexLog;
```

Every name below autocompletes from `log.`:

```text
root  node(i)  cursor()  ofType(type)  visit(visitor)  at(timestamp)  find(predicate)  search(text)
columns  limits  issues  truncation  namespaces  entryPoints  userInfo  debugLevels  size
```

And from a node: `type`, its named fields, `children` (frames only), `parent`, `exit`,
`duration`, the counts (`soqlCount.total`, …, same names as today), `isTruncated`, `index`,
`text` (lazy) and `raw` (lazy).

**Search.** `search(text)` encodes the query once, runs `Uint8Array.indexOf` over the source, and
maps each hit offset to its row by binary search on `start`. That is a full-text search of a
100 MB log in tens of milliseconds, with no strings built.

## 6. Async, yielding and workers

- **The time slice.** Check `performance.now()` every 2,048 lines. When the slice has run out,
  yield with `scheduler.yield()` where it exists (Chrome/Edge 129+, Firefox 142+; [not
  Safari](https://caniuse.com/mdn-api_scheduler_yield)). Otherwise use a `MessageChannel` post in
  browsers, which avoids `setTimeout`'s 4 ms clamp, and `setImmediate` in Node. The scanner state
  is plain locals and typed arrays, so suspending costs nothing.
- **The worker** is the default for UIs. The input `Uint8Array` is transferred in, and the store's
  `ArrayBuffer`s are transferred back. Section 1 shows why this is only viable with columns: an
  object tree costs more to clone (3.0 s) than to parse.
- **Cancellation** with an `AbortSignal` at each slice, so opening a second log abandons the first.
- **Progress** is bytes scanned over the total size, which is honest because scanning is linear.

## 7. Web and Node builds

One core with no `node:*` imports, as today. Two thin platform layers:

```jsonc
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "node": "./dist/node/index.js",      // worker_threads, setImmediate, parseFile(path) over fs streams
    "browser": "./dist/browser/index.js",// Web Worker via new URL('./worker.js', import.meta.url), MessageChannel
    "default": "./dist/browser/index.js"
  },
  "./worker": { "node": "./dist/node/worker.js", "default": "./dist/browser/worker.js" }
}
```

`new URL('./worker.js', import.meta.url)` is the form Vite, webpack 5, esbuild and Rollup bundle
without configuration. VS Code webviews restrict worker origins, so `workerUrl` overrides the
location, and a `blob:` fallback inlines the worker. `sideEffects: false` stays: the sync
`parse` must not pull in the worker code.

## 7.1 WASM

Not now. The reasons:

- **The scan is no longer the cost.** The JS byte scanner already runs at ~1 GB/s. After the
  rewrite, field decoding, interning and rollups dominate, and much of that ends up as JS strings
  and objects that WASM cannot create more cheaply.
- **The boundary costs.** Bytes must be copied into linear memory (or streamed in), and every
  string a consumer reads crosses back.
- **The operational cost is real.** It needs a Rust or Zig toolchain in CI, async instantiation,
  more bundle size, and `wasm-unsafe-eval` in the CSP of VS Code webviews and other strict
  hosts.
- **Keep the door open.** The store's column layout is the ABI. Revisit only if the benchmark
  shows the scanner above about half the parse time after the rewrite.

## 8. Monomorphism

V8 caches each property access and each call site by the hidden class (map) it has seen. With one
map the cache is monomorphic and fast. With 2–4 maps it is polymorphic. With more than 4 it is
megamorphic, and every access falls back to a global lookup. Today every shared access site (for
example `parent.dmlCount.total` in `aggregateTotals`) sees up to 175 classes, which #109
identifies as the limit on its gains.

Measured: 1M nodes of 60 event types, reading `.lineNumber` at one site (Node 22, mean of 10 runs):

| Representation | Time |
| --- | ---: |
| One class per type, own fields (today) | 10.0 ms |
| Lazy view, one prototype per type | 19.6 ms |
| **Lazy view, one class for every node** | **4.6 ms** |
| Typed-array column `lineNo[i]` | 1.2 ms |

A prototype per type, the obvious way to generate typed views, is twice as slow as today. One
class is 2.2× faster than today, and a column read is 8×. So the design keeps the runtime
monomorphic at every layer, and puts all the per-type variety in TypeScript, which costs
nothing at runtime:

- **Scanner and store.** Typed arrays have a fixed element kind, so there are no maps to vary.
  `Float64Array` holds nanosecond times unboxed, which is the problem #107 works around today.
- **Per-type behaviour is data, not methods.** Today `onEnd?` and `onAfter?` are polymorphic
  method calls on 175 classes. They become a `switch` on the type id, or a lookup in a table of
  exit ids, counter columns and field slots, all indexed by type id.
- **One node class.** One prototype holds every field getter of every event, and each getter
  reads its slot from `FIELD_SLOT[type][field]`. Every receiver has the same map, so every
  inline cache stays monomorphic. TypeScript shows a node only the fields its `type` declares.
- **The same map for every node object.** The constructor sets every field, in the same order,
  and nothing adds a property later. The same rule holds for the side-table objects (issues,
  truncation regions, limit values).
- **Consumer callbacks.** `visit({ SOQL_EXECUTE_BEGIN: f, DML_BEGIN: g })` calls several
  functions from one site, which makes that call polymorphic. That is fine for a handful of
  types. For whole-log work, the cursor and the columns avoid calls entirely.
- **A check in CI.** A test runs the scanner under `--allow-natives-syntax` and asserts that
  `%GetOptimizationStatus` shows the hot functions optimised and never deoptimised on the bench
  logs. A change that makes a site polymorphic then fails a test, not just a benchmark.

## 9. Allocation rules for the hot path

- No `split`, no regex, and no `slice` per line. Regexes only on the header and on lines that
  already failed the fast checks.
- No object per event. Rows live in typed arrays that grow by doubling.
- No closures on the hot path, and no generator per line (today's `generateLogLines` +
  `LineIterator`). The loop is one function specialised per input kind.
- Numbers are parsed from char codes, never through `Number(substring)`.
- Interned names are numbers in columns. Free text is a byte range until read.
- One pass. Anything that needs "later" waits on a small pending list resolved by row id, as
  issue end times do.

## 10. Does it keep every feature?

**Every piece of information is kept.** The `compat` digest gate in [How this lands](#12-how-this-lands) is what proves it. The
API shape changes in the ways listed after the table.

| Feature today | In the rewrite |
| --- | --- |
| Tree, `parent`, `children`, `eventIndex`, `eventsById` | Prefix-order rows. `node(i)` replaces `eventsById[i]`, and exit lines stay rows. |
| `timestamp`, `exitStamp`, `duration.self`/`total` | Columns. Self time is subtracted when each child closes. |
| SOQL/DML/SOSL counts and rows, `thrownCount` | Rollup columns |
| `heapAllocated`, `heapGross`, `heapPeak` | Rollup columns. The running heap is kept during the scan, in log order, as today. |
| Governor limits, snapshots, granular `limitUsage` | Parsed eagerly when the block's last line arrives. It is a rare, cold path. |
| Flow DB residuals, managed package merge | Applied when the frame closes, not as a post-pass |
| `namespace` | **Must stay eager.** `_parseMethodNamespace` reads the namespaces *seen so far*, so a lazy decode would see the final set and answer differently. It is an interned id column, decided during the scan. |
| `text`, `logLine`, per-class text rules (VF, named credentials, …) | Lazy decoders, one per event, with the same output. Wrapped lines are joined with `\n` and `\r` is stripped, as today. |
| `category`, `debugCategory`, `debugLevel`, `exitTypes`, `suffix`, `hasValidSymbols` | Constants per type in the schema, costing nothing per row |
| Per-row overrides (`cpuType: 'loading'` for `Type.forName`, `codeUnitType`, a VF call with its exits cleared) | Decided during the scan into a flags column, because they change matching or rollups |
| `logIssues`, `parsingErrors`, `truncation`, `truncatedEvents`, `isTruncated` | Side tables, filled in the same pass |
| `debugLevels`, `debugLevelSettings`, `userInfo`, `entryPoints`, `startTime`, `executionEndTime`, `exceptions`, `namespaces` | Unchanged. They come from the header or from the indexes. |
| `size` (UTF-8 bytes) | Free for byte input (`byteLength`). A string input keeps `utf8ByteLength`. |

**What changes for consumers:**

- **Mutation.** #108 rejected frozen objects because "the API must stay mutable". Views can keep
  setters for the scalar fields, which write to the columns or to an overlay for strings. But
  `children` is no longer an array a consumer can push to or splice. Before committing, we need
  to know exactly what the analyzer and MCP mutate today. Adding new properties to a node object
  would still work, because node objects are cached, but it costs monomorphism.
- **`instanceof` event classes** become `node.type` and `is(node, type)`.
- **`ApexLogParser` subclassing and custom event constructors** go away. Extending the parser
  would mean extending the schema.
- **`JSON.stringify` on the tree** never worked anyway, because of `parent` cycles. `toJSON()` and
  `toBuffers()` replace it.

The `compat` adapter rebuilds today's classes for any code that needs the old shape, at today's
cost, but only for that code.

## 11. Other changes with a large impact

These go beyond the scanner and the store, roughly in order of impact per unit of work:

1. **Do not parse twice.** `toBuffers()` / `fromBuffers()` turns reopening a log into ~0 ms.
   MCP caches to disk instead of holding one slot in memory for five minutes, and the analyzer
   caches in IndexedDB keyed by a content hash. For repeat opens, this beats any parser
   speed-up.
2. **Draw while parsing.** The store is append-only and in prefix order, so every closed subtree
   is final the moment it closes. `createLogBuilder().snapshot()` lets the timeline draw the start
   of a log while the rest streams in. Time to first paint becomes the first chunk, not the
   whole file.
3. **A render index for the flame chart.** The analyzer draws every frame today. A lazily built
   index, with rows grouped by depth and sorted by start time, lets the chart binary-search the
   visible time range at each depth. Rendering then costs O(visible frames), not O(all frames),
   which matters on every pan and zoom, not just once. Building it costs about one pass over the
   columns.
4. **A parallel first stage in workers**, like simdjson. Splitting the bytes at newlines and
   finding each line's type id, timestamp and fields is independent per chunk. Only the stack
   matching is sequential, and it is cheap. With 4 workers, 100 MB should drop from ~0.5 s
   towards ~0.2 s. It needs `SharedArrayBuffer` (cross-origin isolation in browsers, which VS
   Code webviews may not grant) or one transfer per chunk. It is an optional later phase, worth
   it only for logs of 50 MB or more.
5. **Size the arrays once.** Allocating from `byteLength / 90` removed about 10% of the scan
   time in the profile, against doubling.
6. **Cancel stale work.** An `AbortSignal` per parse, so switching logs in the UI never waits
   for the previous one.
7. **Never decode what is never shown.** The UI draws labels only for frames wide enough to
   show text, and only those labels are decoded. The columns make that the default rather than
   an optimisation.

## 12. How this lands

The rule from #37 holds: no step merges without a before-and-after number from the harness in
#106. Correctness is held to the private 440-log corpus digest that #107 and #109 already use.

0. **Merge #106, #107 and #109 now.** They help today's consumers, and the rewrite takes longer.
1. **Schema and codegen.** Generate the type-id table, field decoders and named interfaces from
   the data JSON plus overrides. Run the corpus parent→child report to settle the container lists.
2. **Scanner and store, sync, behind a separate entry point.** Add a `compat` adapter that builds
   today's `LogEvent` tree from the store. It must give the same corpus digest as `main`, which
   makes the rewrite provably the same information. Target at 100 MB: ≤ 400 ms, ≤ 150 MB
   including the source.
3. **Views:** nodes, cursor, `ofType`, `visit`, `at`, `search`, `columns`. Closes #34 and #71.
4. **`parseAsync`, streams, progress and cancellation**, with a slice target of ≤ 10 ms per
   yield.
5. **Workers and the two builds**, then `toBuffers`/`fromBuffers` for MCP.
6. **Migrate the analyzer and MCP.** Release 1.0. Keep `compat` for one major, so the analyzer can
   move one view at a time; `compat` costs today's memory, but only for code that still uses it.

## 13. Risks

- **Exactness of the matching rules.** `parseTree`/`endMethod`, discontinuities, max-size
  truncation, package merge and flow residuals are subtle and tested mainly through real logs.
  The `compat` digest gate is the mitigation; without the corpus I would not attempt this.
- **Container lists that are too strict** would reparent real children. Mitigation: derive them
  from the corpus, and start with few containers.
- **A larger API change for consumers.** No classes, so `instanceof` goes away, and a node is a
  view. Mitigation: the same field names where they exist today, `is()` guards, and the `compat`
  adapter.
- **Keeping the source alive.** Lazy fields need the bytes. `retainSource: false` and
  `toBuffers` let a host choose its trade-off explicitly, rather than through accidental
  sliced-string retention as today.

## How this covers the open issues

| Issue | How the design answers it |
| --- | --- |
| #37 perf and memory | The whole proposal, benchmark-gated |
| #108 heap and GC | No per-event objects, so GC all but disappears from the parse |
| #34 per-kind indexes and visitor | `ofType`, `visit` and `Cursor`, built in the scanning pass |
| #35 classification | A total `kind` in the schema, enforced by codegen |
| #71 named, documented fields | Schema fields, generated documented interfaces |
| #72 variables in scope | A lazy index built with the cursor over the columns, which yields between slices |

## Appendix: prototype core loop

This is the byte-input loop from the measurements, trimmed. It is a floor: it omits text fields,
namespaces, issues, limits and package merging, and its exit matching is simplified.

```js
while (pos < len) {
  let eol = src.indexOf(10, pos); if (eol < 0) eol = len;
  if (src[pos + 2] === 58 && src[pos + 5] === 58) {          // HH:MM:SS.f (N)|TYPE|
    let i = pos + 8; while (src[i] !== 40) i++; i++;
    let t = 0, c; while ((c = src[i]) !== 41) { t = t * 10 + (c - 48); i++; }
    i += 2;
    let h = 0; while (i < eol && (c = src[i]) !== 124 && c !== 13) { h = (Math.imul(h, 31) + c) | 0; i++; }
    const id = lookupTypeId(h);                                // perfect hash, no substring
    if (isExit[id]) {
      let m = sp - 1; while (m >= 0 && exitOf[type[stack[m]]] !== id) m--;
      while (m >= 0 && sp > m) {                               // close, and roll up into the parent
        const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot;
        subtreeEnd[e] = n; const p = parent[e];
        if (p >= 0) { soql[p] += soql[e]; dml[p] += dml[e]; heap[p] += heap[e]; selfDur[p] -= tot; }
      }
    } else {
      const e = n++;                                           // typed-array columns, grown by doubling
      start[e] = pos; type[e] = id; ts[e] = t; parent[e] = sp ? stack[sp - 1] : -1;
      if (exitOf[id] >= 0) stack[sp++] = e;
      else if (sp) { /* add the leaf's own counts to the open frame */ }
    }
  }
  pos = eol + 1;
}
```
