# AGENTS.md

For coding agents. Usage docs: [README](./README.md).

## What this is

`@apexdevtools/apex-log-parser` turns Salesforce Apex debug log text into a typed event tree:
timings, governor limits, SOQL/DML/SOSL counts. No runtime dependencies. ESM only.

## Layout

- `src/` — the parser.
  - `catalog/` — `catalog.ts`: one hand-written entry per event type: type info, field names, text
    rule. A rule names the fields it reads; at load the catalog resolves each name to a position,
    and throws on a name the entry does not list. `fields.ts`: types only, TSDoc per type and field,
    so editors show it and no bundle carries it. `__tests__/Catalog.test.ts` and
    `scripts/__tests__/CatalogDocs.test.ts` fail when either drifts from the event database.
  - `bytes/` — reads the bytes: a `Source` per build (`node.ts`, `browser.ts`), the `ByteFields`
    cursor, the type id lookup. `ascii.ts`: the byte constants and searches all readers share.
    `lines.ts`: the line tests (timestamp, type name, first event line). Every `Fields` adapter
    passes `__tests__/fieldsContract.ts`.
  - `store/` — events as typed-array columns, sparse count and heap pools, and the string table of
    interned byte ranges. `tags.ts` reads a value's type tag, which holds across realms where
    `instanceof` fails.
  - `engine/` — builds the tree, runs the passes after the scan, makes the indexes the views read on
    first use. See `src/engine/AGENTS.md`.
  - `views/` — reads the store as events, and row 0 as `ApexLog`. Event ids start at 1; id 0 is the
    log. See `src/views/AGENTS.md`.
  - `node.ts`, `browser.ts` — each build's entry: the async `parse` and the shared surface
    (`api/surface.ts`). `api/parse.ts` is the shared driver: reads the source to bytes
    (`api/sources.ts`), scans in 5 ms slices (`LogBuilder.scan`), runs the passes after the scan in
    slices (`LogBuilder.settle`), and yields between slices the build's own way (`api/hosts.ts`).
  - `api/buffers.ts` — `toBuffers` and each build's `fromBuffers` move a log between threads,
    through `engine/buffers.ts`. `Store.restore` and `StringTable.restore` make their objects as the
    engine does, so a restored log has the same object layout. The format is internal to one package
    version; not for storage.
  - `api/worker.ts` — `parse`'s `worker` option. The read stays on the caller's thread; the bytes
    move to the worker (a copy when the caller holds them); the log comes back as buffers.
    `worker/serve.ts` is the worker's side. `worker/node.ts` and `worker/browser.ts` start it, each
    built as one file with no imports, so a webview can start it from a `blob:` URL.
  - `limits.ts` — parses limit text, derives the whole-log figures.
  - V8 drops a class's object layout, and the code it optimised for it, once no instance is alive;
    the parse after a GC then runs about 3× slower. So the `Engine` keeps one idle builder alive,
    and a builder field that holds a time starts as a double (`NO_TIME`, -0), not 0.
    `benchmarks/__tests__/deopt.test.ts` fails when either breaks.
- `src/__tests__/` — vitest suites. `helpers.ts`: shared fixtures.
- `data/` — the event database, made by `pnpm scrape`. Edit the scraper, not the JSON. Not
  published; the parser never reads it. `Catalog.test.ts`, `CatalogDocs.test.ts` and the scripts do.
- `scripts/scrape.ts` — the scraper. Reads both official sources over plain HTTP; endpoints and
  failure modes in `scripts/scraper.md`. `--report=<path>` writes the run as JSON, for
  `scripts/ci/report.ts`.
- `scripts/validate-data.ts` — `pnpm run validate:data`: the event database against its own
  `$schema`. Not in `pnpm run ci`; the scrape workflow runs it.
- `scripts/cli.ts` — argument reading and the entry-point guard all scripts use. No other imports,
  so a small script does not load the scraper's module graph to read one flag.
- `scripts/ci/` — the scrape workflow's logic, so the YAML only declares what runs. `actions.ts`:
  Actions plumbing (step outputs, job summary, annotations). `report.ts`: the pull request body.
  `seed.ts`: seeds `data/` from the open automation branch. See `.github/workflows/README.md`.
- `benchmarks/` — all benchmarks and their tools: the CodSpeed suite, synthetic logs, `bench:large`,
  `compare`. See `benchmarks/AGENTS.md`. A new parser hot path needs a shape in
  `benchmarks/fixtures/profiles.json`. Every benchmark output states the raw figures, then the times
  and the percent change.
- `scripts/` and `benchmarks/` are outside `tsconfig.json`, so `pnpm typecheck` does not see them;
  `tsconfig.scripts.json` does. `pnpm run ci` runs both.

## Commands

`pnpm run ci` — biome, `tsc --noEmit`, `tsc -p tsconfig.scripts.json`, vitest. Run before every
commit.

- `pnpm ci` is pnpm's `clean-install`: it deletes `node_modules` and reinstalls. Always write `run`.
- `pnpm run bench` — the benchmarks, no watch. Locally: wall time. CI on a pull request: instruction
  counts and allocations. Do not compare the two. A parser change that can affect large logs also
  needs `pnpm run bench:large` against `main`.
- `pnpm build` needs Node `^22.18 || ^24.11 || >=26` for tsdown; the package supports any Node 22.
  CI builds on Node 24 only.

## The public API surface

- The root (`.`): the `node` condition gets the node build, every other host the browser build. Both
  export the same surface: `parse`, `toBuffers`, `fromBuffers`, the catalog (`EVENT_TYPES`,
  `eventType`), the const companions, the public types. `src/__tests__/PublicApi.test.ts` pins it.
- `./worker`: the file a worker runs for `parse`'s `worker` option. The node build for the `node`
  condition, else the browser build as a classic script. Exports nothing.

Export only what a consumer uses in production. A helper only a consumer's tests would reuse stays
internal.

An export added or removed updates `src/__tests__/PublicApi.test.ts` in the same change. It pins the
runtime list, and the types through an interface that fails `pnpm typecheck`, not the test run. Run
both.

## Conventions

- Strict TypeScript, with `verbatimModuleSyntax` and `isolatedDeclarations`: every exported
  declaration states its type; type-only imports are statement-level `import type`.
- `noUncheckedIndexedAccess` makes each indexed read `T | undefined`, so parsing code carries `!`
  and `?? ''`.
- `erasableSyntaxOnly` bans enums, so a union gets a const companion.
- Import with a `.js` extension.
- `types: ["vitest/globals"]` in `tsconfig.json` keeps ambient node types out. `src/` uses no
  `node:*` and reads no files at runtime; `src/worker/node.ts` reaches `worker_threads` through the
  global `process.getBuiltinModule`. `tsconfig.scripts.json` adds `node` for `scripts/` only. A test
  may statically import the data JSON, as `Catalog.test.ts` does; `tsconfig.build.json` excludes the
  tests, so `rootDir` holds for the build. A WHATWG global `src/` needs is declared in the module
  that uses it, as `api/sources.ts` declares `TextEncoder`. Never widen `lib` to `DOM` for one type.
- Event times: nanoseconds. Heap figures: bytes. `ApexLog.startTime`: milliseconds since midnight.
  The `cpuTime` limit: milliseconds. State the unit on every new field.
- Report what the log stated. For a value the log did not give, use `null`, never a default, so a
  caller can tell "not stated" from "zero". Not `''`, and not an absent or `undefined` field, whose
  shape depends on the transport. A sub-object whose source field is missing is `null` itself, not
  an object of nulls.
- Comment the why, not the what. In doubt, none. One line. Public API takes a doc block.
- Never paste a log from an org. Fixtures use `ns`, `MyClass`, `user@example.com` and ids
  zero-filled after the key prefix (`005000000000AAA`).
- Conventional commits, one concern per commit.
- A change a consumer can see gets a changeset. Changesets writes `CHANGELOG.md`; never edit it by
  hand.
- File issues and pull requests through the templates in `.github/`. One filed without a template:
  fix it in place; never close and refile.

## Adding an event type

1. `src/catalog/types.ts` — append the name to the end of `EVENT_TYPE_NAMES`, not in sorted order,
   so no other type id moves.
2. `src/catalog/catalog.ts` — add its entry, with its `fields`, to `ENTRIES`. A field named `line`
   makes the engine read a line number. An event that adds to a rollup or states a namespace
   declares it: `count`, `rows`, `heap`, `namespace`. Scan-time work no declaration states is a
   `hook`, which the engine runs. Text work is not: the views do it. An exit line states
   `shape: 'exit'`, its `fields` and its `text`; its category, level and kind come from the frame
   that lists it in `exits`. A frame states `exits` or `closes`, not a shape. Omit `kind` when the
   debug category is also a kind, such as `callout`. `kind: 'other'` opts out.
3. `src/catalog/fields.ts` — document it in `EventFields`: the data JSON description, then each
   field with its `Format:`. Add the `@remarks` line unless a real log confirms the layout.
4. `data/salesforce-debug-log-events.json` — via `pnpm scrape`, once Salesforce documents it.

`Catalog.test.ts` enforces steps 1, 2 and 4 against the data JSON: the catalog holds exactly the
documented events, each with the database's debug category and level. `CatalogDocs.test.ts` enforces
step 3: the TSDoc states each description and each field.

## Limits

`GovernorLimits.snapshots` holds only the cumulative `LIMIT_USAGE_FOR_NS` blocks. Granular limit
lines keep their reading on the event, in `details`. Two folds are deliberate: `heapPeak` into
`peak.heapSize`, and flow running-total deltas into the element's SOQL/DML counters
(`applyFlowResiduals`).

## Gotchas

- `parse()`, the entry point, is async. Tests and benchmarks build synchronously with the internal
  `apexLog(nodeEngine.build(bytes))`.
- `id` is stable within one parse. `startTimestamp` is not unique.
- The header is the text before the first timestamped line, or all the text when there is none.
  `engine/header.ts` reads the settings line from it, and `USER_INFO` from the first timestamped
  line.
- A log can be truncated in two unrelated ways: the platform dropped a block
  (`*** Skipped N bytes`), or the log hit the maximum size. `ApexLog.truncation` reports both.
- An event's `isTruncated`: the log does not close that frame. On the `ApexLog`: the platform
  dropped content. So `truncatedEvents` can be non-empty while it is `false`.
