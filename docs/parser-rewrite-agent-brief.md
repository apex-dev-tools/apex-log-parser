# Agent brief: rewrite `@apexdevtools/apex-log-parser` for speed, memory and types

This file is self-contained. It gives you the context, the measurements, the design, the
feature-parity checklist, the build plan, and every script needed to reproduce the
measurements. You can work from this file and a checkout of the repo alone.

- **Repo:** `apex-dev-tools/apex-log-parser`. At the time of writing, `main` was `77416e7`
  (version 0.2.0).
- **Research branch:** `claude/parser-perf-rewrite-research-lwnhlz`. It holds
  `docs/parser-rewrite-proposal.md`, a short summary of this brief.
- **Written:** 2026-10-04 to 2026-10-06, from a cloud session that read the code, prototyped and
  measured. Every number here comes from scripts in §B, run in that session.

## At a glance

- **The problem.** `parse()` takes ~0.75–1.06 s and keeps 190–259 MB for a 20 MB log, the
  Salesforce cap. At 100 MB it takes ~2.7–4.8 s and keeps 0.8–1.1 GB. It runs on the caller's
  thread, so the analyzer's webview freezes. The cost is allocation, not reading text: 13+ objects
  per event, and GC is over a fifth of the parse.
- **The design.** The fastest parsers and trace tools converge on this shape:
  - a scanner with no per-line allocation, over a string or bytes, whichever the caller has;
  - columnar typed arrays, with parents before children and a subtree-end pointer;
  - interned strings, and sparse side tables for counts and exit details;
  - exits folded into their entries;
  - one node class, created on demand;
  - type metadata looked up by type;
  - generated, cast-free types;
  - a worker, with the arrays transferred rather than copied;
  - a `compat` adapter that rebuilds today's tree.
- **The numbers** (§3.7–3.9):

  | | 20 MB | 100 MB |
  | --- | --- | --- |
  | JS core | 43 ms warm, 158–169 ms cold (today ~0.9 s) | 200–300 ms (today ~3 s) |
  | Optional WASM SIMD core | 23–27 ms | 102–140 ms |

  Tree memory falls ~15–25×. Each timeline redraw falls 6 ms → 0.09 ms. A worker never blocks
  the UI for more than ~4 ms.
- **The recommendation** (§0.2):
  - ship the JS core as a parallel, switchable engine;
  - add the WASM core only if real-log profiles still show the parse as the main wait;
  - backport the shared-arrays patch to today's parser now, and the shared-zero-counters patch if
    nobody writes to leaf counters (§0.3).
- **What decides it.** The go/no-go spike on the private corpus (§0.1). Everything here is
  synthetic until then.

## Decision log

Decisions made with the maintainer during the research, newest last. Where a later decision
changed an earlier one, the brief follows the later one.

| # | Decision | Where |
| --- | --- | --- |
| 1 | Full rewrite allowed. Same information, any architecture: async, streams, lazy, workers, WASM. | §1 |
| 2 | Cast-free types, with child types limited per parent. Enforce containers only where the corpus shows them closed; start with leaf vs frame. | §5.4, §0.1 |
| 3 | Monomorphism matters: one runtime node class; per-type variety only in TypeScript. | §3.3, §5.5 |
| 4 | Event ids exist because timestamps collide. They must be unique, stable and deterministic per parse; they need not equal today's numbers. | §5.2, §7 #8 |
| 5 | Exits are not stored. Read only type, timestamp, line number, SOQL/SOSL rows and the class-reference namespace. Unmatched exits and the dual `WF_*` types keep rows. | §5.2 |
| 6 | Exit details become typed fields on the entry (`node.exit`). | §5.2.1 |
| 7 | Category, level and the other type properties are looked up by type, never stored per event. | §5.2.2 |
| 8 | Separate the returned data model (public) from the parsing grammar (internal), linked by the compiler. | §5.12 |
| 9 | Ship the new engine in parallel and switchable: `engine: 'next'` returns today's shape, `engine: 'shadow'` compares both, and `/next` is the new API. | §5.13 |
| 10 | Architecture reviewed against Perfetto, the Firefox Profiler, simdjson, oxc, Lezer, the DevTools trace engine and Arrow, and measured: struct-of-arrays, prefix order, interning and one class all confirmed. | §3.6 |
| 11 | Build the JS core first and ship it. WASM SIMD (~2–3× faster) is optional, behind a real-log trigger. | §0.2, §5.10 |
| 12 | Strings vs bytes depends on the platform and the input source (a maintainer measured strings faster locally). Scan what the caller has, never convert just to scan, and never use `TextEncoder` in Chromium on the hot path. | §3.9 |
| 13 | Backports: shared arrays now (safe); shared frozen zero counters if no consumer writes to leaf counters. | §0.3 |

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
  visitor and append parsing until after 1.0. **The WASM SIMD core is optional** (Phase 2b, §0.2):
  add it only if real-log profiles show the JS core's parse is still the main wait. §3.6 measured
  it at ~2–3× warm, and §3.8 at ~1.5–2× cold.

### 0.2 Which implementation to build: recommendation

The options, with numbers from the consolidated run in §3.8:

| Option | 20 MB warm / cold | 100 MB warm / cold | Cost |
| --- | --- | --- | --- |
| A. Today plus #107 and #109 | ~1.0 s / ~1.0 s (–28% at best) | ~3–5 s | none, and already done |
| **B. JS core** (v5 design) | **43 ms / 158–169 ms** | **215 ms / 409–449 ms** | one language, one implementation |
| C. WASM SIMD core | 24 ms / 75–118 ms | 102 ms / 315–320 ms | a C/Rust toolchain, a CSP change, every hot rule written twice |
| D. B, then C | as C where WASM runs, B elsewhere | as C | as C, plus a differential test |

**Recommendation: build B, the JS core, and make it the shipping engine. Keep C as a measured,
optional Phase 2b, not a commitment.**

**Why B:**

- **B delivers the change users feel.** It is ~20× warm and ~6× cold against today at 20 MB.
  At the 20 MB log cap, the gap between B and C is ~20 ms warm and ~50–90 ms on a cold first
  open. Users will not notice that next to today's 1 s.
- **Most of the UI win comes from the architecture, not the core's language:**
  - the worker never blocks the main thread for more than ~4 ms;
  - a timeline built from the columns adds ~0 ms;
  - each redraw is 70× cheaper;
  - caching with `toBuffers` makes a reopen ~0 ms.

  B gets all of it.
- **One implementation of the subtle tree rules.** Parity with today rests on the corpus digest,
  and two cores double the places a rule can drift. B is also easier to debug and profile, and to
  contribute to.
- **C has costs that only pay off for large logs:**
  - its win grows with size (~100–250 ms at 100 MB), which only matters for MCP's large logs;
  - MCP can avoid most reparsing with the `toBuffers` cache anyway;
  - on tiny logs C is slower cold, because it compiles first (10 ms against 7 ms).

**When to add C:**

- Only if, after B ships, a profile on real logs shows the parse is still the main wait: for
  example, MCP regularly parsing logs over 50 MB, or webview cold parses over ~150 ms.
- Keep the column layout as the ABI, so C drops in behind the same store with no API change.
- The JS core then stays the fallback and the oracle.

**Which input path B uses** (§3.9):

- **MCP, and Node in general:** read bytes, and scan with `Buffer.indexOf`.
- **The analyzer:** the extension host transfers bytes to the webview's parser worker, which
  scans them with SWAR. If only text is available, the string loop.
- **Never convert just to scan.** Chromium's `TextEncoder` costs ~1 s per 100 MB.

**How to cut B's cold time** (the gap to C is mostly the first, unoptimised run):

- Spawn the parser worker when the extension activates, not on first open.
- Run a small warm-up parse in it while idle, so V8 has optimised the scanner before the first
  real log arrives.
- Measure this in the Phase 2 gate.

### 0.3 What can be backported to today's parser, and is it worth it?

**The most impactful changes in the new design,** ranked by measured contribution:

| # | Change | Measured effect | Backportable without breaking the API? |
| --- | --- | --- | --- |
| 1 | **No object per event:** columns plus lazy views | Today ~930 B per event; the JS core ~80 B per row. Parse 10–15× faster: allocation and GC were the cost, not scanning (§3.2). | No. This is the redesign itself. |
| 2 | **Columns drive the timeline,** with a per-depth render index | Building the timeline +245 ms → ~0; each redraw 6.2 ms → 0.09 ms (§3.5) | **Partly, on the consumer side.** The analyzer can build per-depth typed arrays from today's tree once, which costs a walk, and get the ~70× redraw win now. |
| 3 | **Worker plus transfer** | The main thread is never blocked for more than 4 ms | No for the analyzer: today's tree costs ~3 s to clone. **Yes for MCP:** parse in a worker thread and keep the tree there, answering tool queries in the worker, so nothing is cloned. |
| 4 | **Fold exits into entries** | 30–41% fewer rows; with sparse counts, store 2.2× smaller | No: exits take `eventIndex` today. **Shared zero counters (row 6) remove most of the exits' memory anyway.** |
| 5 | **Bytes instead of `split`, interning** | `split` alone is ~6% of today's parse | Not worth it: every one of 175 constructors indexes `parts`. |
| 6 | **Sparse counters, and type-level constants not stored per event** | 0.6–3% of frames have a count | **Yes, measured below.** |
| 7 | **Caching** (`toBuffers`) | A reopen takes ~0 ms | No: today's tree is not cheaply serialisable. |

**Backport experiments on today's code,** on top of #107 and #109 (`origin/perf/single-pass-totals`).
Synthetic logs, two rounds each. The output digest (every event's numbers, issues and limits) is
identical to the baseline, and all 317 tests pass at each step:

| Step | 20 MB time / heap | 100 MB time / heap |
| --- | --- | --- |
| `main` | ~953 ms / 259 MB | ~3,638 ms / 1,100 MB |
| #107 + #109 | 904–936 ms / 190 MB | 3,320–3,548 ms / 808 MB |
| **A.** Shared arrays: one `exitTypes` array per distinct list, and leaves share one empty `children` array (only `DurationLogEvent` and the root own one) | 900–920 ms / 179 MB | 3,298–3,388 ms / 764 MB |
| **B.** A, plus shared **frozen** zero counter objects: an event takes its own `{self, total}` only when it writes one (frames, heap and exception leaves, SOQL/SOSL ends) | **776–811 ms / 124 MB** | **2,976–3,027 ms / 555 MB** |

From `main` to B: **~15–20% faster and ~50% less heap.** The JS core, by comparison, is ~20×
faster with ~20× less memory.

**Opinion:**

- **A: do it.** It is safe and shape-preserving: properties stay own properties, so
  serialisation is unchanged. It saves ~5% of heap. The only risk is a consumer pushing into a
  leaf's `children` or an event's `exitTypes`, which nothing should do.
- **B: worth it, if the maintainers accept one rule.** Counters on events that never write them
  are frozen shared zeros. A consumer that writes to a leaf's or an exit's counter then gets a
  `TypeError`, because ESM is strict, instead of silently changing another event. That is the
  "shared frozen objects" #108 rejected to keep the API mutable. The measured price of keeping
  that rule is ~30% of heap and ~10% of time. **Ask:** do the analyzer or MCP ever write to a
  leaf's or an exit's counters? Frames, and the root, keep their own mutable counters.
- **Consumer-side, now:** build the timeline render index from today's tree (the ~70× redraw win),
  and run MCP's parse in a worker thread with the tree kept there.
- **Not worth it on today's parser:** removing `split`, folding exits, async yielding (the
  recursive `parseTree` would need to become async throughout), and a webview worker (the clone
  cost). Put that effort into the JS core.

The patch for A and B is in §B (`backport.diff`, against `origin/perf/single-pass-totals`
`e80a701`).

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
is noisy for scenarios that return a number. Reproduce with §B.

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
- *(Revised in §3.9.)* **Bytes vs strings depends on the platform and on where the input comes
  from.** The early v1 comparison favoured bytes 1.5×, but its string loop was less tuned. With
  the same tuned algorithm, bytes won by 10–40% on Linux x86-64 Node 22, while a maintainer's
  local test found strings faster. A string with one non-Latin-1 character also doubles in memory,
  because V8 stores the whole string two-byte.
- **The structure is built eagerly; objects and strings are lazy.** The root's total, a whole
  flame chart and `ofType` cost nothing after the scan, because rollups and indexes happen
  during it.
- **Draw the timeline from the columns.** From columns it adds ~0–30 ms at 100 MB; from node
  objects it adds ~200 ms.
- **A worker only works with columns.** Cloning an object tree costs more than parsing it. A
  columnar store transfers at no cost, and the UI is never blocked for more than ~4 ms.
- *(Stage estimate from v3, superseded by the final numbers in §3.7 and §3.8.)* **Expected for the full parser**, with the v3 output shape from §3.4 plus the omitted rules,
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

- *(v3 stage result; final numbers are in §3.7 and §3.8.)* **Before and after, to a drawn timeline at 100 MB:** ~3.2–3.4 s today against ~0.27–0.29 s
  from the columns, so **~11–12× faster**. The parse alone goes from ~2.9–3.1 s to ~0.28–0.34 s.
- **Building the timeline from the tree costs ~245 ms today.** From the columns it costs about
  nothing: rows are already in time order, so building per-depth row arrays is one counting pass.
  Node objects sit in between.
- **Every pan and zoom gets ~70× cheaper.** Each redraw of a 1% window drops from ~6 ms to
  ~0.1 ms, because a per-depth binary search finds the visible frames instead of testing every
  rect. A frame at 60 fps has 16.7 ms, and today's redraw already takes a third of it before
  drawing anything.
### 3.6 Architecture review: is this the best structure?

The design was tested against the alternatives that the fastest parsers and trace tools use. All
runs: Node 22.22 (V8 12.4), 4-core Linux container, synthetic logs from #106, median of 7–15 runs.
Chromium 141 headless for the browser rows. The scripts are in §B.

**Prior art checked, with sources in §4.** These systems were checked for how they store and
process data:

- Perfetto trace processor:
  [`slice_tables.py`](https://github.com/google/perfetto/blob/main/src/trace_processor/tables/slice_tables.py),
  [`string_pool.h`](https://github.com/google/perfetto/blob/main/src/trace_processor/containers/string_pool.h),
  and the [architecture doc](https://github.com/google/perfetto/blob/main/docs/design-docs/trace-processor-architecture.md).
- The Firefox Profiler
  [processed format](https://github.com/firefox-devtools/profiler/blob/main/docs-developer/processed-profile-format.md).
- The Chrome DevTools
  [trace engine](https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/README.md).
- The simdjson [tape](https://github.com/simdjson/simdjson/blob/master/doc/tape.md) and
  [On-Demand](https://github.com/simdjson/simdjson/blob/master/doc/ondemand_design.md) designs.
- oxc [raw transfer](https://github.com/oxc-project/oxc/issues/2409).
- The Lezer [`tree.ts`](https://github.com/lezer-parser/common/blob/main/src/tree.ts).
- Apache Arrow JS.
- V8 source.

**Where the experiments and prior art agree with the design:**

| Decision | Evidence | Verdict |
| --- | --- | --- |
| **Columnar typed arrays (struct of arrays)** | Measured against array-of-structs (Lezer/oxc style), on 510k rows: writes about equal (16.0 vs 16.7 ms at 100 MB; at 20 MB array-of-structs wrote faster, 3.2 vs 4.2 ms); flame-chart read 4.5 vs 6.3 ms; one column 0.5 vs 1.0 ms; tree walk 7.3 vs 12.3 ms; 30.6 vs 32.7 MB. Perfetto, Firefox Profiler and Arrow all store this way. | **Keep.** |
| **Prefix order with a skip pointer** (`subtreeEnd`) | simdjson's tape (`{` holds the index past its scope), Lezer's `endIndex`, Perfetto's `depth` + `parent_id`. | **Keep.** |
| **Interned strings, a side table for sparse data** | Perfetto's string pool and `arg_set_id`; the Firefox Profiler's single `stringArray`; Arrow dictionary encoding. Sparse counts measured: 0.6–3% of frames need a slot. | **Keep.** |
| **One node class** | V8 `DEFAULT_MAX_POLYMORPHIC_MAP_COUNT 4`. Measured: per-type prototypes 2× slower than today, one class 2.2× faster (§3.3). | **Keep.** |
| **Eager structure, lazy objects and strings** | simdjson On-Demand: laziness wins for sparse access, loses for random access and revisits. A timeline reads everything, so the structure must be eager. oxc's laziness is mainly about GC. Measured: rollups cost nothing extra after the scan. | **Keep.** |
| **Single pass, one handler per type** | The Chrome DevTools trace engine loops once and calls handlers. Its 4× speed-up came from removing per-event Map growth. | **Keep.** No per-event Maps, objects or arrays. |
| **Transfer, not SharedArrayBuffer, in webviews** | VS Code cross-origin isolation is behind a flag (1.72 release notes), so `SharedArrayBuffer` is unavailable in webviews by default. | **Keep.** |
| **Uint32 offsets, not Lezer's 16-bit buffers** | Lezer caps buffers at 1,024 characters to stay in 16 bits; a 100 MB log cannot. | **Keep.** Uint32 limits a log to 4 GB. |

**Where they change the design:**

1. **WASM: from "no" to "yes, as the accelerated core".** The same full single pass (scan, tree,
   exit matching, interning, sparse counts, heap, self time) was written in C and compiled to WASM.
   It produced **the identical tree** to the JS v5 on all three logs, and the result columns are
   read **in place** through typed-array views over WASM memory, oxc's "raw transfer". WASM times
   include copying the input in.

   | | JS v5 (Node) | WASM scalar | **WASM SIMD128** | JS v5 (Chromium) | **WASM SIMD (Chromium)** |
   | --- | ---: | ---: | ---: | ---: | ---: |
   | 20 MB | 43–56 ms | 31 ms | **23 ms** | 68–136 ms | **23–24 ms** |
   | 100 MB | 226–303 ms | 156 ms | **105 ms** | 323–327 ms | **110–111 ms** |
   | 90 MB, 282k distinct names | 307–387 ms | 221 ms | **202 ms** | — | — |

   WASM SIMD is **~2× faster in Node and ~3× in Chromium**, the analyzer's engine, and it varies
   far less between runs. The published "JS is enough" cases (mraleph on source maps, OpenUI)
   lost to boundary copying and string conversion. This design avoids both: one copy in, zero
   copies out, and strings stay lazy in JS.

   **Costs:**
   - a C or Rust toolchain in CI;
   - `wasm-unsafe-eval` in the webview CSP, which the extension controls;
   - WASM memory cannot be transferred, so a worker copies the ~40 MB of columns out (~10 ms) or
     keeps the parse and its views inside the worker;
   - memory never shrinks, so use a fresh `Memory` per parse.
2. **Newline search depends on the platform.** V8's `Uint8Array.prototype.indexOf` is a scalar
   C++ loop ([elements.cc](https://github.com/v8/v8/blob/main/src/objects/elements.cc)), not
   memchr. Measured over 100 MB:

   | Search | Time |
   | --- | ---: |
   | `Uint8Array.indexOf` | 67.5 ms |
   | Node `Buffer.indexOf` (memchr) | 28.8 ms |
   | SWAR, 4 bytes at a time in JS | 49.8 ms |
   | WASM `i8x16` SIMD | inside the 105 ms above |
   | plain JS byte loop | 120.5 ms |

   So the Node build uses `Buffer.indexOf`, the browser JS core uses SWAR, and the WASM core uses
   SIMD.
3. **Interning is the next cost after newlines.** v4's line profile: newline search 15.6%,
   column writes ~15%, interning ~22%, timestamp ~5%. v5 fused label hashing into the field scan
   and derived the namespace once per distinct label: 267 → 226 ms at 100 MB. Skipping the byte
   check after a hash match saves another ~20% (179 ms) but risks a wrong name on a collision.
   **Keep the check**, or use a 64-bit hash pair if a profile on real logs demands it.
4. **The parallel first stage is not worth it in the browser.** 4 worker threads in Node:

   | Log | 1 thread | 4 workers | Speed-up |
   | --- | ---: | ---: | ---: |
   | 20 MB | 52 ms | 31 ms | 1.7× |
   | 100 MB | 303 ms | 131 ms | 2.3× |
   | 90 MB, high cardinality | 314 ms | 216 ms | 1.45× |

   The sequential tree and interning stage caps the gain. It needs `SharedArrayBuffer`, which
   webviews lack, and it does not combine with WASM without WASM threads. **Defer**; it is an
   option for MCP only, and WASM single-thread is already faster.
5. **High cardinality is the real-log risk, and it holds.** With 282,345 distinct strings (90 MB),
   v5 still parses in 307–387 ms against today's 3,467 ms (9–11×), and keeps 72 MB against
   1,109 MB. Today's string also turns two-byte (180 MB) when one non-ASCII character appears.
6. **Not adopted:** a native Node addon. It is faster again for MCP, but needs prebuilt binaries
   per platform and cannot run in a browser; WASM covers both.

**Verdict:**

- The structure is the one the fastest systems converge on: a byte scanner, columnar store,
  prefix order, interned strings, sparse side tables, one node class, eager structure with lazy
  strings, and transfer.
- The best model for performance is that structure with **two interchangeable cores behind one
  column ABI:**
  - a **JS core**: the reference implementation, the fallback, and the oracle for differential
    tests;
  - a **WASM SIMD core**: the default where WASM is allowed.
- Both are generated from the same schema tables, and the store, views, types and API are
  identical whichever core ran.

### 3.7 Final performance numbers

**Measured** means prototype output was verified identical between engines; **projected** adds
the rules the prototypes still omit (issues text, limits blocks, truncation, package merge, flow
residuals, discontinuity, exit details, parsing errors), estimated at +10–25% on the scan.

| | Today (measured) | JS core (measured → projected) | **WASM SIMD core (measured → projected)** |
| --- | ---: | ---: | ---: |
| **20 MB** parse, Node | 745–862 ms | 43–56 → **50–70 ms** | 23 → **25–30 ms** |
| **20 MB** parse, Chromium, bytes | — | 68–145 (SWAR 73–76) → **80–150 ms** | 23–24 → **25–30 ms** |
| **20 MB** parse, Chromium, string (the webview receives text) | — | 102–109 → **110–135 ms** | needs bytes: `TextEncoder` costs 104–179 ms first, so not viable from a string |
| **20 MB** to a drawn timeline (Node) | 833–873 ms | **50–70 ms** (the columns add ~0) | **25–30 ms** |
| **100 MB** parse, Node | 2,738–3,243 ms | 226–303 → **260–380 ms** | 105 → **120–140 ms** |
| **100 MB** parse, Chromium, bytes | — | 323–391 (SWAR 349–351) → **370–440 ms** | 110–119 → **125–140 ms** |
| **100 MB** parse, Chromium, string | — | 530–557 → **580–650 ms** | not viable from a string: `TextEncoder` costs 906–1,015 ms |
| **100 MB** to a drawn timeline | 3,190–3,388 ms | **260–380 ms** | **120–140 ms** |
| **100 MB** MCP path (read the file, then parse) | 3,477–3,731 ms | ~**330–450 ms** (bytes read straight in) | ~**180–220 ms** |
| **90 MB, 282k names** | 3,467 ms | 307–387 → **350–480 ms** | 202 → **220–260 ms** |
| Redraw of a 1% window (pan or zoom) | 6.2–7 ms | **0.09 ms** | **0.09 ms** |
| Main thread blocked, worker mode | not viable | **≤ 4 ms** | **≤ 4 ms** plus a ~10 ms column copy, or none if the views stay in the worker |
| Memory for the tree, 100 MB | 1,100 MB plus the 100–200 MB pinned string | ~41 MB (72 MB at high cardinality) plus 100 MB of source bytes | the same |

**Speed-up against today:**

- JS core: **~10–15×** to a drawn timeline.
- WASM SIMD core: **~25–30×**.
- Memory: **~15–25× less** for the tree, and **~6–8×** including the source bytes, which lazy
  text needs.
- Every pan and zoom: **~70×** cheaper.

All of this is synthetic until the corpus runs; the go/no-go gate in §0.1 uses real logs.

### 3.8 Consolidated run on the sample logs, warm and cold

Every engine ran in one script (`final.ts`) on the same machine: Node 22.22, 4 cores. The logs
are the Appendix A sample (11 lines), the #106 synthetic 20 MB and 100 MB logs, and their
high-cardinality variants (`make-hc.py`). Row counts agree between the JS and WASM cores on every
log.

**Warm** (median after two warm-up parses; 201 runs for the sample, 9 at 20 MB, 5 at 100 MB):

| Log | Size | Today | JS core (v5) | WASM scalar | WASM SIMD |
| --- | ---: | ---: | ---: | ---: | ---: |
| Appendix A sample | 0.001 MB | 0.88 ms | 0.14 ms | 0.05 ms | 0.05 ms |
| `dev20` | 20 MB | 1,064 ms | **43 ms** | 31 ms | **24 ms** |
| `dev20-hc` (50k names) | 19 MB | 1,140 ms | **43 ms** | 34 ms | **27 ms** |
| `large100` | 100 MB | 4,760 ms | **215 ms** | 143 ms | **102 ms** |
| `large100-hc` (282k names) | 90 MB | 5,026 ms | **400 ms** | 206 ms | **175 ms** |

Today's parser ran slower here than in its solo runs (745–862 ms and 2.7–3.2 s): this process
already held more memory, and today's parser spends over a fifth of its time in GC (#108). The
new cores barely allocate, so they are not sensitive to that. A UI that holds other data behaves
more like this run.

**Cold** (`cold.ts`: a fresh process, then the **first** parse, including loading the engine:
module import, or WASM compile and instantiate, and memory growth). Three runs each:

| Log | Today | JS core | WASM scalar | WASM SIMD |
| --- | ---: | ---: | ---: | ---: |
| Appendix A sample | 19–22 ms | **7 ms** | 9–12 ms | 10–11 ms |
| `dev20` (20 MB) | 957–1,054 ms | **158–169 ms** | 90–108 ms | **75–118 ms** |
| `large100` (100 MB) | 5,125–8,112 ms | **409–449 ms** | 410–449 ms | **315–320 ms** |

**What cold means:**

- The first parse runs partly unoptimised: V8 tiers up JS mid-loop, and WASM pays to compile and
  grow its memory.
- The gap between the cores is smaller cold (~1.5–2×) than warm (~2×), and **JS wins on tiny
  logs**.
- A pre-warmed worker (§0.2) moves the JS core towards its warm numbers.
- Today's script went through tsx, which adds a few milliseconds of transform to the "today" and
  JS rows on the sample log.

### 3.9 Strings vs bytes: it depends on the platform and the input

A maintainer's local test found **strings faster than bytes**. The earlier "bytes beat strings
1.5×" (§3.2) compared a tuned byte loop with a less-tuned string loop, so it was re-run fairly.
`scan-v5s.mjs` is v5 with only character reads (`charCodeAt`) and newline search
(`String.indexOf`) changed. `scan-v5w.mjs` is v5 with a SWAR newline search. Each variant ran in
its own process (`sb-one.mjs`), so V8 never specialises shared code for one input type and
penalises the other. Medians of 9 warm scans, three rounds. Every variant builds the same tree.

**Linux x86-64, Node 22.22 (this environment):**

| Log | String | Bytes, `Uint8Array.indexOf` | Bytes, `Buffer.indexOf` (Node) | Bytes, SWAR |
| --- | ---: | ---: | ---: | ---: |
| 20 MB | 60–67 ms | 47–53 ms | **37–42 ms** | 45–48 ms |
| 100 MB | 325–352 ms | 234–250 ms | **199–208 ms** | 222–233 ms |
| 90 MB, two-byte string | 422–446 ms | 361–375 ms | **312–330 ms** | 338–351 ms |

**Chromium 141 headless (x86-64), the analyzer's engine** (`web/make-web.py`, two rounds):

| Log | String | Bytes, `Uint8Array.indexOf` | Bytes, SWAR | WASM SIMD (bytes) | `TextDecoder` | `TextEncoder` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 20 MB | 102–109 ms | 81–145 ms | 73–76 ms | 24 ms | 17 ms | **104–179 ms** |
| 100 MB | 530–557 ms | 390–391 ms | 349–351 ms | 118–119 ms | 113–120 ms | **906–1,015 ms** |

In Chromium, bytes beat strings by ~1.4–1.5× with SWAR, but **`TextEncoder` is very slow**. A
webview holding a string must never convert it to bytes just to scan.

**Getting the input** (`strbytes.mjs`, Node), at 100 MB:

| Conversion | Time |
| --- | ---: |
| Read the file as bytes | 59–87 ms |
| Read the file as a UTF-8 string | 214 ms, or 401 ms when the result is two-byte |
| `TextDecoder` (bytes to string) | 91 ms (294 ms two-byte) |
| `TextEncoder` (string to bytes) | 107 ms (159 ms two-byte) |

**What explains a "strings faster" result:**

1. **The machine.** Apple Silicon (arm64) V8 may favour `charCodeAt` and `String.indexOf`
   differently from x86-64. That is untested here, because this environment is x86-64 only.
2. **What was timed.** If the input was already a string, as in a webview that receives the log
   text, the byte path must pay `TextEncoder` first (~17 ms at 20 MB, ~107 ms at 100 MB). That
   alone makes strings win end to end.
3. **How text fields were read.** `TextDecoder` per short field is slow, with a large fixed cost
   per call. Decode short ASCII in JS, and decode each interned string once.
4. **The newline search.** `Uint8Array.indexOf` is a scalar loop in V8, but `String.indexOf` is
   fast. A byte loop with plain `indexOf` is the weakest byte variant.

**Decision:**

- **Scan what the caller already has. Never convert just to scan.**
- **Analyzer webview:** best is to have the extension host read the file as bytes and post the
  `ArrayBuffer` to the webview as a transfer. VS Code webviews accept `ArrayBuffer`s in
  `postMessage`; check the release notes for the minimum VS Code version and whether it is a true
  zero-copy transfer. Then scan bytes with SWAR, or with the WASM core. If the webview only has
  text, use the **string loop**, never `TextEncoder`.
- **MCP, or reading a file in Node:** read **bytes**, which skips the 214–401 ms UTF-8 decode, and
  scan with `Buffer.indexOf`.
- **Streams and `Blob`:** bytes.
- **A WASM core:** needs bytes. From a string, `TextEncoder.encodeInto` straight into WASM memory
  is possible, but Chromium's encoder costs ~1 s per 100 MB, which cancels the WASM gain. So
  in the webview, WASM is only worth it when bytes arrive directly from the extension host.
- **Both loops are generated from the same grammar tables** and must produce identical columns,
  enforced by a differential test.
- **Phase 0 must run `sb-one.mjs` on the maintainers' machines** (macOS arm64 at least) and on the
  analyzer's real input path, before any default is fixed.

To reproduce locally, from the repo root:

```sh
for v in string u8 buffer swar; do node bench/rewrite/sb-one.mjs $v bench/rewrite/logs/large100.log; done
node bench/rewrite/strbytes.mjs bench/rewrite/logs dev20.log large100.log large100-hc.log
```

---

## 4. Prior art, and what to take from each

| Project | Technique | Take |
| --- | --- | --- |
| **oxc** (Rust → JS) | Raw transfer: the AST sits in one buffer and is deserialised lazily in JS, so only the nodes a visitor touches become objects. ~3× faster than eager deserialisation, and transfer cost near zero. [oxc.rs/blog/2025-10-09-oxlint-js-plugins](https://oxc.rs/blog/2025-10-09-oxlint-js-plugins.html) | A buffer is the truth; objects are an on-demand view. |
| **Lezer** (CodeMirror) | `TreeBuffer`: `(type, start, end, endIndex)` in a typed array, prefix order, with the parent's end bounding its children. `SyntaxNode` objects on demand, and a `TreeCursor` that allocates nothing. [lezer.codemirror.net/docs/ref](https://lezer.codemirror.net/docs/ref/) | Prefix-order rows with a subtree end. Nodes plus a cursor. |
| **simdjson** | Stage 1 finds structural characters in bulk; stage 2 builds a flat tape of fixed-width records, with strings as offsets. | Fast newline search (memchr in Node, SIMD in WASM; V8's `Uint8Array.indexOf` is a scalar loop, see §3.6). Fixed-width rows. A parallel first stage. |
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
   path, or a `string`. **Both are first-class**, each with its own specialised loop (`charCodeAt`
   plus `String.indexOf`, or byte reads plus the platform's fastest newline search). Scan what the
   caller already has, and never convert just to scan (§3.9).
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

**The source** (the input string or bytes, whichever was scanned) is kept for lazy text, and the
columns hold offsets into it: character offsets for a string, byte offsets for bytes. A one-byte
string costs the same as bytes. A string with any non-Latin-1 character is stored two-byte by V8,
so it costs double. `retainSource: false` drops the source after the eager fields, for callers
that need only the tree and the interned names.

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
- **Text.** Free text is produced on first read:
  - **String source:** `slice`, which is zero-copy in V8. Keep it, because the source is retained
    on purpose.
  - **Byte source:** `String.fromCharCode` for short ASCII ranges, and `TextDecoder` over a
    subarray for long or non-ASCII ranges. `TextDecoder` has a large fixed cost per call.
  - **Interned strings** are decoded once and cached by id.
  - Wrapped lines are joined with `\n`, and `\r` is stripped per line, exactly as today's `text`.

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
Start with few containers. `types-sketch.ts` in §B proves the typing works, including the
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
- Newline search depends on the platform (§3.6): `Buffer.indexOf` in the Node build (memchr), SWAR
  in the browser JS core, `i8x16` SIMD in the WASM core. Never `Uint8Array.indexOf` on the hot
  path, because it is a scalar loop in V8.
- Hash the label while finding its field boundaries, and derive anything that depends only on the
  label (namespace) once per distinct label, cached by string id.
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
  cloned. A string input is posted as a string; strings are immutable, so this is cheap but may
  copy.
- **Getting the log into the webview:** the extension host reads the file as bytes (59–87 ms per
  100 MB, against 214–401 ms as a UTF-8 string) and transfers the `ArrayBuffer`. The webview
  forwards it to the parser worker, also by transfer. Never `TextEncoder` a string in Chromium on
  this path (§3.9).
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

### 5.10 Two cores, JS and WASM SIMD, behind one column ABI (revised after §3.6)

The earlier "no WASM" call was a judgement; §3.6 measured it. A WASM SIMD core is ~2× faster than
the best JS in Node and ~3× in Chromium, with an identical tree. So:

- **The column layout is the ABI.** Both cores write the same columns, string table, count pool
  and per-type indexes. Everything above them is shared: views, types, `compat` and the API.
- **Each core has its job:**
  - **The JS core is built first.** It is the reference implementation, the fallback where WASM
    is not allowed, and the differential-test oracle.
  - **The WASM SIMD core is optional (§0.2).** If Phase 2b's trigger is met, it becomes the default
    wherever WASM is available. That covers Node ≥ 16.4, every current browser (Safari ≥ 16.4) and
    Electron. Detect it with `WebAssembly.validate` on a SIMD probe.
- **The WASM core does only the hot pass:** scan, match, intern and roll up, about 300 lines.
  Field decoders, text, issues text and limits parsing stay in JS, reading the same bytes.
  `grammar/` generates its tables into both cores from the one schema.
- **Data flow:**
  - Read or stream the input straight into WASM memory, so it is never in JS memory twice.
  - The result columns are typed-array views over WASM memory, with no copy out (oxc's raw
    transfer).
  - In a worker, either copy the columns into transferable buffers (~10 ms at 100 MB), or keep the
    parse and its views in the worker and answer queries there.
  - Use a fresh `WebAssembly.Memory` per parse, because WASM memory never shrinks.
- **Language:** OPEN decision 10. C with clang needs no extra dependencies, and the prototype
  module is 5 KB. Rust adds memory safety and is common in CI. Zig is another option.
- **CSP:** the analyzer's webview CSP needs `'wasm-unsafe-eval'`. The extension owns that CSP.
- **Differential tests:** every corpus log runs through both cores and must give identical
  columns. That catches core divergence for free.

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

### 5.12 Separate the returned data from the parsing rules

Today one class per event mixes three things:

- **what the log said:** `timestamp`, `text`, `lineNumber`, …;
- **what the type is:** `category`, `debugLevel`, …, copied onto every instance;
- **how to parse it:** `logParser`, `acceptsText`, `isExit`, `nextLineIsExit`, `exitTypes`,
  `discontinuity`, `onEnd`, `onAfter`, `seedHeapLeaf`, `parseTimestamp`, `parseLineNumber`.

All three are public, on every event (Appendix A). The new code keeps them in separate modules
that never import each other's internals:

```text
src/next/
  model/              PUBLIC: what a consumer sees
    catalog.ts        event types: names, category, debugCategory, level, kind, shape, exits,
                      public field names and their docs, description          (source of truth)
    events.gen.ts     generated named interfaces per event + ApexEvent union + EventMap
    eventTypes.gen.ts generated EVENT_TYPES table and eventType(type), public metadata
    log.ts            ApexLog, Node, Cursor, EventList, Columns: interfaces only
  grammar/            INTERNAL: how to parse, never exported
    rules.ts          per type: recognise, match (exitTypes, nextLineIsExit, acceptsText,
                      discontinuity, line-number matching), byte decoders for each public field,
                      exitFields capture, namespace inference, per-row overrides, rollup
                      contributions (soql +1, rows from the exit), container enforcement
    tables.gen.ts     perfect hash and Uint8Array flag tables built from rules.ts
  engine/             INTERNAL: scanner, store, close-time rollups, issues, limits, truncation
  views/              node.ts (one class), cursor.ts, eventList.ts: implement model/log.ts
  compat/             toLegacyTree.ts: today's classes, built from the store
```

The compiler enforces the link: `rules: { readonly [K in EventType]: Rules<K> }`, and `Rules<K>`
must supply a decoder for every public field `catalog.ts` declares for `K`. So:

- a field declared without a decoder fails `tsc`;
- the grammar cannot leak a field into the output, because output types come from the catalog
  only;
- parsing flags never appear on a node.

The catalog can change a field's docs or name without touching the parser, and the grammar can
change how a field is read without touching the public types. `EventMetadata.test.ts` crosses
`catalog.ts` with `data/salesforce-debug-log-events.json`, as it crosses the classes today.

### 5.13 Shipping in parallel, switchable

| Entry point | What it returns | Who uses it |
| --- | --- | --- |
| `parse(text)` from `@apexdevtools/apex-log-parser` | today's `ApexLog` from today's engine, unchanged | everyone, by default |
| `parse(text, { engine: 'next' })` from the same entry | **today's `ApexLog` shape**, built by the new engine through `compat` | consumers flip a setting: a drop-in switch with the same API, at most of the new parse speed |
| `parse(text, { engine: 'shadow' })` | today's engine's result, after running both and reporting any digest difference through `onMismatch` | dev builds of the analyzer and MCP, to find parity bugs on real logs |
| `@apexdevtools/apex-log-parser/next` | the new API (§5.7) natively: nodes, cursor, columns, `parseAsync`, workers | consumers moving view by view, starting with the analyzer's timeline |

**Rules:**

- The new engine never changes the default until the user decides.
- `next` and `shadow` share one engine.
- Removing the legacy engine is a later major version.
- The `PublicApi.test.ts` pins both entry points.
- `engine: 'next'` costs today's object memory, because `compat` builds the old tree, but saves
  the scan. Only `/next` gives the memory win.

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
7. **Repo layout.** RESOLVED: the new parser ships **in parallel, as a switchable option** in the
   same package (§5.13).
8. **`eventIndex` numbering.** RESOLVED: ids exist for uniqueness when timestamps collide, so
   unique, stable, deterministic row numbers meet the need, and folding exits is accepted. Still
   confirm that nothing **persists** ids across package versions; a cache keyed by content hash
   plus parser version is safe.
9. **Projection default.** Full rows, or frames only? And which aggregates ship in 1.0?
10. **WASM core: whether, when and in which language.** The recommendation (§0.2) is to ship the JS
    core and add WASM only if Phase 2b's trigger is met. If it is, choose C (clang, no extra
    dependencies), Rust or Zig.

---

## 8. Build plan and acceptance gates

### Phase 0: groundwork

- Make sure #106 has merged, or bring its harness in. Merge or rebase onto #107 and #109.
- Reproduce §3 with §B.
- Get access to the corpus, and the digest script that #107 and #109 used. Ask the user where it
  lives.
- Run the strings-vs-bytes comparison (§3.9) on the maintainers' machines, in Node and in the
  analyzer's webview. Confirm how the analyzer receives the log today: a string, or bytes.
- Confirm that VS Code can transfer an `ArrayBuffer` from the extension host to the webview, and
  from which VS Code version.

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

### Phase 2b: the WASM SIMD core (optional; only if triggered)

**Trigger (§0.2):** after the JS core ships, a real-log profile still shows the parse as the main
wait. For example, MCP regularly parses logs over 50 MB, or webview cold parses exceed ~150 ms
even with a pre-warmed worker.

- Port the hot pass to WASM SIMD, with tables generated from the same `grammar/`.
- Add the input-straight-into-memory path and the views over WASM memory.
- Fall back to the JS core when WASM SIMD is unavailable.

**Gate:**

- identical columns to the JS core on every corpus log;
- at 100 MB, ≤ 150 ms in Node and in Chromium;
- the analyzer webview loads it under its CSP.

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
- **Platform traps found by measurement:**
  - V8's `Uint8Array.prototype.indexOf` is a scalar loop; use `Buffer.indexOf` in Node and SWAR in
    browsers.
  - Chromium's `TextEncoder` is ~10× slower than its `TextDecoder`.
  - `TextDecoder` is slow on short strings.
  - A string with one non-Latin-1 character is stored two-byte.
  - Results differ between x86-64 and arm64, so measure on the maintainers' machines (§3.9).
- **The synthetic logs are not real logs.** They have few distinct names and no hostile text.
  Validate on the corpus.

---

## A. Old vs new output for one small log

The log (placeholder content only):

```text
64.0 APEX_CODE,FINE;APEX_PROFILING,INFO;CALLOUT,INFO;DB,INFO;NBA,INFO;SYSTEM,DEBUG;VALIDATION,INFO;VISUALFORCE,INFO;WAVE,INFO;WORKFLOW,INFO
09:00:00.001 (1000000)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com|(GMT+00:00) Greenwich Mean Time (Europe/London)|GMTZ
09:00:00.001 (1100000)|EXECUTION_STARTED
09:00:00.001 (1200000)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex
09:00:00.002 (2000000)|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.loadAccounts()
09:00:00.003 (3000000)|SOQL_EXECUTE_BEGIN|[12]|Aggregations:0|SELECT Id, Name FROM Account LIMIT 10
09:00:00.005 (5500000)|SOQL_EXECUTE_END|[12]|Rows:10
09:00:00.006 (6000000)|USER_DEBUG|[14]|DEBUG|loaded 10 accounts
09:00:00.007 (7000000)|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.loadAccounts()
09:00:00.008 (8000000)|CODE_UNIT_FINISHED|execute_anonymous_apex
09:00:00.008 (8100000)|EXECUTION_FINISHED
```

### A.1 Today: actual output of `parse()` on `main`

The ids are 0 root, 1 `USER_INFO`, 2 `EXECUTION_STARTED`, 3 `CODE_UNIT_STARTED`,
4 `METHOD_ENTRY`, 5 `SOQL_EXECUTE_BEGIN`, **6 `SOQL_EXECUTE_END`** (an object, not in the tree),
7 `USER_DEBUG`, 8 `METHOD_EXIT`, 9 `CODE_UNIT_FINISHED`, 10 `EXECUTION_FINISHED`. That is 11
objects for 7 tree nodes. References are shown as `[Class #id]`.

```jsonc
// SOQLExecuteBeginLine #5: every field is an own property of the instance
{
  "logParser": "[ApexLogParser]",                     // parser internal
  "parent": "[MethodEntryLine #4]", "children": [],
  "type": "SOQL_EXECUTE_BEGIN",
  "logLine": "09:00:00.003 (3000000)|SOQL_EXECUTE_BEGIN|[12]|Aggregations:0|SELECT Id, Name FROM Account LIMIT 10",
  "text": "SELECT Id, Name FROM Account LIMIT 10",
  "acceptsText": false, "isExit": false, "isParent": true,            // parser internal
  "isTruncated": false, "nextLineIsExit": false, "discontinuity": false, // mostly parser internal
  "lineNumber": 12, "namespace": "default", "hasValidSymbols": false, "suffix": null,
  "timestamp": 3000000, "eventIndex": 5, "exitStamp": 5500000,
  "category": "SOQL", "debugCategory": "database", "debugLevel": "INFO", "cpuType": "free", // the same for every SOQL event
  "duration":     { "self": 2500000, "total": 2500000 },
  "soqlCount":    { "self": 1,  "total": 1 },
  "soqlRowCount": { "self": 10, "total": 10 },        // copied from the exit by onEnd
  "dmlCount": { "self": 0, "total": 0 }, "dmlRowCount": { "self": 0, "total": 0 },
  "soslCount": { "self": 0, "total": 0 }, "soslRowCount": { "self": 0, "total": 0 },
  "thrownCount": { "self": 0, "total": 0 },
  "heapAllocated": { "self": 0, "total": 0 }, "heapGross": { "self": 0, "total": 0 }, "heapPeak": 0,
  "exitTypes": ["SOQL_EXECUTE_END"],                  // parser internal, an array per instance
  "aggregations": 0
}
// methods on the prototype chain: onEnd, recalculateDurations, seedHeapLeaf, parseTimestamp, parseLineNumber

// SOQLExecuteEndLine #6: built, matched, passed to onEnd, then dropped from the tree (parent null)
{ "type": "SOQL_EXECUTE_END", "eventIndex": 6, "parent": null, "isExit": true, "timestamp": 5500000,
  "lineNumber": 12, "soqlRowCount": { "self": 10, "total": 10 }, /* …and all 11 SelfTotal objects again */ }

// MethodEntryLine #4 (abridged)
{ "type": "METHOD_ENTRY", "eventIndex": 4, "text": "ns.MyClass.loadAccounts()", "lineNumber": 1,
  "namespace": "default", "timestamp": 2000000, "exitStamp": 7000000,
  "duration": { "self": 2500000, "total": 5000000 },
  "soqlCount": { "self": 0, "total": 1 }, "soqlRowCount": { "self": 0, "total": 10 },
  "children": ["[SOQLExecuteBeginLine #5]", "[UserDebugLine #7]"], "exitTypes": ["METHOD_EXIT"], /* … */ }

// ApexLog #0, the root (abridged)
{ "text": "LOG_ROOT", "size": 873, "timestamp": 1000000, "exitStamp": 8100000,
  "duration": { "self": 100000, "total": 7100000 },
  "debugLevels": { "apexCode": "FINE", "database": "INFO", /* … */ },
  "debugLevelSettings": [{ "token": "APEX_CODE", "level": "FINE", "category": "apexCode" }, /* … */],
  "userInfo": { "id": "005000000000AAA", "userName": "user@example.com",
                "timezone": { "label": "Greenwich Mean Time", "name": "Europe/London", "offsetMinutes": 0, /* … */ } },
  "namespaces": ["default"], "logIssues": [], "parsingErrors": [],
  "entryPoints": ["[CodeUnitStartedLine #3]"], "truncation": { "regions": [], "totalSkippedBytes": 0 },
  "governorLimits": { "snapshots": [], "final": { /* 13 LimitValues */ }, "peak": { /* … */ }, "byNamespace": {} },
  "startTime": 32400001, "executionEndTime": 8100000,
  "eventsById": "[11 events]", "exceptions": [], "truncatedEvents": [] }
```

### A.2 New: `@apexdevtools/apex-log-parser/next`

This is designed, not yet implemented; the values are the same log's. The ids are 0 root, 1
`USER_INFO`, 2 `EXECUTION_STARTED`, 3 `CODE_UNIT_STARTED`, 4 `METHOD_ENTRY`,
5 `SOQL_EXECUTE_BEGIN`, **6 `USER_DEBUG`**. The four matched exits fold into their entries. The
values below are getters on one `Node` class reading the columns; nothing else is stored per
event.

```ts
const log = parse(bytes);                 // or await parseAsync(stream) / await parseInWorker(bytes)

// Log-level data: the same shapes as today
log.size;            // 873 (UTF-8 bytes)
log.duration;        // { self: 100_000, total: 7_100_000 } (ns)
log.userInfo;        // { id: '005000000000AAA', userName: 'user@example.com', timezone: { … } }
log.debugLevels;     // { apexCode: 'FINE', database: 'INFO', … }
log.namespaces;      // ['default']
log.issues;          // []   (was logIssues)
log.limits;          // { snapshots: [], final: {…}, peak: {…}, byNamespace: {} }
log.entryPoints;     // [Node<'CODE_UNIT_STARTED'> #3]
log.eventCount;      // 7
log.root.children;   // [Node<'USER_INFO'> #1, Node<'EXECUTION_STARTED'> #2]

// A frame. Typed as Node<'METHOD_ENTRY'>, with no cast
const m = log.ofType('METHOD_ENTRY').at(0)!;
m.index;          // 4: unique and stable within this parse
m.type;           // 'METHOD_ENTRY'
m.timestamp;      // 2_000_000
m.exitStamp;      // 7_000_000
m.duration;       // { self: 2_500_000, total: 5_000_000 }
m.depth;          // 3
m.lineNumber;     // 1
m.classId;        // '01p000000000AAA'                  (named field, #71)
m.signature;      // 'ns.MyClass.loadAccounts()'        (named field, #71)
m.text;           // 'ns.MyClass.loadAccounts()'        (display text, decoded lazily)
m.namespace;      // 'default'
m.soqlCount;      // { self: 0, total: 1 }              (sparse: most frames read zeros from no slot)
m.soqlRowCount;   // { self: 0, total: 10 }
m.isTruncated;    // false
m.exit;           // { type: 'METHOD_EXIT', timestamp: 7_000_000 }
m.parent;         // Node<'CODE_UNIT_STARTED'> #3
m.children;       // [Node<'SOQL_EXECUTE_BEGIN'> #5, Node<'USER_DEBUG'> #6]: a union, narrows by .type

// A container. Typed as Node<'SOQL_EXECUTE_BEGIN'>
const q = m.childrenOfType('SOQL_EXECUTE_BEGIN')[0]!;
q.lineNumber;     // 12
q.aggregations;   // 0
q.query;          // 'SELECT Id, Name FROM Account LIMIT 10'
q.soqlCount;      // { self: 1, total: 1 }
q.soqlRowCount;   // { self: 10, total: 10 }
q.exit;           // { type: 'SOQL_EXECUTE_END', timestamp: 5_500_000, rows: 10, durationMs: null }
                  //   durationMs is null: this exit line states no duration ("report what the log stated")
q.children;       // [], typed as readonly Node<'SOQL_EXECUTE_EXPLAIN'>[]

// A leaf. Typed as Node<'USER_DEBUG'>, with no `children` property at all
const d = log.node(6);
if (is(d, 'USER_DEBUG')) { d.level; /* 'DEBUG' */ d.message; /* 'loaded 10 accounts' */ }

// Type-level metadata: looked up by type, never stored per event
q.category;                       // 'SOQL' (a getter reading EVENT_TYPES by the row's type id)
eventType('SOQL_EXECUTE_BEGIN');  // { category: 'SOQL', debugCategory: 'database', level: 'INFO',
                                  //   kind: 'soql', shape: 'container', exits: ['SOQL_EXECUTE_END'],
                                  //   cpuType: 'free', fields: { lineNumber: {…doc}, aggregations: {…}, query: {…} },
                                  //   description: '…' }
eventType('SOQL_EXECUTE_END');    // { category: 'SOQL', debugCategory: 'database', level: 'INFO', kind: 'exit', … }

// Columns, for rendering and bulk work: typed arrays indexed by id
log.columns.timestamp;  // Float64Array [1000000, 1000000, 1100000, 1200000, 2000000, 3000000, 6000000]
log.columns.exitStamp;  // Float64Array [8100000, 0, 8100000, 8000000, 7000000, 5500000, 0]
log.columns.depth;      // Uint16Array  [0, 1, 1, 2, 3, 4, 4]
log.columns.parent;     // Int32Array   [-1, 0, 0, 2, 3, 4, 4]
log.columns.type;       // Uint16Array  of type ids; eventType(id) and typeName(id) decode them
```

**Methods.**

| On | Methods |
| --- | --- |
| `ApexLog` | `node(i)`, `ofType(type)`, `visit({ TYPE: fn })`, `cursor()`, `at(timestamp)`, `find(pred)`, `search(text)`, `toBuffers()`, `toJSON()`, plus `ApexLog.fromBuffers(buffers)` |
| `Node` | `childrenOfType(type)`, `toJSON()` (a plain-object snapshot). Everything else is a read-only getter. |
| `Cursor` | `firstChild()`, `nextSibling()`, `parent()`, `next()` (pre-order), plus getters for the current row |
| `EventList` | `length`, `at(i)`, iteration, `map`, `filter`, `toArray()` |
| Free functions | `parse`, `parseAsync`, `parseInWorker`, `createParserPool`, `createLogBuilder`, `is(node, type)`, `eventType(type)` |

### A.3 Field mapping, old to new

| Today | New |
| --- | --- |
| `eventIndex` | `index`. Unique and stable per parse; exits no longer take ids. |
| `logLine` | `raw`, decoded on read |
| `text` | `text`, decoded on read, plus named fields (`signature`, `query`, `message`, …) |
| `type`, `timestamp`, `exitStamp`, `lineNumber`, `namespace`, `isTruncated`, `duration`, counts, heap | the same names |
| `category`, `debugCategory`, `debugLevel`, `cpuType`, `suffix`, `hasValidSymbols` | the same getters, read from `EVENT_TYPES` by type (with per-row overrides) |
| `isParent`, `exitTypes` | `eventType(type).shape` and `.exits` |
| `acceptsText`, `isExit`, `nextLineIsExit`, `discontinuity`, `logParser`, `onEnd`, `onAfter`, `recalculateDurations`, `seedHeapLeaf`, `parseTimestamp`, `parseLineNumber` | gone from the output; they live in `grammar/` and `engine/` |
| exit objects (e.g. `SOQLExecuteEndLine` #6) | `node.exit` details on the entry |
| `soqlRowCount` copied from the exit | still `soqlRowCount`, and also `exit.rows` |
| `eventsById` | `node(i)` |
| `logIssues` | `issues` |
| `governorLimits` | `limits` |
| `instanceof SOQLExecuteBeginLine` | `node.type === 'SOQL_EXECUTE_BEGIN'` or `is(node, 'SOQL_EXECUTE_BEGIN')` |

## B. Reproducing the measurements

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

### Architecture-review experiments (§3.6)

Save each file below under `bench/rewrite/` with its heading's path. For example, `wasm/full.c`
goes in `bench/rewrite/wasm/full.c`. Then, from the repo root:

```sh
# generate the high-cardinality logs
python3 bench/rewrite/make-hc.py bench/rewrite/logs/large100.log bench/rewrite/logs/large100-hc.log
python3 bench/rewrite/make-hc.py bench/rewrite/logs/dev20.log bench/rewrite/logs/dev20-hc.log
# JS scanners
node bench/rewrite/v4bench.mjs bench/rewrite/logs dev20.log large100.log
node bench/rewrite/v5bench.mjs bench/rewrite/logs dev20.log large100.log
node --cpu-prof --cpu-prof-interval 100 bench/rewrite/prof4.mjs bench/rewrite/logs/large100.log   # line profile of v4
node --expose-gc --max-old-space-size=8000 --import tsx bench/rewrite/hcbench.ts bench/rewrite/logs dev20-hc.log large100-hc.log
node bench/rewrite/par-bench.mjs bench/rewrite/logs dev20.log large100.log large100-hc.log
node bench/rewrite/layout.mjs bench/rewrite/logs/large100.log
node bench/rewrite/nl.mjs bench/rewrite/logs/large100.log && node bench/rewrite/swar.mjs bench/rewrite/logs/large100.log
# C / WASM (clang 18 with wasm-ld)
cd bench/rewrite/wasm
clang -O3 -march=native -DNATIVE_MAIN stage1.c -o stage1-native
W='--target=wasm32 -O3 -nostdlib -Wl,--no-entry -Wl,--export-all -Wl,--export-memory'
clang $W -Wl,--initial-memory=268435456 -Wl,--max-memory=1073741824 stage1.c -o stage1.wasm
clang $W -msimd128 -Wl,--initial-memory=268435456 -Wl,--max-memory=1073741824 stage1.c -o stage1-simd.wasm
clang $W -Wl,--initial-memory=67108864 -Wl,--max-memory=2147483648 full.c -o full.wasm
clang $W -msimd128 -Wl,--initial-memory=67108864 -Wl,--max-memory=2147483648 full.c -o full-simd.wasm
node wasm-bench.mjs ../logs dev20.log large100.log large100-hc.log
node full-bench.mjs ../logs dev20.log large100.log large100-hc.log
# browser: JS v5 vs WASM SIMD in Chromium
cd .. && python3 web/make-web.py logs && cd web/out && node ../server.mjs &
chromium --headless=new http://127.0.0.1:8766/    # results are written to web/out/result.txt
```

### `scan-v4.mjs`

````js
// Prototype v4: v3's output shape, tuned. One function, no closures in the loop. Adds today's
// line-number exit matching, unwinding to a match further down the stack, unmatched exits kept
// as rows, SOQL/SOSL rows read from the exit line, and a root row 0. Still omits issues text,
// limits, truncation, package merge, flow residuals, discontinuity and the per-event text rules.
import { readFileSync } from 'node:fs';

const table = JSON.parse(readFileSync(new URL('./type-table.json', import.meta.url), 'utf8'));
export const names = ['<root>', ...table.map((r) => r.name)];
const N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
export const PURE_EXIT = new Uint8Array(N);
const NEXT_IS_EXIT = new Uint8Array(N), ACCEPTS = new Uint8Array(N), HAS_EXITS = new Uint8Array(N), EXIT_MATCH = new Uint8Array(N * N);
table.forEach((r, i) => {
  const t = i + 1;
  PURE_EXIT[t] = r.isExit && !(r.exitTypes?.length) ? 1 : 0;
  NEXT_IS_EXIT[t] = r.nextLineIsExit ? 1 : 0; ACCEPTS[t] = r.acceptsText ? 1 : 0;
  for (const x of r.exitTypes ?? []) { EXIT_MATCH[t * N + idOf.get(x)] = 1; HAS_EXITS[t] = 1; }
});
const LABEL_FIELD = new Int8Array(N).fill(-1);
for (const [n, f] of [['METHOD_ENTRY', 4], ['CONSTRUCTOR_ENTRY', 5], ['SYSTEM_METHOD_ENTRY', 3], ['CODE_UNIT_STARTED', 4], ['VF_APEX_CALL_START', 3]]) LABEL_FIELD[idOf.get(n)] = f;
// Counter kind contributed by a leaf of this type: 1 soql, 2 dml, 3 sosl, 7 thrown (slot index + 1)
const OWN_COUNT = new Int8Array(N);
OWN_COUNT[idOf.get('SOQL_EXECUTE_BEGIN')] = 1; OWN_COUNT[idOf.get('DML_BEGIN')] = 2; OWN_COUNT[idOf.get('SOSL_EXECUTE_BEGIN')] = 3; OWN_COUNT[idOf.get('EXCEPTION_THROWN')] = 7;
const ROWS_FROM_EXIT = new Int8Array(N); // exit type -> row-count slot (+1)
ROWS_FROM_EXIT[idOf.get('SOQL_EXECUTE_END')] = 4; ROWS_FROM_EXIT[idOf.get('SOSL_EXECUTE_END')] = 6;
const HEAP = idOf.get('HEAP_ALLOCATE'), EXEC = idOf.get('EXECUTION_STARTED');
const HB = 4096, H_TAB = new Int16Array(HB).fill(-1), NAME_HASH = new Int32Array(N), NAME_LEN = new Uint8Array(N);
for (let i = 1; i < N; i++) {
  let h = 0; for (const ch of names[i]) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  NAME_HASH[i] = h; NAME_LEN[i] = names[i].length; let k = h & (HB - 1); while (H_TAB[k] !== -1) k = (k + 1) & (HB - 1); H_TAB[k] = i;
}
export const NC = 8;
const LN_NULL = -2, LN_EXTERNAL = -1;

function grow(a, n) { const b = new a.constructor(n); b.set(a.subarray(0, Math.min(a.length, n))); return b; }

export function scanV4(src, opts = {}) {
  const methodStats = opts.methodStats !== false;
  const len = src.length;
  let cap = Math.max(1 << 12, Math.ceil(len / 120)), n = 0;
  let type = new Uint16Array(cap), start = new Uint32Array(cap), end = new Uint32Array(cap), ts = new Float64Array(cap),
    exitTs = new Float64Array(cap), parent = new Int32Array(cap), subEnd = new Uint32Array(cap), depth = new Uint16Array(cap),
    lineNo = new Int32Array(cap), label = new Int32Array(cap), ns = new Int32Array(cap), selfDur = new Float64Array(cap),
    cslot = new Int32Array(cap), heap = new Float64Array(cap), peak = new Float64Array(cap);
  let pCap = 1 << 10, nSlots = 0, pool = new Int32Array(pCap * NC);
  let sCap = 1 << 12, nStr = 0, strStart = new Uint32Array(sCap), strEnd = new Uint32Array(sCap), strHash = new Int32Array(sCap);
  let IB = 1 << 14, iTab = new Int32Array(IB).fill(-1);
  let mCap = 1 << 12, mCalls = new Uint32Array(mCap), mSelf = new Float64Array(mCap), mTotal = new Float64Array(mCap), mActive = new Uint16Array(mCap);
  const byTypeN = new Uint32Array(N), byType = new Array(N); for (let t = 0; t < N; t++) byType[t] = new Uint32Array(8);
  const stack = new Int32Array(16384); let sp = 0, last = -1, running = 0, unmatchedExits = 0;
  // root row 0
  type[0] = 0; parent[0] = -1; label[0] = -1; ns[0] = -1; cslot[0] = -1; n = 1; stack[sp++] = 0;
  let pos = 0;
  while (pos < len) {
    let eol = src.indexOf(10, pos); if (eol < 0) eol = len;
    let lineEnd = eol; if (lineEnd > pos && src[lineEnd - 1] === 13) lineEnd--;
    if (src[pos + 2] === 58 && src[pos + 5] === 58) {
      let i = pos + 8; while (i < lineEnd && src[i] !== 40) i++; i++;
      let t = 0, c = 0; while ((c = src[i]) !== 41 && i < lineEnd) { t = t * 10 + (c - 48); i++; }
      i += 2; const t0 = i;
      let h = 0; while (i < lineEnd && (c = src[i]) !== 124) { h = (Math.imul(h, 31) + c) | 0; i++; }
      let k = h & (HB - 1), id = 0;
      for (let e; (e = H_TAB[k]) !== -1; k = (k + 1) & (HB - 1)) if (NAME_HASH[e] === h && NAME_LEN[e] === i - t0) { id = e; break; }
      if (id === 0) { pos = eol + 1; continue; } // unsupported name: a parsing error in the real engine
      let ln = LN_NULL;
      if (src[i] === 124 && src[i + 1] === 91) { let j = i + 2; if (src[j] === 69) ln = LN_EXTERNAL; else { ln = 0; while ((c = src[j]) >= 48 && c <= 57) { ln = ln * 10 + (c - 48); j++; } } }
      if (last >= 0 && NEXT_IS_EXIT[type[last]] && exitTs[last] === 0) exitTs[last] = t;
      if (PURE_EXIT[id]) {
        // find the frame this exit closes: the top, or one further down (unwind)
        let m = sp - 1;
        for (; m > 0; m--) { const f = stack[m], fl = lineNo[f]; if (EXIT_MATCH[type[f] * N + id] && (ln === fl || ln < 0 || fl < 0)) break; }
        if (m > 0) {
          const rs = ROWS_FROM_EXIT[id];
          if (rs) { // Rows:N from the exit line, onto the frame being closed
            let j = lineEnd - 1; while (j > i && src[j] !== 58) j--; let rows = 0; j++; while (j < lineEnd && (c = src[j]) >= 48 && c <= 57) { rows = rows * 10 + (c - 48); j++; }
            const f = stack[m]; let sl = cslot[f]; if (sl < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } sl = cslot[f] = nSlots++; } pool[sl * NC + rs - 1] += rows;
          }
          while (sp > m) {
            const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n;
            const p = parent[e];
            selfDur[p] -= tot; const ck = cslot[e];
            if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } const pb = pk * NC, cb = ck * NC; for (let q = 0; q < NC; q++) pool[pb + q] += pool[cb + q]; }
            heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e];
            if (methodStats) { const l = label[e]; if (l >= 0) { if (--mActive[l] === 0) mTotal[l] += tot; mSelf[l] += selfDur[e]; } }
          }
          last = -1; pos = eol + 1; continue;
        }
        unmatchedExits++; // kept as a leaf row, as today
      }
      if (n === cap) { cap *= 2; type = grow(type, cap); start = grow(start, cap); end = grow(end, cap); ts = grow(ts, cap); exitTs = grow(exitTs, cap); parent = grow(parent, cap); subEnd = grow(subEnd, cap); depth = grow(depth, cap); lineNo = grow(lineNo, cap); label = grow(label, cap); ns = grow(ns, cap); selfDur = grow(selfDur, cap); cslot = grow(cslot, cap); heap = grow(heap, cap); peak = grow(peak, cap); }
      if (id === EXEC) {
        while (sp > 1) { const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; selfDur[p] -= tot; heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; const ck = cslot[e]; if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } for (let q = 0; q < NC; q++) pool[pk * NC + q] += pool[ck * NC + q]; } }
      }
      const e = n++; const p = stack[sp - 1];
      type[e] = id; start[e] = pos; end[e] = lineEnd; ts[e] = t; lineNo[e] = ln; label[e] = -1; ns[e] = -1; cslot[e] = -1;
      parent[e] = p; depth[e] = sp - 1; subEnd[e] = e + 1;
      const lf = LABEL_FIELD[id];
      if (lf > 0) {
        let f = 2, a = i; while (f < lf && a < lineEnd) { a++; while (a < lineEnd && src[a] !== 124) a++; f++; }
        a++; let b = a; while (b < lineEnd && src[b] !== 124) b++;
        if (a < b) {
          // intern [a,b), then the namespace prefix [a,d)
          for (let pass = 0; pass < 2; pass++) {
            let lo = a, hi = b;
            if (pass === 1) { let d = a; while (d < b && src[d] !== 46) d++; if (d === b) break; hi = d; }
            let hh = 0; for (let q = lo; q < hi; q++) hh = (Math.imul(hh, 31) + src[q]) | 0;
            let kk = hh & (IB - 1), sid = -1;
            for (let s2; (s2 = iTab[kk]) !== -1; kk = (kk + 1) & (IB - 1)) {
              if (strHash[s2] === hh && strEnd[s2] - strStart[s2] === hi - lo) { let x = strStart[s2], y = lo; while (y < hi && src[y] === src[x]) { x++; y++; } if (y === hi) { sid = s2; break; } }
            }
            if (sid < 0) {
              if (nStr === sCap) { sCap *= 2; strStart = grow(strStart, sCap); strEnd = grow(strEnd, sCap); strHash = grow(strHash, sCap); }
              sid = nStr++; strStart[sid] = lo; strEnd[sid] = hi; strHash[sid] = hh; iTab[kk] = sid;
              if (nStr * 2 > IB) { IB *= 2; iTab = new Int32Array(IB).fill(-1); for (let s3 = 0; s3 < nStr; s3++) { let k3 = strHash[s3] & (IB - 1); while (iTab[k3] !== -1) k3 = (k3 + 1) & (IB - 1); iTab[k3] = s3; } }
            }
            if (pass === 0) label[e] = sid; else ns[e] = sid;
          }
        }
      }
      if (byTypeN[id] === byType[id].length) byType[id] = grow(byType[id], byType[id].length * 2);
      byType[id][byTypeN[id]++] = e;
      const own = OWN_COUNT[id];
      if (own) { let sl = cslot[e]; if (sl < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } sl = cslot[e] = nSlots++; } pool[sl * NC + own - 1] = 1; }
      else if (id === HEAP) { let j = lineEnd - 1; while (j > i && src[j] !== 58) j--; let b = 0, neg = false; j++; if (src[j] === 45) { neg = true; j++; } while (j < lineEnd && (c = src[j]) >= 48 && c <= 57) { b = b * 10 + (c - 48); j++; } if (neg) b = -b; heap[e] = b; running = running + b; if (running < 0) running = 0; peak[e] = running; }
      if (HAS_EXITS[id]) {
        stack[sp++] = e;
        if (methodStats) { const l = label[e]; if (l >= 0) { if (l >= mCap) { mCap = Math.max(mCap * 2, l + 1); mCalls = grow(mCalls, mCap); mSelf = grow(mSelf, mCap); mTotal = grow(mTotal, mCap); mActive = grow(mActive, mCap); } mCalls[l]++; mActive[l]++; } }
      } else {
        // a leaf rolls straight into its parent
        const ck = cslot[e]; if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } for (let q = 0; q < NC; q++) pool[pk * NC + q] += pool[ck * NC + q]; }
        heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e];
      }
      last = e;
    } else if (last >= 0 && ACCEPTS[type[last]] && src[pos] !== 42) {
      end[last] = lineEnd;
    }
    pos = eol + 1;
  }
  const lastTs = n > 1 ? ts[n - 1] : 0;
  while (sp > 1) { const e = stack[--sp]; exitTs[e] = lastTs; const tot = lastTs - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; selfDur[p] -= tot; heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; }
  ts[0] = n > 1 ? ts[1] : 0; exitTs[0] = lastTs; subEnd[0] = n;
  return { n, src, type, start, end, ts, exitTs, parent, subEnd, depth, lineNo, label, ns, selfDur, cslot, pool, nSlots, heap, peak, strStart, strEnd, nStr, byType, byTypeN, mCalls, mSelf, mTotal, unmatchedExits };
}
````

### `scan-v5.mjs`

````js
// Prototype v5: v4 with label hashing fused into the field scan, namespace derived once per
// distinct label, end offsets stored only for wrapped rows. (Header from v4 follows.)
// Prototype v4: v3's output shape, tuned. One function, no closures in the loop. Adds today's
// line-number exit matching, unwinding to a match further down the stack, unmatched exits kept
// as rows, SOQL/SOSL rows read from the exit line, and a root row 0. Still omits issues text,
// limits, truncation, package merge, flow residuals, discontinuity and the per-event text rules.
import { readFileSync } from 'node:fs';

const table = JSON.parse(readFileSync(new URL('./type-table.json', import.meta.url), 'utf8'));
export const names = ['<root>', ...table.map((r) => r.name)];
const N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
export const PURE_EXIT = new Uint8Array(N);
const NEXT_IS_EXIT = new Uint8Array(N), ACCEPTS = new Uint8Array(N), HAS_EXITS = new Uint8Array(N), EXIT_MATCH = new Uint8Array(N * N);
table.forEach((r, i) => {
  const t = i + 1;
  PURE_EXIT[t] = r.isExit && !(r.exitTypes?.length) ? 1 : 0;
  NEXT_IS_EXIT[t] = r.nextLineIsExit ? 1 : 0; ACCEPTS[t] = r.acceptsText ? 1 : 0;
  for (const x of r.exitTypes ?? []) { EXIT_MATCH[t * N + idOf.get(x)] = 1; HAS_EXITS[t] = 1; }
});
const LABEL_FIELD = new Int8Array(N).fill(-1);
for (const [n, f] of [['METHOD_ENTRY', 4], ['CONSTRUCTOR_ENTRY', 5], ['SYSTEM_METHOD_ENTRY', 3], ['CODE_UNIT_STARTED', 4], ['VF_APEX_CALL_START', 3]]) LABEL_FIELD[idOf.get(n)] = f;
// Counter kind contributed by a leaf of this type: 1 soql, 2 dml, 3 sosl, 7 thrown (slot index + 1)
const OWN_COUNT = new Int8Array(N);
OWN_COUNT[idOf.get('SOQL_EXECUTE_BEGIN')] = 1; OWN_COUNT[idOf.get('DML_BEGIN')] = 2; OWN_COUNT[idOf.get('SOSL_EXECUTE_BEGIN')] = 3; OWN_COUNT[idOf.get('EXCEPTION_THROWN')] = 7;
const ROWS_FROM_EXIT = new Int8Array(N); // exit type -> row-count slot (+1)
ROWS_FROM_EXIT[idOf.get('SOQL_EXECUTE_END')] = 4; ROWS_FROM_EXIT[idOf.get('SOSL_EXECUTE_END')] = 6;
const HEAP = idOf.get('HEAP_ALLOCATE'), EXEC = idOf.get('EXECUTION_STARTED');
const HB = 4096, H_TAB = new Int16Array(HB).fill(-1), NAME_HASH = new Int32Array(N), NAME_LEN = new Uint8Array(N);
for (let i = 1; i < N; i++) {
  let h = 0; for (const ch of names[i]) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  NAME_HASH[i] = h; NAME_LEN[i] = names[i].length; let k = h & (HB - 1); while (H_TAB[k] !== -1) k = (k + 1) & (HB - 1); H_TAB[k] = i;
}
export const NC = 8;
const LN_NULL = -2, LN_EXTERNAL = -1;

function grow(a, n) { const b = new a.constructor(n); b.set(a.subarray(0, Math.min(a.length, n))); return b; }

export function scanV5(src, opts = {}) {
  const verify = opts.verify !== false;
  const methodStats = opts.methodStats !== false;
  const len = src.length;
  let cap = Math.max(1 << 12, Math.ceil(len / 120)), n = 0;
  let type = new Uint16Array(cap), start = new Uint32Array(cap), ts = new Float64Array(cap),
    exitTs = new Float64Array(cap), parent = new Int32Array(cap), subEnd = new Uint32Array(cap), depth = new Uint16Array(cap),
    lineNo = new Int32Array(cap), label = new Int32Array(cap), ns = new Int32Array(cap), selfDur = new Float64Array(cap),
    cslot = new Int32Array(cap), heap = new Float64Array(cap), peak = new Float64Array(cap);
  let pCap = 1 << 10, nSlots = 0, pool = new Int32Array(pCap * NC);
  let sCap = 1 << 12, nStr = 0, strStart = new Uint32Array(sCap), strEnd = new Uint32Array(sCap), strHash = new Int32Array(sCap);
  let IB = 1 << 14, iTab = new Int32Array(IB).fill(-1);
  let mCap = 1 << 12, mCalls = new Uint32Array(mCap), mSelf = new Float64Array(mCap), mTotal = new Float64Array(mCap), mActive = new Uint16Array(mCap);
  const byTypeN = new Uint32Array(N), byType = new Array(N); for (let t = 0; t < N; t++) byType[t] = new Uint32Array(8);
  const wrappedEnd = new Map(); let nsOfLabel = new Int32Array(1 << 12).fill(-2);
  const stack = new Int32Array(16384); let sp = 0, last = -1, running = 0, unmatchedExits = 0;
  // root row 0
  type[0] = 0; parent[0] = -1; label[0] = -1; ns[0] = -1; cslot[0] = -1; n = 1; stack[sp++] = 0;
  let pos = 0;
  while (pos < len) {
    let eol = src.indexOf(10, pos); if (eol < 0) eol = len;
    let lineEnd = eol; if (lineEnd > pos && src[lineEnd - 1] === 13) lineEnd--;
    if (src[pos + 2] === 58 && src[pos + 5] === 58) {
      let i = pos + 8; while (i < lineEnd && src[i] !== 40) i++; i++;
      let t = 0, c = 0; while ((c = src[i]) !== 41 && i < lineEnd) { t = t * 10 + (c - 48); i++; }
      i += 2; const t0 = i;
      let h = 0; while (i < lineEnd && (c = src[i]) !== 124) { h = (Math.imul(h, 31) + c) | 0; i++; }
      let k = h & (HB - 1), id = 0;
      for (let e; (e = H_TAB[k]) !== -1; k = (k + 1) & (HB - 1)) if (NAME_HASH[e] === h && NAME_LEN[e] === i - t0) { id = e; break; }
      if (id === 0) { pos = eol + 1; continue; } // unsupported name: a parsing error in the real engine
      let ln = LN_NULL;
      if (src[i] === 124 && src[i + 1] === 91) { let j = i + 2; if (src[j] === 69) ln = LN_EXTERNAL; else { ln = 0; while ((c = src[j]) >= 48 && c <= 57) { ln = ln * 10 + (c - 48); j++; } } }
      if (last >= 0 && NEXT_IS_EXIT[type[last]] && exitTs[last] === 0) exitTs[last] = t;
      if (PURE_EXIT[id]) {
        // find the frame this exit closes: the top, or one further down (unwind)
        let m = sp - 1;
        for (; m > 0; m--) { const f = stack[m], fl = lineNo[f]; if (EXIT_MATCH[type[f] * N + id] && (ln === fl || ln < 0 || fl < 0)) break; }
        if (m > 0) {
          const rs = ROWS_FROM_EXIT[id];
          if (rs) { // Rows:N from the exit line, onto the frame being closed
            let j = lineEnd - 1; while (j > i && src[j] !== 58) j--; let rows = 0; j++; while (j < lineEnd && (c = src[j]) >= 48 && c <= 57) { rows = rows * 10 + (c - 48); j++; }
            const f = stack[m]; let sl = cslot[f]; if (sl < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } sl = cslot[f] = nSlots++; } pool[sl * NC + rs - 1] += rows;
          }
          while (sp > m) {
            const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n;
            const p = parent[e];
            selfDur[p] -= tot; const ck = cslot[e];
            if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } const pb = pk * NC, cb = ck * NC; for (let q = 0; q < NC; q++) pool[pb + q] += pool[cb + q]; }
            heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e];
            if (methodStats) { const l = label[e]; if (l >= 0) { if (--mActive[l] === 0) mTotal[l] += tot; mSelf[l] += selfDur[e]; } }
          }
          last = -1; pos = eol + 1; continue;
        }
        unmatchedExits++; // kept as a leaf row, as today
      }
      if (n === cap) { cap *= 2; type = grow(type, cap); start = grow(start, cap); ts = grow(ts, cap); exitTs = grow(exitTs, cap); parent = grow(parent, cap); subEnd = grow(subEnd, cap); depth = grow(depth, cap); lineNo = grow(lineNo, cap); label = grow(label, cap); ns = grow(ns, cap); selfDur = grow(selfDur, cap); cslot = grow(cslot, cap); heap = grow(heap, cap); peak = grow(peak, cap); }
      if (id === EXEC) {
        while (sp > 1) { const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; selfDur[p] -= tot; heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; const ck = cslot[e]; if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } for (let q = 0; q < NC; q++) pool[pk * NC + q] += pool[ck * NC + q]; } }
      }
      const e = n++; const p = stack[sp - 1];
      type[e] = id; start[e] = pos; ts[e] = t; lineNo[e] = ln; label[e] = -1; ns[e] = -1; cslot[e] = -1;
      parent[e] = p; depth[e] = sp - 1; subEnd[e] = e + 1;
      const lf = LABEL_FIELD[id];
      if (lf > 0) {
        let f = 2, a = i; while (f < lf && a < lineEnd) { a++; while (a < lineEnd && src[a] !== 124) a++; f++; }
        a++; let b = a, hh = 0, dot = -1;
        while (b < lineEnd && (c = src[b]) !== 124) { hh = (Math.imul(hh, 31) + c) | 0; if (c === 46 && dot < 0) dot = b; b++; }
        if (a < b) {
          let kk = hh & (IB - 1), sid = -1;
          for (let s2; (s2 = iTab[kk]) !== -1; kk = (kk + 1) & (IB - 1)) {
            if (strHash[s2] === hh && strEnd[s2] - strStart[s2] === b - a) {
              if (!verify) { sid = s2; break; }
              let x = strStart[s2], y = a; while (y < b && src[y] === src[x]) { x++; y++; } if (y === b) { sid = s2; break; }
            }
          }
          if (sid < 0) {
            if (nStr + 2 >= sCap) { sCap *= 2; strStart = grow(strStart, sCap); strEnd = grow(strEnd, sCap); strHash = grow(strHash, sCap); }
            sid = nStr++; strStart[sid] = a; strEnd[sid] = b; strHash[sid] = hh; iTab[kk] = sid;
            if (nStr * 2 > IB) { IB *= 2; iTab = new Int32Array(IB).fill(-1); for (let s3 = 0; s3 < nStr; s3++) { let k3 = strHash[s3] & (IB - 1); while (iTab[k3] !== -1) k3 = (k3 + 1) & (IB - 1); iTab[k3] = s3; } }
          }
          label[e] = sid;
          if (sid >= nsOfLabel.length) { const o = nsOfLabel; nsOfLabel = new Int32Array(o.length * 2).fill(-2); nsOfLabel.set(o); }
          let nsid = nsOfLabel[sid];
          if (nsid === -2) {
            // first sight of this label: intern its namespace prefix once
            nsid = -1;
            if (dot > a) {
              let h2 = 0; for (let q = a; q < dot; q++) h2 = (Math.imul(h2, 31) + src[q]) | 0;
              let k2 = h2 & (IB - 1);
              for (let s2; (s2 = iTab[k2]) !== -1; k2 = (k2 + 1) & (IB - 1)) { if (strHash[s2] === h2 && strEnd[s2] - strStart[s2] === dot - a) { let x = strStart[s2], y = a; while (y < dot && src[y] === src[x]) { x++; y++; } if (y === dot) { nsid = s2; break; } } }
              if (nsid < 0) { nsid = nStr++; strStart[nsid] = a; strEnd[nsid] = dot; strHash[nsid] = h2; iTab[k2] = nsid; if (nStr * 2 > IB) { IB *= 2; iTab = new Int32Array(IB).fill(-1); for (let s3 = 0; s3 < nStr; s3++) { let k3 = strHash[s3] & (IB - 1); while (iTab[k3] !== -1) k3 = (k3 + 1) & (IB - 1); iTab[k3] = s3; } } }
            }
            nsOfLabel[sid] = nsid;
          }
          ns[e] = nsid;
        }
      }
      if (byTypeN[id] === byType[id].length) byType[id] = grow(byType[id], byType[id].length * 2);
      byType[id][byTypeN[id]++] = e;
      const own = OWN_COUNT[id];
      if (own) { let sl = cslot[e]; if (sl < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } sl = cslot[e] = nSlots++; } pool[sl * NC + own - 1] = 1; }
      else if (id === HEAP) { let j = lineEnd - 1; while (j > i && src[j] !== 58) j--; let b = 0, neg = false; j++; if (src[j] === 45) { neg = true; j++; } while (j < lineEnd && (c = src[j]) >= 48 && c <= 57) { b = b * 10 + (c - 48); j++; } if (neg) b = -b; heap[e] = b; running = running + b; if (running < 0) running = 0; peak[e] = running; }
      if (HAS_EXITS[id]) {
        stack[sp++] = e;
        if (methodStats) { const l = label[e]; if (l >= 0) { if (l >= mCap) { mCap = Math.max(mCap * 2, l + 1); mCalls = grow(mCalls, mCap); mSelf = grow(mSelf, mCap); mTotal = grow(mTotal, mCap); mActive = grow(mActive, mCap); } mCalls[l]++; mActive[l]++; } }
      } else {
        // a leaf rolls straight into its parent
        const ck = cslot[e]; if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } for (let q = 0; q < NC; q++) pool[pk * NC + q] += pool[ck * NC + q]; }
        heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e];
      }
      last = e;
    } else if (last >= 0 && ACCEPTS[type[last]] && src[pos] !== 42) {
      wrappedEnd.set(last, lineEnd);
    }
    pos = eol + 1;
  }
  const lastTs = n > 1 ? ts[n - 1] : 0;
  while (sp > 1) { const e = stack[--sp]; exitTs[e] = lastTs; const tot = lastTs - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; selfDur[p] -= tot; heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; }
  ts[0] = n > 1 ? ts[1] : 0; exitTs[0] = lastTs; subEnd[0] = n;
  return { n, src, type, start, wrappedEnd, ts, exitTs, parent, subEnd, depth, lineNo, label, ns, selfDur, cslot, pool, nSlots, heap, peak, strStart, strEnd, nStr, byType, byTypeN, mCalls, mSelf, mTotal, unmatchedExits };
}
````

### `v4bench.mjs`

````js
import { readFileSync } from 'node:fs';
import { scanV3 } from './scan-v3.mjs';
import { scanV4 } from './scan-v4.mjs';
function time(fn, runs = 9) { fn(); fn(); const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return [ts[runs >> 1], ts[1], ts[runs - 2]]; }
const trimmedBytes = (o) => { let t = 0; for (const [k, v] of Object.entries(o)) { if (!ArrayBuffer.isView(v) || k === 'src') continue; if (k === 'pool') t += o.nSlots * 8 * 4; else if (k.startsWith('str')) t += o.nStr * v.BYTES_PER_ELEMENT; else if (k.startsWith('m')) t += v.byteLength; else t += o.n * v.BYTES_PER_ELEMENT; } return t; };
const dir = process.argv[2]; const files = process.argv.slice(3);
for (const f of files) {
  const b = new Uint8Array(readFileSync(`${dir}/${f}`));
  const s3 = scanV3(b), s4 = scanV4(b);
  const [m3, lo3, hi3] = time(() => scanV3(b)), [m4, lo4, hi4] = time(() => scanV4(b)), [m4n] = time(() => scanV4(b, { methodStats: false }));
  console.log(`== ${f} (${(b.length / 1e6).toFixed(0)} MB)`);
  console.log(`v3 ${m3.toFixed(0)} ms [${lo3.toFixed(0)}-${hi3.toFixed(0)}] rows ${s3.n} strings ${s3.nStr}`);
  console.log(`v4 ${m4.toFixed(0)} ms [${lo4.toFixed(0)}-${hi4.toFixed(0)}] rows ${s4.n} strings ${s4.nStr} unmatched exits ${s4.unmatchedExits} columns ${(trimmedBytes(s4) / 1e6).toFixed(1)} MB; without method stats ${m4n.toFixed(0)} ms`);
  console.log(`   throughput v4 ${(b.length / 1e6 / (m4 / 1000)).toFixed(0)} MB/s`);
}
````

### `v5bench.mjs`

````js
import { readFileSync } from 'node:fs';
import { scanV4 } from './scan-v4.mjs';
import { scanV5 } from './scan-v5.mjs';
function time(fn, runs = 9) { fn(); fn(); const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[runs >> 1]; }
const dir = process.argv[2];
for (const f of process.argv.slice(3)) {
  const b = new Uint8Array(readFileSync(`${dir}/${f}`));
  const a4 = scanV4(b), a5 = scanV5(b);
  let same = a4.n === a5.n; for (let i = 0; same && i < a4.n; i++) if (a4.ts[i] !== a5.ts[i] || a4.exitTs[i] !== a5.exitTs[i] || a4.parent[i] !== a5.parent[i] || a4.selfDur[i] !== a5.selfDur[i]) same = false;
  console.log(`== ${f} (${(b.length / 1e6).toFixed(0)} MB): rows ${a5.n}, strings ${a5.nStr}, v4==v5 tree ${same}`);
  const t4 = time(() => scanV4(b)), t5 = time(() => scanV5(b)), t5n = time(() => scanV5(b, { verify: false }));
  console.log(`v4 ${t4.toFixed(0)} ms | v5 ${t5.toFixed(0)} ms (${(b.length / 1e6 / (t5 / 1000)).toFixed(0)} MB/s) | v5 without byte verify ${t5n.toFixed(0)} ms`);
}
````

### `prof4.mjs`

````js
import { readFileSync } from 'node:fs';
import { scanV4 } from './scan-v4.mjs';
const b = new Uint8Array(readFileSync(process.argv[2]));
for (let i = 0; i < 12; i++) scanV4(b);
````

### `make-hc.py`

````python
# High-cardinality variant of a synthetic log: 20k distinct classes, ~100k distinct signatures,
# entry/exit pairs keep the same name, 5% of USER_DEBUG messages carry non-ASCII text.
import random, sys
random.seed(7)
src, dst = sys.argv[1], sys.argv[2]
stack = []
uni = ['ü', 'é', '日本語', 'Ω', '—']
with open(src, encoding='utf-8') as fi, open(dst, 'w', encoding='utf-8') as fo:
    for line in fi:
        p = line.rstrip('\n').split('|')
        if len(p) > 4 and p[1] in ('METHOD_ENTRY', 'CONSTRUCTOR_ENTRY'):
            c = random.randrange(20000); m = random.randrange(5)
            sig = p[4]
            dot = sig.find('.')
            name = f"ns.MyClass{c}.method{m}{sig[sig.find('('):] if '(' in sig else '()'}"
            p[4] = name; stack.append(name)
        elif len(p) > 4 and p[1] in ('METHOD_EXIT', 'CONSTRUCTOR_EXIT'):
            if stack: p[4] = stack.pop()
        elif len(p) > 4 and p[1] == 'USER_DEBUG' and random.random() < 0.05:
            p[4] = p[4] + ' ' + random.choice(uni) * 3
        fo.write('|'.join(p) + '\n')
````

### `hcbench.ts`

````ts
import { readFileSync } from 'node:fs';
import { parse } from '../../src/index.js';
// @ts-expect-error js
import { scanV5 } from './scan-v5.mjs';
const gc = (globalThis as any).gc as () => void;
function bench(label: string, fn: () => unknown, runs = 5) { fn(); const ts: number[] = []; let heap = 0, keep: unknown; for (let r = 0; r < runs; r++) { keep = null; gc(); const b = process.memoryUsage(); const t = performance.now(); keep = fn(); ts.push(performance.now() - t); gc(); const a = process.memoryUsage(); heap = a.heapUsed + a.arrayBuffers - b.heapUsed - b.arrayBuffers; } void keep; ts.sort((x, y) => x - y); console.log(label.padEnd(46), `${ts[runs >> 1]!.toFixed(0)} ms`.padStart(8), `${(heap / 1e6).toFixed(0)} MB`.padStart(8)); }
for (const f of process.argv.slice(3)) {
  const path = `${process.argv[2]}/${f}`, str = readFileSync(path, 'utf8'), bytes = new Uint8Array(readFileSync(path));
  const s = scanV5(bytes);
  console.log(`== ${f}: ${(bytes.length / 1e6).toFixed(0)} MB, rows ${s.n}, interned strings ${s.nStr}, string ${str.length === bytes.length ? 'one-byte' : 'TWO-BYTE (non-Latin-1 present)'}`);
  bench('TODAY parse(string)', () => parse(str), 3);
  bench('v5 scan(bytes)', () => scanV5(bytes));
  bench('v5 scan(bytes), no byte verify', () => scanV5(bytes, { verify: false }));
}
````

### `par-stage1.mjs`

````js
// Stage 1 of a parallel scan (simdjson-style): per line, find type id, timestamp, line number,
// label byte range + hash, and the numbers stage 2 needs (heap bytes, exit rows). No tree.
import { readFileSync } from 'node:fs';
const table = JSON.parse(readFileSync(new URL('./type-table.json', import.meta.url), 'utf8'));
export const names = ['<root>', ...table.map((r) => r.name)];
const N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
const HB = 4096, H_TAB = new Int16Array(HB).fill(-1), NAME_HASH = new Int32Array(N), NAME_LEN = new Uint8Array(N);
for (let i = 1; i < N; i++) { let h = 0; for (const ch of names[i]) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; NAME_HASH[i] = h; NAME_LEN[i] = names[i].length; let k = h & (HB - 1); while (H_TAB[k] !== -1) k = (k + 1) & (HB - 1); H_TAB[k] = i; }
const LABEL_FIELD = new Int8Array(N).fill(-1);
for (const [n, f] of [['METHOD_ENTRY', 4], ['CONSTRUCTOR_ENTRY', 5], ['SYSTEM_METHOD_ENTRY', 3], ['CODE_UNIT_STARTED', 4], ['VF_APEX_CALL_START', 3]]) LABEL_FIELD[idOf.get(n)] = f;
const NUM_TAIL = new Uint8Array(N); NUM_TAIL[idOf.get('HEAP_ALLOCATE')] = 1; NUM_TAIL[idOf.get('SOQL_EXECUTE_END')] = 1; NUM_TAIL[idOf.get('SOSL_EXECUTE_END')] = 1;
export const WRAP = 0xffff;
export function stage1(src, from, to) {
  let cap = Math.ceil((to - from) / 100) + 1024, n = 0;
  let start = new Uint32Array(cap), type = new Uint16Array(cap), ts = new Float64Array(cap), ln = new Int32Array(cap), la = new Uint32Array(cap), lb = new Uint32Array(cap), lh = new Int32Array(cap), num = new Float64Array(cap);
  const g = (a, m) => { const b = new a.constructor(m); b.set(a); return b; };
  let pos = from;
  while (pos < to) {
    let eol = src.indexOf(10, pos); if (eol < 0 || eol > to) eol = to;
    let lineEnd = eol; if (lineEnd > pos && src[lineEnd - 1] === 13) lineEnd--;
    if (n === cap) { cap *= 2; start = g(start, cap); type = g(type, cap); ts = g(ts, cap); ln = g(ln, cap); la = g(la, cap); lb = g(lb, cap); lh = g(lh, cap); num = g(num, cap); }
    if (src[pos + 2] === 58 && src[pos + 5] === 58) {
      let i = pos + 8; while (i < lineEnd && src[i] !== 40) i++; i++;
      let t = 0, c = 0; while ((c = src[i]) !== 41 && i < lineEnd) { t = t * 10 + (c - 48); i++; }
      i += 2; const t0 = i;
      let h = 0; while (i < lineEnd && (c = src[i]) !== 124) { h = (Math.imul(h, 31) + c) | 0; i++; }
      let k = h & (HB - 1), id = 0;
      for (let e; (e = H_TAB[k]) !== -1; k = (k + 1) & (HB - 1)) if (NAME_HASH[e] === h && NAME_LEN[e] === i - t0) { id = e; break; }
      if (id === 0) { pos = eol + 1; continue; }
      let l = -2; if (src[i] === 124 && src[i + 1] === 91) { let j = i + 2; if (src[j] === 69) l = -1; else { l = 0; while ((c = src[j]) >= 48 && c <= 57) { l = l * 10 + (c - 48); j++; } } }
      const e = n++; start[e] = pos; type[e] = id; ts[e] = t; ln[e] = l; la[e] = 0; lb[e] = 0;
      const lf = LABEL_FIELD[id];
      if (lf > 0) { let f = 2, a = i; while (f < lf && a < lineEnd) { a++; while (a < lineEnd && src[a] !== 124) a++; f++; } a++; let b = a, hh = 0; while (b < lineEnd && (c = src[b]) !== 124) { hh = (Math.imul(hh, 31) + c) | 0; b++; } la[e] = a; lb[e] = b; lh[e] = hh; }
      if (NUM_TAIL[id]) { let j = lineEnd - 1; while (j > i && src[j] !== 58) j--; let v = 0, neg = false; j++; if (src[j] === 45) { neg = true; j++; } while (j < lineEnd && (c = src[j]) >= 48 && c <= 57) { v = v * 10 + (c - 48); j++; } num[e] = neg ? -v : v; }
    } else { const e = n++; start[e] = pos; type[e] = WRAP; }
    pos = eol + 1;
  }
  return { n, start, type, ts, ln, la, lb, lh, num };
}
````

### `par-worker.mjs`

````js
import { parentPort } from 'node:worker_threads';
import { stage1 } from './par-stage1.mjs';
parentPort.on('message', ({ sab, from, to }) => {
  const r = stage1(new Uint8Array(sab), from, to);
  const arrs = [r.start, r.type, r.ts, r.ln, r.la, r.lb, r.lh, r.num];
  parentPort.postMessage({ ...r }, arrs.map((a) => a.buffer));
});
````

### `par-bench.mjs`

````js
// Parallel stage 1 on W workers + sequential stage 2 (tree, rollups, interning) on the main thread.
import { readFileSync } from 'node:fs';
import { Worker } from 'node:worker_threads';
import { stage1, WRAP, names } from './par-stage1.mjs';
import { scanV5 } from './scan-v5.mjs';
const table = JSON.parse(readFileSync(new URL('./type-table.json', import.meta.url), 'utf8'));
const N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
const PURE_EXIT = new Uint8Array(N), HAS_EXITS = new Uint8Array(N), ACCEPTS = new Uint8Array(N), EXIT_MATCH = new Uint8Array(N * N);
table.forEach((r, i) => { const t = i + 1; PURE_EXIT[t] = r.isExit && !(r.exitTypes?.length) ? 1 : 0; ACCEPTS[t] = r.acceptsText ? 1 : 0; for (const x of r.exitTypes ?? []) { EXIT_MATCH[t * N + idOf.get(x)] = 1; HAS_EXITS[t] = 1; } });
const HEAP = idOf.get('HEAP_ALLOCATE');

function stage2(src, parts) {
  let total = 0; for (const p of parts) total += p.n;
  const type = new Uint16Array(total + 1), start = new Uint32Array(total + 1), ts = new Float64Array(total + 1), exitTs = new Float64Array(total + 1), parent = new Int32Array(total + 1), subEnd = new Uint32Array(total + 1), depth = new Uint16Array(total + 1), lineNo = new Int32Array(total + 1), label = new Int32Array(total + 1), selfDur = new Float64Array(total + 1), heap = new Float64Array(total + 1), peak = new Float64Array(total + 1);
  let IB = 1 << 14, iTab = new Int32Array(IB).fill(-1), sCap = 1 << 12, nStr = 0, sS = new Uint32Array(sCap), sE = new Uint32Array(sCap), sH = new Int32Array(sCap);
  const stack = new Int32Array(16384); let sp = 1, n = 1, last = -1, running = 0; stack[0] = 0; parent[0] = -1;
  for (const P of parts) {
    for (let r = 0; r < P.n; r++) {
      const id = P.type[r];
      if (id === WRAP) continue; // wrapped text: would extend `last` when ACCEPTS
      const t = P.ts[r], ln = P.ln[r];
      if (PURE_EXIT[id]) {
        let m = sp - 1; for (; m > 0; m--) { const f = stack[m], fl = lineNo[f]; if (EXIT_MATCH[type[f] * N + id] && (ln === fl || ln < 0 || fl < 0)) break; }
        if (m > 0) { while (sp > m) { const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; selfDur[p] -= tot; heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; } last = -1; continue; }
      }
      const e = n++; const p = stack[sp - 1];
      type[e] = id; start[e] = P.start[r]; ts[e] = t; lineNo[e] = ln; parent[e] = p; depth[e] = sp - 1; subEnd[e] = e + 1; label[e] = -1;
      const a = P.la[r], b = P.lb[r];
      if (b > a) {
        const hh = P.lh[r]; let kk = hh & (IB - 1), sid = -1;
        for (let s2; (s2 = iTab[kk]) !== -1; kk = (kk + 1) & (IB - 1)) if (sH[s2] === hh && sE[s2] - sS[s2] === b - a) { let x = sS[s2], y = a; while (y < b && src[y] === src[x]) { x++; y++; } if (y === b) { sid = s2; break; } }
        if (sid < 0) { if (nStr === sCap) { sCap *= 2; const g = (q) => { const z = new q.constructor(sCap); z.set(q); return z; }; sS = g(sS); sE = g(sE); sH = g(sH); } sid = nStr++; sS[sid] = a; sE[sid] = b; sH[sid] = hh; iTab[kk] = sid; if (nStr * 2 > IB) { IB *= 2; iTab = new Int32Array(IB).fill(-1); for (let s3 = 0; s3 < nStr; s3++) { let k3 = sH[s3] & (IB - 1); while (iTab[k3] !== -1) k3 = (k3 + 1) & (IB - 1); iTab[k3] = s3; } } }
        label[e] = sid;
      }
      if (id === HEAP) { const v = P.num[r]; heap[e] = v; running += v; if (running < 0) running = 0; peak[e] = running; }
      if (HAS_EXITS[id]) stack[sp++] = e; else { heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; }
      last = e;
    }
  }
  return { n, nStr, ts, exitTs, parent, selfDur };
}

function splits(src, w) { const out = [0]; for (let k = 1; k < w; k++) { let p = Math.floor((src.length * k) / w); p = src.indexOf(10, p) + 1; out.push(p); } out.push(src.length); return out; }
function time(fn, runs = 7) { const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[runs >> 1]; }
async function timeAsync(fn, runs = 7) { await fn(); await fn(); const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); await fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[runs >> 1]; }

const dir = process.argv[2];
const pool = Array.from({ length: 4 }, () => new Worker(new URL('./par-worker.mjs', import.meta.url)));
for (const f of process.argv.slice(3)) {
  const buf = readFileSync(`${dir}/${f}`); const sab = new SharedArrayBuffer(buf.length); const src = new Uint8Array(sab); src.set(buf);
  const plain = new Uint8Array(buf);
  console.log(`== ${f} (${(buf.length / 1e6).toFixed(0)} MB)`);
  console.log(`v5 single-thread scan: ${time(() => scanV5(plain)).toFixed(0)} ms`);
  const s1only = time(() => stage1(src, 0, src.length)); 
  const one = [stage1(src, 0, src.length)];
  const s2only = time(() => stage2(src, one));
  console.log(`stage 1 alone (1 thread): ${s1only.toFixed(0)} ms; stage 2 alone: ${s2only.toFixed(0)} ms`);
  for (const W of [2, 3, 4]) {
    const run = async () => { const sp = splits(src, W); const parts = await Promise.all(Array.from({ length: W }, (_, k) => new Promise((ok) => { pool[k].once('message', ok); pool[k].postMessage({ sab, from: sp[k], to: sp[k + 1] }); }))); return stage2(src, parts); };
    const r = await run(); const ref = scanV5(plain);
    console.log(`parallel W=${W}: ${(await timeAsync(run)).toFixed(0)} ms total  (rows ${r.n} vs v5 ${ref.n}, strings ${r.nStr})`);
  }
}
await Promise.all(pool.map((w) => w.terminate()));
````

### `layout.mjs`

````js
// Struct-of-arrays (one typed array per field) vs array-of-structs (Lezer/oxc style: fields
// interleaved in one buffer), on the real v5 rows: write cost, flame-chart read, tree walk.
import { readFileSync } from 'node:fs';
import { scanV5 } from './scan-v5.mjs';
const s = scanV5(new Uint8Array(readFileSync(process.argv[2])));
const n = s.n;
function time(fn, runs = 15) { for (let w = 0; w < 3; w++) fn(); const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[runs >> 1].toFixed(2).padStart(7) + ' ms'; }
// AoS: 8 x i32 per row (type, start, parent, subEnd, depth, lineNo, label, cslot) + 4 x f64 per row (ts, exitTs, selfDur, heap)
const I = 8, F = 4;
const writeSoA = () => { const c = { type: new Uint16Array(n), start: new Uint32Array(n), parent: new Int32Array(n), subEnd: new Uint32Array(n), depth: new Uint16Array(n), lineNo: new Int32Array(n), label: new Int32Array(n), cslot: new Int32Array(n), ts: new Float64Array(n), exitTs: new Float64Array(n), selfDur: new Float64Array(n), heap: new Float64Array(n) };
  for (let e = 0; e < n; e++) { c.type[e] = s.type[e]; c.start[e] = s.start[e]; c.parent[e] = s.parent[e]; c.subEnd[e] = s.subEnd[e]; c.depth[e] = s.depth[e]; c.lineNo[e] = s.lineNo[e]; c.label[e] = s.label[e]; c.cslot[e] = s.cslot[e]; c.ts[e] = s.ts[e]; c.exitTs[e] = s.exitTs[e]; c.selfDur[e] = s.selfDur[e]; c.heap[e] = s.heap[e]; } return c; };
const writeAoS = () => { const iv = new Int32Array(n * I), fv = new Float64Array(n * F);
  for (let e = 0; e < n; e++) { const b = e * I, f = e * F; iv[b] = s.type[e]; iv[b + 1] = s.start[e]; iv[b + 2] = s.parent[e]; iv[b + 3] = s.subEnd[e]; iv[b + 4] = s.depth[e]; iv[b + 5] = s.lineNo[e]; iv[b + 6] = s.label[e]; iv[b + 7] = s.cslot[e]; fv[f] = s.ts[e]; fv[f + 1] = s.exitTs[e]; fv[f + 2] = s.selfDur[e]; fv[f + 3] = s.heap[e]; } return { iv, fv }; };
const soa = writeSoA(), aos = writeAoS();
console.log(`rows ${n}`);
console.log('write all fields      SoA', time(writeSoA), ' AoS', time(writeAoS));
console.log('flame chart read      SoA', time(() => { let x = 0; for (let e = 0; e < n; e++) if (soa.exitTs[e] > 0) x += soa.ts[e] + soa.exitTs[e] + soa.depth[e] + soa.type[e]; return x; }),
  ' AoS', time(() => { let x = 0; const { iv, fv } = aos; for (let e = 0; e < n; e++) { const f = e * F; if (fv[f + 1] > 0) x += fv[f] + fv[f + 1] + iv[e * I + 4] + iv[e * I]; } return x; }));
console.log('one column (exitTs)   SoA', time(() => { let x = 0; for (let e = 0; e < n; e++) x += soa.exitTs[e]; return x; }), ' AoS', time(() => { let x = 0; const fv = aos.fv; for (let e = 0; e < n; e++) x += fv[e * F + 1]; return x; }));
console.log('tree walk (children)  SoA', time(() => { let x = 0; for (let e = 0; e < n; e++) for (let c = e + 1; c < soa.subEnd[e]; c = soa.subEnd[c]) x += soa.label[c]; return x; }),
  ' AoS', time(() => { let x = 0; const iv = aos.iv; for (let e = 0; e < n; e++) for (let c = e + 1; c < iv[e * I + 3]; c = iv[c * I + 3]) x += iv[c * I + 6]; return x; }));
console.log('bytes                 SoA', (Object.values(soa).reduce((a, v) => a + v.byteLength, 0) / 1e6).toFixed(1), 'MB  AoS', ((aos.iv.byteLength + aos.fv.byteLength) / 1e6).toFixed(1), 'MB (AoS cannot use narrow 16-bit fields without packing)');
````

### `nl.mjs`

````js
// Finding line ends: Uint8Array.indexOf (V8 scalar builtin) vs Node Buffer.indexOf (memchr) vs a JS loop vs String.indexOf.
import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]); const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.length); const str = buf.toString('latin1');
function time(fn, runs = 9) { fn(); fn(); const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[runs >> 1].toFixed(1).padStart(6) + ' ms'; }
console.log('Uint8Array.indexOf(10)', time(() => { let c = 0, p = 0; while ((p = u8.indexOf(10, p) + 1) > 0) c++; return c; }));
console.log('Buffer.indexOf(10)    ', time(() => { let c = 0, p = 0; while ((p = buf.indexOf(10, p) + 1) > 0) c++; return c; }));
console.log('JS byte loop          ', time(() => { let c = 0; const n = u8.length; for (let i = 0; i < n; i++) if (u8[i] === 10) c++; return c; }));
console.log('string.indexOf("\\n")  ', time(() => { let c = 0, p = 0; while ((p = str.indexOf('\n', p) + 1) > 0) c++; return c; }));
````

### `swar.mjs`

````js
// SWAR newline search: 4 bytes at a time on a Uint32Array view with the has-zero-byte trick.
import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]); const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
const n = u8.length, w = new Uint32Array(u8.buffer, u8.byteOffset, n >>> 2);
function nextNl(p) {
  while (p < n && (p & 3) !== 0) { if (u8[p] === 10) return p; p++; }
  const kEnd = n >>> 2; let k = p >>> 2;
  for (; k < kEnd; k++) { const x = (w[k] ^ 0x0a0a0a0a) | 0; if ((((x - 0x01010101) & ~x) & 0x80808080) !== 0) break; }
  const q = k << 2; if (q > p) p = q; while (p < n) { if (u8[p] === 10) return p; p++; } return -1;
}
const run = () => { let c = 0, p = 0; while ((p = nextNl(p)) >= 0) { c++; p++; } return c; };
let t = performance.now(); console.log('byteOffset', u8.byteOffset, 'lines', run(), (performance.now() - t).toFixed(1), 'ms first');
const ts = []; for (let r = 0; r < 7; r++) { t = performance.now(); run(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); console.log('SWAR median', ts[3].toFixed(1), 'ms');
````

### `wasm/stage1.c`

````c
// Stage-1 scanner in C, identical logic to par-stage1.mjs: per line -> start, type id, ts, line
// number, label range + hash, tail number. Built native (upper bound) and as WASM (with/without SIMD).
#include <stdint.h>
#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif
#define HB 4096
int16_t H_TAB[HB]; int32_t NAME_HASH[512]; uint8_t NAME_LEN[512]; int8_t LABEL_FIELD[512]; uint8_t NUM_TAIL[512];

static inline uint32_t next_nl(const uint8_t *s, uint32_t p, uint32_t n) {
#ifdef __wasm_simd128__
  v128_t nl = wasm_i8x16_splat(10);
  while (p + 16 <= n) {
    v128_t v = wasm_v128_load(s + p);
    uint32_t m = wasm_i8x16_bitmask(wasm_i8x16_eq(v, nl));
    if (m) return p + __builtin_ctz(m);
    p += 16;
  }
#endif
  while (p < n) { if (s[p] == 10) return p; p++; }
  return n;
}

uint32_t stage1(const uint8_t *s, uint32_t from, uint32_t to, uint32_t *start, uint16_t *type, double *ts, int32_t *ln,
                uint32_t *la, uint32_t *lb, int32_t *lh, double *num) {
  uint32_t n = 0, pos = from;
  while (pos < to) {
    uint32_t eol = next_nl(s, pos, to), lineEnd = eol;
    if (lineEnd > pos && s[lineEnd - 1] == 13) lineEnd--;
    if (s[pos + 2] == 58 && s[pos + 5] == 58) {
      uint32_t i = pos + 8; while (i < lineEnd && s[i] != 40) i++; i++;
      double t = 0; uint8_t c; while ((c = s[i]) != 41 && i < lineEnd) { t = t * 10 + (c - 48); i++; }
      i += 2; uint32_t t0 = i; int32_t h = 0;
      while (i < lineEnd && (c = s[i]) != 124) { h = (int32_t)((uint32_t)h * 31u + c); i++; }
      int k = h & (HB - 1), id = 0;
      for (int e; (e = H_TAB[k]) != -1; k = (k + 1) & (HB - 1)) if (NAME_HASH[e] == h && NAME_LEN[e] == i - t0) { id = e; break; }
      if (id == 0) { pos = eol + 1; continue; }
      int32_t l = -2;
      if (s[i] == 124 && s[i + 1] == 91) { uint32_t j = i + 2; if (s[j] == 69) l = -1; else { l = 0; while ((c = s[j]) >= 48 && c <= 57) { l = l * 10 + (c - 48); j++; } } }
      uint32_t e = n++; start[e] = pos; type[e] = id; ts[e] = t; ln[e] = l; la[e] = 0; lb[e] = 0;
      int lf = LABEL_FIELD[id];
      if (lf > 0) { int f = 2; uint32_t a = i; while (f < lf && a < lineEnd) { a++; while (a < lineEnd && s[a] != 124) a++; f++; } a++; uint32_t b = a; int32_t hh = 0; while (b < lineEnd && (c = s[b]) != 124) { hh = (int32_t)((uint32_t)hh * 31u + c); b++; } la[e] = a; lb[e] = b; lh[e] = hh; }
      if (NUM_TAIL[id]) { uint32_t j = lineEnd - 1; while (j > i && s[j] != 58) j--; double v = 0; int neg = 0; j++; if (s[j] == 45) { neg = 1; j++; } while (j < lineEnd && (c = s[j]) >= 48 && c <= 57) { v = v * 10 + (c - 48); j++; } num[e] = neg ? -v : v; }
    } else { uint32_t e = n++; start[e] = pos; type[e] = 0xffff; }
    pos = eol + 1;
  }
  return n;
}
#ifdef NATIVE_MAIN
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
int main(int argc, char **argv) {
  FILE *f = fopen(argv[1], "rb"); fseek(f, 0, SEEK_END); long n = ftell(f); fseek(f, 0, SEEK_SET);
  uint8_t *s = malloc(n + 64); fread(s, 1, n, f); fclose(f);
  // type table from a file of "name hash len labelField numTail" lines written by the JS driver
  memset(H_TAB, 0xff, sizeof H_TAB); FILE *tf = fopen(argv[2], "r"); int id, hsh, len, lf, nt;
  while (fscanf(tf, "%d %d %d %d %d", &id, &hsh, &len, &lf, &nt) == 5) { NAME_HASH[id] = hsh; NAME_LEN[id] = len; LABEL_FIELD[id] = lf; NUM_TAIL[id] = nt; int k = hsh & (HB - 1); while (H_TAB[k] != -1) k = (k + 1) & (HB - 1); H_TAB[k] = id; }
  uint32_t cap = n / 40 + 1024;
  uint32_t *st = malloc(cap * 4), *la = malloc(cap * 4), *lb = malloc(cap * 4); uint16_t *ty = malloc(cap * 2); double *ts = malloc(cap * 8), *num = malloc(cap * 8); int32_t *ln = malloc(cap * 4), *lh = malloc(cap * 4);
  double best[9]; uint32_t lines = 0;
  for (int r = 0; r < 9; r++) { struct timespec a, b; clock_gettime(CLOCK_MONOTONIC, &a); lines = stage1(s, 0, n, st, ty, ts, ln, la, lb, lh, num); clock_gettime(CLOCK_MONOTONIC, &b); best[r] = (b.tv_sec - a.tv_sec) * 1e3 + (b.tv_nsec - a.tv_nsec) / 1e6; }
  for (int i = 0; i < 9; i++) for (int j = i + 1; j < 9; j++) if (best[j] < best[i]) { double t = best[i]; best[i] = best[j]; best[j] = t; }
  printf("native C -O3: %u lines, median %.1f ms\n", lines, best[4]);
}
#endif
````

### `wasm/wasm-bench.mjs`

````js
// JS stage 1 vs WASM stage 1 (scalar and SIMD) vs native C, same logic. WASM time includes copying
// the input into linear memory; outputs are read in place through typed-array views.
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { stage1 } from '../par-stage1.mjs';
const table = JSON.parse(readFileSync(new URL('../type-table.json', import.meta.url), 'utf8'));
const names = ['<root>', ...table.map((r) => r.name)];
const LABEL = { METHOD_ENTRY: 4, CONSTRUCTOR_ENTRY: 5, SYSTEM_METHOD_ENTRY: 3, CODE_UNIT_STARTED: 4, VF_APEX_CALL_START: 3 }, TAIL = new Set(['HEAP_ALLOCATE', 'SOQL_EXECUTE_END', 'SOSL_EXECUTE_END']);
const rows = names.map((nm, id) => { let h = 0; for (const ch of nm) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; return [id, h, nm.length, LABEL[nm] ?? -1, TAIL.has(nm) ? 1 : 0]; }).slice(1);
writeFileSync('types.txt', rows.map((r) => r.join(' ')).join('\n'));
function time(fn, runs = 9) { fn(); fn(); const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[runs >> 1]; }
async function load(file) {
  const { instance } = await WebAssembly.instantiate(readFileSync(file));
  const ex = instance.exports, mem = ex.memory;
  const H = new Int16Array(mem.buffer, ex.H_TAB.value, 4096); H.fill(-1);
  const NH = new Int32Array(mem.buffer, ex.NAME_HASH.value, 512), NL = new Uint8Array(mem.buffer, ex.NAME_LEN.value, 512), LF = new Int8Array(mem.buffer, ex.LABEL_FIELD.value, 512), NT = new Uint8Array(mem.buffer, ex.NUM_TAIL.value, 512);
  for (const [id, h, len, lf, nt] of rows) { NH[id] = h; NL[id] = len; LF[id] = lf; NT[id] = nt; let k = h & 4095; while (H[k] !== -1) k = (k + 1) & 4095; H[k] = id; }
  return ex;
}
const dir = process.argv[2];
const exScalar = await load('stage1.wasm'), exSimd = await load('stage1-simd.wasm');
for (const f of process.argv.slice(3)) {
  const bytes = new Uint8Array(readFileSync(`${dir}/${f}`)); const n = bytes.length;
  console.log(`== ${f} (${(n / 1e6).toFixed(0)} MB)`);
  console.log(`JS stage 1:                 ${time(() => stage1(bytes, 0, n)).toFixed(0)} ms (${stage1(bytes, 0, n).n} lines)`);
  for (const [label, ex] of [['WASM scalar', exScalar], ['WASM SIMD128', exSimd]]) {
    const mem = ex.memory; const base = (ex.__heap_base.value + 15) & ~15; const cap = Math.ceil(n / 40) + 1024;
    const need = base + n + 64 + cap * (4 + 2 + 8 + 4 + 4 + 4 + 4 + 8) + 64 * 8;
    if (mem.buffer.byteLength < need) mem.grow(Math.ceil((need - mem.buffer.byteLength) / 65536));
    let off = base + n + 64; const al = (a) => (off = (off + 7) & ~7, off += a, off - a);
    const pS = al(cap * 4), pT = al(cap * 2), pTs = al(cap * 8), pLn = al(cap * 4), pLa = al(cap * 4), pLb = al(cap * 4), pLh = al(cap * 4), pNum = al(cap * 8);
    const copyAndScan = () => { new Uint8Array(mem.buffer, base, n).set(bytes); return ex.stage1(base, base, base + n, pS, pT, pTs, pLn, pLa, pLb, pLh, pNum); };
    const scanOnly = () => ex.stage1(base, base, base + n, pS, pT, pTs, pLn, pLa, pLb, pLh, pNum);
    console.log(`${label.padEnd(13)} copy+scan: ${time(copyAndScan).toFixed(0)} ms; scan only ${time(scanOnly).toFixed(0)} ms (${copyAndScan()} lines)`);
  }
  console.log(execFileSync('./stage1-native', [`${dir}/${f}`, 'types.txt']).toString().trim());
}
````

### `wasm/full.c`

````c
// Full single pass in C (the v5 algorithm): scan + tree + exit matching + interning (label, ns once
// per label) + sparse counts + heap/peak + self time. Columns live in linear memory for JS to view.
#include <stdint.h>
#ifdef __wasm_simd128__
#include <wasm_simd128.h>
#endif
#define HB 4096
#define NT 512
#define NC 8
int16_t H_TAB[HB]; int32_t NAME_HASH[NT]; uint8_t NAME_LEN[NT]; int8_t LABEL_FIELD[NT];
uint8_t PURE_EXIT[NT], NEXT_IS_EXIT[NT], ACCEPTS[NT], HAS_EXITS[NT]; uint8_t EXIT_MATCH[NT * NT];
int8_t OWN_COUNT[NT], ROWS_FROM_EXIT[NT]; int32_t HEAP_ID, EXEC_ID;

// column pointers, set by JS before scan
uint16_t *type; uint32_t *start; double *ts, *exitTs, *selfDur, *heap, *peak; int32_t *parent, *lineNo, *label, *ns, *cslot; uint32_t *subEnd; uint16_t *depth;
int32_t *pool; uint32_t *strStart, *strEnd; int32_t *strHash, *iTab, *nsOfLabel; uint32_t IB; int32_t stack[16384];
uint32_t nRows, nStr, nSlots;

static inline uint32_t next_nl(const uint8_t *s, uint32_t p, uint32_t n) {
#ifdef __wasm_simd128__
  v128_t nl = wasm_i8x16_splat(10);
  while (p + 16 <= n) { uint32_t m = wasm_i8x16_bitmask(wasm_i8x16_eq(wasm_v128_load(s + p), nl)); if (m) return p + __builtin_ctz(m); p += 16; }
#endif
  while (p < n) { if (s[p] == 10) return p; p++; } return n;
}
static inline int32_t slot(int32_t e) { int32_t k = cslot[e]; if (k < 0) { k = cslot[e] = nSlots++; for (int q = 0; q < NC; q++) pool[k * NC + q] = 0; } return k; }
static inline int32_t intern(const uint8_t *s, uint32_t a, uint32_t b, int32_t h) {
  uint32_t k = h & (IB - 1);
  for (int32_t e; (e = iTab[k]) != -1; k = (k + 1) & (IB - 1)) {
    if (strHash[e] == h && strEnd[e] - strStart[e] == b - a) { uint32_t x = strStart[e], y = a; while (y < b && s[y] == s[x]) { x++; y++; } if (y == b) return e; }
  }
  int32_t id = nStr++; strStart[id] = a; strEnd[id] = b; strHash[id] = h; iTab[k] = id; nsOfLabel[id] = -2; return id; // IB sized by JS for the worst case
}
static inline void roll(int32_t p, int32_t e) {
  int32_t ck = cslot[e]; if (ck >= 0) { int32_t pk = slot(p); for (int q = 0; q < NC; q++) pool[pk * NC + q] += pool[ck * NC + q]; }
  heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e];
}
static inline void close_frame(int32_t e, double t) { exitTs[e] = t; double tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = nRows; int32_t p = parent[e]; selfDur[p] -= tot; roll(p, e); }

uint32_t parse(const uint8_t *s, uint32_t len) {
  uint32_t n = 1, sp = 0, pos = 0; int32_t last = -1; double running = 0;
  nStr = 0; nSlots = 0; nRows = 1;
  type[0] = 0; parent[0] = -1; label[0] = -1; ns[0] = -1; cslot[0] = -1; selfDur[0] = 0; heap[0] = 0; peak[0] = 0; stack[sp++] = 0;
  while (pos < len) {
    uint32_t eol = next_nl(s, pos, len), lineEnd = eol; if (lineEnd > pos && s[lineEnd - 1] == 13) lineEnd--;
    if (s[pos + 2] == 58 && s[pos + 5] == 58) {
      uint32_t i = pos + 8; while (i < lineEnd && s[i] != 40) i++; i++;
      double t = 0; uint8_t c; while ((c = s[i]) != 41 && i < lineEnd) { t = t * 10 + (c - 48); i++; }
      i += 2; uint32_t t0 = i; int32_t h = 0;
      while (i < lineEnd && (c = s[i]) != 124) { h = (int32_t)((uint32_t)h * 31u + c); i++; }
      int k = h & (HB - 1), id = 0;
      for (int e; (e = H_TAB[k]) != -1; k = (k + 1) & (HB - 1)) if (NAME_HASH[e] == h && NAME_LEN[e] == i - t0) { id = e; break; }
      if (id == 0) { pos = eol + 1; continue; }
      int32_t ln = -2; if (s[i] == 124 && s[i + 1] == 91) { uint32_t j = i + 2; if (s[j] == 69) ln = -1; else { ln = 0; while ((c = s[j]) >= 48 && c <= 57) { ln = ln * 10 + (c - 48); j++; } } }
      if (last >= 0 && NEXT_IS_EXIT[type[last]] && exitTs[last] == 0) exitTs[last] = t;
      if (PURE_EXIT[id]) {
        int m = (int)sp - 1;
        for (; m > 0; m--) { int32_t f = stack[m], fl = lineNo[f]; if (EXIT_MATCH[type[f] * NT + id] && (ln == fl || ln < 0 || fl < 0)) break; }
        if (m > 0) {
          int rs = ROWS_FROM_EXIT[id];
          if (rs) { uint32_t j = lineEnd - 1; while (j > i && s[j] != 58) j--; int32_t rows = 0; j++; while (j < lineEnd && (c = s[j]) >= 48 && c <= 57) { rows = rows * 10 + (c - 48); j++; } pool[slot(stack[m]) * NC + rs - 1] += rows; }
          nRows = n; while ((int)sp > m) close_frame(stack[--sp], t);
          last = -1; pos = eol + 1; continue;
        }
      }
      if (id == EXEC_ID) { nRows = n; while (sp > 1) close_frame(stack[--sp], t); }
      uint32_t e = n++; int32_t p = stack[sp - 1];
      type[e] = id; start[e] = pos; ts[e] = t; exitTs[e] = 0; lineNo[e] = ln; label[e] = -1; ns[e] = -1; cslot[e] = -1; selfDur[e] = 0; heap[e] = 0; peak[e] = 0;
      parent[e] = p; depth[e] = sp - 1; subEnd[e] = e + 1;
      int lf = LABEL_FIELD[id];
      if (lf > 0) {
        int f = 2; uint32_t a = i; while (f < lf && a < lineEnd) { a++; while (a < lineEnd && s[a] != 124) a++; f++; }
        a++; uint32_t b = a; int32_t hh = 0; int32_t dot = -1;
        while (b < lineEnd && (c = s[b]) != 124) { hh = (int32_t)((uint32_t)hh * 31u + c); if (c == 46 && dot < 0) dot = b; b++; }
        if (a < b) {
          int32_t sid = intern(s, a, b, hh); label[e] = sid;
          if (nsOfLabel[sid] == -2) { int32_t nsid = -1; if (dot > (int32_t)a) { int32_t h2 = 0; for (uint32_t q = a; q < (uint32_t)dot; q++) h2 = (int32_t)((uint32_t)h2 * 31u + s[q]); nsid = intern(s, a, dot, h2); } nsOfLabel[sid] = nsid; }
          ns[e] = nsOfLabel[sid];
        }
      }
      int own = OWN_COUNT[id];
      if (own) pool[slot(e) * NC + own - 1] = 1;
      else if (id == HEAP_ID) { uint32_t j = lineEnd - 1; while (j > i && s[j] != 58) j--; double b = 0; int neg = 0; j++; if (s[j] == 45) { neg = 1; j++; } while (j < lineEnd && (c = s[j]) >= 48 && c <= 57) { b = b * 10 + (c - 48); j++; } if (neg) b = -b; heap[e] = b; running += b; if (running < 0) running = 0; peak[e] = running; }
      if (HAS_EXITS[id]) stack[sp++] = e; else roll(p, e);
      last = e;
    }
    pos = eol + 1;
  }
  nRows = n; double lastTs = n > 1 ? ts[n - 1] : 0;
  while (sp > 1) close_frame(stack[--sp], lastTs);
  return n;
}
````

### `wasm/full-bench.mjs`

````js
// Full single pass: JS (v5) vs WASM (scalar, SIMD128). WASM time includes copying the input into
// linear memory; JS reads the result columns in place through typed-array views (raw transfer).
import { readFileSync } from 'node:fs';
import { scanV5 } from '../scan-v5.mjs';
const table = JSON.parse(readFileSync(new URL('../type-table.json', import.meta.url), 'utf8'));
const names = ['<root>', ...table.map((r) => r.name)], N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
const NT = 512, NC = 8;
function time(fn, runs = 9) { fn(); fn(); const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[runs >> 1]; }
async function load(file) {
  const { instance } = await WebAssembly.instantiate(readFileSync(file)); const ex = instance.exports;
  const u8 = (g, l) => new Uint8Array(ex.memory.buffer, ex[g].value, l), i8 = (g, l) => new Int8Array(ex.memory.buffer, ex[g].value, l);
  const H = new Int16Array(ex.memory.buffer, ex.H_TAB.value, 4096); H.fill(-1);
  const NH = new Int32Array(ex.memory.buffer, ex.NAME_HASH.value, NT), NL = u8('NAME_LEN', NT), LF = i8('LABEL_FIELD', NT), PE = u8('PURE_EXIT', NT), NX = u8('NEXT_IS_EXIT', NT), AC = u8('ACCEPTS', NT), HX = u8('HAS_EXITS', NT), EM = u8('EXIT_MATCH', NT * NT), OC = i8('OWN_COUNT', NT), RX = i8('ROWS_FROM_EXIT', NT);
  for (let id = 1; id < N; id++) { const nm = names[id]; let h = 0; for (const ch of nm) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0; NH[id] = h; NL[id] = nm.length; let k = h & 4095; while (H[k] !== -1) k = (k + 1) & 4095; H[k] = id; }
  table.forEach((r, i) => { const t = i + 1; PE[t] = r.isExit && !(r.exitTypes?.length) ? 1 : 0; NX[t] = r.nextLineIsExit ? 1 : 0; AC[t] = r.acceptsText ? 1 : 0; for (const x of r.exitTypes ?? []) { EM[t * NT + idOf.get(x)] = 1; HX[t] = 1; } });
  for (const [n, f] of [['METHOD_ENTRY', 4], ['CONSTRUCTOR_ENTRY', 5], ['SYSTEM_METHOD_ENTRY', 3], ['CODE_UNIT_STARTED', 4], ['VF_APEX_CALL_START', 3]]) LF[idOf.get(n)] = f;
  OC[idOf.get('SOQL_EXECUTE_BEGIN')] = 1; OC[idOf.get('DML_BEGIN')] = 2; OC[idOf.get('SOSL_EXECUTE_BEGIN')] = 3; OC[idOf.get('EXCEPTION_THROWN')] = 7;
  RX[idOf.get('SOQL_EXECUTE_END')] = 4; RX[idOf.get('SOSL_EXECUTE_END')] = 6;
  new Int32Array(ex.memory.buffer, ex.HEAP_ID.value, 1)[0] = idOf.get('HEAP_ALLOCATE'); new Int32Array(ex.memory.buffer, ex.EXEC_ID.value, 1)[0] = idOf.get('EXECUTION_STARTED');
  return ex;
}
function setup(ex, n) {
  const cap = Math.ceil(n / 60) + 4096, sCap = cap, IB = 1 << Math.ceil(Math.log2(sCap * 2 + 16));
  const base = (ex.__heap_base.value + 63) & ~63; let off = base + n + 64;
  const al = (bytes) => { off = (off + 7) & ~7; const p = off; off += bytes; return p; };
  const L = { type: [al(cap * 2), Uint16Array], start: [al(cap * 4), Uint32Array], ts: [al(cap * 8), Float64Array], exitTs: [al(cap * 8), Float64Array], selfDur: [al(cap * 8), Float64Array], heap: [al(cap * 8), Float64Array], peak: [al(cap * 8), Float64Array], parent: [al(cap * 4), Int32Array], lineNo: [al(cap * 4), Int32Array], label: [al(cap * 4), Int32Array], ns: [al(cap * 4), Int32Array], cslot: [al(cap * 4), Int32Array], subEnd: [al(cap * 4), Uint32Array], depth: [al(cap * 2), Uint16Array], pool: [al(cap * NC * 4), Int32Array], strStart: [al(sCap * 4), Uint32Array], strEnd: [al(sCap * 4), Uint32Array], strHash: [al(sCap * 4), Int32Array], iTab: [al(IB * 4), Int32Array], nsOfLabel: [al(sCap * 4), Int32Array] };
  if (ex.memory.buffer.byteLength < off) ex.memory.grow(Math.ceil((off - ex.memory.buffer.byteLength) / 65536));
  const ptr = new Uint32Array(ex.memory.buffer);
  for (const [k, [p]] of Object.entries(L)) ptr[ex[k].value >>> 2] = p;
  ptr[ex.IB.value >>> 2] = IB;
  return { base, L, IB };
}
const dir = process.argv[2];
const variants = [['WASM scalar', await load('full.wasm')], ['WASM SIMD128', await load('full-simd.wasm')]];
for (const f of process.argv.slice(3)) {
  const bytes = new Uint8Array(readFileSync(`${dir}/${f}`)); const n = bytes.length; const ref = scanV5(bytes);
  console.log(`== ${f} (${(n / 1e6).toFixed(0)} MB): JS v5 ${time(() => scanV5(bytes)).toFixed(0)} ms, rows ${ref.n}, strings ${ref.nStr}`);
  for (const [label, ex] of variants) {
    const { base, L, IB } = setup(ex, n);
    const run = () => { new Uint8Array(ex.memory.buffer, base, n).set(bytes); new Int32Array(ex.memory.buffer, L.iTab[0], IB).fill(-1); return ex.parse(base, n); };
    const rows = run(); const v = (k) => new L[k][1](ex.memory.buffer, L[k][0], rows);
    const ts = v('ts'), exitTs = v('exitTs'), parent = v('parent'), selfDur = v('selfDur');
    let same = rows === ref.n; for (let i = 1; same && i < rows; i++) if (ts[i] !== ref.ts[i] || exitTs[i] !== ref.exitTs[i] || parent[i] !== ref.parent[i] || Math.abs(selfDur[i] - ref.selfDur[i]) > 1e-6) { same = false; console.log('  first diff at row', i); }
    const nStr = new Uint32Array(ex.memory.buffer, ex.nStr.value, 1)[0];
    console.log(`${label.padEnd(13)} copy+parse ${time(run).toFixed(0)} ms; rows ${rows}, strings ${nStr}; same tree as JS: ${same}`);
  }
}
````

### `web/make-web.py`

````python
# Builds web/out/: index.html (JS v5 vs WASM SIMD in a browser), scan-v5.web.mjs, full-simd.wasm.
# Run from bench/rewrite: python3 web/make-web.py <logsDir>; then cd web/out && node ../server.mjs
# and open http://127.0.0.1:8766/ in Chromium (headless works); results are POSTed to result.txt.
import sys, os, shutil
logs = sys.argv[1]
os.makedirs('web/out', exist_ok=True)
tbl = open('type-table.json').read().strip()
for name in ('scan-v5', 'scan-v5s', 'scan-v5w'):
    v = open(name + '.mjs').read().replace("import { readFileSync } from 'node:fs';\n", "").replace("JSON.parse(readFileSync(new URL('./type-table.json', import.meta.url), 'utf8'))", tbl)
    open('web/out/' + name + '.web.mjs', 'w').write(v)
fb = open('wasm/full-bench.mjs').read()
helpers = fb[fb.index('const NT = 512'):fb.index('const dir = process.argv[2];')].replace("readFileSync(file)", "await (await fetch(file)).arrayBuffer()")
page = """<!doctype html><meta charset=utf-8><body><script type=module>
import { scanV5 } from './scan-v5.web.mjs';
import { scanV5s } from './scan-v5s.web.mjs';
import { scanV5w } from './scan-v5w.web.mjs';
const table = %s;
const names = ['<root>', ...table.map((r) => r.name)], N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
%s
const out = [];
try {
  const ex = await load('full-simd.wasm');
  for (const f of ['dev20.log', 'large100.log']) {
    const bytes = new Uint8Array(await (await fetch(f)).arrayBuffer()); const n = bytes.length; const ref = scanV5(bytes);
    const text = await (await fetch(f)).text();
    out.push(`${f}: JS v5 bytes ${time(() => scanV5(bytes)).toFixed(0)} ms (rows ${ref.n}) | JS v5 bytes+SWAR ${time(() => scanV5w(bytes)).toFixed(0)} ms (rows ${scanV5w(bytes).n}) | JS v5 string ${time(() => scanV5s(text)).toFixed(0)} ms (rows ${scanV5s(text).n})`);
    out.push(`   input: TextDecoder ${time(() => new TextDecoder().decode(bytes), 5).toFixed(0)} ms | TextEncoder ${time(() => new TextEncoder().encode(text), 5).toFixed(0)} ms`);
    const { base, L, IB } = setup(ex, n);
    const run = () => { new Uint8Array(ex.memory.buffer, base, n).set(bytes); new Int32Array(ex.memory.buffer, L.iTab[0], IB).fill(-1); return ex.parse(base, n); };
    const rows = run(); out.push(`   WASM SIMD128 ${time(run).toFixed(0)} ms (rows ${rows})`);
  }
} catch (e) { out.push('ERROR ' + e.stack); }
await fetch('/result', { method: 'POST', body: out.join('\\n') + '\\nDONE ' + navigator.userAgent });
</script>""" % (tbl, helpers)
open('web/out/index.html', 'w').write(page)
shutil.copy('wasm/full-simd.wasm', 'web/out/full-simd.wasm')
for f in ('dev20.log', 'large100.log'):
    dst = 'web/out/' + f
    if not os.path.exists(dst): os.symlink(os.path.abspath(os.path.join(logs, f)), dst)
print('built web/out')
````

### `web/server.mjs`

````js
import { createServer } from 'node:http'; import { readFileSync, writeFileSync } from 'node:fs'; import { extname } from 'node:path';
const types = { '.html': 'text/html', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.log': 'text/plain' };
createServer((req, res) => {
  if (req.method === 'POST') { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { writeFileSync('result.txt', b); res.end('ok'); }); return; }
  let body; const f = '.' + (req.url === '/' ? '/index.html' : req.url); try { body = readFileSync(f); } catch { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); res.end(body);
}).listen(8766);
````

### Consolidated and cold runs (§3.8)

```sh
cp bench/rewrite/sample.log bench/rewrite/logs/   # the Appendix A log
node --expose-gc --max-old-space-size=8000 --import tsx bench/rewrite/final.ts bench/rewrite/logs \
  sample.log dev20.log dev20-hc.log large100.log large100-hc.log
cd bench/rewrite && for e in today js wasm simd; do node --import tsx cold.ts $e logs/dev20.log; done
```

`sample.log` is the log in Appendix A, saved as a file. `wasm/core.mjs` reuses the WASM setup in
`wasm/full-bench.mjs`, so build the `.wasm` files first.

### `wasm/core.mjs`

````js
// Loads a WASM core and returns parse(bytes) -> rows, with the setup from full-bench.mjs.
import { readFileSync } from 'node:fs';
const table = JSON.parse(readFileSync(new URL('../type-table.json', import.meta.url), 'utf8'));
const names = ['<root>', ...table.map((r) => r.name)], N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
const src = readFileSync(new URL('./full-bench.mjs', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('async function load'), src.indexOf('const dir = process.argv[2];'));
const make = new Function('readFileSync', 'table', 'names', 'N', 'idOf', 'NT', 'NC', `${body}; return { load, setup };`);
const { load, setup } = make((f) => readFileSync(new URL(f, import.meta.url)), table, names, N, idOf, 512, 8);
export async function wasmCore(file) {
  const ex = await load(file);
  return (bytes) => { const n = bytes.length; const { base, L, IB } = setup(ex, n); new Uint8Array(ex.memory.buffer, base, n).set(bytes); new Int32Array(ex.memory.buffer, L.iTab[0], IB).fill(-1); return ex.parse(base, n); };
}
````

### `final.ts`

````ts
// One consolidated run: today vs JS core (v5) vs WASM scalar vs WASM SIMD, warm medians, on every sample log.
import { readFileSync } from 'node:fs';
import { parse } from '../../src/index.js';
// @ts-expect-error js
import { scanV5 } from './scan-v5.mjs';
// @ts-expect-error js
import { wasmCore } from './wasm/core.mjs';
const gc = (globalThis as any).gc as () => void;
const wScalar = await wasmCore('full.wasm'), wSimd = await wasmCore('full-simd.wasm');
function t(fn: () => unknown, runs: number) { fn(); fn(); const ts: number[] = []; for (let r = 0; r < runs; r++) { gc(); const s = performance.now(); fn(); ts.push(performance.now() - s); } ts.sort((a, b) => a - b); return ts[runs >> 1]!; }
const fmt = (x: number) => (x < 1 ? x.toFixed(2) : x < 10 ? x.toFixed(1) : x.toFixed(0)).padStart(7);
console.log('log'.padEnd(18), 'MB'.padStart(5), 'today'.padStart(8), 'JS v5'.padStart(8), 'WASM'.padStart(8), 'SIMD'.padStart(8), ' rows (JS / SIMD)');
for (const f of process.argv.slice(3)) {
  const path = `${process.argv[2]}/${f}`, str = readFileSync(path, 'utf8'), bytes = new Uint8Array(readFileSync(path));
  const runs = bytes.length < 1e6 ? 201 : bytes.length < 3e7 ? 9 : 5;
  const a = t(() => parse(str), runs), b = t(() => scanV5(bytes), runs), c = t(() => wScalar(bytes), runs), d = t(() => wSimd(bytes), runs);
  console.log(f.padEnd(18), (bytes.length / 1e6).toFixed(bytes.length < 1e6 ? 3 : 0).padStart(5), fmt(a), fmt(b), fmt(c), fmt(d), ` ${scanV5(bytes).n} / ${wSimd(bytes)}`);
}
````

### `cold.ts`

````ts
// Cold start: a fresh process, then the FIRST parse of one log, including loading the engine
// (module import / WASM compile + instantiate). Usage: cold.ts <engine> <file>
import { readFileSync } from 'node:fs';
const [engine, file] = process.argv.slice(2);
const bytes = new Uint8Array(readFileSync(file!)); const str = engine === 'today' ? readFileSync(file!, 'utf8') : '';
const t0 = performance.now();
let rows = 0;
if (engine === 'today') { const { parse } = await import('../../src/index.js'); rows = parse(str).eventsById.length; }
else if (engine === 'js') { const { scanV5 } = await import('./scan-v5.mjs' as string); rows = scanV5(bytes).n; }
else { const { wasmCore } = await import('./wasm/core.mjs' as string); const t1 = performance.now(); const p = await wasmCore(engine === 'simd' ? 'full-simd.wasm' : 'full.wasm'); const t2 = performance.now(); rows = p(bytes); process.stdout.write(`(load ${(t2 - t1).toFixed(1)} ms) `); }
console.log(`${engine} first parse incl. load: ${(performance.now() - t0).toFixed(1)} ms (rows ${rows})`);
````

### `backport.diff` (§0.3, experiments A and B on today's parser)

Apply on `origin/perf/single-pass-totals` (`e80a701`) with `git apply`. Verify with the digest script below and `pnpm run ci`.

````diff
diff --git a/src/LogEvents.ts b/src/LogEvents.ts
index 3d04c65..c1f2ea2 100644
--- a/src/LogEvents.ts
+++ b/src/LogEvents.ts
@@ -39,6 +39,34 @@ function zeroDuration(): SelfTotal {
   return duration;
 }
 
+// Shared by every event that has none, so a leaf allocates no array. Only DurationLogEvent and the
+// root get their own children array, because only they are given children.
+const noChildren: LogEvent[] = [];
+// EXPERIMENT B: one zero counter object per field, shared by every event whose counters stay zero.
+// An event that writes a counter first takes its own object (ownCounters / own()).
+const Z = {
+  duration: zeroDuration(), dmlRowCount: { self: 0, total: 0 }, soqlRowCount: { self: 0, total: 0 },
+  soslRowCount: { self: 0, total: 0 }, dmlCount: { self: 0, total: 0 }, soqlCount: { self: 0, total: 0 },
+  soslCount: { self: 0, total: 0 }, thrownCount: { self: 0, total: 0 }, heapAllocated: { self: 0, total: 0 },
+  heapGross: { self: 0, total: 0 },
+};
+for (const zero of Object.values(Z)) Object.freeze(zero);
+const noExitTypes: LogEventType[] = [];
+// One exitTypes array per distinct list, shared by every event of that type.
+const exitTypesByKey = new Map<string, LogEventType[]>();
+function sharedExitTypes(exitTypes: LogEventType[]): LogEventType[] {
+  if (!exitTypes.length) {
+    return noExitTypes;
+  }
+  const key = exitTypes.join('|');
+  let shared = exitTypesByKey.get(key);
+  if (!shared) {
+    shared = exitTypes.slice();
+    exitTypesByKey.set(key, shared);
+  }
+  return shared;
+}
+
 /**
  * All log lines extend this base class.
  */
@@ -50,7 +78,7 @@ export abstract class LogEvent {
   /**
    * All child nodes of the current node
    */
-  children: LogEvent[] = [];
+  children: LogEvent[] = noChildren;
 
   /**
    * The type of this log line from the log file e.g METHOD_ENTRY
@@ -161,39 +189,39 @@ export abstract class LogEvent {
    * The time spent: `self` is the net (wall) time spent in the node (when not inside children), and
    * `total` is the total (wall) time spent in the node.
    */
-  duration: SelfTotal = zeroDuration();
+  duration: SelfTotal = Z.duration;
 
   /**
    * Total + self row counts for DML: `self` excludes child nodes, `total` includes them.
    */
-  dmlRowCount: SelfTotal = { self: 0, total: 0 };
+  dmlRowCount: SelfTotal = Z.dmlRowCount;
 
   /**
    * Total + self row counts for SOQL: `self` excludes child nodes, `total` includes them.
    */
-  soqlRowCount: SelfTotal = { self: 0, total: 0 };
+  soqlRowCount: SelfTotal = Z.soqlRowCount;
 
   /**
    * Total + self row counts for SOSL: `self` excludes child nodes, `total` includes them.
    */
-  soslRowCount: SelfTotal = { self: 0, total: 0 };
+  soslRowCount: SelfTotal = Z.soslRowCount;
 
   /**
    * DML operations (DML_BEGIN): `self` is the net number in this node, `total` includes child nodes.
    */
-  dmlCount: SelfTotal = { self: 0, total: 0 };
+  dmlCount: SelfTotal = Z.dmlCount;
 
   /**
    * SOQL operations (SOQL_EXECUTE_BEGIN): `self` is the net number in this node, `total` includes
    * child nodes.
    */
-  soqlCount: SelfTotal = { self: 0, total: 0 };
+  soqlCount: SelfTotal = Z.soqlCount;
 
   /**
    * SOSL operations (SOSL_EXECUTE_BEGIN): `self` is the net number in this node, `total` includes
    * child nodes.
    */
-  soslCount: SelfTotal = { self: 0, total: 0 };
+  soslCount: SelfTotal = Z.soslCount;
 
   /**
    * Total + self counts for exceptions thrown (EXCEPTION_THROWN): `self` is the number thrown
@@ -205,7 +233,7 @@ export abstract class LogEvent {
    * Throws tooltip row, because it would only ever read "(self 0)". The field keeps the SelfTotal
    * shape for consistency with the other metrics and so the leaf carries `self: 1`.
    */
-  thrownCount: SelfTotal = { self: 0, total: 0 };
+  thrownCount: SelfTotal = Z.thrownCount;
 
   /**
    * Signed NET heap bytes (alloc − free) for HEAP_ALLOCATE / BULK_HEAP_ALLOCATE / HEAP_DEALLOCATE.
@@ -219,7 +247,7 @@ export abstract class LogEvent {
    * children only, so a method's `self` excludes allocations in sub-methods. `total` is the
    * net across this node and all descendants.
    */
-  heapAllocated: SelfTotal = { self: 0, total: 0 };
+  heapAllocated: SelfTotal = Z.heapAllocated;
 
   /**
    * GROSS heap bytes allocated (positive HEAP_ALLOCATE only; frees ignored): the churn / GC
@@ -227,7 +255,7 @@ export abstract class LogEvent {
    * (net) and {@link heapPeak} (max live): an allocate-then-free loop has net ≈ 0 and a small
    * peak but a large gross. Same self/total aggregation as {@link heapAllocated}.
    */
-  heapGross: SelfTotal = { self: 0, total: 0 };
+  heapGross: SelfTotal = Z.heapGross;
 
   /**
    * Peak live heap (bytes) for this node's subtree: the highest running live-heap total reached
@@ -240,7 +268,7 @@ export abstract class LogEvent {
   /**
    * The line types which would legitimately end this method
    */
-  exitTypes: LogEventType[] = [];
+  exitTypes: LogEventType[] = noExitTypes;
 
   constructor(parser: ApexLogParser, parts: string[]) {
     this.logParser = parser;
@@ -261,7 +289,23 @@ export abstract class LogEvent {
   /** Called when the Log event after this one is created in the line parser*/
   onAfter?(parser: ApexLogParser, next?: LogEvent): void;
 
+  protected ownCounters(): void {
+    this.duration = zeroDuration();
+    this.dmlRowCount = { self: 0, total: 0 };
+    this.soqlRowCount = { self: 0, total: 0 };
+    this.soslRowCount = { self: 0, total: 0 };
+    this.dmlCount = { self: 0, total: 0 };
+    this.soqlCount = { self: 0, total: 0 };
+    this.soslCount = { self: 0, total: 0 };
+    this.thrownCount = { self: 0, total: 0 };
+    this.heapAllocated = { self: 0, total: 0 };
+    this.heapGross = { self: 0, total: 0 };
+  }
+
   public recalculateDurations(): void {
+    if (this.duration === Z.duration) {
+      this.duration = zeroDuration();
+    }
     if (this.exitStamp) {
       this.duration.total = this.duration.self = this.exitStamp - this.timestamp;
     }
@@ -272,6 +316,8 @@ export abstract class LogEvent {
    * (negative = deallocation) and advances the parser's running live-heap total.
    */
   protected seedHeapLeaf(parser: ApexLogParser, bytes: number): void {
+    this.heapAllocated = { self: 0, total: 0 };
+    this.heapGross = { self: 0, total: 0 };
     this.heapAllocated.self = this.heapAllocated.total = bytes || 0;
     this.heapGross.self = this.heapGross.total = bytes > 0 ? bytes : 0;
     this.heapPeak = parser.trackHeapAllocation(bytes);
@@ -312,7 +358,9 @@ export class DurationLogEvent extends LogEvent {
     cpuType: CPUType,
   ) {
     super(parser, parts);
-    this.exitTypes = exitTypes;
+    this.children = [];
+    this.ownCounters();
+    this.exitTypes = sharedExitTypes(exitTypes);
     this.category = category;
     this.cpuType = cpuType;
   }
@@ -333,7 +381,8 @@ export class ApexLog extends LogEvent {
   text = 'LOG_ROOT';
   timestamp = 0;
   exitStamp = 0;
-  exitTypes: LogEventType[] = [];
+  override children: LogEvent[] = [];
+  exitTypes: LogEventType[] = noExitTypes;
   override category: LogCategory = '';
   cpuType: CPUType = '';
 
@@ -424,6 +473,7 @@ export class ApexLog extends LogEvent {
 
   constructor(parser: ApexLogParser) {
     super(parser, []);
+    this.ownCounters();
   }
 
   setTimes(): void {
@@ -892,7 +942,7 @@ export class VFApexCallStartLine extends DurationLogEvent {
       // we have a system entry and they do not have exits
       // e.g |VF_APEX_CALL_START|[EXTERNAL]|/apexpage/pagemessagescomponentcontroller.apex <init>
       // and they really mess with the logs so skip handling them.
-      this.exitTypes = [];
+      this.exitTypes = noExitTypes;
       this.hasValidSymbols = false;
     } else if (methodtext) {
       // method call
@@ -1047,6 +1097,7 @@ export class SOQLExecuteEndLine extends LogEvent {
   constructor(parser: ApexLogParser, parts: string[]) {
     super(parser, parts);
     this.lineNumber = this.parseLineNumber(parts[2]);
+    this.soqlRowCount = { self: 0, total: 0 };
     this.soqlRowCount.total = this.soqlRowCount.self = parseRows(parts[3] || '');
   }
 }
@@ -1123,6 +1174,7 @@ export class SOSLExecuteEndLine extends LogEvent {
   constructor(parser: ApexLogParser, parts: string[]) {
     super(parser, parts);
     this.lineNumber = this.parseLineNumber(parts[2]);
+    this.soslRowCount = { self: 0, total: 0 };
     this.soslRowCount.total = this.soslRowCount.self = parseRows(parts[3] || '');
   }
 }
@@ -2472,6 +2524,7 @@ export class ExceptionThrownLine extends LogEvent {
 
   constructor(parser: ApexLogParser, parts: string[]) {
     super(parser, parts);
+    this.thrownCount = { self: 0, total: 0 };
     this.thrownCount.self = this.thrownCount.total = 1;
     this.lineNumber = this.parseLineNumber(parts[2]);
     this.text = parts[3] || '';
````

### `digest.mts` (proves a backport changes no output)

````ts
// A digest of every event's public numbers, to prove an experiment changes no output.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const { parse } = await import(process.cwd() + '/src/index.ts');
for (const f of process.argv.slice(2)) {
  const log = parse(readFileSync(f, 'utf8')); const h = createHash('sha256');
  const keys = ['duration', 'dmlRowCount', 'soqlRowCount', 'soslRowCount', 'dmlCount', 'soqlCount', 'soslCount', 'thrownCount', 'heapAllocated', 'heapGross'];
  for (const e of log.eventsById) { h.update(`${e.eventIndex}|${e.type}|${e.timestamp}|${e.exitStamp}|${e.text}|${e.namespace}|${e.heapPeak}|${e.children.length}|${e.exitTypes.join(',')}|`); for (const k of keys) h.update(`${e[k].self},${e[k].total};`); }
  h.update(JSON.stringify(log.logIssues) + JSON.stringify(log.governorLimits));
  console.log(f.split('/').pop(), h.digest('hex').slice(0, 16));
}
````

### `bp-measure.mts` (time and heap of `parse()` from the current checkout)

````ts
// Time and retained heap of parse() from the worktree's src, on the given logs.
import { readFileSync } from 'node:fs';
const { parse } = await import(process.cwd() + '/src/index.ts');
const gc = (globalThis as any).gc as () => void;
for (const f of process.argv.slice(2)) {
  const str = readFileSync(f, 'utf8'); parse(str); parse(str);
  const ts: number[] = []; let heap = 0, keep: unknown;
  for (let r = 0; r < 5; r++) { keep = null; gc(); const b = process.memoryUsage().heapUsed; const t = performance.now(); keep = parse(str); ts.push(performance.now() - t); gc(); heap = process.memoryUsage().heapUsed - b; }
  void keep; ts.sort((a, b) => a - b);
  console.log(`${f.split('/').pop()!.padEnd(16)} ${ts[2]!.toFixed(0).padStart(5)} ms  ${(heap / 1e6).toFixed(0).padStart(5)} MB`);
}
````

### `scan-v5s.mjs`

````js
// Prototype v5s: v5 over a JS string (charCodeAt + String.indexOf), otherwise identical.
// Prototype v5: v4 with label hashing fused into the field scan, namespace derived once per
// distinct label, end offsets stored only for wrapped rows. (Header from v4 follows.)
// Prototype v4: v3's output shape, tuned. One function, no closures in the loop. Adds today's
// line-number exit matching, unwinding to a match further down the stack, unmatched exits kept
// as rows, SOQL/SOSL rows read from the exit line, and a root row 0. Still omits issues text,
// limits, truncation, package merge, flow residuals, discontinuity and the per-event text rules.
import { readFileSync } from 'node:fs';

const table = JSON.parse(readFileSync(new URL('./type-table.json', import.meta.url), 'utf8'));
export const names = ['<root>', ...table.map((r) => r.name)];
const N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
export const PURE_EXIT = new Uint8Array(N);
const NEXT_IS_EXIT = new Uint8Array(N), ACCEPTS = new Uint8Array(N), HAS_EXITS = new Uint8Array(N), EXIT_MATCH = new Uint8Array(N * N);
table.forEach((r, i) => {
  const t = i + 1;
  PURE_EXIT[t] = r.isExit && !(r.exitTypes?.length) ? 1 : 0;
  NEXT_IS_EXIT[t] = r.nextLineIsExit ? 1 : 0; ACCEPTS[t] = r.acceptsText ? 1 : 0;
  for (const x of r.exitTypes ?? []) { EXIT_MATCH[t * N + idOf.get(x)] = 1; HAS_EXITS[t] = 1; }
});
const LABEL_FIELD = new Int8Array(N).fill(-1);
for (const [n, f] of [['METHOD_ENTRY', 4], ['CONSTRUCTOR_ENTRY', 5], ['SYSTEM_METHOD_ENTRY', 3], ['CODE_UNIT_STARTED', 4], ['VF_APEX_CALL_START', 3]]) LABEL_FIELD[idOf.get(n)] = f;
// Counter kind contributed by a leaf of this type: 1 soql, 2 dml, 3 sosl, 7 thrown (slot index + 1)
const OWN_COUNT = new Int8Array(N);
OWN_COUNT[idOf.get('SOQL_EXECUTE_BEGIN')] = 1; OWN_COUNT[idOf.get('DML_BEGIN')] = 2; OWN_COUNT[idOf.get('SOSL_EXECUTE_BEGIN')] = 3; OWN_COUNT[idOf.get('EXCEPTION_THROWN')] = 7;
const ROWS_FROM_EXIT = new Int8Array(N); // exit type -> row-count slot (+1)
ROWS_FROM_EXIT[idOf.get('SOQL_EXECUTE_END')] = 4; ROWS_FROM_EXIT[idOf.get('SOSL_EXECUTE_END')] = 6;
const HEAP = idOf.get('HEAP_ALLOCATE'), EXEC = idOf.get('EXECUTION_STARTED');
const HB = 4096, H_TAB = new Int16Array(HB).fill(-1), NAME_HASH = new Int32Array(N), NAME_LEN = new Uint8Array(N);
for (let i = 1; i < N; i++) {
  let h = 0; for (const ch of names[i]) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  NAME_HASH[i] = h; NAME_LEN[i] = names[i].length; let k = h & (HB - 1); while (H_TAB[k] !== -1) k = (k + 1) & (HB - 1); H_TAB[k] = i;
}
export const NC = 8;
const LN_NULL = -2, LN_EXTERNAL = -1;

function grow(a, n) { const b = new a.constructor(n); b.set(a.subarray(0, Math.min(a.length, n))); return b; }

export function scanV5s(src, opts = {}) {
  const verify = opts.verify !== false;
  const methodStats = opts.methodStats !== false;
  const len = src.length;
  let cap = Math.max(1 << 12, Math.ceil(len / 120)), n = 0;
  let type = new Uint16Array(cap), start = new Uint32Array(cap), ts = new Float64Array(cap),
    exitTs = new Float64Array(cap), parent = new Int32Array(cap), subEnd = new Uint32Array(cap), depth = new Uint16Array(cap),
    lineNo = new Int32Array(cap), label = new Int32Array(cap), ns = new Int32Array(cap), selfDur = new Float64Array(cap),
    cslot = new Int32Array(cap), heap = new Float64Array(cap), peak = new Float64Array(cap);
  let pCap = 1 << 10, nSlots = 0, pool = new Int32Array(pCap * NC);
  let sCap = 1 << 12, nStr = 0, strStart = new Uint32Array(sCap), strEnd = new Uint32Array(sCap), strHash = new Int32Array(sCap);
  let IB = 1 << 14, iTab = new Int32Array(IB).fill(-1);
  let mCap = 1 << 12, mCalls = new Uint32Array(mCap), mSelf = new Float64Array(mCap), mTotal = new Float64Array(mCap), mActive = new Uint16Array(mCap);
  const byTypeN = new Uint32Array(N), byType = new Array(N); for (let t = 0; t < N; t++) byType[t] = new Uint32Array(8);
  const wrappedEnd = new Map(); let nsOfLabel = new Int32Array(1 << 12).fill(-2);
  const stack = new Int32Array(16384); let sp = 0, last = -1, running = 0, unmatchedExits = 0;
  // root row 0
  type[0] = 0; parent[0] = -1; label[0] = -1; ns[0] = -1; cslot[0] = -1; n = 1; stack[sp++] = 0;
  let pos = 0;
  while (pos < len) {
    let eol = src.indexOf('\n', pos); if (eol < 0) eol = len;
    let lineEnd = eol; if (lineEnd > pos && src.charCodeAt(lineEnd - 1) === 13) lineEnd--;
    if (src.charCodeAt(pos + 2) === 58 && src.charCodeAt(pos + 5) === 58) {
      let i = pos + 8; while (i < lineEnd && src.charCodeAt(i) !== 40) i++; i++;
      let t = 0, c = 0; while ((c = src.charCodeAt(i)) !== 41 && i < lineEnd) { t = t * 10 + (c - 48); i++; }
      i += 2; const t0 = i;
      let h = 0; while (i < lineEnd && (c = src.charCodeAt(i)) !== 124) { h = (Math.imul(h, 31) + c) | 0; i++; }
      let k = h & (HB - 1), id = 0;
      for (let e; (e = H_TAB[k]) !== -1; k = (k + 1) & (HB - 1)) if (NAME_HASH[e] === h && NAME_LEN[e] === i - t0) { id = e; break; }
      if (id === 0) { pos = eol + 1; continue; } // unsupported name: a parsing error in the real engine
      let ln = LN_NULL;
      if (src.charCodeAt(i) === 124 && src.charCodeAt(i + 1) === 91) { let j = i + 2; if (src.charCodeAt(j) === 69) ln = LN_EXTERNAL; else { ln = 0; while ((c = src.charCodeAt(j)) >= 48 && c <= 57) { ln = ln * 10 + (c - 48); j++; } } }
      if (last >= 0 && NEXT_IS_EXIT[type[last]] && exitTs[last] === 0) exitTs[last] = t;
      if (PURE_EXIT[id]) {
        // find the frame this exit closes: the top, or one further down (unwind)
        let m = sp - 1;
        for (; m > 0; m--) { const f = stack[m], fl = lineNo[f]; if (EXIT_MATCH[type[f] * N + id] && (ln === fl || ln < 0 || fl < 0)) break; }
        if (m > 0) {
          const rs = ROWS_FROM_EXIT[id];
          if (rs) { // Rows:N from the exit line, onto the frame being closed
            let j = lineEnd - 1; while (j > i && src.charCodeAt(j) !== 58) j--; let rows = 0; j++; while (j < lineEnd && (c = src.charCodeAt(j)) >= 48 && c <= 57) { rows = rows * 10 + (c - 48); j++; }
            const f = stack[m]; let sl = cslot[f]; if (sl < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } sl = cslot[f] = nSlots++; } pool[sl * NC + rs - 1] += rows;
          }
          while (sp > m) {
            const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n;
            const p = parent[e];
            selfDur[p] -= tot; const ck = cslot[e];
            if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } const pb = pk * NC, cb = ck * NC; for (let q = 0; q < NC; q++) pool[pb + q] += pool[cb + q]; }
            heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e];
            if (methodStats) { const l = label[e]; if (l >= 0) { if (--mActive[l] === 0) mTotal[l] += tot; mSelf[l] += selfDur[e]; } }
          }
          last = -1; pos = eol + 1; continue;
        }
        unmatchedExits++; // kept as a leaf row, as today
      }
      if (n === cap) { cap *= 2; type = grow(type, cap); start = grow(start, cap); ts = grow(ts, cap); exitTs = grow(exitTs, cap); parent = grow(parent, cap); subEnd = grow(subEnd, cap); depth = grow(depth, cap); lineNo = grow(lineNo, cap); label = grow(label, cap); ns = grow(ns, cap); selfDur = grow(selfDur, cap); cslot = grow(cslot, cap); heap = grow(heap, cap); peak = grow(peak, cap); }
      if (id === EXEC) {
        while (sp > 1) { const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; selfDur[p] -= tot; heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; const ck = cslot[e]; if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } for (let q = 0; q < NC; q++) pool[pk * NC + q] += pool[ck * NC + q]; } }
      }
      const e = n++; const p = stack[sp - 1];
      type[e] = id; start[e] = pos; ts[e] = t; lineNo[e] = ln; label[e] = -1; ns[e] = -1; cslot[e] = -1;
      parent[e] = p; depth[e] = sp - 1; subEnd[e] = e + 1;
      const lf = LABEL_FIELD[id];
      if (lf > 0) {
        let f = 2, a = i; while (f < lf && a < lineEnd) { a++; while (a < lineEnd && src.charCodeAt(a) !== 124) a++; f++; }
        a++; let b = a, hh = 0, dot = -1;
        while (b < lineEnd && (c = src.charCodeAt(b)) !== 124) { hh = (Math.imul(hh, 31) + c) | 0; if (c === 46 && dot < 0) dot = b; b++; }
        if (a < b) {
          let kk = hh & (IB - 1), sid = -1;
          for (let s2; (s2 = iTab[kk]) !== -1; kk = (kk + 1) & (IB - 1)) {
            if (strHash[s2] === hh && strEnd[s2] - strStart[s2] === b - a) {
              if (!verify) { sid = s2; break; }
              let x = strStart[s2], y = a; while (y < b && src.charCodeAt(y) === src.charCodeAt(x)) { x++; y++; } if (y === b) { sid = s2; break; }
            }
          }
          if (sid < 0) {
            if (nStr + 2 >= sCap) { sCap *= 2; strStart = grow(strStart, sCap); strEnd = grow(strEnd, sCap); strHash = grow(strHash, sCap); }
            sid = nStr++; strStart[sid] = a; strEnd[sid] = b; strHash[sid] = hh; iTab[kk] = sid;
            if (nStr * 2 > IB) { IB *= 2; iTab = new Int32Array(IB).fill(-1); for (let s3 = 0; s3 < nStr; s3++) { let k3 = strHash[s3] & (IB - 1); while (iTab[k3] !== -1) k3 = (k3 + 1) & (IB - 1); iTab[k3] = s3; } }
          }
          label[e] = sid;
          if (sid >= nsOfLabel.length) { const o = nsOfLabel; nsOfLabel = new Int32Array(o.length * 2).fill(-2); nsOfLabel.set(o); }
          let nsid = nsOfLabel[sid];
          if (nsid === -2) {
            // first sight of this label: intern its namespace prefix once
            nsid = -1;
            if (dot > a) {
              let h2 = 0; for (let q = a; q < dot; q++) h2 = (Math.imul(h2, 31) + src.charCodeAt(q)) | 0;
              let k2 = h2 & (IB - 1);
              for (let s2; (s2 = iTab[k2]) !== -1; k2 = (k2 + 1) & (IB - 1)) { if (strHash[s2] === h2 && strEnd[s2] - strStart[s2] === dot - a) { let x = strStart[s2], y = a; while (y < dot && src.charCodeAt(y) === src.charCodeAt(x)) { x++; y++; } if (y === dot) { nsid = s2; break; } } }
              if (nsid < 0) { nsid = nStr++; strStart[nsid] = a; strEnd[nsid] = dot; strHash[nsid] = h2; iTab[k2] = nsid; if (nStr * 2 > IB) { IB *= 2; iTab = new Int32Array(IB).fill(-1); for (let s3 = 0; s3 < nStr; s3++) { let k3 = strHash[s3] & (IB - 1); while (iTab[k3] !== -1) k3 = (k3 + 1) & (IB - 1); iTab[k3] = s3; } } }
            }
            nsOfLabel[sid] = nsid;
          }
          ns[e] = nsid;
        }
      }
      if (byTypeN[id] === byType[id].length) byType[id] = grow(byType[id], byType[id].length * 2);
      byType[id][byTypeN[id]++] = e;
      const own = OWN_COUNT[id];
      if (own) { let sl = cslot[e]; if (sl < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } sl = cslot[e] = nSlots++; } pool[sl * NC + own - 1] = 1; }
      else if (id === HEAP) { let j = lineEnd - 1; while (j > i && src.charCodeAt(j) !== 58) j--; let b = 0, neg = false; j++; if (src.charCodeAt(j) === 45) { neg = true; j++; } while (j < lineEnd && (c = src.charCodeAt(j)) >= 48 && c <= 57) { b = b * 10 + (c - 48); j++; } if (neg) b = -b; heap[e] = b; running = running + b; if (running < 0) running = 0; peak[e] = running; }
      if (HAS_EXITS[id]) {
        stack[sp++] = e;
        if (methodStats) { const l = label[e]; if (l >= 0) { if (l >= mCap) { mCap = Math.max(mCap * 2, l + 1); mCalls = grow(mCalls, mCap); mSelf = grow(mSelf, mCap); mTotal = grow(mTotal, mCap); mActive = grow(mActive, mCap); } mCalls[l]++; mActive[l]++; } }
      } else {
        // a leaf rolls straight into its parent
        const ck = cslot[e]; if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } for (let q = 0; q < NC; q++) pool[pk * NC + q] += pool[ck * NC + q]; }
        heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e];
      }
      last = e;
    } else if (last >= 0 && ACCEPTS[type[last]] && src.charCodeAt(pos) !== 42) {
      wrappedEnd.set(last, lineEnd);
    }
    pos = eol + 1;
  }
  const lastTs = n > 1 ? ts[n - 1] : 0;
  while (sp > 1) { const e = stack[--sp]; exitTs[e] = lastTs; const tot = lastTs - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; selfDur[p] -= tot; heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; }
  ts[0] = n > 1 ? ts[1] : 0; exitTs[0] = lastTs; subEnd[0] = n;
  return { n, src, type, start, wrappedEnd, ts, exitTs, parent, subEnd, depth, lineNo, label, ns, selfDur, cslot, pool, nSlots, heap, peak, strStart, strEnd, nStr, byType, byTypeN, mCalls, mSelf, mTotal, unmatchedExits };
}
````

### `scan-v5w.mjs`

````js
// Prototype v5w: v5 with a SWAR newline search instead of Uint8Array.indexOf.
// Prototype v5: v4 with label hashing fused into the field scan, namespace derived once per
// distinct label, end offsets stored only for wrapped rows. (Header from v4 follows.)
// Prototype v4: v3's output shape, tuned. One function, no closures in the loop. Adds today's
// line-number exit matching, unwinding to a match further down the stack, unmatched exits kept
// as rows, SOQL/SOSL rows read from the exit line, and a root row 0. Still omits issues text,
// limits, truncation, package merge, flow residuals, discontinuity and the per-event text rules.
import { readFileSync } from 'node:fs';

const table = JSON.parse(readFileSync(new URL('./type-table.json', import.meta.url), 'utf8'));
export const names = ['<root>', ...table.map((r) => r.name)];
const N = names.length, idOf = new Map(names.map((n, i) => [n, i]));
export const PURE_EXIT = new Uint8Array(N);
const NEXT_IS_EXIT = new Uint8Array(N), ACCEPTS = new Uint8Array(N), HAS_EXITS = new Uint8Array(N), EXIT_MATCH = new Uint8Array(N * N);
table.forEach((r, i) => {
  const t = i + 1;
  PURE_EXIT[t] = r.isExit && !(r.exitTypes?.length) ? 1 : 0;
  NEXT_IS_EXIT[t] = r.nextLineIsExit ? 1 : 0; ACCEPTS[t] = r.acceptsText ? 1 : 0;
  for (const x of r.exitTypes ?? []) { EXIT_MATCH[t * N + idOf.get(x)] = 1; HAS_EXITS[t] = 1; }
});
const LABEL_FIELD = new Int8Array(N).fill(-1);
for (const [n, f] of [['METHOD_ENTRY', 4], ['CONSTRUCTOR_ENTRY', 5], ['SYSTEM_METHOD_ENTRY', 3], ['CODE_UNIT_STARTED', 4], ['VF_APEX_CALL_START', 3]]) LABEL_FIELD[idOf.get(n)] = f;
// Counter kind contributed by a leaf of this type: 1 soql, 2 dml, 3 sosl, 7 thrown (slot index + 1)
const OWN_COUNT = new Int8Array(N);
OWN_COUNT[idOf.get('SOQL_EXECUTE_BEGIN')] = 1; OWN_COUNT[idOf.get('DML_BEGIN')] = 2; OWN_COUNT[idOf.get('SOSL_EXECUTE_BEGIN')] = 3; OWN_COUNT[idOf.get('EXCEPTION_THROWN')] = 7;
const ROWS_FROM_EXIT = new Int8Array(N); // exit type -> row-count slot (+1)
ROWS_FROM_EXIT[idOf.get('SOQL_EXECUTE_END')] = 4; ROWS_FROM_EXIT[idOf.get('SOSL_EXECUTE_END')] = 6;
const HEAP = idOf.get('HEAP_ALLOCATE'), EXEC = idOf.get('EXECUTION_STARTED');
const HB = 4096, H_TAB = new Int16Array(HB).fill(-1), NAME_HASH = new Int32Array(N), NAME_LEN = new Uint8Array(N);
for (let i = 1; i < N; i++) {
  let h = 0; for (const ch of names[i]) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  NAME_HASH[i] = h; NAME_LEN[i] = names[i].length; let k = h & (HB - 1); while (H_TAB[k] !== -1) k = (k + 1) & (HB - 1); H_TAB[k] = i;
}
export const NC = 8;
const LN_NULL = -2, LN_EXTERNAL = -1;

function grow(a, n) { const b = new a.constructor(n); b.set(a.subarray(0, Math.min(a.length, n))); return b; }

export function scanV5w(src, opts = {}) {
  // SWAR newline search over a Uint32Array view (src.byteOffset must be 4-aligned)
  const W32 = new Uint32Array(src.buffer, src.byteOffset, src.length >>> 2), SLEN = src.length;
  const nextNl = (p) => {
    while (p < SLEN && (p & 3) !== 0) { if (src[p] === 10) return p; p++; }
    const kEnd = SLEN >>> 2; let k = p >>> 2;
    for (; k < kEnd; k++) { const x = (W32[k] ^ 0x0a0a0a0a) | 0; if ((((x - 0x01010101) & ~x) & 0x80808080) !== 0) break; }
    const q = k << 2; if (q > p) p = q; while (p < SLEN) { if (src[p] === 10) return p; p++; } return -1;
  };
  const verify = opts.verify !== false;
  const methodStats = opts.methodStats !== false;
  const len = src.length;
  let cap = Math.max(1 << 12, Math.ceil(len / 120)), n = 0;
  let type = new Uint16Array(cap), start = new Uint32Array(cap), ts = new Float64Array(cap),
    exitTs = new Float64Array(cap), parent = new Int32Array(cap), subEnd = new Uint32Array(cap), depth = new Uint16Array(cap),
    lineNo = new Int32Array(cap), label = new Int32Array(cap), ns = new Int32Array(cap), selfDur = new Float64Array(cap),
    cslot = new Int32Array(cap), heap = new Float64Array(cap), peak = new Float64Array(cap);
  let pCap = 1 << 10, nSlots = 0, pool = new Int32Array(pCap * NC);
  let sCap = 1 << 12, nStr = 0, strStart = new Uint32Array(sCap), strEnd = new Uint32Array(sCap), strHash = new Int32Array(sCap);
  let IB = 1 << 14, iTab = new Int32Array(IB).fill(-1);
  let mCap = 1 << 12, mCalls = new Uint32Array(mCap), mSelf = new Float64Array(mCap), mTotal = new Float64Array(mCap), mActive = new Uint16Array(mCap);
  const byTypeN = new Uint32Array(N), byType = new Array(N); for (let t = 0; t < N; t++) byType[t] = new Uint32Array(8);
  const wrappedEnd = new Map(); let nsOfLabel = new Int32Array(1 << 12).fill(-2);
  const stack = new Int32Array(16384); let sp = 0, last = -1, running = 0, unmatchedExits = 0;
  // root row 0
  type[0] = 0; parent[0] = -1; label[0] = -1; ns[0] = -1; cslot[0] = -1; n = 1; stack[sp++] = 0;
  let pos = 0;
  while (pos < len) {
    let eol = nextNl(pos); if (eol < 0) eol = len;
    let lineEnd = eol; if (lineEnd > pos && src[lineEnd - 1] === 13) lineEnd--;
    if (src[pos + 2] === 58 && src[pos + 5] === 58) {
      let i = pos + 8; while (i < lineEnd && src[i] !== 40) i++; i++;
      let t = 0, c = 0; while ((c = src[i]) !== 41 && i < lineEnd) { t = t * 10 + (c - 48); i++; }
      i += 2; const t0 = i;
      let h = 0; while (i < lineEnd && (c = src[i]) !== 124) { h = (Math.imul(h, 31) + c) | 0; i++; }
      let k = h & (HB - 1), id = 0;
      for (let e; (e = H_TAB[k]) !== -1; k = (k + 1) & (HB - 1)) if (NAME_HASH[e] === h && NAME_LEN[e] === i - t0) { id = e; break; }
      if (id === 0) { pos = eol + 1; continue; } // unsupported name: a parsing error in the real engine
      let ln = LN_NULL;
      if (src[i] === 124 && src[i + 1] === 91) { let j = i + 2; if (src[j] === 69) ln = LN_EXTERNAL; else { ln = 0; while ((c = src[j]) >= 48 && c <= 57) { ln = ln * 10 + (c - 48); j++; } } }
      if (last >= 0 && NEXT_IS_EXIT[type[last]] && exitTs[last] === 0) exitTs[last] = t;
      if (PURE_EXIT[id]) {
        // find the frame this exit closes: the top, or one further down (unwind)
        let m = sp - 1;
        for (; m > 0; m--) { const f = stack[m], fl = lineNo[f]; if (EXIT_MATCH[type[f] * N + id] && (ln === fl || ln < 0 || fl < 0)) break; }
        if (m > 0) {
          const rs = ROWS_FROM_EXIT[id];
          if (rs) { // Rows:N from the exit line, onto the frame being closed
            let j = lineEnd - 1; while (j > i && src[j] !== 58) j--; let rows = 0; j++; while (j < lineEnd && (c = src[j]) >= 48 && c <= 57) { rows = rows * 10 + (c - 48); j++; }
            const f = stack[m]; let sl = cslot[f]; if (sl < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } sl = cslot[f] = nSlots++; } pool[sl * NC + rs - 1] += rows;
          }
          while (sp > m) {
            const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n;
            const p = parent[e];
            selfDur[p] -= tot; const ck = cslot[e];
            if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } const pb = pk * NC, cb = ck * NC; for (let q = 0; q < NC; q++) pool[pb + q] += pool[cb + q]; }
            heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e];
            if (methodStats) { const l = label[e]; if (l >= 0) { if (--mActive[l] === 0) mTotal[l] += tot; mSelf[l] += selfDur[e]; } }
          }
          last = -1; pos = eol + 1; continue;
        }
        unmatchedExits++; // kept as a leaf row, as today
      }
      if (n === cap) { cap *= 2; type = grow(type, cap); start = grow(start, cap); ts = grow(ts, cap); exitTs = grow(exitTs, cap); parent = grow(parent, cap); subEnd = grow(subEnd, cap); depth = grow(depth, cap); lineNo = grow(lineNo, cap); label = grow(label, cap); ns = grow(ns, cap); selfDur = grow(selfDur, cap); cslot = grow(cslot, cap); heap = grow(heap, cap); peak = grow(peak, cap); }
      if (id === EXEC) {
        while (sp > 1) { const e = stack[--sp]; exitTs[e] = t; const tot = t - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; selfDur[p] -= tot; heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; const ck = cslot[e]; if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } for (let q = 0; q < NC; q++) pool[pk * NC + q] += pool[ck * NC + q]; } }
      }
      const e = n++; const p = stack[sp - 1];
      type[e] = id; start[e] = pos; ts[e] = t; lineNo[e] = ln; label[e] = -1; ns[e] = -1; cslot[e] = -1;
      parent[e] = p; depth[e] = sp - 1; subEnd[e] = e + 1;
      const lf = LABEL_FIELD[id];
      if (lf > 0) {
        let f = 2, a = i; while (f < lf && a < lineEnd) { a++; while (a < lineEnd && src[a] !== 124) a++; f++; }
        a++; let b = a, hh = 0, dot = -1;
        while (b < lineEnd && (c = src[b]) !== 124) { hh = (Math.imul(hh, 31) + c) | 0; if (c === 46 && dot < 0) dot = b; b++; }
        if (a < b) {
          let kk = hh & (IB - 1), sid = -1;
          for (let s2; (s2 = iTab[kk]) !== -1; kk = (kk + 1) & (IB - 1)) {
            if (strHash[s2] === hh && strEnd[s2] - strStart[s2] === b - a) {
              if (!verify) { sid = s2; break; }
              let x = strStart[s2], y = a; while (y < b && src[y] === src[x]) { x++; y++; } if (y === b) { sid = s2; break; }
            }
          }
          if (sid < 0) {
            if (nStr + 2 >= sCap) { sCap *= 2; strStart = grow(strStart, sCap); strEnd = grow(strEnd, sCap); strHash = grow(strHash, sCap); }
            sid = nStr++; strStart[sid] = a; strEnd[sid] = b; strHash[sid] = hh; iTab[kk] = sid;
            if (nStr * 2 > IB) { IB *= 2; iTab = new Int32Array(IB).fill(-1); for (let s3 = 0; s3 < nStr; s3++) { let k3 = strHash[s3] & (IB - 1); while (iTab[k3] !== -1) k3 = (k3 + 1) & (IB - 1); iTab[k3] = s3; } }
          }
          label[e] = sid;
          if (sid >= nsOfLabel.length) { const o = nsOfLabel; nsOfLabel = new Int32Array(o.length * 2).fill(-2); nsOfLabel.set(o); }
          let nsid = nsOfLabel[sid];
          if (nsid === -2) {
            // first sight of this label: intern its namespace prefix once
            nsid = -1;
            if (dot > a) {
              let h2 = 0; for (let q = a; q < dot; q++) h2 = (Math.imul(h2, 31) + src[q]) | 0;
              let k2 = h2 & (IB - 1);
              for (let s2; (s2 = iTab[k2]) !== -1; k2 = (k2 + 1) & (IB - 1)) { if (strHash[s2] === h2 && strEnd[s2] - strStart[s2] === dot - a) { let x = strStart[s2], y = a; while (y < dot && src[y] === src[x]) { x++; y++; } if (y === dot) { nsid = s2; break; } } }
              if (nsid < 0) { nsid = nStr++; strStart[nsid] = a; strEnd[nsid] = dot; strHash[nsid] = h2; iTab[k2] = nsid; if (nStr * 2 > IB) { IB *= 2; iTab = new Int32Array(IB).fill(-1); for (let s3 = 0; s3 < nStr; s3++) { let k3 = strHash[s3] & (IB - 1); while (iTab[k3] !== -1) k3 = (k3 + 1) & (IB - 1); iTab[k3] = s3; } } }
            }
            nsOfLabel[sid] = nsid;
          }
          ns[e] = nsid;
        }
      }
      if (byTypeN[id] === byType[id].length) byType[id] = grow(byType[id], byType[id].length * 2);
      byType[id][byTypeN[id]++] = e;
      const own = OWN_COUNT[id];
      if (own) { let sl = cslot[e]; if (sl < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } sl = cslot[e] = nSlots++; } pool[sl * NC + own - 1] = 1; }
      else if (id === HEAP) { let j = lineEnd - 1; while (j > i && src[j] !== 58) j--; let b = 0, neg = false; j++; if (src[j] === 45) { neg = true; j++; } while (j < lineEnd && (c = src[j]) >= 48 && c <= 57) { b = b * 10 + (c - 48); j++; } if (neg) b = -b; heap[e] = b; running = running + b; if (running < 0) running = 0; peak[e] = running; }
      if (HAS_EXITS[id]) {
        stack[sp++] = e;
        if (methodStats) { const l = label[e]; if (l >= 0) { if (l >= mCap) { mCap = Math.max(mCap * 2, l + 1); mCalls = grow(mCalls, mCap); mSelf = grow(mSelf, mCap); mTotal = grow(mTotal, mCap); mActive = grow(mActive, mCap); } mCalls[l]++; mActive[l]++; } }
      } else {
        // a leaf rolls straight into its parent
        const ck = cslot[e]; if (ck >= 0) { let pk = cslot[p]; if (pk < 0) { if (nSlots === pCap) { pCap *= 2; pool = grow(pool, pCap * NC); } pk = cslot[p] = nSlots++; } for (let q = 0; q < NC; q++) pool[pk * NC + q] += pool[ck * NC + q]; }
        heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e];
      }
      last = e;
    } else if (last >= 0 && ACCEPTS[type[last]] && src[pos] !== 42) {
      wrappedEnd.set(last, lineEnd);
    }
    pos = eol + 1;
  }
  const lastTs = n > 1 ? ts[n - 1] : 0;
  while (sp > 1) { const e = stack[--sp]; exitTs[e] = lastTs; const tot = lastTs - ts[e]; selfDur[e] += tot; subEnd[e] = n; const p = parent[e]; selfDur[p] -= tot; heap[p] += heap[e]; if (peak[e] > peak[p]) peak[p] = peak[e]; }
  ts[0] = n > 1 ? ts[1] : 0; exitTs[0] = lastTs; subEnd[0] = n;
  return { n, src, type, start, wrappedEnd, ts, exitTs, parent, subEnd, depth, lineNo, label, ns, selfDur, cslot, pool, nSlots, heap, peak, strStart, strEnd, nStr, byType, byTypeN, mCalls, mSelf, mTotal, unmatchedExits };
}
````

### `sb-one.mjs`

````js
// One variant per process: node sb-one.mjs <variant> <file>. Prints the median of 9 warm scans.
import { readFileSync } from 'node:fs';
const [variant, path] = process.argv.slice(2);
const buf = readFileSync(path);
let run;
if (variant === 'u8') { const { scanV5 } = await import('./scan-v5.mjs'); const b = new Uint8Array(buf.buffer, buf.byteOffset, buf.length); run = () => scanV5(b).n; }
if (variant === 'buffer') { const { scanV5 } = await import('./scan-v5.mjs'); run = () => scanV5(buf).n; }
if (variant === 'swar') { const { scanV5w } = await import('./scan-v5w.mjs'); const b = new Uint8Array(buf.buffer, buf.byteOffset, buf.length); run = () => scanV5w(b).n; }
if (variant === 'string') { const { scanV5s } = await import('./scan-v5s.mjs'); const s = buf.toString('utf8'); run = () => scanV5s(s).n; }
const rows = run(); run();
const ts = []; for (let r = 0; r < 9; r++) { const t = performance.now(); run(); ts.push(performance.now() - t); }
ts.sort((a, b) => a - b); console.log(ts[4].toFixed(0), rows);
````

### `strbytes.mjs`

````js
// Strings vs bytes, same v5 algorithm. Also the input-acquisition cost of each.
import { readFileSync } from 'node:fs';
import { scanV5 } from './scan-v5.mjs';
import { scanV5s } from './scan-v5s.mjs';
function time(fn, runs = 9) { fn(); fn(); const ts = []; for (let r = 0; r < runs; r++) { const t = performance.now(); fn(); ts.push(performance.now() - t); } ts.sort((a, b) => a - b); return ts[runs >> 1]; }
const dir = process.argv[2];
for (const f of process.argv.slice(3)) {
  const path = `${dir}/${f}`; const buf = readFileSync(path); const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.length); const str = buf.toString('utf8');
  const a = scanV5(bytes), b = scanV5s(str);
  let same = a.n === b.n; for (let i = 0; same && i < a.n; i++) if (a.ts[i] !== b.ts[i] || a.exitTs[i] !== b.exitTs[i] || a.parent[i] !== b.parent[i]) same = false;
  console.log(`== ${f} (${(buf.length / 1e6).toFixed(0)} MB, string is ${str.length === buf.length ? 'one-byte' : 'TWO-BYTE'}): same tree ${same}, strings ${a.nStr}/${b.nStr}`);
  console.log(`  scan only:   bytes (Uint8Array) ${time(() => scanV5(bytes)).toFixed(0)} ms | string ${time(() => scanV5s(str)).toFixed(0)} ms`);
  console.log(`  input cost:  read file -> bytes ${time(() => readFileSync(path), 5).toFixed(0)} ms | read file -> string (utf8) ${time(() => readFileSync(path, 'utf8'), 5).toFixed(0)} ms | bytes -> string (TextDecoder) ${time(() => new TextDecoder().decode(bytes), 5).toFixed(0)} ms | string -> bytes (TextEncoder) ${time(() => new TextEncoder().encode(str), 5).toFixed(0)} ms`);
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

### Raw output: Chromium 141 (`web/make-web.py`)

````text
dev20.log: JS v5 136 ms (rows 144590)
   WASM SIMD128 23 ms (rows 144590)
large100.log: JS v5 327 ms (rows 510461)
   WASM SIMD128 110 ms (rows 510461)
DONE Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36
````

### Raw output: `final.ts` (warm)

````text
log                   MB    today    JS v5     WASM     SIMD  rows (JS / SIMD)
sample.log         0.001    0.88    0.14    0.05    0.05  7 / 7
dev20.log             20    1064      43      31      24  144590 / 144590
dev20-hc.log          19    1140      43      34      27  144590 / 144590
large100.log         100    4760     215     143     102  510461 / 510461
large100-hc.log       90    5026     400     206     175  510461 / 510461
````

### Raw output: `cold.ts` (ms, three runs each)

````text
== sample.log
today: 22.3 18.6 19.4  ms
js: 7.0 6.8 7.0  ms
wasm: 9.3 9.3 11.9  ms
simd: 9.6 9.8 10.9  ms
== dev20.log
today: 999.4 1054.2 956.8  ms
js: 158.1 169.2 167.5  ms
wasm: 89.6 108.2 95.8  ms
simd: 88.1 117.6 75.1  ms
== large100.log
today: 8112.3 5698.9 5125.4  ms
js: 447.4 408.6 449.3  ms
wasm: 417.8 449.0 409.9  ms
simd: 319.9 315.0 319.5  ms
````

### Raw output: backport rounds (`bp-measure.mts`)

````text
== e80a701
dev20.log          904 ms    190 MB
large100.log      3548 ms    808 MB
dev20.log          936 ms    190 MB
large100.log      3320 ms    808 MB
== 9071808
dev20.log          920 ms    179 MB
large100.log      3388 ms    764 MB
dev20.log          900 ms    179 MB
large100.log      3298 ms    764 MB
== 12410fc
dev20.log          811 ms    124 MB
large100.log      2976 ms    555 MB
dev20.log          776 ms    124 MB
large100.log      3027 ms    555 MB
````

### Raw output: strings vs bytes (`sb-one.mjs`, three rounds; `strbytes.mjs`)

````text
== dev20.log
  string: 60 67 65 ms
  u8: 53 48 47 ms
  buffer: 37 39 42 ms
  swar: 46 45 48 ms
== large100.log
  string: 352 325 327 ms
  u8: 236 234 250 ms
  buffer: 208 207 199 ms
  swar: 222 233 224 ms
== large100-hc.log
  string: 422 429 446 ms
  u8: 375 370 361 ms
  buffer: 312 318 330 ms
  swar: 339 351 338 ms

== dev20.log (20 MB, string is one-byte): same tree true, strings 32/32
  scan only:   bytes (Uint8Array) 62 ms | string 61 ms
  input cost:  read file -> bytes 38 ms | read file -> string (utf8) 32 ms | bytes -> string (TextDecoder) 14 ms | string -> bytes (TextEncoder) 17 ms
== large100.log (100 MB, string is one-byte): same tree true, strings 31/31
  scan only:   bytes (Uint8Array) 213 ms | string 290 ms
  input cost:  read file -> bytes 87 ms | read file -> string (utf8) 214 ms | bytes -> string (TextDecoder) 91 ms | string -> bytes (TextEncoder) 107 ms
== large100-hc.log (90 MB, string is TWO-BYTE): same tree true, strings 282345/282345
  scan only:   bytes (Uint8Array) 318 ms | string 374 ms
  input cost:  read file -> bytes 59 ms | read file -> string (utf8) 401 ms | bytes -> string (TextDecoder) 294 ms | string -> bytes (TextEncoder) 159 ms
````

### Raw output: Chromium strings vs bytes (`web/make-web.py`, two rounds)

````text
round 1
dev20.log: JS v5 bytes 145 ms (rows 144590) | JS v5 bytes+SWAR 76 ms (rows 144590) | JS v5 string 109 ms (rows 144590)
   input: TextDecoder 17 ms | TextEncoder 179 ms
   WASM SIMD128 24 ms (rows 144590)
large100.log: JS v5 bytes 391 ms (rows 510461) | JS v5 bytes+SWAR 349 ms (rows 510461) | JS v5 string 557 ms (rows 510461)
   input: TextDecoder 113 ms | TextEncoder 906 ms
   WASM SIMD128 118 ms (rows 510461)
DONE Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36
round 2
dev20.log: JS v5 bytes 81 ms (rows 144590) | JS v5 bytes+SWAR 73 ms (rows 144590) | JS v5 string 102 ms (rows 144590)
   input: TextDecoder 17 ms | TextEncoder 104 ms
   WASM SIMD128 24 ms (rows 144590)
large100.log: JS v5 bytes 390 ms (rows 510461) | JS v5 bytes+SWAR 351 ms (rows 510461) | JS v5 string 530 ms (rows 510461)
   input: TextDecoder 120 ms | TextEncoder 1015 ms
   WASM SIMD128 119 ms (rows 510461)
DONE Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/141.0.0.0 Safari/537.36
````
