# AGENTS.md

Guidance for coding agents working in this repository. For usage docs see [README](./README.md).

## What this is

`@apexdevtools/apex-log-parser` turns raw Salesforce Apex debug log text into a typed event tree:
execution timings, governor limits, and SOQL/DML/SOSL counts. Zero runtime dependencies, ESM only.

## Layout

- `src/` — the parser. `catalog/catalog.ts` holds one hand-written entry per event
  type: its type info, its field names and its text rule. A rule names the fields it reads; the
  catalog resolves each name to a position at load, and throws on a name the entry does not list.
  `catalog/fields.ts` is type only: TSDoc for each type and field, so editors show it and no bundle
  carries it. `__tests__/Catalog.test.ts` and `scripts/__tests__/CatalogDocs.test.ts` fail when
  either drifts from the event database. `bytes/` reads the log's bytes: a `Source` per build
  (`node.ts`, `browser.ts`), the `ByteFields` cursor and the type id lookup. `bytes/ascii.ts`
  holds the byte constants and byte searches every reader shares, and `bytes/lines.ts` the line
  tests: a timestamp, a type name, the first event line. Every `Fields`
  adapter passes `__tests__/fieldsContract.ts`. `store/` holds the events as typed-array columns
  (ADR 0002), with sparse count and heap pools and the string table of interned byte ranges.
  `tags.ts` reads a value's type tag, which holds across realms where `instanceof` fails.
  `engine/builder.ts` builds the tree in one pass with v0's rules and v0's order of side
  effects. A matched exit line gets no row: it folds into the frame it closes. A package entry
  that v0's merge removed gets none either. `engine/tables.ts` holds the per-type tables the
  builder and the views read, and the two frame tests on a row. `engine/markers.ts` holds the
  work off the hot path: the issues, the parsing errors, the limit blocks and the hooks.
  `engine/rollups.ts` runs the passes after the
  build: the log's times, the rollups and the flow residuals. `engine/header.ts` reads the debug
  levels, `USER_INFO` and the start time. `engine/issues.ts` holds the log issues and turns them
  into truncation regions. The builder stops at a second log and reports it as an issue.
  `node.ts` and `browser.ts` are each build's entry: the async `parse`, and the surface both
  share (`api/surface.ts`). `engine/node.ts` and `engine/browser.ts` hold each build's `Engine`
  (`engine/engine.ts`), which keeps one idle builder alive. `api/parse.ts` is the driver both share:
  it reads the source to bytes (`api/sources.ts`), scans in 5 ms slices with `LogBuilder.scan`,
  runs the passes after the scan in slices with `LogBuilder.settle`, and yields between slices
  the build's own way. `api/buffers.ts` holds `toBuffers` and each build's `fromBuffers`, which
  move a log between threads: `engine/buffers.ts` turns a build into typed arrays and plain
  values that structured clone carries whole, and back. `Store.restore` and
  `StringTable.restore` make their objects as the engine does, so a restored log has the same
  object layout. The format is internal to one version of the package; it is not for storage.
  `api/worker.ts` is `parse`'s `worker` option: the read stays on the caller's thread, the bytes
  move to the worker (a copy when the caller holds them), and the log comes back as buffers.
  `worker/serve.ts` is the worker's side; `worker/node.ts` and `worker/browser.ts` start it, each
  built as one file with no imports, so a webview can start it from a `blob:` URL. `api/hosts.ts`
  holds each build's way to yield. V8 drops a class's object layout once no instance of it is alive, and
  throws away the code it optimised for it, so without one the parse after a GC runs about 3×
  slower. For the same reason a builder field that holds a time starts as a double (`NO_TIME`,
  -0), not 0. `benchmarks/__tests__/deopt.test.ts` fails when either breaks.
  `engine/namespaces.ts` holds the namespace rules, read from bytes. `limits.ts` parses limit
  text and derives the whole-log figures.
  `views/events.ts` reads the store as events: one runtime class for every type, each event made
  on first read and then the same object for its id (ADR 0002). Event ids start at 1; id 0 is the
  log. `views/lines.ts` reads an event's text, raw line, fields, suffix and cpuType from the
  source when a caller asks, through the catalog's rules; the flow interviews name, which needs the
  tree, is the one rule it holds itself. `views/details.ts` reads the values a line states beyond
  its text, as `aggregations` or a limit usage, one reader per type; `EventDetails` lists them,
  and `ofType` types each event's `details`. `views/log.ts` reads row 0 as `ApexLog`, the root, and makes each figure that needs work
  on first read. A merged package run can end after the leaves that follow it, so `at()` searches
  frames only.
- `src/__tests__/` — vitest suites. `helpers.ts` holds shared fixtures.
- `data/` — the event database, generated by `pnpm scrape`. Edit the scraper, not the JSON. It is
  not published and the parser never reads it. `Catalog.test.ts`, `CatalogDocs.test.ts` and the
  scripts read it.
- `scripts/scrape.ts` — the scraper. Reads both official sources over plain HTTP; see
  `scripts/scraper.md` for the endpoints and their failure modes. `--report=<path>` writes the run
  as JSON, which is what `scripts/ci/report.ts` reads.
- `scripts/validate-data.ts` — `pnpm run validate:data`, the event database against its own
  `$schema`. Not part of `pnpm run ci`; the scrape workflow runs it.
- `scripts/cli.ts` — argument reading and the entry-point guard every script uses. No other
  imports, so a small script does not pull the scraper's module graph in to read one flag.
- `scripts/ci/` — the scrape workflow's logic, so the YAML only declares what runs.
  `actions.ts` holds the Actions plumbing (step outputs, job summary, annotations); `report.ts`
  renders the pull request body; `seed.ts` seeds `data/` from the open automation branch. See
  `.github/workflows/README.md`.
- `benchmarks/` — every benchmark and its tools: the CodSpeed suite, the synthetic logs,
  `bench:large`, `bench:micro` and `compare`. See `benchmarks/AGENTS.md`. A new hot path in the
  parser needs a shape in `benchmarks/fixtures/profiles.json`. Every benchmark output states the
  raw figures, then the times and the percent change.
- `scripts/` and `benchmarks/` are outside `tsconfig.json`, so `pnpm typecheck` does not see them.
  `tsconfig.scripts.json` covers them instead, and `pnpm run ci` runs both.

## Commands

`pnpm run ci` — biome, `tsc --noEmit`, `tsc -p tsconfig.scripts.json`, vitest. Run this before
any commit.

- `pnpm ci` is pnpm's own alias for `clean-install`: it deletes `node_modules` and reinstalls.
  Always write `run`.
- `pnpm run bench` runs the benchmarks without watch mode. Locally it reports wall time; CI on a pull request
  reports instruction counts and allocations, so the two do not compare. The manual `walltime`
  job reports wall time, on other hardware. A parser change that can affect large logs also needs
  `pnpm run bench:large`, against `main`.
- `pnpm build` needs Node `^22.18 || ^24.11 || >=26` for tsdown, although the package itself
  supports any Node 22. CI builds on Node 24 only.

## The public API surface

Two entry points:

- The root (`.`). Its `node` condition gives the node build, and every other host gets the browser
  build. Both export the same surface: `parse`, `toBuffers`, `fromBuffers`, the catalog
  (`EVENT_TYPES`, `eventType`), the const companions and the public types.
  `src/__tests__/PublicApi.test.ts` pins it.
- `./worker`, the file a worker runs for `parse`'s `worker` option: the node build for the `node`
  condition, else the browser build as a classic script. It exports nothing.

Export only what a consumer uses in production. A helper that only a consumer's tests would reuse
stays internal.

Adding or removing an export needs `src/__tests__/PublicApi.test.ts` updated in the same change: it
pins the runtime list, and pins the types through an interface that fails `pnpm typecheck` rather
than the test run. Run both.

## Conventions

- TypeScript is strict, with `verbatimModuleSyntax` and `isolatedDeclarations`: every exported
  declaration states its type, and type-only imports are statement-level `import type`.
- `noUncheckedIndexedAccess` makes every indexed read `T | undefined`, which is why parsing code
  carries `!` and `?? ''`.
- `erasableSyntaxOnly` bans enums, so a union needs a const companion beside it.
- Import with a `.js` extension.
- `types: ["vitest/globals"]` in `tsconfig.json` is what keeps ambient node types out. `src/` uses
  no `node:*` and reads no files at runtime; `src/worker/node.ts` reaches `worker_threads`
  through the global `process.getBuiltinModule` instead. `tsconfig.scripts.json` adds `node` for `scripts/`
  only. A test may statically import the data JSON, as
  `Catalog.test.ts` does; `tsconfig.build.json` excludes the tests, so `rootDir` still holds
  for the build. A WHATWG global `src/` needs is declared in the module that uses it, as
  `api/sources.ts` declares `TextEncoder`. Never widen `lib` to `DOM` for one type.
- Event times are nanoseconds and heap figures are bytes. `ApexLog.startTime` is milliseconds since
  midnight, and the `cpuTime` limit is milliseconds. State the unit on any new field.
- Report what the log stated. Never substitute a default for a value the log did not give — use
  `null`, so a caller can tell "not stated" from "zero". Not `''`, and not an absent or `undefined`
  field, whose shape depends on the transport. A sub-object whose source field is missing is `null`
  itself, not an object of nulls.
- Comment the why, not the what. In doubt, none. One line. Public API takes a doc block.
- Never paste a log from an org. Fixtures use `ns`, `MyClass`, `user@example.com` and ids
  zero-filled after the key prefix (`005000000000AAA`).
- Conventional commits, one concern per commit.
- Add a changeset for any change a consumer can see. Changesets writes `CHANGELOG.md`; never
  edit it by hand.
- File issues and pull requests through the repo's templates in `.github/`. Fix one filed without a
  template in place; never close and refile.

## Adding an event type

1. `src/catalog/types.ts` — append the name to the end of `EVENT_TYPE_NAMES`, never in sorted
   order, so no other type id moves.
2. `src/catalog/catalog.ts` — add its entry, with its `fields`, to `ENTRIES`. A field named `line`
   makes the engine read a line number. An event that adds to a rollup or states a namespace
   declares it in the entry: `count`, `rows`, `heap`, `namespace`. Scan-time work no declaration
   states is a `hook`, which the engine runs. Text, suffix and cpuType work is not: the views do
   it.
3. `src/catalog/fields.ts` — document it in `EventFields`: the data JSON description, then each
   field with its `Format:`. Add the `@remarks` line unless a real log confirms the layout.
4. `data/salesforce-debug-log-events.json` — via `pnpm scrape`, once Salesforce documents it.

`Catalog.test.ts` enforces steps 1, 2 and 4 against the data JSON: the catalog holds exactly the
documented events, and each one's debug category and level equal the database's.
`CatalogDocs.test.ts` enforces step 3: the TSDoc states each description and each field.

## Rollups

`LogBuilder.settle` runs the passes after the scan, in this order: the log's times
(`setLogTimes`), `rollUp`, `applyFlowResiduals`, then the store trim. The last three stop at a
deadline and go on from where they stopped. The residual pass is after `rollUp` because it adds to every
ancestor itself.

- `rollUp` goes down from the last id, so each subtree is totalled before its root moves up. That
  holds because ids are in prefix order. A new counter rolls up once it is in the store's
  `COUNTERS`.
- `duration.self` is a subtraction: each row adds its total to its own self and takes it off its
  parent's.
- `heapPeak` composes by max, not sum. `heapAllocated.self` and `heapGross.self` come from leaves
  only.
- `id` is the stable id within one parse. `timestamp` is not unique.

## Limits

`GovernorLimits.snapshots` holds the cumulative `LIMIT_USAGE_FOR_NS` blocks only. Granular limit
lines keep their reading on the event, in `details`. Two folds are deliberate: `heapPeak` into
`peak.heapSize`, and flow running-total deltas into the element's SOQL/DML counters
(`applyFlowResiduals`).

## Gotchas

- `parse()` is the entry point, and it is async. Tests and benchmarks build synchronously with
  `apexLog(nodeEngine.build(bytes))`, which is internal.
- The header is the text before the first timestamped line, or the whole text when there is none.
  `engine/header.ts` reads the settings line from it, and `USER_INFO` from the first timestamped
  line.
- A log can be truncated in two unrelated ways: the platform dropped a block
  (`*** Skipped N bytes`), or the log hit the maximum size. `ApexLog.truncation` reports both.
- An event's `isTruncated` means the log does not close that frame. On the `ApexLog` it means the
  platform dropped content, so `truncatedEvents` can be non-empty while it is `false`.
