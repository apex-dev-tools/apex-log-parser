# Changelog

All notable changes to this project will be documented in this file.

Entries are written by hand. [Changesets](https://github.com/changesets/changesets) bumps the version and never edits this file.

## 0.1.0

Initial release as a standalone npm package.

- Parse 200+ Salesforce Apex debug log event types into typed event trees
- Hierarchical parent/child event structure with automatic entry/exit matching
- Self and total execution time computation (nanosecond precision)
- Governor limit tracking with per-namespace snapshots
- Heap accounting on every node: net, gross and peak live heap
- SOQL, DML, and SOSL row count aggregation, with the DML target object type
- Log issue detection with typed kinds: fatal, error, skip and unexpected
- Managed package namespace detection
- Bundled database of 299 documented Salesforce debug log event types
- Zero runtime dependencies
- ESM-only, strict TypeScript
