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
  `ApexLogParser` and the event classes — and a new
  `@apexdevtools/apex-log-parser/types` subpath exports every public type and the const companions
  (`LOG_LEVEL`, `LOG_CATEGORY`, `ALL_LOG_CATEGORIES`). Adds the missing
  `SOSLExecuteBeginLine`, and drops the deprecated `LogSubCategory` alias — use `LogCategory`.
  Requires `moduleResolution` `node16`, `nodenext` or `bundler` to resolve the subpath.
- Report truncation as data: `ApexLog.truncation` holds one `TruncationRegion` per region the
  platform did not write in full, with the byte figure it stated and the time trust resumes, plus
  `totalSkippedBytes`. `ApexLog.isTruncated` is now set on the root, and `ApexLog.truncatedEvents`
  lists the events the log stopped inside. Fixes a bug that dropped every skipped region after the
  first, because all of them share one issue summary.
- Add `ApexLog.userInfo` — the id, user name and timezone from the `USER_INFO` header line, which the
  parser previously discarded. `timezone` states the label, the IANA `name` when the header gave one,
  and `offsetMinutes` east of UTC - null when the header stated no offset the parser can read.
  `userInfo` itself is null when the log states no user.
- `ApexLog.debugLevels` is now `DebugLevels`, an interface with one optional property per category
  (`apexCode`, `apexProfiling`, `database`, ...). An absent property means the header declared no
  level for that category, which a caller can now tell apart from a category that ran nothing. A
  category or level the parser does not know is reported in `parsingErrors`. The `DebugLevel` class
  and its root export are gone, and `LOG_LEVEL` gains `None` for a category the header switched off.
- `LogEvent.debugCategory` now states the `DebugLevels` property name (`'apexCode'`, not
  `'Apex Code'`), so `apexLog.debugLevels[event.debugCategory]` states the level the header declared
  for that event once you rule out `''`. `DebugCategory` is `keyof DebugLevels | ''`, and the
  `DEBUG_CATEGORY` const is gone — a category is a plain string literal, so
  `event.debugCategory === 'apexCode'` needs no import, and display text stays the caller's.
- Every governor limit value gains `percentUsed` — `used`/`limit` as a percentage, unrounded, and
  `null` when the log stated no ceiling. The parser never substitutes a default ceiling, because a
  guessed denominator would be reported as fact. The value shape is now the named `LimitValue` type.
- `ApexLog.governorLimits` no longer extends `Limits`. It now states `snapshots` (unchanged), `final` -
  what the transaction had used when the log ended - `peak` - the highest each metric reached at any
  timepoint - and `byNamespace`, which holds a `final` and a `peak` per namespace. `peak` matters
  because counters fall mid-log, so `final` under-reports a breach. `peak.heapSize` also folds
  `ApexLog.heapPeak`, the only heap figure most logs give. Metric iteration over `final` or `peak` is
  now total: no `byNamespace` or `snapshots` key to filter out.
- Fix state leaking between `ApexLogParser.parse` calls. Nothing reset the parser fields, so a second
  call parsed the new log on top of the first: it inherited the earlier governor limit snapshots, log
  issues, namespaces and event index. `parse` now parses on a fresh instance every call, which also
  means the fields of the instance you call it on stay empty - they were never API.
- Add `LogEvent.callerNamespace` — the namespace of the immediate parent event, so a caller can tell
  who invoked an event. It states the caller as the log records it, so it does not skip past a
  platform or glue frame, and it is `'default'` for a root child and for an event with no namespaced
  caller.
- Add `ApexLog.entryPoint` — the first `CodeUnitStartedLine`, which is what the transaction ran. It is
  found whether the code unit sits under `EXECUTION_STARTED` or directly on the root. Null when the
  log states no code unit.
- Remove `BulkHeapAllocateLine.logCategory`. It stated `'Apex Code'`, a display string in no enum, on one
  event class only. Read `debugCategory` for the `DebugLevels` property name, or `type` for the event name.
