# @apexdevtools/apex-log-parser

## Unreleased

### Internal

- The event scraper reads both official Salesforce sources over plain HTTP, so Playwright is gone.
  It discovers the release instead of computing it, treats every silent-success response as a
  failure, and rewrites the database byte-identically when nothing changed.
- The shared table parser reads the four `CURSOR_*` rows correctly. The developer docs give them
  a fifth, empty cell, which shifted every later column; the committed data was already right,
  so a successful run no longer damages it.
- A scrape reports, without overwriting, any event whose documented category or level has
  moved away from the recorded one, and refuses to rewrite the database from a release older
  than the one it holds.
- The scrape workflow declares what runs; `scripts/ci/` decides what happens. The scraper
  writes a run record, so the pull request body is rendered from data instead of pasted from
  stdout, and the job's logic is covered by tests. `pnpm run ci` now typechecks `scripts/`.
- The workflow is callable with `workflow_call`. See `.github/workflows/README.md`.
- No change to the published package: `data/` is not shipped.

## 0.1.0

### Minor Changes

- Initial release as a standalone npm package.
- Parse 299+ Salesforce Apex debug log event types into typed event trees.
- Hierarchical parent/child event structure with automatic entry/exit matching.
- Self and total execution time computation (nanosecond precision).
- Final and peak governor limit tracking with overall and per namespace snapshots.
- Heap accounting on every node: net, gross and peak live heap.
- SOQL, DML, and SOSL row count aggregation, with the DML target object type.
- Log issue detection with typed kinds: fatal, error, skip and unexpected.
- Managed package namespace detection.
- Log details: user, timezone and the transaction entry point name.
- The debug categories and levels the transaction ran under.
- Zero runtime dependencies.
- ESM-only, strict TypeScript.
