# Agent brief: rewrite `@apexdevtools/apex-log-parser` for speed, memory and types

This file is self-contained. It gives you the context, the measurements, the design, the
feature-parity checklist, the build plan, and every script needed to reproduce the
measurements. You can work from this file and a checkout of the repo alone.

- **Repo:** `apex-dev-tools/apex-log-parser`. At the time of writing, `main` was `77416e7`
  (version 0.2.0).
- **Research branch:** `claude/parser-perf-rewrite-research-lwnhlz`. It holds
  `docs/parser-rewrite-proposal.md`, a narrative version of the design below.
- **Written:** 2026-10-04, from a cloud session that read the code, prototyped and measured.

---

## 0. How to use this brief

**Your job, in two parts:**

1. **Investigate again.** Reproduce the numbers in §3 with the scripts in the appendix.
   Re-check the facts in §2 and §6 against the current `main`, which may have moved: check
   PRs #106, #107 and #109 in particular. Then run the prototypes on the maintainers' private
   corpus if you have access.
2. **Build.** Follow the phases in §8. Each phase has an acceptance gate. Do not start a phase
   until the previous gate passes.

**Before you write code, read these in the repo:**

- `AGENTS.md`, which `CLAUDE.md` includes. It holds the project conventions:
  - strict TypeScript, `isolatedDeclarations`, `erasableSyntaxOnly` (no enums), `.js` import
    extensions;
  - `noUncheckedIndexedAccess`;
  - no `node:*` in `src/`;
  - "report what the log stated" (`null`, never a default);
  - units on every field;
  - conventional commits, one concern each;
  - changesets for any change a consumer can see;
  - never paste a log from an org: fixtures use `ns`, `MyClass`, `user@example.com` and ids like
    `005000000000AAA`.
- `src/ApexLogParser.ts`, `src/LogEvents.ts`, `src/LogLineMapping.ts`, `src/types.ts` and
  `src/limits.ts`.
- `src/__tests__/`. These tests define today's behaviour, and the rewrite must pass their
  intent.

**Ground rules. Ask the user before breaking any of them.**

- Issue #37's rule: **no change merges without a before-and-after number** from the benchmark
  harness (PR #106).
- **Correctness gate:** a digest of the parsed tree must match `main`, through the `compat`
  adapter (§5.9), on every log of the maintainers' private corpus. #107 and #109 already used
  440 logs this way. Without corpus access, use the repo's tests plus the synthetic generator,
  and say plainly that the corpus gate has not run.
- **Run `pnpm run ci` before every commit.** Never `pnpm ci`, which is a clean install.
- **Decisions marked OPEN in §7 belong to the user.** Ask; do not guess.

### 0.1 Is this the right approach? Verdict and go/no-go

**Verdict: yes, the direction is right, but commit to it only after one decisive spike.**

**Why it is right:**

- The cost is structural: an allocation per event and per field. #107 and #109 show that tuning
  the object model reaches ~28%.
- The measured gains are an order of magnitude. At the 20 MB Salesforce log cap, today takes
  833 ms and 259 MB to a timeline, against ~55–100 ms and ~12–19 MB.
- It is the only design in which a worker is viable: an object tree costs more to clone than to
  parse.
- It answers #34, #35, #71 and #72, and the cast-free typing goal, rather than adding to them.

**What would make it wrong. Check each before committing:**

1. **Real logs behave differently.** The synthetic logs hold ~31 distinct names, and real logs
   hold thousands. Interning, long `USER_DEBUG` lines and non-ASCII text are untested.
2. **The full rules cost more than v3.** Line-number matching, discontinuity, max size, package
   merge, flow residuals, issues, limits and text decoders are all missing from the prototype.
3. **Parity cannot be proven.** Without the private corpus and its digest, the subtle tree rules
   cannot be shown equal.
4. **Consumer migration costs more than the rewrite.** The analyzer is large, and mutation
   (OPEN 1) could block lazy views.
5. **Parse is not what users wait for.** Profile an analyzer open from end to end. If rendering
   or the call tree dominates, the parser win shrinks in practice.
6. **Maintainability.** A byte scanner, a state machine, codegen and typed arrays are harder to
   contribute to than classes. The schema, tests and the digest gate must carry that.

**The decisive spike, so do this first** (Phase 2 alone, roughly 1–2 weeks): build the real
sync scanner, the store and `toLegacyTree`, with the full rules but no views, async or workers.

**Go only if all of these hold:**

- the corpus digest is identical to `main` on every log;
- on real corpus logs of 20 MB or less, at least **5× faster** and at most **⅕ of the
  memory**, median and p95;
- a timeline built from the columns costs < 10% of parse time;
- `src/` lines and test coverage are comparable to today, and a second maintainer can follow the
  scanner;
- an analyzer profile shows parse plus tree building is at least half of the time to open a log.

**If it is a no-go,** keep the benchmark harness and the corpus digest, ship #107 and #109, and
take the smaller wins that need no columnar store:

- remove `split` from the hot path;
- fold exits (they are already dropped from the tree);
- type-level metadata;
- sparse counters;
- `parseAsync` with yielding.

**Ways to reduce the risk inside the plan:**

- **Ship the new core under today's API first, through `compat`.** Consumers get the parse win
  with no migration. Only the analyzer's timeline needs to move to the columns early, because
  that is where the extra UI win is.
- **Start with leaf vs frame typing only.** That is the biggest typing win, and it changes no tree
  semantics. Add enforced containers later, and only where the corpus shows them closed.
- **Defer** the parallel first stage, Arrow layout and exporters, projection, the storeless
  visitor, append parsing and WASM until after 1.0.

---

## 1. Context

**What the package does.** It turns raw Salesforce Apex debug log text into a typed event tree,
with execution timings, self and total durations, SOQL/DML/SOSL counts and rows, heap metrics,
governor limits and log issues. It has zero runtime dependencies, ships as ESM only, and runs
in Node ≥ 20 and in browsers.

**Consumers and their pain:**

- **The analyzer** ([certinia/debug-log-analyzer](https://github.com/certinia/debug-log-analyzer))
  parses on the main thread of a VS Code webview, so a large log freezes the UI. It draws a
  timeline (flame chart), call tree, database views and so on, and it has three hand-written
  tree walks (`Database.ts`).
- **The MCP server** reads the whole file into a string, then parses it. It holds a one-slot
  cache with a five-minute idle eviction because a reparse is so slow. Its own comments put the
  memory cost at "four to five times the size of the file … a 200 MB log holds about a
  gigabyte". It keeps its own tables (`KIND_BY_TYPE`, `FRAME_TYPES`) to work around the
  parser's classification, plus its own `walkLog`.

**Open issues this work answers:**

| Issue | Ask |
| --- | --- |
| #37 | Improve parse performance and memory, benchmark-led. Candidates: single pass, fewer allocations, `parseAsync`, a streaming source, a columnar spike. |
| #108 | Cut heap and GC with no API change. #107 implements it. Its notes say "the API must stay mutable", and that async, lazy and streaming work was left for the larger refactor. |
| #34 | Typed per-kind indexes (`soqlEvents`, `dmlEvents`, …, `eventsByType`) and a public iterative visitor. |
| #35 | A total classification: split SOSL from SOQL, and separate execution and package frames from methods. |
| #71 | Name every event's fields, and give every event class a doc comment. |
| #72 | Answer "what variables were in scope at this frame", built as a lazy index that yields between slices. |

**Open PRs at the time of writing.** Re-check them; they may have merged.

- **#106 `ci/benchmarks`:** a CodSpeed CI benchmark. It adds `src/__bench__/fixtures.ts`, a seeded
  synthetic log generator whose `profiles.json` holds only numbers measured from real logs, plus
  `pnpm run bench:large`.
- **#107 `perf/parse-heap`:** −27% heap and ~13% faster. It gives `duration` its own V8 map so
  the counters stay small integers, stores zero durations unboxed, and shares one string per
  type name.
- **#109 `perf/single-pass-totals`:** stacked on #107. Totals come from one backward pass over
  `eventsById`, replacing `flattenByDepth`. ~5% more. It notes that real monomorphism needs one
  event class, which is an API break, and leaves that to #37.

**Recommendation:** merge #106, #107 and #109 first. They help consumers now, and the rewrite
takes longer.

---

## 2. How today's parser works, and where it spends

**Pipeline** (`ApexLogParser.parseLog`):

1. Regex-match the first timestamped line. Everything before it is the header.
2. `generateLogLines`, a generator over the string:
   - find each line end with `indexOf('\n')`, handling CRLF;
   - `slice` the line, and test it for a second log (`opensNextLog`);
   - `parseLine`: `split('|')`, then look up the class for `parts[1]` through
     `getLogEventClass` (a switch fast path, then `lineTypeMap`), then construct it;
   - a line that is not an event is either wrapped text appended to the previous event's
     `text` (when `acceptsText`), a `*** Skipped` or `MAXIMUM DEBUG LOG SIZE` issue, a settings
     line, or a parsing error;
   - `afterParse` calls the previous event's `onAfter(parser, next)`, and records namespaces.
3. `toLogTree`: a `LineIterator` with peek and fetch, and a recursive `parseTree` that matches
   entries to exits:
   - `exitTypes`, `isExit`, `nextLineIsExit`;
   - `isMatchingEnd` compares the type and the line number;
   - `endMethod` unwinds through `discontinuity` (exceptions) and matches further down the stack;
   - a frame is truncated after `maxSizeTimestamp`;
   - `EXECUTION_STARTED` always starts at the top level;
   - it adds the `Unexpected-End` and `Unexpected-Exit` issues;
   - it calls `onEnd(exitLine, stack)`.
4. Post-passes: `setTimes`, `mergeManagedPackageEvents`, `aggregateTotals` (with
   `flattenByDepth`), then `applyFlowDbResiduals`.
5. Then `deriveGovernorLimits`, `resolveIssueEndTimes`, `buildTruncation`, debug settings,
   `USER_INFO` and `findEntryPoints`.

**Facts that matter for a rewrite:**

- `eventIndex` is the stable id: the position in `eventsById`. **Every constructed event gets
  one, including exit lines**, and **the root `ApexLog` is index 0**, because it is constructed
  before the generator starts.
- **175 event classes** extend `LogEvent` or `DurationLogEvent`. Per-type behaviour sits in
  constructors and in `onEnd` and `onAfter`.
- **Namespace inference depends on order.** `MethodEntryLine._parseMethodNamespace` and
  `ConstructorEntryLine._parseConstructorNamespace` read `parser.namespaces`, which holds the
  namespaces *seen so far*. Computing it lazily, at the end, would give different answers.
- **Events write into the parser while it runs:** `codeUnits`, `governorSnapshots`,
  `flowDbElements` and `exceptions`. Heap events call `trackHeapAllocation`, a running total kept
  in log order and clamped at 0.
- **Issues are deduped** by `type:summary`, except `Skipped-Lines`, and kept **sorted by
  `startTime`** (`addLogIssue` sorts on every insert).

**Where the cost goes** (about 1.27 KB retained per event on a 100 MB log):

- **13+ objects per event.** The instance, 11 `SelfTotal` objects, `children` and `exitTypes`.
  Most events are leaves and use none of them.
- **The `parts` array** from `split('|')`, plus a string per field, on every line.
- **`logLine` and `text`** are V8 sliced strings. They pin the whole source string for as long as
  the tree lives.
- **Megamorphic access sites** across 175 classes. The measurement is in §3.3.
- **Several passes** over the tree.
- **Boxed doubles** for nanosecond values that share a hidden class with small counters, which
  #107 fixes.
- **Synchronous, on the caller's thread, from one big string.**

---

## 3. Measurements

**Setup.** Synthetic logs from #106's generator (`largeLogs['developer 20 MB']` and
`largeLogs['large 100 MB']`). Node 22.22, Linux container, `--expose-gc`, median of 3–5 runs after
two warm-ups. Runs varied by about ±15%. "Kept" is the heap plus array buffers after a GC; it
is noisy for scenarios that return a number. Reproduce with §A.

The synthetic logs hold only ~31 distinct method names. Real logs hold thousands, so interning
and label decoding will cost more on them. **The private corpus is the real test.**

**The prototypes:**

- **v1 (floor).** A byte scan, entry/exit matching with a stack, 3 counters rolled up into
  typed-array columns. No text, no wrapped lines, and exits are not rows.
- **v2 (fuller).** Every line is a row, so `eventIndex` is kept, except that row 0 is not the
  root as it is today. It adds:
  - the real `exitTypes`, `isExit`, `nextLineIsExit` and `acceptsText` per type, from today's
    classes (`type-table.json`);
  - wrapped lines, which extend the previous row;
  - labels and namespaces interned by a hash of their bytes;
  - 8 counters, heap net and peak, and self duration;
  - per-type row indexes;
  - arrays sized once from the byte length.

  It omits issues, limits, truncation, package merge, flow residuals, the per-event text rules,
  the line-number check in exit matching, discontinuity unwinding and max-size truncation. It
  is not tuned: a CPU profile showed ~22% of its time in closures (`intern`, `close`).

### 3.1 Final run

| 100 MB log (868,903 rows) | Time | Kept |
| --- | ---: | ---: |
| **Today** `parse(string)` | **2,738 ms** | **1,100 MB** |
| Today: parse, then walk every node (rect + label) | 2,999 ms | |
| Today: read the file as UTF-8, then parse (the MCP path) | 3,477 ms | |
| Floor: `indexOf('\n')` scan of the string | 25 ms | |
| Floor: `slice` + `split('\|')` of every line | 185 ms | |
| `TextDecoder.decode` of the whole file | 71 ms | |
| **v1** scan(bytes) | **123 ms** | 28 MB |
| **v2** scan(bytes) | **373 ms** | ~68 MB |
| v2, then the root's total duration | 396 ms | |
| v2, then a flame chart from the columns (rects) | 386 ms | |
| v2, then a flame chart from the columns with every label | 418 ms | |
| v2, then a node object for every row, walked by `children`, with label | 578 ms | |
| v2, then the raw text of every row (worst-case decode) | 707 ms | |
| v2: read the file as bytes, then scan (the MCP path) | 531 ms | |
| **v2 in a worker**: transfer in, scan, transfer out | **485 ms**, worst main-thread gap **3.7 ms** | |
| `structuredClone` of a plain object per row | 4,989 ms | |

| 20 MB log (206,573 rows) | Time | Kept |
| --- | ---: | ---: |
| Today `parse(string)` | 768 ms | 259 MB |
| Today: parse, then walk every node | 786 ms | |
| Today: the MCP path | 873 ms | |
| v1 scan | 38 ms | 14 MB |
| v2 scan | 68 ms | 24 MB |
| v2, then a flame chart with every label | 85 ms | |
| v2, then an object for every row | 126 ms | |
| v2: the MCP path | 119 ms | |
| v2 in a worker | 84 ms, worst gap 1.8 ms | |

Earlier runs in the same session gave today 2,926–3,243 ms and v2 454–528 ms at 100 MB, so take
the ranges, not the single figures.

### 3.2 What the numbers mean

- **Today's cost is allocation, not scanning.** Splitting every line costs 185 ms, and the parse
  costs 15× that.
- **Bytes beat strings.** The same v1 loop ran about 1.5× faster on a `Uint8Array` than on a
  string with `charCodeAt`, and it skips the decode (71–207 ms at 100 MB). A string with one
  non-Latin-1 character also doubles in size, because V8 stores the whole string two-byte.
- **The structure is built eagerly; objects and strings are lazy.** The root's total, a whole
  flame chart and `ofType` cost nothing after the scan, because rollups and indexes happen
  during it.
- **Draw the timeline from the columns.** From columns it adds ~0–30 ms at 100 MB; from node
  objects it adds ~200 ms.
- **A worker only works with columns.** Cloning an object tree costs more than parsing it. A
  columnar store transfers at no cost, and the UI is never blocked for more than ~4 ms.
- **Expected for the full parser**, with the v3 output shape from §3.4 plus the omitted rules,
  at 100 MB: about **250–400 ms** to a drawn timeline, against ~3 s today, so **8–11× faster**.
  Memory should be **~40–50 MB of columns** plus the source bytes, against 1,100 MB plus the
  pinned string: **~20× less for the tree, ~7–8× including the source**. In worker mode the main
  thread is never blocked for more than a few milliseconds.

### 3.3 Monomorphism

Reading `.lineNumber` from 1M nodes of 60 types at one access site (`monomorphism.mjs`). Two runs:

| Representation | Run 1 | Run 2 |
| --- | ---: | ---: |
| One class per type, own fields (today) | 10.0 ms | 7.6 ms |
| Lazy view, **one prototype per type** | 19.6 ms | 15.2 ms |
| **Lazy view, one class for every node** | **4.6 ms** | **2.1 ms** |
| Typed-array column | 1.2 ms | 1.1 ms |

**The trap:** generating a prototype per event type, the obvious way to build typed views, is 2×
*slower* than today. Use one runtime class, and keep per-type variety in TypeScript only.

### 3.4 Output shape: v3

The rewrite may change the output's shape, so the shape was measured too (`shape.mjs`):

| | 20 MB | 100 MB |
| --- | ---: | ---: |
| Exit lines, as a share of rows | 30.0% | 41.3% |
| Frames (rows with children or a duration) | 30.1% | 41.3% |
| Leaves | 39.9% | 17.5% |
| Frames with **any** non-zero SOQL/DML/SOSL/thrown count | 3.1% | 0.6% |
| Frames with a non-zero heap figure | 38.9% | 26.7% |
| Deepest nesting | 25 | 37 |

The top leaves are `STATEMENT_EXECUTE`, `HEAP_ALLOCATE`, `VARIABLE_ASSIGNMENT` and
`VARIABLE_SCOPE_BEGIN`.

**Prototype v3** (`scan-v3.mjs`) is v2 with the output shape that table suggests:

- **Exit lines fold into their entry row**, and an exit gets no row of its own. The prototype
  still stores the exit's byte offset (`exitStart`); the design drops it (§5.2), which saves
  another ~2 MB at 100 MB.
- **Counters are sparse.** A frame gets a slot in a shared pool only when its subtree has a
  non-zero count.
- **Optional per-method stats are computed during the scan:** calls, self time, and total time
  with recursion counted once, keyed by the interned label.
- **An optional projection** (`leaves: false`) gives leaves no row; their counts and heap still
  roll into the open frame.

v3bench.mjs, 7 runs, medians:

| | 20 MB time | 20 MB columns | 100 MB time | 100 MB columns | rows at 100 MB |
| --- | ---: | ---: | ---: | ---: | ---: |
| v2: every line a row | 66–71 ms | 21.5 MB | 385–433 ms | 90.4 MB | 868,903 |
| **v3: exits folded, sparse counts** | **46–49 ms** | **11.7 MB** | **240–242 ms** | **41.0 MB** | 510,460 |
| v3 with method stats | 50 ms | | 253–257 ms | | |
| v3 frames only (projection) | 44–45 ms | 5.1 MB | 248–251 ms | 28.9 MB | 358,458 |
| A streaming visitor with no store (`shape2.mjs`), finding SOQL lines | | | 104 ms | 0 | |

**Checks:** root durations are identical between v2 and v3, and root heap is identical between v2
and frames-only. At 100 MB only 2,256 count slots were needed, for 358k frames.

**What this means:**

- **Folding exits and storing counts sparsely is the biggest single shape win**: 1.6–1.8× faster
  and 2.2× smaller than v2. Against today at 100 MB that is ~11× faster and ~27× smaller for the
  tree.
- **Per-method stats cost ~5%.** They replace a full tree walk in every consumer that shows
  "top methods", which is the analyzer's analysis view and MCP's summaries.
- **Projection saves memory, not time:** 41 → 29 MB. Leaves are cheap to scan, and what they
  cost is rows.
- **A storeless visitor** is only ~2.4× faster than a full v3 scan. Offer it for memory-bound
  one-shot queries, not as the main path.

### 3.5 Parse to timeline: tree vs arrays

`timeline.ts` measures what a timeline needs: one rect per frame (start, duration, depth, label),
grouped by depth and in time order. Two runs; the ranges show the run-to-run spread.

| 100 MB log | Time | Extra over the parse | Memory added |
| --- | ---: | ---: | ---: |
| **Today** parse | 2,943–3,144 ms | | 1,100 MB |
| Today: parse, then a timeline from the tree (rect objects) | 3,190–3,388 ms | **+244–247 ms** | +35 MB |
| **v3** scan | 279–341 ms | | ~50 MB |
| v3: scan, then a timeline from node objects (rect objects) | 386–389 ms | +45–110 ms | +7 to +95 MB |
| **v3: scan, then a timeline from the columns** (per-depth `Uint32Array`s of row ids) | 272–286 ms | **~0, within noise** | ~1.4 MB |
| One redraw of a 1% window: test every rect object (today's style) | 6.2–7 ms | | |
| **One redraw of a 1% window: binary search on the columns** | **0.09 ms** | | |

At 20 MB: today 745–856 ms to parse and 833–873 ms to a timeline. v3 is 55–62 ms to a timeline
from the columns, and 73–98 ms from node objects. A redraw is 1.06 ms against 0.05 ms.

**What this means:**

- **Before and after, to a drawn timeline at 100 MB:** ~3.2–3.4 s today against ~0.27–0.29 s
  from the columns, so **~11–12× faster**. The parse alone goes from ~2.9–3.1 s to ~0.28–0.34 s.
- **Building the timeline from the tree costs ~245 ms today.** From the columns it costs about
  nothing: rows are already in time order, so building per-depth row arrays is one counting pass.
  Node objects sit in between.
- **Every pan and zoom gets ~70× cheaper.** Each redraw of a 1% window drops from ~6 ms to
  ~0.1 ms, because a per-depth binary search finds the visible frames instead of testing every
  rect. A frame at 60 fps has 16.7 ms, and today's redraw already takes a third of it before
  drawing anything.
---

## 4. Prior art, and what to take from each

| Project | Technique | Take |
| --- | --- | --- |
| **oxc** (Rust → JS) | Raw transfer: the AST sits in one buffer and is deserialised lazily in JS, so only the nodes a visitor touches become objects. ~3× faster than eager deserialisation, and transfer cost near zero. [oxc.rs/blog/2025-10-09-oxlint-js-plugins](https://oxc.rs/blog/2025-10-09-oxlint-js-plugins.html) | A buffer is the truth; objects are an on-demand view. |
| **Lezer** (CodeMirror) | `TreeBuffer`: `(type, start, end, endIndex)` in a typed array, prefix order, with the parent's end bounding its children. `SyntaxNode` objects on demand, and a `TreeCursor` that allocates nothing. [lezer.codemirror.net/docs/ref](https://lezer.codemirror.net/docs/ref/) | Prefix-order rows with a subtree end. Nodes plus a cursor. |
| **simdjson** | Stage 1 finds structural characters in bulk; stage 2 builds a flat tape of fixed-width records, with strings as offsets. | `indexOf` (memchr) for `\n` and `\|`. Fixed-width rows. A parallel first stage. |
| **uDSV** | The fastest JS CSV parser: specialised loops, no per-field allocation, chunked input. [github.com/leeoniya/uDSV](https://github.com/leeoniya/uDSV) | One loop specialised per input kind. Chunks. |
| **acorn, meriyah, esbuild** | Hand-written char-code scanners, with no regex or `split` on the hot path. | Char-code dispatch. Regexes only on cold paths. |
| **tree-sitter (WASM)** | A cursor over a native tree. | WASM pays only when the scanner dominates. |

Other facts used:

- **V8 sliced strings** retain their parent string
  ([v8 issue 2869](https://groups.google.com/g/v8-reviews/c/93uSOHcIZW8)).
- **`scheduler.yield()`** ships in Chrome and Edge 129+ and Firefox 142+, but **not Safari**
  ([caniuse](https://caniuse.com/mdn-api_scheduler_yield)), so it needs a fallback.

---

## 5. Design

### 5.1 How the parse works

1. **Input.** `Uint8Array`, `Blob`, `ReadableStream<Uint8Array>`, `AsyncIterable`, a Node file
   path, or a `string`. A string goes through a loop specialised for `charCodeAt`. Bytes are the
   primary path.
2. **Scan, one pass, one specialised function, no allocation per line.** For each line:
   - find the line end with `indexOf(10)`, and strip a trailing `\r`;
   - check `HH:MM:SS.f (` by char codes, and read the nanosecond counter digit by digit;
   - hash the event name's bytes into a perfect-hash table of type ids, with no substring;
   - read the `[123]` or `[EXTERNAL]` line number;
   - handle a line that is not timestamped: wrapped text (extend the previous row's end, only
     when its type `acceptsText` and the line is not a truncation marker), a truncation marker
     (`*`), a skipped-bytes line, a second log's settings line (the `opensNextLog` rules), or a
     parsing error. Same tests, same order as today.
3. **Tree building in the same pass.** An `Int32Array` stack, with the exact `parseTree` and
   `endMethod` rules written once as an iterative state machine:
   - matching on type plus line number;
   - discontinuity unwinding;
   - matching further down the stack;
   - `nextLineIsExit`;
   - truncation after max size;
   - `EXECUTION_STARTED` resetting to the top level;
   - the `Unexpected-End` and `Unexpected-Exit` issues.
4. **Work done when a frame closes**, which replaces every post-pass:
   - set `exitStamp` and `subtreeEnd`;
   - add the frame's totals to its parent's, subtract its total duration from the parent's self
     duration, and take the max of `heapPeak`;
   - run the `onEnd` equivalents (namespace from the exit, rows from the exit, …);
   - merge consecutive managed packages;
   - apply flow DB residuals;
   - resolve issue end times from a small pending list as qualifying rows arrive.
5. **Work done eagerly when a row is created:**
   - the namespace (order-dependent, see §2);
   - per-row overrides that change matching or rollups, into a flags column:
     `cpuType: 'loading'` for `System.Type.forName(`, `codeUnitType`, and a VF call whose
     `exitTypes` are cleared;
   - the heap running total;
   - the per-type index;
   - `onAfter` equivalents, such as parsing a limits block once its last line has arrived.
6. **Return.** The whole structure, every rollup and every index are complete. Nothing is
   deferred except objects and strings.

### 5.2 Event store (struct of arrays)

One row per log line **except matched pure exits**, plus row 0 for the root (the v3 shape,
§3.4). Today an exit already becomes an object only to be matched, passed to `onEnd` and dropped
from the tree, so folding it loses nothing. The maintainer confirmed this.

**Folding rules,** verified against `src/` on 2026-10-04:

- **A matched pure exit leaves nothing behind.** A pure exit has `isExit` and no `exitTypes`; it
  gets no row and nothing about it is stored. The maintainer confirmed that exits are not needed
  beyond this, and `src/` agrees: today's parser reads only these from an exit line, and the
  scanner reads them in place while scanning:
  - its **type id, timestamp and line number**, for matching (`isMatchingEnd`) and the entry's
    `exitStamp`;
  - **`Rows:` on `SOQL_EXECUTE_END` and `SOSL_EXECUTE_END`**, which becomes the entry's row count
    (`onEnd`);
  - **the namespace on `METHOD_EXIT`**, only when its text does not end with `)` (a class
    reference). It is written to the entry (`onEnd`) and to the namespace set (`afterParse`).

  Every other exit field is never read today: its text, its other fields, its own
  category/level. The `FLOW_START_INTERVIEWS_BEGIN` `onEnd` reads the stack, not the exit.
- **Exit details become fields on the entry** (§5.2.1). The exit row goes away, but the useful
  part of it survives as typed detail on the entry, declared per type in the schema.

#### 5.2.1 Exit details on the entry

A schema entry for a frame type may declare `exitFields`, decoders over its exit line. They are
exposed as `node.exit`, a typed detail object, or `null` when the frame never closed:

```ts
// generated
interface SoqlExecuteBeginEvent {
  readonly exit: { readonly type: 'SOQL_EXECUTE_END'; readonly timestamp: number;
                   readonly rows: number | null; readonly durationMs: number | null } | null;
}
```

The exit's `type` comes from the schema, because every entry but one has a single exit type. The
exception is `WF_CRITERIA_BEGIN`, which closes on `WF_CRITERIA_END` or `WF_RULE_NOT_EVALUATED`,
so 1 flag bit records which one closed it. The exit `timestamp` is the entry's `exitStamp`.

There are two storage strategies, chosen per field in the schema:

- **`scan`: numbers, booleans and enums**, decoded while the exit line is in hand and written to
  a **per-type detail column**. A column holds one slot per row *of that type*, not per row of
  the log. The slot index is the row's position in that type's `ofType` index; rows are
  ascending there, so a binary search on it finds the slot without an extra column. The cost is
  bytes per row of that type only.
- **`lazy`: text** (`CALLOUT_RESPONSE` body, `WF_FIELD_UPDATE` old and new values, …). Only for
  those types, keep the exit line's byte offset in a per-type column, and decode on read.

Exit details worth declaring, from the event database (`data/…json`) and today's code:

| Entry | Exit | Detail on the entry | Strategy |
| --- | --- | --- | --- |
| `SOQL_EXECUTE_BEGIN` | `SOQL_EXECUTE_END` | `rows` (today's row count), `durationMs` (the platform-stated duration) | scan |
| `SOSL_EXECUTE_BEGIN` | `SOSL_EXECUTE_END` | `rows`, `durationMs` | scan |
| `METHOD_ENTRY` | `METHOD_EXIT` | class-reference namespace (today's `onEnd`) | scan, into `namespace` |
| `CURSOR_CREATE_BEGIN` | `CURSOR_CREATE_END` | `rows`, `queryId` | scan |
| `FLOW_BULK_ELEMENT_BEGIN` | `FLOW_BULK_ELEMENT_END` | `records`, `executionTime` | scan |
| `WF_CRITERIA_BEGIN` | `WF_CRITERIA_END` / `WF_RULE_NOT_EVALUATED` | `result` (true/false), which exit | scan |
| `ORG_CACHE_GET_BEGIN`, `SESSION_CACHE_GET_BEGIN` | `…_END` | `hit` | scan |
| `NBA_STRATEGY_BEGIN` | `NBA_STRATEGY_END` | `outputCount` | scan |
| `FLOW_START_INTERVIEWS_BEGIN` | `FLOW_START_INTERVIEWS_END` | `requests` | scan |
| `CALLOUT_REQUEST` | `CALLOUT_RESPONSE` | `responseBody` | lazy |

Confirm each field's position and format against real logs before declaring it; use the repo's
`log-event-fields` skill. "Report what the log stated" applies: a missing exit field is `null`,
and an unterminated frame's `exit` is `null`.

#### 5.2.2 Type-level metadata is looked up, never stored per row

`category`, `debugCategory`, `debugLevel`, `kind`, shape, exit type(s), `suffix`,
`hasValidSymbols`, the default `cpuType`, field docs and the description are properties of the
**type**, not of each event. This holds for entry and exit types alike. They live once in the
generated schema table and cost nothing per row:

- `EVENT_TYPES[type]`, or `eventType(type)`, returns `{ category, debugCategory, level, kind,
  shape, exits, fields, description }`. It works for exit types too, so an exit's category and
  level stay available although no exit is stored.
- Node getters such as `node.category` and `node.debugLevel` read that table by the row's type
  id, so they are monomorphic and allocate nothing.
- Only true per-row deviations are stored, in the flags column: `cpuType: 'loading'` for
  `System.Type.forName(`, `codeUnitType`, and VF calls with their exits cleared.
- A UI that colours or filters by category builds a lookup array once, from type id to colour,
  and reads the `type` column: no per-row work.
- **An unmatched exit keeps its row.** Today `endMethod` returns false, and the exit falls through
  to be pushed as a child, or onto the root at the top level. Class-reference `METHOD_EXIT` lines,
  with no `)` and no `METHOD_ENTRY`, are the common case. Their `Unexpected-Exit` issue points at
  that row.
- **Dual exit-and-entry types always keep their row.** There are 11 `WF_*` types (`WF_APPROVAL`,
  `WF_FORMULA`, `WF_RULE_INVOCATION`, …) with both `isExit` and `exitTypes`. They are tree nodes.
- **No folded exit has wrapped text.** The only exit type with `acceptsText` is `WF_FORMULA`, which
  is dual and keeps its row.
- **A folded exit still feeds the scan.** `METHOD_EXIT` sets a namespace from a class reference,
  and `afterParse` adds it to the parser's namespace set, which later order-dependent inference
  reads. Process that even though no row is created. The same goes for any `onAfter` that
  inspects the next event.
- **A reference to a folded exit resolves to its entry row.** The Skipped-Lines and
  Max-Size-reached issues take `lastEntry.eventIndex`, which can be an exit's id today. Point them
  at the exit's entry row: the exit is part of that span, and `resolveIssueEndTimes` searches
  forward from the next row as before.

**Event ids.** The maintainer uses `eventIndex` because two events can share a timestamp, so it
must be **unique and stable within a parse**. Folding keeps that: ids are row numbers. They are
also **deterministic**: the same bytes always give the same ids, so a cache keyed by a content
hash stays valid. The numbers differ from today's, because exits no longer take one. `compat`
recomputes today's numbers for the digest gate.

| Column | Type | Note |
| --- | --- | --- |
| `type` | `Uint16Array` | schema id |
| `start`, `end` | `Uint32Array` | byte range, including wrapped lines (or drop `end` and use the next row's `start`) |
| `timestamp`, `exitStamp` | `Float64Array` | ns, held exactly by a double |
| `parent` | `Int32Array` | |
| `subtreeEnd` | `Uint32Array` | children are `row+1 … subtreeEnd`; the next sibling is `subtreeEnd` |
| `depth` | `Uint16Array` | |
| `lineNumber` | `Int32Array` | sentinels: −1 for `EXTERNAL`, −2 for `null` |
| `namespace`, `label` | `Int32Array` | string-table ids, −1 for none |
| `flags` | `Uint8Array` | exit, truncated, discontinuity, overrides |
| rollups: time and heap | `Float64Array`: duration self, heap net, gross, peak | dense; heap is non-zero on 27–39% of frames |
| rollups: counts | `Int32Array` `countSlot` per row (−1 for none), plus a pool of 8 `Int32` per slot | sparse: 0.6–3% of frames have a non-zero count. Self derives from the row's own type for leaves. |
| aggregates | per-label calls, self and total; per-namespace and per-type totals | built during the scan (§5.11) |
| per-type indexes | `Uint32Array` per type | |
| string table | byte ranges and hashes | values decoded once, then cached |

**Size:** v3 measured 41 MB at 100 MB (510k rows, ~80 bytes per row, all columns trimmed), and
29 MB frames-only. Target ≤ 50 MB at 100 MB.

**Source bytes** are kept for lazy text. `retainSource: false` drops them after the eager fields,
for callers that need only the tree and the interned names.

### 5.3 Views

- **`Node`: one class for every node.** It holds `(store, row)` and is cached in a sparse array,
  so `===` and `Map` keys work. Every field getter of every event lives on that one prototype and
  decodes through `FIELD_SLOT[type][field]`, so receivers stay monomorphic. The constructor sets
  every field in a fixed order, and nothing adds a property later.
- **`Cursor`** allocates nothing: `firstChild`, `nextSibling`, `parent`, plus `type`,
  `timestamp`, … at the current row. It is iterative, so a deep log cannot overflow the stack.
- **`EventList<K>`** is returned by `ofType`: an array-like view over a `Uint32Array` of rows,
  with `length`, `at`, an iterator, `map`, `filter` and `toArray`.
- **`log.columns`** exposes read-only typed arrays for rendering.
- **Text.** Free text is decoded on first read: `TextDecoder` over a subarray, with an ASCII fast
  path for short ranges. Wrapped lines are joined with `\n`, and `\r` is stripped per line,
  exactly as today's `text`.

### 5.4 One schema that generates runtime and types

One declarative table per event replaces the 175 classes, `LogLineMapping` and `_logEventNames`.
Generate the base from `data/salesforce-debug-log-events.json`, which has fields for many events,
and keep hand-written overrides in a separate file. Each entry states:

- `category`, `debugCategory`, `level`, `cpuType`, `suffix` and `hasValidSymbols`;
- the shape: `leaf`, `scope` or `container`;
- `exit`, or a list of exit types, plus `nextLineIsExit`, `acceptsText` and `discontinuity`;
- for a container, its allowed `children`;
- named `fields` with decoders: line number, string, int, the rest of the line, or a field read
  from the end (the wrapped-trailing-fields case);
- derived fields, read from the exit row or computed;
- a total `kind` (#35): `frame`, `execution`, `package-boundary`, `soql`, `sosl`, `dml`, …;
- doc comments.

Codegen emits:

- the runtime tables;
- the perfect hash;
- **named, documented interfaces per event**, the `ApexEvent` union and `EventMap`. Named
  interfaces read well on hover, keep `tsc` fast, and satisfy `isolatedDeclarations`.

**Shapes:**

- **leaf**: no `children` property.
- **scope**: any child.
- **container**: a closed child list, **enforced by the parser**. When a row of a type the
  container does not allow appears inside it, the parser closes the container as unterminated
  (`Unexpected-End`) and gives the row to the container's parent.

Derive the container lists from the corpus: write a script that counts parent→child type pairs.
Start with few containers. `types-sketch.ts` in §A proves the typing works, including the
expected-error lines.

### 5.5 Monomorphism rules

- **Typed arrays only** on the hot path.
- **Per-type behaviour is tables and switches on the type id**, never polymorphic methods.
- **One node class**, with a fixed field order.
- **The same rule for side-table objects:** issues, truncation regions and limit values.
- **A CI test** runs the scanner with `--allow-natives-syntax` and asserts
  `%GetOptimizationStatus` shows it optimised and never deoptimised on the bench logs.

### 5.6 Allocation rules for the hot path

- No `split`, regex, `slice` or `Number(substring)` per line. Regexes only on the header and on
  lines that already failed the fast checks.
- No closures and no generators in the loop. v2 still has closures, and that cost ~22% in its
  profile.
- Arrays sized once from `byteLength / 90`, then grown by doubling. That removed ~10% of scan time.
- Interned names are numbers. Free text is a byte range until read.
- One pass. Anything that needs "later" waits on a pending list keyed by row.

### 5.7 API

```ts
parse(input: string | Uint8Array, options?): ApexLog;               // sync
parseAsync(input: string | Uint8Array | Blob | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array | string>,
           options?: { signal?: AbortSignal; sliceMs?: number;
                       onProgress?(p: { bytes: number; totalBytes?: number; events: number }): void }): Promise<ApexLog>;
parseInWorker(input, options?): Promise<ApexLog>;                     // transfer in, transfer out
createParserPool({ size?, workerUrl? }): ParserPool;
createLogBuilder(options?): { push(chunk): void; snapshot(): ApexLog; finish(): ApexLog };
log.toBuffers(): ArrayBuffer[];  ApexLog.fromBuffers(buffers): ApexLog; // caching, ~0 ms reopen
```

- **`ApexLog`:** `root`, `node(i)`, `cursor()`, `ofType(type)`, `visit(visitor)`,
  `at(timestamp)`, `find(pred)`, `search(text)` (`indexOf` over the bytes, then a binary search
  on `start`), `columns`, `limits`, `issues`, `truncation`, `namespaces`, `entryPoints`,
  `userInfo`, `debugLevels`, `debugLevelSettings`, `size`, `startTime` and `executionEndTime`.
- **A node:** `type`, its named fields, `children` (frames only), `childrenOfType`, `parent`,
  `duration`, the counts with today's names (`soqlCount.total`, …), `heapAllocated`,
  `heapGross`, `heapPeak`, `isTruncated`, `index`, `text` (lazy) and `raw` (lazy).
- **`is(node, type)`** is a type guard.
- **`node.exit`** holds the typed exit details (§5.2.1). **`EVENT_TYPES` / `eventType(type)`** holds
  type-level metadata (§5.2.2), with `node.category` and friends reading it.

### 5.8 Async, workers and builds

- **Time slices.** Check `performance.now()` every 2,048 lines. Yield with `scheduler.yield()`,
  falling back to a `MessageChannel` post in browsers (no 4 ms clamp) and `setImmediate` in Node.
- **Cancellation.** An `AbortSignal`, checked per slice.
- **Progress.** Bytes over total bytes.
- **The worker** is the default for UIs. Input bytes and output buffers are transferred, never
  cloned.
- **Builds.** One core with no `node:*`. Exports conditions:
  - `node`: `worker_threads`, `setImmediate`, `parseFile(path)` over fs streams;
  - `browser` and `default`: a Web Worker through
    `new URL('./worker.js', import.meta.url)`, which bundlers understand, plus `MessageChannel`.

  Add a `./worker` subpath. Accept `workerUrl` and a `blob:` fallback for VS Code webviews.
  Keep `sideEffects: false`.
- **Toolchain.** `pnpm build` uses tsdown, and needs Node `^22.18 || >=24.11` to build, though
  the package supports Node 20.

### 5.9 The `compat` adapter

`@apexdevtools/apex-log-parser/compat` exports `toLegacyTree(log)`, which builds today's
`ApexLog` and `LogEvent` classes from the store, with the same fields and values. It serves two
purposes:

1. **It is the correctness gate.** The digest of `toLegacyTree(parseNew(log))` must equal the
   digest of `parseOld(log)` on every corpus log, and the repo's existing tests must pass
   against it.
2. **It is the migration path.** It lasts one major version, so the analyzer can move one view
   at a time.

### 5.10 WASM: no, for now

- The JS byte scanner already runs at ~1 GB/s.
- After the rewrite, the cost is strings, objects and rollups, which WASM cannot create more
  cheaply.
- There is a boundary copy each way.
- It needs a Rust or Zig toolchain, async instantiation, more bundle size, and
  `wasm-unsafe-eval` in strict CSPs such as VS Code webviews.
- The column layout is the ABI. Revisit only if the scanner is more than ~50% of parse time
  after the rewrite.

### 5.11 Output-shape wins to adopt

These are the ways high-performance parsers and trace tools (Perfetto, Chrome trace, speedscope,
Arrow) shape output, ranked by measured or expected impact:

1. **Fold exit lines into their entries.** Measured −41% rows and 2.2× smaller with sparse
   counts, and 1.6–1.8× faster. This is how trace formats store a span: one record with a start
   and an end, not two events.
2. **Store totals sparsely, with self derived.** Measured: only 0.6–3% of frames need count
   slots. Store totals only; self is the row's own contribution for leaves, and
   `total − Σ children` where needed.
3. **Ship the aggregates consumers recompute today, built during the scan:**
   - **methods:** per signature, calls, self, total (recursion once), plus SOQL/DML totals;
     measured at ~5%;
   - **namespaces:** time and counts per namespace;
   - **queries:** SOQL and DML grouped by normalised statement text, with count, rows and time
     (the analyzer's database view, MCP's query plans);
   - **types:** a count per event type, which is free from the per-type indexes.

   This removes the consumer walks that #34 lists.
4. **Dictionary-encode strings.** Labels, namespaces, object types and SOQL text are interned
   ids, and consumers group and filter by id (Arrow dictionary encoding). The string table is
   part of the output.
5. **Projection: `parse(input, { include })`.** For example `include: ['frames']` drops leaf
   rows while keeping their totals: 41 → 29 MB measured. Further includes (`'variables'`,
   `'heap'`, `'statements'`) let MCP keep only what a tool needs. OPEN decision 9 decides the
   default.
6. **A frames table for timelines.** A `Uint32Array` of frame rows built during the scan, and the
   render index from §9.3 (frames by depth, sorted by start). A flame chart then never touches
   leaf rows.
7. **Time is the order.** Rows are in timestamp order, so `at(time)` and visible-range queries are
   a binary search on `timestamp`, with no extra index.
8. **Arrow-compatible columns and standard exports.** Lay out the columns so Apache Arrow JS can
   wrap them without copying. That gives DuckDB-wasm and Arrow tooling for free, and it is a
   documented format for `toBuffers`. Add exporters to the Chrome trace event format and to
   speedscope, so a user can open any log in Perfetto UI or speedscope.
9. **A storeless streaming visitor**, `scan(input, visitor)`, for one-shot, memory-bound queries.
   Measured ~2.4× faster than a full scan, with zero retained memory.
10. **Append-only parsing**, for a log that is still being written (tailing), at no extra cost,
    because the store is append-only.

Not worth it:

- **Delta-encoding timestamps.** Random access matters more, and a `Float64` holds the
  nanosecond counter exactly.
- **A table per event type.** It would break prefix order and make walking the tree harder.

---

## 6. Feature-parity checklist

Every row must hold, verified through the `compat` digest and the repo's tests.

| Feature today | Where it lives | Eager or lazy |
| --- | --- | --- |
| Tree: `parent`, `children`, `eventIndex` (root = 0; exits included today), `eventsById` | rows, `parent`, `subtreeEnd`, `node(i)`. Matched pure exits fold into their entries, and only their type, timestamp, line number, SOQL/SOSL rows and class-reference namespace are read; unmatched exits and the dual `WF_*` types keep rows (§5.2). Ids stay unique, stable and deterministic per parse; `compat` recomputes today's numbers. | eager |
| `timestamp`, `exitStamp`, `duration.self` and `total` | columns | eager |
| `dmlCount`, `soqlCount`, `soslCount`, `dmlRowCount`, `soqlRowCount`, `soslRowCount`, `thrownCount` (self and total) | rollup columns | eager |
| `heapAllocated`, `heapGross` (self and total), `heapPeak` (max), the running live heap clamped at 0 | rollup columns | eager |
| `GovernorLimits` snapshots (`LIMIT_USAGE_FOR_NS`), per namespace, `peak.heapSize` fold, granular `limitUsage` | side table | eager (a cold path) |
| Flow DB residuals (`applyFlowDbResiduals`) | on frame close | eager |
| Managed package merge (`ENTERING_MANAGED_PKG`) | on frame close | eager |
| `namespace`, including order-dependent inference | `namespace` column | **eager, required** |
| `text`, `logLine`, per-class text rules, wrapped text, `suffix` | decoders | lazy |
| `category`, `debugCategory`, `debugLevel`, `cpuType`, `exitTypes`, `hasValidSymbols` | type-level table (`EVENT_TYPES`), plus per-row overrides in flags (§5.2.2) | constant |
| SOQL/SOSL row counts from the exit; exit details generally | `node.exit` and per-type detail columns (§5.2.1) | eager (scan) or lazy (text) |
| `codeUnitType`, the `Type.forName` loading `cpuType`, VF calls with exits cleared | flags column | eager |
| `isTruncated`, `discontinuity`, `nextLineIsExit`, `acceptsText`, `isExit`, `isParent` | flags and schema | eager |
| `logIssues` (Unexpected-End/Exit, Skipped-Lines with bytes, Max-Size-reached, Multiple-Logs, …), deduped, sorted, with end times | side table | eager |
| `parsingErrors` (unsupported event name, deduped; invalid line; unsupported debug level) | side table | eager |
| `truncation` (regions, `totalSkippedBytes`), `truncatedEvents`, root `isTruncated` | side table | eager |
| `debugLevels`, `debugLevelSettings`, `userInfo` (with timezone parsing), `entryPoints`, `startTime`, `executionEndTime`, `exceptions`, `namespaces` | header and indexes | eager |
| `size` in UTF-8 bytes | `byteLength`, or `utf8ByteLength` for a string input | eager |
| Multiple logs in one text: parse only the first, report how many | scanner | eager |

---

## 7. What changes for consumers, and the OPEN decisions

**What changes:**

- **Mutation.** `children` is no longer an array consumers can push to or splice. Setters can be
  kept for scalar fields, writing to the columns or to an overlay for strings. Adding a new
  property to a node still works, but costs monomorphism.
- **`instanceof` event classes** become `node.type` or `is()`.
- **Extending the parser.** `ApexLogParser` subclassing and custom event constructors go away.
- **`eventsById[i]`** becomes `node(i)`.

**OPEN: ask the user before deciding.**

1. **Mutation.** #108 says the API must stay mutable. What exactly do the analyzer and MCP
   mutate today? Grep both consumers for assignments to event fields and to `children`.
2. **Compat.** How long does the `compat` adapter live, and is 1.0 the release for this?
3. **Containers.** Which events are containers? Decide from the corpus pair report.
4. **`retainSource`.** What is its default, and is the memory trade-off acceptable for MCP?
5. **Node and browsers.** The minimum Node version, Safari support (which needs the `yield`
   fallback), and whether VS Code webviews allow workers from the extension's origin.
6. **Parallel first stage** (§9.4). Is it worth `SharedArrayBuffer` and cross-origin isolation?
7. **Repo layout.** Is the rewrite a new entry point in the same package during development, or a
   separate package until it reaches parity?
8. **`eventIndex` numbering.** RESOLVED: ids exist for uniqueness when timestamps collide, so
   unique, stable, deterministic row numbers meet the need, and folding exits is accepted. Still
   confirm that nothing **persists** ids across package versions; a cache keyed by content hash
   plus parser version is safe.
9. **Projection default.** Full rows, or frames only? And which aggregates ship in 1.0?

---

## 8. Build plan and acceptance gates

### Phase 0: groundwork

- Make sure #106 has merged, or bring its harness in. Merge or rebase onto #107 and #109.
- Reproduce §3 with §A.
- Get access to the corpus, and the digest script that #107 and #109 used. Ask the user where it
  lives.

**Gate:** §3 reproduced within ±25%, and the corpus digest runs on `main`.

### Phase 1: schema and codegen

- Write the schema table, the codegen, and the generated types.
- Port every event's fields, text rules, flags and overrides from `LogEvents.ts`.
- Replace or extend `EventMetadata.test.ts`, so the data JSON still crosses the schema.
- Run the parent→child pair report on the corpus, and propose container lists to the user.

**Gate:** codegen output typechecks under the repo's tsconfig; every documented event resolves;
`types-sketch`-style tests pass, including the expected errors.

### Phase 2: scanner, store and compat, sync only

- Write the scanner and store as one specialised loop each for bytes and for strings.
- Port the full matching rules, the rollups at close, issues, limits, truncation, package merge,
  flow residuals and multiple-log detection.
- Write `toLegacyTree`.

**Gate:**

- the corpus digest is identical to `main` on every log;
- every existing test passes against compat;
- at 100 MB, ≤ 400 ms and ≤ 50 MB of columns;
- aggregates (methods, namespaces, queries) match a tree walk over compat;
- the deopt test is green.

### Phase 3: views

- `Node` (one class), `Cursor`, `EventList`, `ofType`, `visit`, `at`, `find`, `search`, `columns`
  and `is`.
- Public API tests, and `PublicApi.test.ts` updated.

**Gate:** #34 and #71 acceptance; a flame chart from the columns adds < 30 ms at 100 MB; an object
for every row adds < 250 ms.

### Phase 4: async, streams, progress and cancellation

**Gate:** the worst main-thread slice is ≤ 10 ms on the 100 MB log; total time is within 10% of
the sync path; `AbortSignal` stops within one slice.

### Phase 5: workers, the two builds, and `toBuffers`/`fromBuffers`

**Gate:**

- the worker round trip is within 10% of the sync scan;
- the worst main-thread gap is < 10 ms;
- builds work in Vite, webpack and esbuild, and in a VS Code webview;
- the `fromBuffers` reopen takes < 20 ms at 100 MB.

### Phase 6: migrate consumers and release

- Guides for the analyzer and MCP, and a changeset.
- Keep `compat` for the agreed time.

**Gate:** both consumers run on the new API in a branch, and the user signs off.

**After 1.0, optional:**

- the render index (§9.3);
- the parallel first stage (§9.4);
- the #72 variables index, built with the cursor.

---

## 9. Other changes with a large impact

1. **Do not parse twice.** `toBuffers` plus a disk cache (MCP) or IndexedDB (the analyzer),
   keyed by a content hash. A reopen costs ~0 ms.
2. **Draw while parsing.** The store is append-only and in prefix order, so closed subtrees are
   final. `createLogBuilder().snapshot()` lets the UI draw before the end arrives.
3. **A render index for the flame chart.** Rows grouped by depth and sorted by start, so each
   pan or zoom binary-searches the visible range and draws O(visible) frames, not O(all).
4. **A parallel first stage.** Split the bytes at newlines across workers to find type ids,
   timestamps and fields; the stack matching stays sequential. Maybe ~0.2 s at 100 MB on 4
   cores. It needs `SharedArrayBuffer` or one transfer per chunk.
5. **Size arrays from the byte length** (measured ~10%), and **cancel stale parses**.
6. **Decode only what is shown.** Labels for frames wide enough to show text.

---

## 10. Gotchas

- **`eventIndex` must stay unique, stable and deterministic within a parse.** UIs navigate by it,
  because timestamps collide. The root is 0. The numbers may differ from today's only by the
  folded exits (§5.2), and `compat` restores today's numbers for the digest.
- **Folding exits:** only *matched pure* exits fold. Unmatched exits and the dual `WF_*` types
  keep rows; a folded exit still contributes its namespace; and an issue that points at a folded
  exit points at its entry. The v3 prototype is simplified here: it drops unmatched exits instead
  of keeping them, so fix that in the real scanner.
- **Namespace inference depends on order.** Compute it while scanning.
- **Exit matching checks line numbers** (`isMatchingEnd`). v2 does not; the real scanner must.
- **Discontinuity and max-size truncation** interact (`parseTree`); port them exactly.
- **`nextLineIsExit` events** take their exit timestamp from the next event of any kind, and can
  only be exited by other pseudo-exits.
- **`EXECUTION_STARTED`** always closes every open frame.
- **Issues are deduped** by `type:summary`, except `Skipped-Lines`, and sorted by `startTime`.
  `updateLogIssue` replaces one.
- **Wrapped text never absorbs a truncation marker.** Trailing fields after a wrapped message are
  split off by `splitTrailingFields` (`LogEvents.ts`).
- **CRLF:** strip `\r` per line, including inside wrapped text.
- **Report what the log stated:** a missing field decodes to `null`, never `''` or `0`.
- **Sliced strings:** never keep a `slice` of a big string in the output. Decode from bytes.
- **The synthetic logs are not real logs.** They have few distinct names and no hostile text.
  Validate on the corpus.

---

## A. Reproducing the measurements

From a checkout of the repo at `main`, with Node 22+ and `pnpm install` done:

```sh
mkdir -p bench/rewrite
# The synthetic generator and its profiles, from #106 (or from src/__bench__/ if it has merged).
git fetch origin ci/benchmarks
git show origin/ci/benchmarks:src/__bench__/fixtures.ts   > bench/rewrite/fixtures.ts
git show origin/ci/benchmarks:src/__bench__/profiles.json > bench/rewrite/profiles.json
# Save each file below into bench/rewrite/ under the name in its heading. Then:
pnpm exec tsx bench/rewrite/type-table.ts > bench/rewrite/type-table.json
pnpm exec tsx bench/rewrite/gen-logs.ts bench/rewrite/logs          # ~120 MB of logs
node --expose-gc --max-old-space-size=8000 --import tsx bench/rewrite/bench.ts bench/rewrite/logs
node bench/rewrite/worker-bench.mjs bench/rewrite/logs
node bench/rewrite/monomorphism.mjs
node bench/rewrite/shape.mjs bench/rewrite/logs      # row mix and rollup density
node bench/rewrite/v3bench.mjs bench/rewrite/logs    # v2 vs v3, method stats, projection
node bench/rewrite/shape2.mjs bench/rewrite/logs     # storeless visitor vs scans
node --expose-gc --max-old-space-size=8000 --import tsx bench/rewrite/timeline.ts bench/rewrite/logs  # parse to timeline
pnpm exec tsc --ignoreConfig --noEmit --skipLibCheck --strict --noUncheckedIndexedAccess \
  --target es2022 --module nodenext bench/rewrite/types-sketch.ts
```

Keep `bench/rewrite/` out of commits (add it to `.git/info/exclude`): it does not follow the
repo's lint rules, and `logs/` is large. `fixtures.ts` imports a type from `./measure.js`; tsx
erases it, so `measure.ts` is not needed.

Each file below was run as written in the session that produced this brief.

### `gen-logs.ts`

````ts
// Writes the synthetic logs the measurements use. Run from the repo root:
//   pnpm exec tsx bench/rewrite/gen-logs.ts <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { largeLogs, makeLog } from './fixtures.js';

const out = process.argv[2] ?? 'bench/rewrite/logs';
mkdirSync(out, { recursive: true });
writeFileSync(`${out}/dev20.log`, makeLog(largeLogs['developer 20 MB']!));
writeFileSync(`${out}/large100.log`, makeLog(largeLogs['large 100 MB']!));
console.log(`wrote ${out}/dev20.log and ${out}/large100.log`);
````

### `type-table.ts`

````ts
// Reads today's event classes into a JSON table the prototypes use, so their matching rules are
// the real ones. Run from the repo root:
//   pnpm exec tsx bench/rewrite/type-table.ts > bench/rewrite/type-table.json
import { readFileSync } from 'node:fs';
import { ApexLogParser } from '../../src/index.js';
import { getLogEventClass } from '../../src/LogLineMapping.js';
import type { LogEventType } from '../../src/types.js';

const typesSrc = readFileSync('src/types.ts', 'utf8');
const list = typesSrc.slice(typesSrc.indexOf('const _logEventNames')).split('] as const')[0]!;
const names = [...list.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]!);
const rows = names.map((name) => {
  const C = getLogEventClass(name as LogEventType);
  if (!C) return { name, registered: false };
  // Field values that every constructor accepts; only the flags and exit types are read.
  const parts = ['00:00:00.0 (1)', name, '[1]', 'Rows:1', 'Rows:1', 'Rows:1', 'Rows:1', 'Rows:1'];
  try {
    const e = new C(new ApexLogParser(), parts);
    return { name, registered: true, isParent: e.isParent, isExit: e.isExit, nextLineIsExit: e.nextLineIsExit,
      acceptsText: e.acceptsText, discontinuity: e.discontinuity, exitTypes: e.exitTypes };
  } catch (err) {
    return { name, registered: true, error: String(err) };
  }
});
process.stdout.write(JSON.stringify(rows, null, 1));
````

### `scan-v1.mjs`

````js
// Prototype v1: the floor. Scans bytes, matches entries to exits, rolls up 3 counters into
// typed-array columns. No text, no wrapped lines, exits are not rows. Not a forecast.
import { readFileSync } from 'node:fs';

const table = JSON.parse(readFileSync(new URL('./type-table.json', import.meta.url), 'utf8'));
const names = ['?', ...table.map((r) => r.name)];
const N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
const exitOf = new Int16Array(N).fill(-1), isExit = new Uint8Array(N);
table.forEach((r, i) => { const x = r.exitTypes?.[0]; if (x) { exitOf[i + 1] = idOf.get(x); isExit[idOf.get(x)] = 1; } });
const HB = 4096, hTab = new Int16Array(HB).fill(-1), nameHash = new Int32Array(N);
for (let i = 1; i < N; i++) {
  let h = 0; for (const ch of names[i]) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  nameHash[i] = h; let k = h & (HB - 1); while (hTab[k] !== -1) k = (k + 1) & (HB - 1); hTab[k] = i;
}
const SOQL = idOf.get('SOQL_EXECUTE_BEGIN'), DML = idOf.get('DML_BEGIN'), HEAP = idOf.get('HEAP_ALLOCATE');
const grow = (a, n) => { const b = new a.constructor(n); b.set(a); return b; };

export function scanV1(src) {
  const len = src.length;
  let cap = 1 << 16, n = 0;
  let start = new Uint32Array(cap), type = new Uint16Array(cap), ts = new Float64Array(cap), exitTs = new Float64Array(cap),
    parent = new Int32Array(cap), subtreeEnd = new Uint32Array(cap), soql = new Int32Array(cap), dml = new Int32Array(cap),
    heap = new Float64Array(cap), selfDur = new Float64Array(cap);
  const stack = new Int32Array(8192); let sp = 0, pos = 0;
  while (pos < len) {
    let eol = src.indexOf(10, pos); if (eol < 0) eol = len;
    if (src[pos + 2] === 58 && src[pos + 5] === 58) {                 // HH:MM:SS.f (N)|TYPE|
      let i = pos + 8; while (src[i] !== 40) i++; i++;
      let t = 0, c; while ((c = src[i]) !== 41) { t = t * 10 + (c - 48); i++; }
      i += 2;
      let h = 0; while (i < eol && (c = src[i]) !== 124 && c !== 13) { h = (Math.imul(h, 31) + c) | 0; i++; }
      let k = h & (HB - 1), id = 0;
      for (let e; (e = hTab[k]) !== -1; k = (k + 1) & (HB - 1)) if (nameHash[e] === h) { id = e; break; }
      if (n === cap) { cap *= 2; start = grow(start, cap); type = grow(type, cap); ts = grow(ts, cap); exitTs = grow(exitTs, cap); parent = grow(parent, cap); subtreeEnd = grow(subtreeEnd, cap); soql = grow(soql, cap); dml = grow(dml, cap); heap = grow(heap, cap); selfDur = grow(selfDur, cap); }
      if (isExit[id]) {
        let m = sp - 1; while (m >= 0 && exitOf[type[stack[m]]] !== id) m--;
        while (m >= 0 && sp > m) {                                     // close and roll up into the parent
          const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subtreeEnd[e] = n;
          const p = parent[e]; if (p >= 0) { soql[p] += soql[e]; dml[p] += dml[e]; heap[p] += heap[e]; selfDur[p] -= tot; }
        }
      } else {
        const e = n++;
        start[e] = pos; type[e] = id; ts[e] = t; parent[e] = sp ? stack[sp - 1] : -1; subtreeEnd[e] = e + 1;
        if (id === SOQL) soql[e] = 1; else if (id === DML) dml[e] = 1;
        else if (id === HEAP) { let j = i; while (j < eol && src[j] !== 58) j++; let b = 0; j++; while (j < eol && (c = src[j]) >= 48 && c <= 57) { b = b * 10 + (c - 48); j++; } heap[e] = b; }
        if (exitOf[id] >= 0) stack[sp++] = e;
        else if (sp) { const p = stack[sp - 1]; soql[p] += soql[e]; dml[p] += dml[e]; heap[p] += heap[e]; }
      }
    }
    pos = eol + 1;
  }
  return { n, start, type, ts, exitTs, parent, subtreeEnd, soql, dml, heap, selfDur };
}
````

### `scan-v2.mjs`

````js
// Prototype v2: closer to the proposal. Every line is a row (eventIndex kept); real exit,
// nextLineIsExit and acceptsText rules from type-table.json; wrapped lines; interned labels and
// namespaces; 8 counters, heap net and peak, self duration; per-type indexes; arrays sized once.
// Omits issues, limits, truncation, package merge and the per-event text rules.
import { readFileSync } from 'node:fs';

const table = JSON.parse(readFileSync(new URL('./type-table.json', import.meta.url), 'utf8'));
export const names = ['?', ...table.map((r) => r.name)];
const N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
export const isExitType = new Uint8Array(N);
const nextIsExit = new Uint8Array(N), accepts = new Uint8Array(N), hasExits = new Uint8Array(N);
const exitMatch = new Uint8Array(N * N);
table.forEach((r, i) => {
  const t = i + 1;
  isExitType[t] = r.isExit && !(r.exitTypes?.length) ? 1 : 0;
  nextIsExit[t] = r.nextLineIsExit ? 1 : 0; accepts[t] = r.acceptsText ? 1 : 0;
  for (const x of r.exitTypes ?? []) { exitMatch[t * N + idOf.get(x)] = 1; hasExits[t] = 1; }
});
// Which pipe field holds the label to intern, for the frequent frames.
const LABEL_FIELD = new Int8Array(N).fill(-1);
for (const [n, f] of [['METHOD_ENTRY', 4], ['METHOD_EXIT', 4], ['CONSTRUCTOR_ENTRY', 5], ['SYSTEM_METHOD_ENTRY', 3], ['CODE_UNIT_STARTED', 4], ['VF_APEX_CALL_START', 3]]) LABEL_FIELD[idOf.get(n)] = f;
const HB = 4096, hTab = new Int16Array(HB).fill(-1), nameHash = new Int32Array(N);
for (let i = 1; i < N; i++) {
  let h = 0; for (const ch of names[i]) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  nameHash[i] = h; let k = h & (HB - 1); while (hTab[k] !== -1) k = (k + 1) & (HB - 1); hTab[k] = i;
}
const SOQL = idOf.get('SOQL_EXECUTE_BEGIN'), DML = idOf.get('DML_BEGIN'), SOSL = idOf.get('SOSL_EXECUTE_BEGIN'),
  HEAP = idOf.get('HEAP_ALLOCATE'), THROWN = idOf.get('EXCEPTION_THROWN'), EXEC = idOf.get('EXECUTION_STARTED');
export const NC = 8; // soql, dml, sosl, soqlRows, dmlRows, soslRows, thrown, spare
const grow = (a, n) => { const b = new a.constructor(n); b.set(a); return b; };

export function scanV2(src) {
  const len = src.length;
  let cap = Math.max(1 << 12, Math.ceil(len / 90)), n = 0; // rows ~ bytes/115 in real logs: at most one grow
  let type = new Uint16Array(cap), start = new Uint32Array(cap), end = new Uint32Array(cap), ts = new Float64Array(cap),
    exitTs = new Float64Array(cap), parent = new Int32Array(cap), subEnd = new Uint32Array(cap), depth = new Uint16Array(cap),
    lineNo = new Int32Array(cap), label = new Int32Array(cap), ns = new Int32Array(cap), selfDur = new Float64Array(cap),
    cnt = new Int32Array(cap * NC), heap = new Float64Array(cap), peak = new Float64Array(cap);
  let sCap = 1 << 12, nStr = 0, strStart = new Uint32Array(sCap), strEnd = new Uint32Array(sCap), strHash = new Int32Array(sCap);
  let IB = 1 << 14, iTab = new Int32Array(IB).fill(-1);
  const intern = (a, b) => {
    let h = 0; for (let i = a; i < b; i++) h = (Math.imul(h, 31) + src[i]) | 0;
    let k = h & (IB - 1);
    for (let e; (e = iTab[k]) !== -1; k = (k + 1) & (IB - 1)) {
      if (strHash[e] === h && strEnd[e] - strStart[e] === b - a) { let j = strStart[e], i = a; while (i < b && src[i] === src[j]) { i++; j++; } if (i === b) return e; }
    }
    if (nStr === sCap) { sCap *= 2; strStart = grow(strStart, sCap); strEnd = grow(strEnd, sCap); strHash = grow(strHash, sCap); }
    strStart[nStr] = a; strEnd[nStr] = b; strHash[nStr] = h; iTab[k] = nStr;
    if (nStr * 2 > IB) { IB *= 2; iTab = new Int32Array(IB).fill(-1); for (let s = 0; s <= nStr; s++) { let kk = strHash[s] & (IB - 1); while (iTab[kk] !== -1) kk = (kk + 1) & (IB - 1); iTab[kk] = s; } }
    return nStr++;
  };
  const byTypeN = new Uint32Array(N), byType = Array.from({ length: N }, () => new Uint32Array(16));
  const stack = new Int32Array(8192); let sp = 0, last = -1, running = 0, pos = 0;
  const rollInto = (p, e) => { const pe = p * NC, ce = e * NC; for (let c = 0; c < NC; c++) cnt[pe + c] += cnt[ce + c]; heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; };
  const close = (e, t) => { exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; if (p >= 0) { selfDur[p] -= tot; rollInto(p, e); } };
  while (pos < len) {
    let eol = src.indexOf(10, pos); if (eol < 0) eol = len;
    let lineEnd = eol; if (lineEnd > pos && src[lineEnd - 1] === 13) lineEnd--;
    if (src[pos + 2] === 58 && src[pos + 5] === 58) {
      let i = pos + 8; while (src[i] !== 40 && i < lineEnd) i++; i++;
      let t = 0, c = 0; while ((c = src[i]) !== 41) { t = t * 10 + (c - 48); i++; }
      i += 2; const t0 = i;
      let h = 0; while (i < lineEnd && (c = src[i]) !== 124) { h = (Math.imul(h, 31) + c) | 0; i++; }
      let k = h & (HB - 1), id = 0;
      for (let e; (e = hTab[k]) !== -1; k = (k + 1) & (HB - 1)) if (nameHash[e] === h) { id = e; break; }
      if (id === 0 && i === t0) { pos = eol + 1; continue; }
      if (n === cap) { cap *= 2; type = grow(type, cap); start = grow(start, cap); end = grow(end, cap); ts = grow(ts, cap); exitTs = grow(exitTs, cap); parent = grow(parent, cap); subEnd = grow(subEnd, cap); depth = grow(depth, cap); lineNo = grow(lineNo, cap); label = grow(label, cap); ns = grow(ns, cap); selfDur = grow(selfDur, cap); cnt = grow(cnt, cap * NC); heap = grow(heap, cap); peak = grow(peak, cap); }
      const e = n++;
      type[e] = id; start[e] = pos; end[e] = lineEnd; ts[e] = t; label[e] = -1; ns[e] = -1;
      let ln = -2; // -2 null, -1 EXTERNAL
      if (src[i] === 124 && src[i + 1] === 91) { let j = i + 2; ln = 0; while ((c = src[j]) >= 48 && c <= 57) { ln = ln * 10 + (c - 48); j++; } if (c !== 93) ln = -1; }
      lineNo[e] = ln;
      const lf = LABEL_FIELD[id];
      if (lf > 0) {
        let f = 2, a = i; while (f < lf && a < lineEnd) { a++; while (a < lineEnd && src[a] !== 124) a++; f++; }
        a++; let b = a; while (b < lineEnd && src[b] !== 124) b++;
        if (a < b) { label[e] = intern(a, b); let d = a; while (d < b && src[d] !== 46) d++; if (d < b) ns[e] = intern(a, d); }
      }
      if (byTypeN[id] === byType[id].length) byType[id] = grow(byType[id], byType[id].length * 2);
      byType[id][byTypeN[id]++] = e;
      if (id === SOQL) cnt[e * NC] = 1; else if (id === DML) cnt[e * NC + 1] = 1; else if (id === SOSL) cnt[e * NC + 2] = 1; else if (id === THROWN) cnt[e * NC + 6] = 1;
      else if (id === HEAP) { let j = lineEnd - 1; while (j > i && src[j] !== 58) j--; let b = 0, neg = false; j++; if (src[j] === 45) { neg = true; j++; } while (j < lineEnd && (c = src[j]) >= 48 && c <= 57) { b = b * 10 + (c - 48); j++; } if (neg) b = -b; heap[e] = b; running = Math.max(0, running + b); peak[e] = running; }
      if (last >= 0 && nextIsExit[type[last]] && exitTs[last] === 0) exitTs[last] = t;
      if (isExitType[id]) {
        let m = sp - 1; while (m >= 0 && !exitMatch[type[stack[m]] * N + id]) m--;
        parent[e] = sp ? stack[sp - 1] : -1; depth[e] = sp; subEnd[e] = e + 1;
        if (m >= 0) while (sp > m) close(stack[--sp], t);
      } else {
        if (id === EXEC) while (sp) close(stack[--sp], t);
        const p = sp ? stack[sp - 1] : -1; parent[e] = p; depth[e] = sp; subEnd[e] = e + 1;
        if (hasExits[id]) stack[sp++] = e; else if (p >= 0) rollInto(p, e);
      }
      last = e;
    } else if (last >= 0 && accepts[type[last]]) {
      end[last] = lineEnd; // wrapped text extends the previous row
    }
    pos = eol + 1;
  }
  while (sp) close(stack[--sp], n ? ts[n - 1] : 0);
  return { n, src, type, start, end, ts, exitTs, parent, subEnd, depth, lineNo, label, ns, selfDur, cnt, heap, peak, strStart, strEnd, nStr, byType, byTypeN };
}

const dec = new TextDecoder();
function decodeRange(src, a, b) {
  if (b - a < 64) { let ascii = true; for (let i = a; i < b; i++) if (src[i] > 127) { ascii = false; break; } if (ascii) return String.fromCharCode.apply(null, src.subarray(a, b)); }
  return dec.decode(src.subarray(a, b));
}
/** Lazy views: one class for every node, cached by row so === holds. */
export class LogView {
  constructor(s) { this.s = s; this.strCache = []; this.nodes = []; }
  str(id) { return (this.strCache[id] ??= decodeRange(this.s.src, this.s.strStart[id], this.s.strEnd[id])); }
  node(i) { return (this.nodes[i] ??= new NodeView(this, i)); }
}
export class NodeView {
  constructor(log, index) { this.log = log; this.index = index; this._children = undefined; }
  get type() { return names[this.log.s.type[this.index]]; }
  get timestamp() { return this.log.s.ts[this.index]; }
  get exitStamp() { return this.log.s.exitTs[this.index]; }
  get durationTotal() { return this.log.s.exitTs[this.index] - this.log.s.ts[this.index]; }
  get durationSelf() { return this.log.s.selfDur[this.index]; }
  get depth() { return this.log.s.depth[this.index]; }
  get text() { const l = this.log.s.label[this.index]; return l >= 0 ? this.log.str(l) : names[this.log.s.type[this.index]]; }
  get raw() { return decodeRange(this.log.s.src, this.log.s.start[this.index], this.log.s.end[this.index]); }
  get children() {
    if (this._children) return this._children;
    const s = this.log.s, out = [];
    for (let c = this.index + 1; c < s.subEnd[this.index]; c = s.subEnd[c]) if (!isExitType[s.type[c]]) out.push(this.log.node(c));
    return (this._children = out);
  }
}
````

### `bench.ts`

````ts
// Today's parser against prototypes v1 and v2, on what a consumer waits for. From the repo root:
//   node --expose-gc --max-old-space-size=8000 --import tsx bench/rewrite/bench.ts bench/rewrite/logs
import { readFileSync } from 'node:fs';
import { parse } from '../../src/index.js';
// @ts-expect-error plain JS module
import { scanV1 } from './scan-v1.mjs';
// @ts-expect-error plain JS module
import { LogView, NodeView, names, scanV2 } from './scan-v2.mjs';

const gc = (globalThis as { gc?: () => void }).gc;
if (!gc) throw new Error('run with node --expose-gc');
const dir = process.argv[2] ?? 'bench/rewrite/logs';

function bench(label: string, fn: () => unknown, runs = 5): void {
  fn(); fn();
  const times: number[] = []; let heap = 0; let keep: unknown;
  for (let r = 0; r < runs; r++) {
    keep = null; gc!();
    const b = process.memoryUsage(); const t = performance.now();
    keep = fn();
    times.push(performance.now() - t);
    gc!(); const a = process.memoryUsage();
    heap = a.heapUsed + a.arrayBuffers - (b.heapUsed + b.arrayBuffers);
  }
  void keep;
  times.sort((x, y) => x - y);
  console.log(label.padEnd(62), `${times[runs >> 1]!.toFixed(0)} ms`.padStart(9), `${(heap / 1e6).toFixed(0)} MB kept`.padStart(12));
}

// Every node's rect and label, as a flame chart built from today's tree would read them.
function walkToday(root: any): number {
  let sum = 0; const st = [root]; const dp = [0];
  while (st.length) { const n = st.pop(); const d = dp.pop()!; for (const c of n.children) { sum += c.timestamp + (c.exitStamp ?? c.timestamp) + c.duration.total + d + c.text.length; st.push(c); dp.push(d + 1); } }
  return sum;
}

for (const f of ['dev20.log', 'large100.log']) {
  const path = `${dir}/${f}`;
  const bytes = new Uint8Array(readFileSync(path));
  const str = readFileSync(path, 'utf8');
  const s0 = scanV2(bytes);
  console.log(`\n== ${f}: ${(bytes.length / 1e6).toFixed(0)} MB, ${s0.n} rows, ${s0.nStr} interned strings`);
  bench('TODAY parse(string)', () => parse(str), 3);
  bench('TODAY parse + walk every node (rect + label)', () => walkToday(parse(str)), 3);
  bench('TODAY read file as utf8 + parse (MCP path)', () => parse(readFileSync(path, 'utf8')), 3);
  bench('floor: indexOf line scan of the string', () => { let c = 0, p = 0; while ((p = str.indexOf('\n', p) + 1) > 0) c++; return c; });
  bench('floor: slice + split every line', () => { let c = 0, p = 0, q; while ((q = str.indexOf('\n', p)) >= 0) { c += str.slice(p, q).split('|').length; p = q + 1; } return c; });
  bench('decode: TextDecoder on the whole file', () => new TextDecoder().decode(bytes).length);
  bench('V1 scan(bytes)', () => scanV1(bytes));
  bench('V2 scan(bytes)', () => scanV2(bytes));
  bench('V2 scan + root total duration', () => { const s = scanV2(bytes); let t = 0; for (let i = 0; i < s.n; i++) if (s.parent[i] === -1 && s.exitTs[i]) t = Math.max(t, s.exitTs[i]); return t - s.ts[0]; });
  bench('V2 scan + flame chart from columns (rects)', () => { const s = scanV2(bytes); let sum = 0; for (let i = 0; i < s.n; i++) if (s.exitTs[i]) sum += s.ts[i] + s.exitTs[i] + s.depth[i] + s.type[i]; return sum; });
  bench('V2 scan + flame chart from columns + every label', () => { const s = scanV2(bytes); const v = new LogView(s); let sum = 0; for (let i = 0; i < s.n; i++) if (s.exitTs[i]) { sum += s.ts[i] + s.exitTs[i] + s.depth[i]; const l = s.label[i]; sum += l >= 0 ? v.str(l).length : names[s.type[i]].length; } return [sum, v]; });
  bench('V2 scan + node object for every row, walked + label', () => { const v = new LogView(scanV2(bytes)); let sum = 0; const st: any[] = []; for (let i = 0; i < v.s.n; i++) if (v.s.parent[i] === -1) st.push(v.node(i)); while (st.length) { const n = st.pop() as typeof NodeView.prototype; sum += n.timestamp + n.exitStamp + n.durationTotal + n.depth + n.text.length; for (const c of n.children) st.push(c); } return v; }, 3);
  bench('V2 scan + raw text of every row (worst-case decode)', () => { const v = new LogView(scanV2(bytes)); let sum = 0; for (let i = 0; i < v.s.n; i++) sum += v.node(i).raw.length; return sum; }, 3);
  bench('V2 read file as bytes + scan (MCP path)', () => scanV2(new Uint8Array(readFileSync(path))));
  const objs: unknown[] = []; for (let i = 0; i < s0.n; i++) objs.push({ type: s0.type[i], ts: s0.ts[i], exit: s0.exitTs[i], parent: s0.parent[i], line: s0.lineNo[i], soql: { self: 0, total: s0.cnt[i * 8] }, dml: { self: 0, total: s0.cnt[i * 8 + 1] }, dur: { self: s0.selfDur[i], total: s0.exitTs[i] - s0.ts[i] } });
  bench('structuredClone: a plain object per row', () => structuredClone(objs), 3);
  bench('structuredClone: the v2 columns', () => structuredClone([s0.type, s0.start, s0.end, s0.ts, s0.exitTs, s0.parent, s0.subEnd, s0.depth, s0.lineNo, s0.label, s0.ns, s0.selfDur, s0.cnt, s0.heap, s0.peak]), 3);
}
````

### `worker.mjs`

````js
import { parentPort } from 'node:worker_threads';
import { scanV2 } from './scan-v2.mjs';

parentPort.on('message', (bytes) => {
  const s = scanV2(bytes);
  const cols = [s.type, s.start, s.end, s.ts, s.exitTs, s.parent, s.subEnd, s.depth, s.lineNo, s.label, s.ns, s.selfDur, s.cnt, s.heap, s.peak];
  parentPort.postMessage({ n: s.n, cols, src: bytes }, [...new Set(cols.map((c) => c.buffer)), bytes.buffer]);
});
````

### `worker-bench.mjs`

````js
// A worker round trip: bytes transferred in, scanned, columns transferred back. A 1 ms timer
// records the worst main-thread gap. From the repo root:
//   node bench/rewrite/worker-bench.mjs bench/rewrite/logs
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';

const dir = process.argv[2] ?? 'bench/rewrite/logs';
const w = new Worker(new URL('./worker.mjs', import.meta.url));
for (const f of ['dev20.log', 'large100.log']) {
  const res = [];
  for (let r = 0; r < 7; r++) {
    const bytes = new Uint8Array(readFileSync(`${dir}/${f}`));
    let worst = 0, lastTick = performance.now();
    const iv = setInterval(() => { const now = performance.now(); worst = Math.max(worst, now - lastTick); lastTick = now; }, 1);
    const t = performance.now();
    const out = await new Promise((ok) => { w.once('message', ok); w.postMessage(bytes, [bytes.buffer]); });
    const total = performance.now() - t; clearInterval(iv);
    res.push([total, worst, out.n]);
  }
  res.sort((a, b) => a[0] - b[0]);
  const [total, worst, n] = res[3];
  console.log(`${f}: worker round trip ${total.toFixed(0)} ms, worst main-thread gap ${worst.toFixed(1)} ms, ${n} rows`);
}
await w.terminate();
````

### `monomorphism.mjs`

````js
// Field reads over 1M nodes of 60 types: per-type classes vs per-type prototypes vs one class vs a column.
//   node bench/rewrite/monomorphism.mjs
const N = 1_000_000, T = 60; // ~60 types in a realistic log; today has 175 classes
const typeOf = new Uint16Array(N); for (let i=0;i<N;i++) typeOf[i] = (i*7919) % T;
const lineNo = new Int32Array(N); for (let i=0;i<N;i++) lineNo[i] = i & 1023;

// (a) today-style: one class per type, own fields (megamorphic at shared sites)
const classes = []; for (let t=0;t<T;t++) classes.push(new Function('return class C'+t+' { constructor(i){ this.type='+t+'; this.extra'+t+'=0; this.lineNumber=i&1023; this.timestamp=i; } }')());
const a = []; for (let i=0;i<N;i++) a.push(new classes[typeOf[i]](i));

// (b) lazy views, one prototype per type with getters (polymorphic/megamorphic receiver maps)
const base = { get lineNumber(){ return lineNo[this.row]; } };
const protos = []; for (let t=0;t<T;t++) { const p = Object.create(base); Object.defineProperty(p,'f'+t,{get(){return this.row;}}); protos.push(p); }
const b = []; for (let i=0;i<N;i++) { const o = Object.create(protos[typeOf[i]]); o.row = i; b.push(o); }

// (c) lazy views, ONE class for every node; type-specific getters live on the same prototype
class NodeView { constructor(row){ this.row = row; } get type(){ return typeOf[this.row]; } get lineNumber(){ return lineNo[this.row]; } }
const c = []; for (let i=0;i<N;i++) c.push(new NodeView(i));

// (d) no objects: read the column
function run(label, fn) { for (let w=0;w<5;w++) fn(); const t=performance.now(); let s=0; for (let r=0;r<10;r++) s+=fn(); console.log(label.padEnd(58), ((performance.now()-t)/10).toFixed(2).padStart(7),'ms', s>0?'':'x'); }
run('(a) one class per type, read .lineNumber', () => { let s=0; for (let i=0;i<N;i++) s+=a[i].lineNumber; return s; });
run('(b) view, one prototype per type, read .lineNumber', () => { let s=0; for (let i=0;i<N;i++) s+=b[i].lineNumber; return s; });
run('(c) view, one class for all nodes, read .lineNumber', () => { let s=0; for (let i=0;i<N;i++) s+=c[i].lineNumber; return s; });
run('(d) column read lineNo[i]', () => { let s=0; for (let i=0;i<N;i++) s+=lineNo[i]; return s; });
````

### `types-sketch.ts`

````ts
// The typed API, as inference. Typechecks under strict + noUncheckedIndexedAccess, including the
// three expected-error lines at the end. The build should generate named interfaces instead.
//   pnpm exec tsc --ignoreConfig --noEmit --skipLibCheck --strict --noUncheckedIndexedAccess --target es2022 --module nodenext bench/rewrite/types-sketch.ts
// ---- field decoders: each says what TS type it yields ----
interface Field<T> { readonly kind: string; readonly at: number; readonly __t?: T }
const lineNo = (at: number): Field<number | 'EXTERNAL' | null> => ({ kind: 'lineNo', at });
const str = (at: number): Field<string | null> => ({ kind: 'str', at });
const int = (at: number): Field<number | null> => ({ kind: 'int', at });
const rest = (at: number): Field<string | null> => ({ kind: 'rest', at });

type Shape = 'leaf' | 'scope' | 'container';
interface Spec {
  readonly category: string;
  readonly level: string;
  readonly shape: Shape;
  readonly exit?: string;
  readonly children?: readonly string[];
  readonly fields: Readonly<Record<string, Field<unknown>>>;
}

// ---- the single source of truth (generated in part from data/*.json) ----
const events = {
  EXECUTION_STARTED: { category: 'EXECUTION', level: 'ERROR', shape: 'scope', exit: 'EXECUTION_FINISHED', fields: {} },
  CODE_UNIT_STARTED: { category: 'APEX_CODE', level: 'ERROR', shape: 'scope', exit: 'CODE_UNIT_FINISHED', fields: { name: str(4) } },
  METHOD_ENTRY: { category: 'APEX_CODE', level: 'FINE', shape: 'scope', exit: 'METHOD_EXIT', fields: { lineNumber: lineNo(2), classId: str(3), signature: rest(4) } },
  SOQL_EXECUTE_BEGIN: { category: 'DB', level: 'INFO', shape: 'container', exit: 'SOQL_EXECUTE_END', children: ['SOQL_EXECUTE_EXPLAIN'], fields: { lineNumber: lineNo(2), aggregations: int(3), query: rest(4) } },
  SOQL_EXECUTE_EXPLAIN: { category: 'DB', level: 'FINEST', shape: 'leaf', fields: { lineNumber: lineNo(2), plan: rest(3) } },
  DML_BEGIN: { category: 'DB', level: 'INFO', shape: 'container', exit: 'DML_END', children: [], fields: { lineNumber: lineNo(2), operation: str(3), objectType: str(4), rows: int(5) } },
  CUMULATIVE_LIMIT_USAGE: { category: 'APEX_PROFILING', level: 'INFO', shape: 'container', exit: 'CUMULATIVE_LIMIT_USAGE_END', children: ['LIMIT_USAGE_FOR_NS'], fields: {} },
  LIMIT_USAGE_FOR_NS: { category: 'APEX_PROFILING', level: 'FINEST', shape: 'leaf', fields: { namespace: str(2) } },
  USER_DEBUG: { category: 'APEX_CODE', level: 'DEBUG', shape: 'leaf', fields: { lineNumber: lineNo(2), level: str(3), message: rest(4) } },
  HEAP_ALLOCATE: { category: 'APEX_CODE', level: 'FINEST', shape: 'leaf', fields: { lineNumber: lineNo(2), bytes: int(3) } },
} as const satisfies Record<string, Spec>;

type Events = typeof events;
type EventType = keyof Events;
type FieldsOf<K extends EventType> = { readonly [F in keyof Events[K]['fields']]: Events[K]['fields'][F] extends Field<infer T> ? T : never };

// Containers list their children; scopes take anything; leaves take nothing.
type ChildTypeOf<K extends EventType> =
  Events[K]['shape'] extends 'leaf' ? never
  : Events[K] extends { readonly children: readonly (infer C)[] } ? C & EventType
  : EventType;

interface NodeBase<K extends EventType> {
  readonly type: K;
  readonly index: number;      // stable id (eventIndex)
  readonly timestamp: number;  // ns
  readonly duration: { readonly self: number; readonly total: number }; // ns
  readonly parent: AnyNode | null;
}
type ParentPart<K extends EventType> = [ChildTypeOf<K>] extends [never]
  ? { readonly hasChildren: false }
  : {
      readonly hasChildren: boolean;
      readonly children: readonly NodeOf<ChildTypeOf<K>>[];
      childrenOfType<C extends ChildTypeOf<K>>(type: C): readonly NodeOf<C>[];
    };
export type Node<K extends EventType> = NodeBase<K> & FieldsOf<K> & ParentPart<K>;
// distribute so NodeOf<'A'|'B'> is Node<'A'> | Node<'B'> — a discriminated union
type NodeOf<K extends EventType> = K extends EventType ? Node<K> : never;
export type AnyNode = NodeOf<EventType>;

type Visitor = { readonly [K in EventType]?: (node: Node<K>) => void | false };
interface ApexLog {
  ofType<K extends EventType>(type: K): readonly Node<K>[];
  visit(visitor: Visitor): void;
  readonly root: { readonly children: readonly AnyNode[] };
}
declare const log: ApexLog;
declare function is<K extends EventType>(node: AnyNode, type: K): node is Extract<AnyNode, { readonly type: K }>;

// ---- what consumers write: no casts anywhere ----
for (const q of log.ofType('SOQL_EXECUTE_BEGIN')) {
  const s: string | null = q.query;
  for (const c of q.children) { const plan: string | null = c.plan; void plan; } // children are only EXPLAIN
  void s;
}
log.visit({ DML_BEGIN: (d) => { const r: number | null = d.rows; void r; }, METHOD_ENTRY: (m) => void m.signature });
for (const n of log.root.children) {
  switch (n.type) {
    case 'USER_DEBUG': void n.message; break;          // narrowed
    case 'METHOD_ENTRY': for (const c of n.children) void c.type; break;
  }
  if (is(n, 'HEAP_ALLOCATE')) void n.bytes;
}
// @ts-expect-error a leaf has no children
log.ofType('USER_DEBUG')[0]!.children;
// @ts-expect-error DML_BEGIN takes no child of this type
log.ofType('DML_BEGIN')[0]!.childrenOfType('METHOD_ENTRY');
// @ts-expect-error field from another event
log.ofType('METHOD_ENTRY')[0]!.query;
````

### `scan-v3.mjs`

````js
// Prototype v2: closer to the proposal. Every line is a row (eventIndex kept); real exit,
// nextLineIsExit and acceptsText rules from type-table.json; wrapped lines; interned labels and
// namespaces; 8 counters, heap net and peak, self duration; per-type indexes; arrays sized once.
// Omits issues, limits, truncation, package merge and the per-event text rules.
import { readFileSync } from 'node:fs';

const table = JSON.parse(readFileSync(new URL('./type-table.json', import.meta.url), 'utf8'));
export const names = ['?', ...table.map((r) => r.name)];
const N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
export const isExitType = new Uint8Array(N);
const nextIsExit = new Uint8Array(N), accepts = new Uint8Array(N), hasExits = new Uint8Array(N);
const exitMatch = new Uint8Array(N * N);
table.forEach((r, i) => {
  const t = i + 1;
  isExitType[t] = r.isExit && !(r.exitTypes?.length) ? 1 : 0;
  nextIsExit[t] = r.nextLineIsExit ? 1 : 0; accepts[t] = r.acceptsText ? 1 : 0;
  for (const x of r.exitTypes ?? []) { exitMatch[t * N + idOf.get(x)] = 1; hasExits[t] = 1; }
});
// Which pipe field holds the label to intern, for the frequent frames.
const LABEL_FIELD = new Int8Array(N).fill(-1);
for (const [n, f] of [['METHOD_ENTRY', 4], ['METHOD_EXIT', 4], ['CONSTRUCTOR_ENTRY', 5], ['SYSTEM_METHOD_ENTRY', 3], ['CODE_UNIT_STARTED', 4], ['VF_APEX_CALL_START', 3]]) LABEL_FIELD[idOf.get(n)] = f;
const HB = 4096, hTab = new Int16Array(HB).fill(-1), nameHash = new Int32Array(N);
for (let i = 1; i < N; i++) {
  let h = 0; for (const ch of names[i]) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  nameHash[i] = h; let k = h & (HB - 1); while (hTab[k] !== -1) k = (k + 1) & (HB - 1); hTab[k] = i;
}
const SOQL = idOf.get('SOQL_EXECUTE_BEGIN'), DML = idOf.get('DML_BEGIN'), SOSL = idOf.get('SOSL_EXECUTE_BEGIN'),
  HEAP = idOf.get('HEAP_ALLOCATE'), THROWN = idOf.get('EXCEPTION_THROWN'), EXEC = idOf.get('EXECUTION_STARTED');
export const NC = 8; // soql, dml, sosl, soqlRows, dmlRows, soslRows, thrown, spare
const grow = (a, n) => { const b = new a.constructor(n); b.set(a); return b; };

export function scanV3(src, { methodStats = true, leaves = true } = {}) {
  const len = src.length;
  let cap = Math.max(1 << 12, Math.ceil(len / 90)), n = 0; // rows ~ bytes/115 in real logs: at most one grow
  let type = new Uint16Array(cap), start = new Uint32Array(cap), end = new Uint32Array(cap), ts = new Float64Array(cap),
    exitTs = new Float64Array(cap), parent = new Int32Array(cap), subEnd = new Uint32Array(cap), depth = new Uint16Array(cap),
    lineNo = new Int32Array(cap), label = new Int32Array(cap), ns = new Int32Array(cap), selfDur = new Float64Array(cap),
    exitStart = new Uint32Array(cap), cslot = new Int32Array(cap).fill(-1), heap = new Float64Array(cap), peak = new Float64Array(cap);
  let pCap = 1 << 10, nSlots = 0, pool = new Int32Array(pCap * NC);
  const slotOf = (e) => { let k = cslot[e]; if (k < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } k = cslot[e] = nSlots++; } return k; };
  let mCap = 1 << 12, mCalls = new Uint32Array(mCap), mSelf = new Float64Array(mCap), mTotal = new Float64Array(mCap), mActive = new Uint16Array(mCap);
  let sCap = 1 << 12, nStr = 0, strStart = new Uint32Array(sCap), strEnd = new Uint32Array(sCap), strHash = new Int32Array(sCap);
  let IB = 1 << 14, iTab = new Int32Array(IB).fill(-1);
  const intern = (a, b) => {
    let h = 0; for (let i = a; i < b; i++) h = (Math.imul(h, 31) + src[i]) | 0;
    let k = h & (IB - 1);
    for (let e; (e = iTab[k]) !== -1; k = (k + 1) & (IB - 1)) {
      if (strHash[e] === h && strEnd[e] - strStart[e] === b - a) { let j = strStart[e], i = a; while (i < b && src[i] === src[j]) { i++; j++; } if (i === b) return e; }
    }
    if (nStr === sCap) { sCap *= 2; strStart = grow(strStart, sCap); strEnd = grow(strEnd, sCap); strHash = grow(strHash, sCap); }
    strStart[nStr] = a; strEnd[nStr] = b; strHash[nStr] = h; iTab[k] = nStr;
    if (nStr * 2 > IB) { IB *= 2; iTab = new Int32Array(IB).fill(-1); for (let s = 0; s <= nStr; s++) { let kk = strHash[s] & (IB - 1); while (iTab[kk] !== -1) kk = (kk + 1) & (IB - 1); iTab[kk] = s; } }
    return nStr++;
  };
  const byTypeN = new Uint32Array(N), byType = Array.from({ length: N }, () => new Uint32Array(16));
  const stack = new Int32Array(8192); let sp = 0, last = -1, running = 0, pos = 0;
  const rollInto = (p, e) => { const ck = cslot[e]; if (ck >= 0) { const pk = slotOf(p) * NC, cb = ck * NC; for (let c = 0; c < NC; c++) pool[pk + c] += pool[cb + c]; } heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; };
  const close = (e, t, xs) => { exitTs[e] = t; exitStart[e] = xs; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; if (p >= 0) { selfDur[p] -= tot; rollInto(p, e); }
    if (methodStats) { const l = label[e]; if (l >= 0) { if (--mActive[l] === 0) mTotal[l] += tot; mSelf[l] += selfDur[e]; } } };
  while (pos < len) {
    let eol = src.indexOf(10, pos); if (eol < 0) eol = len;
    let lineEnd = eol; if (lineEnd > pos && src[lineEnd - 1] === 13) lineEnd--;
    if (src[pos + 2] === 58 && src[pos + 5] === 58) {
      let i = pos + 8; while (src[i] !== 40 && i < lineEnd) i++; i++;
      let t = 0, c = 0; while ((c = src[i]) !== 41) { t = t * 10 + (c - 48); i++; }
      i += 2; const t0 = i;
      let h = 0; while (i < lineEnd && (c = src[i]) !== 124) { h = (Math.imul(h, 31) + c) | 0; i++; }
      let k = h & (HB - 1), id = 0;
      for (let e; (e = hTab[k]) !== -1; k = (k + 1) & (HB - 1)) if (nameHash[e] === h) { id = e; break; }
      if (id === 0 && i === t0) { pos = eol + 1; continue; }
      if (n === cap) { cap *= 2; type = grow(type, cap); start = grow(start, cap); end = grow(end, cap); ts = grow(ts, cap); exitTs = grow(exitTs, cap); parent = grow(parent, cap); subEnd = grow(subEnd, cap); depth = grow(depth, cap); lineNo = grow(lineNo, cap); label = grow(label, cap); ns = grow(ns, cap); selfDur = grow(selfDur, cap); exitStart = grow(exitStart, cap); { const o = cslot; cslot = new Int32Array(cap).fill(-1); cslot.set(o); } heap = grow(heap, cap); peak = grow(peak, cap); }
      if (isExitType[id]) {
        if (last >= 0 && nextIsExit[type[last]] && exitTs[last] === 0) exitTs[last] = t;
        let m = sp - 1; while (m >= 0 && !exitMatch[type[stack[m]] * N + id]) m--;
        if (m >= 0) while (sp > m) close(stack[--sp], t, pos);
        // an unmatched exit would be recorded as an Unexpected-Exit issue here
        last = -1; pos = eol + 1; continue;
      }
      if (!leaves && !hasExits[id] && sp) {
        // Projection: a leaf adds to the open frame's totals but gets no row of its own.
        const p = stack[sp - 1];
        if (id === SOQL) pool[slotOf(p) * NC]++; else if (id === DML) pool[slotOf(p) * NC + 1]++; else if (id === SOSL) pool[slotOf(p) * NC + 2]++; else if (id === THROWN) pool[slotOf(p) * NC + 6]++;
        else if (id === HEAP) { let j = lineEnd - 1; while (j > i && src[j] !== 58) j--; let b = 0, neg = false; j++; if (src[j] === 45) { neg = true; j++; } while (j < lineEnd && (c = src[j]) >= 48 && c <= 57) { b = b * 10 + (c - 48); j++; } if (neg) b = -b; heap[p] += b; running = Math.max(0, running + b); if (running > peak[p]) peak[p] = running; }
        last = -1; pos = eol + 1; continue;
      }
      const e = n++;
      type[e] = id; start[e] = pos; end[e] = lineEnd; ts[e] = t; label[e] = -1; ns[e] = -1;
      let ln = -2; // -2 null, -1 EXTERNAL
      if (src[i] === 124 && src[i + 1] === 91) { let j = i + 2; ln = 0; while ((c = src[j]) >= 48 && c <= 57) { ln = ln * 10 + (c - 48); j++; } if (c !== 93) ln = -1; }
      lineNo[e] = ln;
      const lf = LABEL_FIELD[id];
      if (lf > 0) {
        let f = 2, a = i; while (f < lf && a < lineEnd) { a++; while (a < lineEnd && src[a] !== 124) a++; f++; }
        a++; let b = a; while (b < lineEnd && src[b] !== 124) b++;
        if (a < b) { label[e] = intern(a, b); let d = a; while (d < b && src[d] !== 46) d++; if (d < b) ns[e] = intern(a, d); }
      }
      if (byTypeN[id] === byType[id].length) byType[id] = grow(byType[id], byType[id].length * 2);
      byType[id][byTypeN[id]++] = e;
      if (id === SOQL) pool[slotOf(e) * NC] = 1; else if (id === DML) pool[slotOf(e) * NC + 1] = 1; else if (id === SOSL) pool[slotOf(e) * NC + 2] = 1; else if (id === THROWN) pool[slotOf(e) * NC + 6] = 1;
      else if (id === HEAP) { let j = lineEnd - 1; while (j > i && src[j] !== 58) j--; let b = 0, neg = false; j++; if (src[j] === 45) { neg = true; j++; } while (j < lineEnd && (c = src[j]) >= 48 && c <= 57) { b = b * 10 + (c - 48); j++; } if (neg) b = -b; heap[e] = b; running = Math.max(0, running + b); peak[e] = running; }
      if (last >= 0 && nextIsExit[type[last]] && exitTs[last] === 0) exitTs[last] = t;
      {
        if (id === EXEC) while (sp) close(stack[--sp], t, pos);
        const p = sp ? stack[sp - 1] : -1; parent[e] = p; depth[e] = sp; subEnd[e] = e + 1;
        if (hasExits[id]) { stack[sp++] = e; if (methodStats) { const l = label[e]; if (l >= 0) { if (l >= mCap) { const o = mCap; mCap = Math.max(mCap * 2, l + 1); mCalls = grow(mCalls, mCap); mSelf = grow(mSelf, mCap); mTotal = grow(mTotal, mCap); mActive = grow(mActive, mCap); } mCalls[l]++; mActive[l]++; } } } else if (p >= 0) rollInto(p, e);
      }
      last = e;
    } else if (last >= 0 && accepts[type[last]]) {
      end[last] = lineEnd; // wrapped text extends the previous row
    }
    pos = eol + 1;
  }
  while (sp) close(stack[--sp], n ? ts[n - 1] : 0, len);
  return { n, src, type, start, end, ts, exitTs, exitStart, parent, subEnd, depth, lineNo, label, ns, selfDur, cslot, pool, nSlots, heap, peak, mCalls, mSelf, mTotal, strStart, strEnd, nStr, byType, byTypeN };
}

const dec = new TextDecoder();
function decodeRange(src, a, b) {
  if (b - a < 64) { let ascii = true; for (let i = a; i < b; i++) if (src[i] > 127) { ascii = false; break; } if (ascii) return String.fromCharCode.apply(null, src.subarray(a, b)); }
  return dec.decode(src.subarray(a, b));
}
/** Lazy views: one class for every node, cached by row so === holds. */
export class LogView {
  constructor(s) { this.s = s; this.strCache = []; this.nodes = []; }
  str(id) { return (this.strCache[id] ??= decodeRange(this.s.src, this.s.strStart[id], this.s.strEnd[id])); }
  node(i) { return (this.nodes[i] ??= new NodeView(this, i)); }
}
export class NodeView {
  constructor(log, index) { this.log = log; this.index = index; this._children = undefined; }
  get type() { return names[this.log.s.type[this.index]]; }
  get timestamp() { return this.log.s.ts[this.index]; }
  get exitStamp() { return this.log.s.exitTs[this.index]; }
  get durationTotal() { return this.log.s.exitTs[this.index] - this.log.s.ts[this.index]; }
  get durationSelf() { return this.log.s.selfDur[this.index]; }
  get depth() { return this.log.s.depth[this.index]; }
  get text() { const l = this.log.s.label[this.index]; return l >= 0 ? this.log.str(l) : names[this.log.s.type[this.index]]; }
  get raw() { return decodeRange(this.log.s.src, this.log.s.start[this.index], this.log.s.end[this.index]); }
  get children() {
    if (this._children) return this._children;
    const s = this.log.s, out = [];
    for (let c = this.index + 1; c < s.subEnd[this.index]; c = s.subEnd[c]) if (!isExitType[s.type[c]]) out.push(this.log.node(c));
    return (this._children = out);
  }
}
````

### `shape.mjs`

````js
import { readFileSync } from 'node:fs';
import { scanV2, names, isExitType, NC } from './scan-v2.mjs';
for (const f of ['dev20.log', 'large100.log']) {
  const s = scanV2(new Uint8Array(readFileSync(process.argv[2] + '/' + f)));
  let exits = 0, frames = 0, leaves = 0, framesAnyCount = 0, framesAnyHeap = 0, maxDepth = 0;
  const byType = new Map();
  for (let i = 0; i < s.n; i++) {
    const t = s.type[i];
    if (isExitType[t]) { exits++; continue; }
    const isFrame = s.subEnd[i] > i + 1 || s.exitTs[i] > 0;
    if (isFrame) { frames++; let any = false; for (let c = 0; c < NC; c++) if (s.cnt[i * NC + c]) any = true; if (any) framesAnyCount++; if (s.heap[i] || s.peak[i]) framesAnyHeap++; }
    else { leaves++; byType.set(names[t], (byType.get(names[t]) ?? 0) + 1); }
    if (s.depth[i] > maxDepth) maxDepth = s.depth[i];
  }
  const pct = (x) => (100 * x / s.n).toFixed(1) + '%';
  console.log(`== ${f}: rows ${s.n}; exits ${exits} (${pct(exits)}); frames ${frames} (${pct(frames)}); leaves ${leaves} (${pct(leaves)}); maxDepth ${maxDepth}`);
  console.log(`   frames with any non-zero count ${(100*framesAnyCount/frames).toFixed(1)}%, with heap ${(100*framesAnyHeap/frames).toFixed(1)}%`);
  console.log('   top leaves', [...byType].sort((a,b)=>b[1]-a[1]).slice(0,6).map(([k,v])=>k+' '+(100*v/s.n).toFixed(1)+'%').join(', '));
}
````

### `v3bench.mjs`

````js
import { readFileSync } from 'node:fs';
import { scanV2 } from './scan-v2.mjs';
import { scanV3 } from './scan-v3.mjs';
const bytesOf = (o) => Object.values(o).reduce((sum, v) => sum + (ArrayBuffer.isView(v) && v !== o.src ? v.byteLength : Array.isArray(v) ? v.reduce((a, x) => a + (x?.byteLength ?? 0), 0) : 0), 0);
// Trim each column to n rows, as a finished store would, so sizes compare like for like.
const trimmed = (o) => { let t = 0; for (const [k, v] of Object.entries(o)) { if (!ArrayBuffer.isView(v) || k === 'src') continue; const per = k === 'pool' ? 8 * 4 : v.BYTES_PER_ELEMENT * (k === 'cnt' ? 8 : 1); const rows = k === 'pool' ? o.nSlots : k.startsWith('m') || k.startsWith('str') ? v.length : o.n; t += Math.min(v.byteLength, rows * per); } return t; };
function time(fn, runs = 7) { fn(); fn(); const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[runs >> 1]; }
for (const f of ['dev20.log', 'large100.log']) {
  const b = new Uint8Array(readFileSync(process.argv[2] + '/' + f));
  const v2 = scanV2(b), v3 = scanV3(b), v3f = scanV3(b, { leaves: false }), v3n = scanV3(b, { methodStats: false });
  console.log(`== ${f}`);
  console.log(`v2  every line a row       ${time(() => scanV2(b)).toFixed(0).padStart(5)} ms  rows ${String(v2.n).padStart(7)}  columns ${(trimmed(v2) / 1e6).toFixed(1)} MB`);
  console.log(`v3  exits folded, sparse   ${time(() => scanV3(b, { methodStats: false })).toFixed(0).padStart(5)} ms  rows ${String(v3n.n).padStart(7)}  columns ${(trimmed(v3n) / 1e6).toFixed(1)} MB  count slots ${v3n.nSlots}`);
  console.log(`v3  + method stats         ${time(() => scanV3(b)).toFixed(0).padStart(5)} ms`);
  console.log(`v3  frames only (projection) ${time(() => scanV3(b, { leaves: false })).toFixed(0).padStart(3)} ms  rows ${String(v3f.n).padStart(7)}  columns ${(trimmed(v3f) / 1e6).toFixed(1)} MB`);
  // checks: v3 frame totals agree with v2 at the root frames
  const rootsV2 = [], rootsV3 = [];
  for (let i = 0; i < v2.n; i++) if (v2.parent[i] === -1 && v2.exitTs[i]) rootsV2.push(v2.exitTs[i] - v2.ts[i]);
  for (let i = 0; i < v3.n; i++) if (v3.parent[i] === -1 && v3.exitTs[i]) rootsV3.push(v3.exitTs[i] - v3.ts[i]);
  const heapV2 = v2.heap.slice(0, v2.n).reduce((a, x, i) => a + (v2.parent[i] === -1 ? x : 0), 0), heapV3 = v3f.heap.slice(0, v3f.n).reduce((a, x, i) => a + (v3f.parent[i] === -1 ? x : 0), 0);
  console.log(`check: root durations equal ${JSON.stringify(rootsV2) === JSON.stringify(rootsV3)}; root heap v2 ${heapV2} vs frames-only ${heapV3}`);
  const top = [...v3.mCalls.keys()].filter((l) => v3.mCalls[l]).sort((a, b) => v3.mSelf[b] - v3.mSelf[a]).slice(0, 3);
  const dec = new TextDecoder();
  console.log('top methods by self time:', top.map((l) => `${dec.decode(b.subarray(v3.strStart[l], v3.strEnd[l])).slice(0, 40)} calls=${v3.mCalls[l]} self=${(v3.mSelf[l] / 1e6).toFixed(0)}ms total=${(v3.mTotal[l] / 1e6).toFixed(0)}ms`).join(' | '));
}
````

### `shape2.mjs`

````js
// How much would per-statement SOQL/DML aggregation and a no-store streaming visitor cost or save?
import { readFileSync } from 'node:fs';
import { scanV1 } from './scan-v1.mjs';
import { scanV3 } from './scan-v3.mjs';
function time(fn, runs = 7) { fn(); fn(); const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[runs >> 1]; }
for (const f of ['large100.log']) {
  const b = new Uint8Array(readFileSync(process.argv[2] + '/' + f));
  // A visitor with no store: count SOQL lines and sum their row counts, the shape of an MCP one-shot query.
  const visitorOnly = () => { let n = 0, pos = 0; const pat = new TextEncoder().encode('|SOQL_EXECUTE_BEGIN|'); const len = b.length;
    while (pos < len) { let eol = b.indexOf(10, pos); if (eol < 0) eol = len; let i = pos; while (i < eol && b[i] !== 124) i++; let ok = true; for (let j = 0; j < pat.length; j++) if (b[i + j] !== pat[j]) { ok = false; break; } if (ok) n++; pos = eol + 1; } return n; };
  console.log('streaming visitor, no store (find SOQL lines):', time(visitorOnly).toFixed(0), 'ms');
  console.log('v1 floor scan with tree:', time(() => scanV1(b)).toFixed(0), 'ms');
  console.log('v3 full scan:', time(() => scanV3(b)).toFixed(0), 'ms');
}
````

### `timeline.ts`

````ts
// Parse, then build what a timeline needs: one rect per frame (start, duration, depth, label),
// grouped by depth, sorted by start. Today's tree vs v3 node objects vs v3 columns.
import { readFileSync } from 'node:fs';
import { parse } from '../../src/index.js';
// @ts-expect-error plain JS
import { scanV3 } from './scan-v3.mjs';
// @ts-expect-error plain JS
import { LogView } from './scan-v2.mjs';

const gc = (globalThis as { gc?: () => void }).gc!;
function bench(label: string, fn: () => unknown, runs = 5) {
  fn(); fn(); const ts: number[] = []; let heap = 0, keep: unknown;
  for (let r = 0; r < runs; r++) { keep = null; gc(); const b = process.memoryUsage(); const t = performance.now(); keep = fn(); ts.push(performance.now() - t); gc(); const a = process.memoryUsage(); heap = a.heapUsed + a.arrayBuffers - b.heapUsed - b.arrayBuffers; }
  void keep; ts.sort((x, y) => x - y);
  console.log(label.padEnd(60), `${ts[runs >> 1]!.toFixed(2)} ms`.padStart(8), `${(heap / 1e6).toFixed(0)} MB`.padStart(8));
}

// Today: walk the LogEvent tree and build rect objects per depth, as a UI does.
function timelineFromTree(root: any) {
  const byDepth: { x: number; w: number; label: string; event: unknown }[][] = [];
  const st: any[] = [root], dp: number[] = [-1];
  while (st.length) {
    const n = st.pop(); const d = dp.pop()!;
    if (d >= 0 && n.duration.total > 0) (byDepth[d] ??= []).push({ x: n.timestamp, w: n.duration.total, label: n.text, event: n });
    for (let i = n.children.length - 1; i >= 0; i--) { st.push(n.children[i]); dp.push(d + 1); }
  }
  return byDepth;
}
// v3 node objects: the same, through lazy views (one class).
function timelineFromViews(v: any) {
  const s = v.s; const byDepth: { x: number; w: number; label: string; event: unknown }[][] = [];
  for (let i = 0; i < s.n; i++) if (s.exitTs[i] > 0) { const n = v.node(i); (byDepth[n.depth] ??= []).push({ x: n.timestamp, w: n.durationTotal, label: n.text, event: n }); }
  return byDepth;
}
// v3 columns: per-depth typed arrays of row ids; rects are read straight from the columns when drawn.
function timelineFromColumns(s: any) {
  const counts = new Uint32Array(64);
  for (let i = 0; i < s.n; i++) if (s.exitTs[i] > 0) counts[s.depth[i]]++;
  const byDepth = Array.from(counts, (c) => new Uint32Array(c)); const fill = new Uint32Array(64);
  for (let i = 0; i < s.n; i++) if (s.exitTs[i] > 0) { const d = s.depth[i]; byDepth[d]![fill[d]!++] = i; } // already sorted: rows are in time order
  return byDepth;
}
// Drawing one screen: the visible window is 1% of the log; find rects by binary search, read label ids.
function drawWindowColumns(s: any, byDepth: Uint32Array[], from: number, to: number) {
  let drawn = 0;
  for (const rows of byDepth) {
    let lo = 0, hi = rows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (s.exitTs[rows[m]!] < from) lo = m + 1; else hi = m; }
    for (let k = lo; k < rows.length && s.ts[rows[k]!] <= to; k++) { const r = rows[k]!; drawn += s.exitTs[r] - s.ts[r] > 0 ? 1 : 0; }
  }
  return drawn;
}
function drawWindowTree(byDepth: { x: number; w: number }[][], from: number, to: number) {
  let drawn = 0;
  for (const rects of byDepth) for (const r of rects ?? []) if (r.x + r.w >= from && r.x <= to) drawn++;
  return drawn;
}

for (const f of ['dev20.log', 'large100.log']) {
  const path = `${process.argv[2]}/${f}`, str = readFileSync(path, 'utf8'), bytes = new Uint8Array(readFileSync(path));
  console.log(`\n== ${f}`);
  bench('TODAY parse', () => parse(str), 3);
  bench('TODAY parse + timeline from tree (rect objects)', () => timelineFromTree(parse(str)), 3);
  bench('V3 scan', () => scanV3(bytes));
  bench('V3 scan + timeline from node objects (rect objects)', () => timelineFromViews(new LogView(scanV3(bytes))), 3);
  bench('V3 scan + timeline from columns (per-depth row arrays)', () => timelineFromColumns(scanV3(bytes)));
  // One redraw (pan/zoom) on an already-built timeline.
  const tree = timelineFromTree(parse(str)); const s = scanV3(bytes); const cols = timelineFromColumns(s);
  let t0 = Infinity, t1 = 0; for (let i = 0; i < s.n; i++) { if (s.ts[i] < t0) t0 = s.ts[i]; if (s.exitTs[i] > t1) t1 = s.exitTs[i]; }
  const from = t0 + (t1 - t0) * 0.5, to = from + (t1 - t0) * 0.01;
  bench('one redraw, 1% window: scan all rect objects (today-style)', () => drawWindowTree(tree, from, to), 20);
  bench('one redraw, 1% window: binary search on columns', () => drawWindowColumns(s, cols, from, to), 20);
}
````

### Raw output of the final `bench.ts` run

````text

== dev20.log: 20 MB, 206573 rows, 32 interned strings
TODAY parse(string)                                               768 ms  259 MB kept
TODAY parse + walk every node (rect + label)                      786 ms   -0 MB kept
TODAY read file as utf8 + parse (MCP path)                        873 ms  259 MB kept
floor: indexOf line scan of the string                              6 ms    0 MB kept
floor: slice + split every line                                    43 ms   -0 MB kept
decode: TextDecoder on the whole file                              13 ms   -0 MB kept
V1 scan(bytes)                                                     38 ms   14 MB kept
V2 scan(bytes)                                                     68 ms   24 MB kept
V2 scan + root total duration                                      74 ms    1 MB kept
V2 scan + flame chart from columns (rects)                         84 ms    0 MB kept
V2 scan + flame chart from columns + every label                   85 ms   24 MB kept
V2 scan + node object for every row, walked + label               126 ms   44 MB kept
V2 scan + raw text of every row (worst-case decode)               179 ms   -0 MB kept
V2 read file as bytes + scan (MCP path)                           119 ms   45 MB kept
structuredClone: a plain object per row                           699 ms   78 MB kept
structuredClone: the v2 columns                                    46 ms   23 MB kept

== large100.log: 100 MB, 868903 rows, 31 interned strings
TODAY parse(string)                                              2738 ms 1100 MB kept
TODAY parse + walk every node (rect + label)                     2999 ms   -0 MB kept
TODAY read file as utf8 + parse (MCP path)                       3477 ms 1100 MB kept
floor: indexOf line scan of the string                             25 ms   -0 MB kept
floor: slice + split every line                                   185 ms   -0 MB kept
decode: TextDecoder on the whole file                              71 ms   -0 MB kept
V1 scan(bytes)                                                    123 ms   28 MB kept
V2 scan(bytes)                                                    373 ms   68 MB kept
V2 scan + root total duration                                     396 ms  115 MB kept
V2 scan + flame chart from columns (rects)                        386 ms   99 MB kept
V2 scan + flame chart from columns + every label                  418 ms   53 MB kept
V2 scan + node object for every row, walked + label               578 ms  186 MB kept
V2 scan + raw text of every row (worst-case decode)               707 ms   14 MB kept
V2 read file as bytes + scan (MCP path)                           531 ms   23 MB kept
structuredClone: a plain object per row                          4989 ms  368 MB kept
structuredClone: the v2 columns                                   643 ms  116 MB kept
````

### Raw output of `shape.mjs`, `v3bench.mjs` and `shape2.mjs`

````text
== dev20.log: rows 206573; exits 61984 (30.0%); frames 62150 (30.1%); leaves 82439 (39.9%); maxDepth 25
   frames with any non-zero count 3.1%, with heap 38.9%
   top leaves STATEMENT_EXECUTE 11.2%, HEAP_ALLOCATE 10.5%, VARIABLE_ASSIGNMENT 6.1%, ENTERING_MANAGED_PKG 3.9%, SYSTEM_MODE_ENTER 3.1%, VARIABLE_SCOPE_BEGIN 2.4%
== large100.log: rows 868903; exits 358443 (41.3%); frames 358457 (41.3%); leaves 152003 (17.5%); maxDepth 37
   frames with any non-zero count 0.6%, with heap 26.7%
   top leaves STATEMENT_EXECUTE 9.6%, HEAP_ALLOCATE 4.8%, VARIABLE_ASSIGNMENT 1.5%, VARIABLE_SCOPE_BEGIN 1.0%, USER_DEBUG 0.2%, SYSTEM_MODE_EXIT 0.2%
== dev20.log
v2  every line a row          66 ms  rows  206573  columns 21.5 MB
v3  exits folded, sparse      46 ms  rows  144589  columns 11.7 MB  count slots 2059
v3  + method stats            50 ms
v3  frames only (projection)  45 ms  rows   62151  columns 5.1 MB
check: root durations equal true; root heap v2 5574690 vs frames-only 5574690
top methods by self time: MyAccountsSelector.selectByIdWithContact calls=5793 self=4099ms total=24501ms | ns.MyAccountService.calculateRollupTotal calls=5801 self=4052ms total=25909ms | MyClass.getDefaultCurrencyIsoCode() calls=5759 self=3984ms total=25214ms
== large100.log
v2  every line a row         385 ms  rows  868903  columns 90.4 MB
v3  exits folded, sparse     240 ms  rows  510460  columns 41.0 MB  count slots 2256
v3  + method stats           253 ms
v3  frames only (projection) 248 ms  rows  358458  columns 28.9 MB
check: root durations equal true; root heap v2 10682183 vs frames-only 10682183
top methods by self time: ns.MyInvoiceService.postInvoicesAndUpdat calls=37890 self=18220ms total=128231ms | MyTriggerHandler.beforeUpdate(Map<Id,SOb calls=37718 self=18158ms total=127411ms | MyClass.getDefaultCurrencyIsoCode() calls=37714 self=18152ms total=129001ms
streaming visitor, no store (find SOQL lines): 104 ms
v1 floor scan with tree: 134 ms
v3 full scan: 291 ms
````

### Raw output of `timeline.ts`

````text

== dev20.log
TODAY parse                                                  745.04 ms   259 MB
TODAY parse + timeline from tree (rect objects)              833.51 ms   266 MB
V3 scan                                                      75.65 ms    19 MB
V3 scan + timeline from node objects (rect objects)          98.06 ms    30 MB
V3 scan + timeline from columns (per-depth row arrays)       54.92 ms     0 MB
one redraw, 1% window: scan all rect objects (today-style)    1.06 ms     0 MB
one redraw, 1% window: binary search on columns               0.05 ms     0 MB

== large100.log
TODAY parse                                                  2942.76 ms  1100 MB
TODAY parse + timeline from tree (rect objects)              3190.13 ms  1135 MB
V3 scan                                                      340.97 ms    56 MB
V3 scan + timeline from node objects (rect objects)          386.41 ms   150 MB
V3 scan + timeline from columns (per-depth row arrays)       285.67 ms    46 MB
one redraw, 1% window: scan all rect objects (today-style)    6.22 ms     0 MB
one redraw, 1% window: binary search on columns               0.09 ms     0 MB
````
