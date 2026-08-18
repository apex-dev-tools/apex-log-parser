# @apexdevtools/apex-log-parser

<!-- Maintained by hand: .changeset/config.json sets "changelog": false, so Changesets never writes here. -->

## 0.1.0

### Minor Changes

- Initial release as a standalone npm package.
- Parse 200+ Salesforce Apex debug log event types into typed event trees.
- Hierarchical parent/child event structure with automatic entry/exit matching.
- Self and total execution time computation (nanosecond precision).
- Governor limit tracking with per-namespace snapshots.
- Heap accounting on every node: net, gross and peak live heap.
- SOQL, DML, and SOSL row count aggregation, with the DML target object type.
- Log issue detection with typed kinds: fatal, error, skip and unexpected.
- Managed package namespace detection.
- Bundled database of 299 documented Salesforce debug log event types.
- Zero runtime dependencies.
- ESM-only, strict TypeScript.
- Split the public API: the root entry point exports runtime values only — `parse`,
  `ApexLogParser`, `DebugLevel` and the event classes — and a new
  `@apexdevtools/apex-log-parser/types` subpath exports every public type and the const companions
  (`LOG_LEVEL`, `DEBUG_CATEGORY`, `LOG_CATEGORY`, `ALL_LOG_CATEGORIES`). Adds the missing
  `SOSLExecuteBeginLine`, and drops the deprecated `LogSubCategory` alias — use `LogCategory`.
  Requires `moduleResolution` `node16`, `nodenext` or `bundler` to resolve the subpath.
- Report truncation as data: `ApexLog.truncation` holds one `TruncationRegion` per region the
  platform did not write in full, with the byte figure it stated and the time trust resumes, plus
  `totalSkippedBytes`. `ApexLog.isTruncated` is now set on the root, and `ApexLog.truncatedEvents`
  lists the events the log stopped inside. Fixes a bug that dropped every skipped region after the
  first, because all of them share one issue summary.
- Add `ApexLog.userInfo` — the id, user name and timezone from the `USER_INFO` header line, which the
  parser previously discarded. `timezone` states the label, the IANA `name` when the header gave one,
  and `offsetMinutes` east of UTC. Null when the log states no user.
- `ApexLog.debugLevels` is now `Partial<Record<DebugCategory, LogLevel>>`, keyed by the display
  category the rest of the API uses. An absent key means the header declared no level for that
  category, which a caller can now tell apart from a category that ran nothing. The `DebugLevel`
  class and its root export are gone, and `LOG_LEVEL` gains `None` for a category the header
  switched off.

