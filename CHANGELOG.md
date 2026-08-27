# @apexdevtools/apex-log-parser

## Unreleased

### Internal

- The event scraper reads both official Salesforce sources over plain HTTP, so Playwright is gone.
  It discovers the release instead of computing it, treats every silent-success response as a
  failure, and rewrites the database byte-identically when nothing changed.
- Corrected the four `CURSOR_*` events, whose category and level the developer docs mislabel.
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
