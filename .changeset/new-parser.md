---
'@apexdevtools/apex-log-parser': minor
---

**Breaking:** new parser and a new API. The old parser is removed.

It still gives the event tree, with times, SOQL, DML and SOSL counts, and governor limits for the whole log and per namespace. What is new:

- **5–8× faster, 6× less memory vs v0.3** (8–100 MB logs). A 100 MB log: 182 ms and 141 MB, was 1,215 ms and 812 MB.
- **Streaming.** Reads a string, bytes, a `Blob`, a `Response` or a stream, not only a string.
- **Off the main thread.** Parses in 5 ms slices, with cancel and progress, or in a worker.
- **Variables.** The locals, `this` and statics each event could see, with their last write.

What breaks:

- **Async.** `const log = await parse(text)`.
- **Views, not classes.** No event classes, `ApexLogParser` or `instanceof`. Use `event.type`, `event.kind` or `log.ofType(type)`.
- **Exit lines are not events.** They set the end and duration of their frame.
- **`null` means not stated**, not `''`, `0` or `'default'`.
- **Renamed:** `eventIndex` → `id`, `timestamp` → `startTimestamp`, `exitStamp` → `endTimestamp`, `isParent` → `isFrame`, `isTruncated` → `endedBy`, `logIssues` → `issues`, `governorLimits` → `limits`. Import from the root; `./next` is gone. The compiler finds the rest.
