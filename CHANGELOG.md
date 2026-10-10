# @apexdevtools/apex-log-parser

## 0.3.0

### Minor Changes

- 04159cc: Add a new, experimental parser at `@apexdevtools/apex-log-parser/next`. It replaces today's parser in v1, and its API can change before then. Today's `parse` does not change.
  
  **6–9× faster and 8× less memory used vs v0.2.0**, on logs of 8 to 100 MB. A 100 MB log parse was measured at 182 ms instead of 1,646 ms, with 141 MB memory held instead of 1,100 MB.
  
  - `parse` is async. It reads a string, bytes, a `Blob`, a `fetch` `Response`, a `ReadableStream` or an async iterable.
  - It works in time slices of 5 ms, so the page or the event loop stays responsive. `signal` stops it, and `onProgress` reports how far it is.
  - Optional: for more speed and a clear main thread, the `worker` option runs the parse in a worker that loads `@apexdevtools/apex-log-parser/next/worker`. In a browser, use a `blob:` URL for the worker.
  - Optional: `toBuffers` and `fromBuffers` move a parsed log to another thread without a copy.
  - Each event tells you what kind of work it is (`kind`), and gives the extra values on its log line, such as a query plan or heap bytes (`details`). `ofType` finds every event of the types you name. `columns` gives the times and tree links of every event as plain arrays.
  - A Node build and a browser build are both available.
- a006ff8: Parse logs of 20 MB or more 28% faster on average, with 27% less heap
- 29b627e: Breaking: require Node.js 22 or later

## 0.2.0

### Minor Changes

- 4117f05: Add `ApexLog.debugLevelSettings`, every category and level from the log's settings line, and stop reporting an unknown category in `parsingErrors`
- 60c5766: Breaking: replace `ApexLog.entryPoint` with `ApexLog.entryPoints`, every top-level code unit in log
  order. To migrate, use `apexLog.entryPoints[0] ?? null`.
- 1e7a1f5: Breaking: remove the `/types` entry point. To migrate, change `from '@apexdevtools/apex-log-parser/types'` to `from '@apexdevtools/apex-log-parser'`.
- dca74fd: Breaking: remove the event name prefix from the `text` of `FLOW_START_INTERVIEWS_BEGIN`, `WF_CRITERIA_BEGIN`, `WF_FLOW_ACTION_ERROR` and `WF_FLOW_ACTION_ERROR_DETAIL` events
- ec2172d: Add `LogTimezone.text` and `LogTimezone.offsetText`, the timezone and its offset as the log states them
- c48d1d6: Breaking: add the header `USER_INFO` line to the tree as the first root event, so the root starts at it (#96). To find the execution, look for the `EXECUTION_STARTED` child instead of reading `children[0]`.
- ec2172d: Breaking: report a `USER_INFO` field the log does not state as `null`, not `''`. To migrate, handle `null` in `UserInfo.id`, `UserInfo.userName`, `UserInfo.timezone` and `LogTimezone.label`.

### Patch Changes

- 6d3fd3e: Fix an `EXECUTION_STARTED` nested under a method or code unit whose exit the log dropped
- f1105c0: Fix slow `ApexLog.size` calculation on large logs in the browser (#97)
- 6ccd1d8: Name a `FLOW_START_INTERVIEWS_BEGIN` event after its flow when an error comes before the first interview
- c48d1d6: Stop reporting header text as `parsingErrors` in a log with no `EXECUTION_STARTED` (#96)
- ec2172d: Read the `USER_INFO` timezone field in linear time. A field with many ` (` could stall the parse for seconds.
- bbde325: Fix missing fields and `undefined` in the text of `FLOW_ELEMENT_ERROR`, `FLOW_START_INTERVIEWS_ERROR`, `VALIDATION_FORMULA` and `WF_FORMULA` events whose message spans lines
- 2c5a1b0: Parse only the first of several pasted-together logs, and report a `Multiple-Logs` issue of type `error`
- 0387470: Reword and trim the README, and reword the package description and API doc comments in plainer language
- 6d3fd3e: Fix a too-short duration for a method or code unit the log never closes
- ce46f51: Report a skipped or max-size truncation that follows an event with wrapped text, such as `USER_DEBUG`, instead of adding the marker to that event's text
- ec2172d: Fix a wrong or missing `userInfo` when a log quotes a `USER_INFO` or `EXECUTION_STARTED` line
- c48d1d6: Stop showing `undefined` in the text of a `USER_INFO` event whose line states no user name

## 0.1.1

### Patch Changes

- 556d741: Apply `HEAP_DEALLOCATE` events to correctly reduce the aggregated heap total (#73)
- c59d755: Count `ApexLog.size` in UTF-8 bytes, logs with non-ASCII characters previously reported fewer bytes (#70)

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
