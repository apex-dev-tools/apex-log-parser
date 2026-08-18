# AGENTS.md

Guidance for coding agents working in this repository. For usage docs see [README](./README.md).

## What this is

`@apexdevtools/apex-log-parser` turns raw Salesforce Apex debug log text into a typed event tree:
execution timings, governor limits, and SOQL/DML/SOSL counts. Zero runtime dependencies, ESM only.

## Layout

- `src/ApexLogParser.ts` — the parsing engine, tree building, rollups and log issues.
- `src/LogEvents.ts` — `LogEvent`, `ApexLog` and one class per handled event type.
- `src/types.ts` — public types and their const companions.
- `src/limits.ts` — governor limit parsing and aggregation.
- `src/index.ts` — root entry point. Runtime values only.
- `src/publicTypes.ts` — the `/types` entry point. Types and const companions only.
- `src/__tests__/` — vitest suites.
- `data/salesforce-debug-log-events.json` — bundled database of documented event types.

## Commands

- `pnpm run ci` — biome, `tsc --noEmit`, vitest. Run this before any commit. Note `pnpm ci` is a
  different, unrelated command and fails.
- `pnpm build` — `tsdown` for the JS bundles, `tsc -p tsconfig.build.json` for declarations.
- `pnpm test` — vitest only.

## The public API surface

Two entry points, with one home per name:

- Root (`.`) exports runtime values: `parse`, `ApexLogParser` and the event classes.
- `/types` exports every public type plus the const companions (`LOG_LEVEL`, `LOG_CATEGORY`, ...).

Do not re-export a type from the root, or a runtime value from `/types`.

`src/index.ts` and `src/publicTypes.ts` are the source of truth for what is public.
`src/__tests__/PublicApi.test.ts` pins both lists, so adding or removing an export needs that test
updated in the same change. Never keep a hand-written copy of the export list anywhere else — it
drifts.

## Conventions

- TypeScript is strict, with `verbatimModuleSyntax` and `isolatedDeclarations`. Every exported
  declaration needs an explicit type. Import with a `.js` extension.
- `rootDir` is `src`, and there is no `@types/node`. Source and tests cannot read repo-root files or
  import `node:*`.
- Times are nanoseconds, heap figures are bytes. State the unit on any new field.
- Report what the log stated. Never substitute a default for a value the log did not give — use
  `null` or leave the field absent, so a caller can tell "not stated" from "zero".
- Limits are cumulative snapshots only. The parser does not fold granular SOQL/DML/heap events.
- Conventional commits, one concern per commit.
- `CHANGELOG.md` is hand-maintained for 0.1.0. From 0.2 on, add a changeset instead.

## Gotchas

- `parse()` is the entry point. `ApexLogParser` is public only because every event constructor takes
  one; its fields are parser state, not API.
- `generateLogLines` starts at `EXECUTION_STARTED`, so header lines before it are discarded unless
  read explicitly in `parse()`.
- A log can be truncated in two unrelated ways: the platform dropped a block
  (`*** Skipped N bytes`), or the log hit the maximum size. `ApexLog.truncation` reports both.
- `LogEvent.isTruncated` means the parser found no matching exit event. On the root `ApexLog` it
  means the platform dropped content.
