---
'@apexdevtools/apex-log-parser': minor
---

**Breaking:** new parser and a new API. The old parser is removed.

It still gives the event tree, with times, SOQL, DML and SOSL counts, and governor limits for the whole log and per namespace. What is new:

- **About 6× faster and up to 22× less memory than v0.3** (8–100 MB logs; 7–8.5× faster than v0.2).
  - A 20 MB log: 33 ms and 11 MB, was 221 ms and 190 MB.
  - A 100 MB log: 131 ms and 37 MB, was 829 ms and 812 MB.
- **Streaming.** Reads a string, bytes, a `Blob`, a `Response` or a stream, not only a string.
- **Off the main thread.** Parses in 5 ms slices, with cancel and progress, or in a worker.
- **Variables.** The locals, `this` and statics each event could see, with their last write.
- **Reads hold almost nothing.** Each read makes a new event object, so the log keeps none: reading every event's text of a 95 MB log adds 2 MB to the 25 MB the parse holds. v0.3 held 761 MB. `columns` gives every number, flag, count and frame text id as typed arrays, for a pass you repeat: a call tree of that log takes 5 ms on repeat.

What breaks:

- **Async.** `const log = await parse(text)`.
- **Views, not classes.** No event classes, `ApexLogParser` or `instanceof`. Use `event.type`, `event.kind` or `log.ofType(type)`.
- **A new event object per read.** `log.event(1) !== log.event(1)`, so key a `Map` by `id`.
- **Exit lines are not events.** They set the end and duration of their frame.
- **`null` means not stated**, not `''`, `0` or `'default'`.
- **Renamed:** `eventIndex` → `id`, `timestamp` → `startTimestamp`, `exitStamp` → `endTimestamp`, `isParent` → `isFrame`, `isTruncated` → `endedBy`, `logIssues` → `issues`, `governorLimits` → `limits`. Import from the root; `./next` is gone. The compiler finds the rest.
