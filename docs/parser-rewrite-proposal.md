# Parser rewrite: proposal

Status: research, for discussion under #37. Nothing here is merged code.

This is the short version. **`docs/parser-rewrite-agent-brief.md` is the full, self-contained
version.** It holds every measurement, the design detail, the feature-parity checklist, the open
decisions, the build plan with acceptance gates, and every script needed to reproduce the
numbers. Section references (§) below point into it.

## The problem

`parse()` runs on the caller's thread and allocates an object graph that is far larger than the
log. On the synthetic logs from #106:

| Log | Time | Retained heap |
| --- | ---: | ---: |
| 20 MB, the Salesforce cap | ~0.75–1.06 s | 190–259 MB |
| 100 MB | ~2.7–4.8 s | 0.8–1.1 GB |

The analyzer's webview freezes while it runs, and MCP holds a one-slot cache because reparsing is
so slow.

The cost is allocation, not reading text. Each event has 13 or more objects: the instance, 10
`{self, total}` counters, `children` and `exitTypes`. Each line also gets a `split` array, and
every event keeps a sliced string that pins the whole source. Across 175 event classes, the hot
property reads are megamorphic, and GC is over a fifth of the parse (§2).

## The design

This is the shape the fastest parsers and trace tools converge on: Perfetto, the Firefox Profiler,
simdjson, oxc, Lezer and the DevTools trace engine. It was checked against each of them and
measured (§3.6).

1. **A scanner with no per-line allocation.** It reads whatever the caller already has: a string
   (`charCodeAt` plus `String.indexOf`), or bytes (Node's `Buffer.indexOf`, or SWAR in browsers).
   It never converts just to scan (§3.9).
2. **A columnar store.** Typed arrays, one row per event, parents before children, and a
   subtree-end pointer. Strings are interned, and counts and exit details live in sparse side
   tables.
   - **Exits are folded into their entries.** Only their type, timestamp, line number, SOQL/SOSL
     rows and class-reference namespace are read. Unmatched exits and the dual `WF_*` types keep
     rows (§5.2).
   - **Event ids stay unique, stable and deterministic** per parse.
   - **Totals roll up when each frame closes,** in the same pass.
3. **Views.**
   - **One node class** for every event, created on demand and cached so `===` holds.
   - **A cursor** that walks without allocating.
   - **Per-type lists** from `ofType`.
   - **The raw columns** for timelines: building a flame chart from them costs ~0, and a redraw
     6 ms → 0.09 ms.
4. **One schema, two halves.** The schema generates a public model (named, documented interfaces
   per event, `EVENT_TYPES` metadata looked up by type, and `node.exit` details on the entry). It
   also generates an internal grammar: matching rules, field decoders and rollups. The compiler
   keeps the two in step, and no parser flag reaches the output (§5.12).
5. **Async and workers.** `parseAsync` yields every few milliseconds, can be cancelled and reports
   progress. `parseInWorker` transfers arrays rather than copying them. The extension host sends
   the webview bytes, never text that the webview would have to encode (§5.8).
6. **Ships in parallel and switchable** (§5.13):
   - `engine: 'next'` returns today's shape, through `compat`;
   - `engine: 'shadow'` runs both engines and reports differences;
   - `@apexdevtools/apex-log-parser/next` is the new API.

## The numbers

These are prototype measurements, with output verified identical between engines, plus 10–25%
for the rules the prototypes still omit (§3.7–3.9).

| | Today | JS core | Optional WASM SIMD core |
| --- | ---: | ---: | ---: |
| 20 MB, Node, warm | 0.75–1.06 s | 43 ms → 50–70 ms | 23 ms → 25–30 ms |
| 20 MB, Node, cold first parse | 0.96–1.05 s | 158–169 ms | 75–118 ms |
| 20 MB, Chromium | — | 73–109 ms (bytes with SWAR, or string) | 24 ms (bytes only) |
| 100 MB, Node | 2.7–4.8 s | 200–300 ms → 260–380 ms | 102–105 ms → 120–140 ms |
| Memory, 100 MB | 0.8–1.1 GB plus the pinned source | ~41 MB of columns plus the source | the same |
| Main thread blocked, worker mode | not viable | ≤ 4 ms | ≤ 4 ms |

## The recommendation

- **Build the JS core and ship it as the switchable engine** (§0.2). At the 20 MB cap, the WASM
  core's extra gain (~20 ms warm, ~50–90 ms cold) is not worth a second implementation of the
  subtle tree rules, a C/Rust toolchain and a CSP change. It is also not viable in the webview
  unless bytes arrive directly.
- **Add WASM later, behind a trigger.** Only if real-log profiles still show the parse as the main
  wait, for example MCP regularly parsing logs over 50 MB.
- **Backport to today's parser now** (§0.3), both measured with an identical output digest and all
  tests passing:
  - **shared `exitTypes` and `children` arrays:** ~5% less heap, safe;
  - **shared frozen zero counters:** a further ~30% less heap and ~10% faster, if no consumer
    writes to a leaf's or an exit's counters.
- **Decide with the go/no-go spike** (§0.1): build the JS scanner, the store and `compat` with
  every rule, then require identical digests on the private corpus and at least 5× the speed on
  real logs before committing.

## What it answers

| Issue | How |
| --- | --- |
| #37 perf and memory | The whole proposal, benchmark-gated |
| #108 heap and GC | No per-event objects |
| #34 per-kind indexes and visitor | `ofType`, `visit` and the cursor, built in the scanning pass |
| #35 classification | A total `kind` per event in the schema |
| #71 named, documented fields | Generated interfaces per event |
| #72 variables in scope | A lazy index built with the cursor over the columns |
