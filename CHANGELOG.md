# @apexdevtools/apex-log-parser

## 0.1.0

### Minor Changes

- Initial release as a standalone npm package.
- Parse 200+ Salesforce Apex debug log event types into typed event trees.
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
