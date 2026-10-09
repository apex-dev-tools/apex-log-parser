---
'@apexdevtools/apex-log-parser': minor
---

Add a new, experimental parser at `@apexdevtools/apex-log-parser/next`. It replaces today's parser in v1, and its API can change before then. Today's `parse` does not change.

**6–9× faster and 8× less memory used vs v0.2.0**, on logs of 8 to 100 MB. A 100 MB log parse was measured at 182 ms instead of 1,646 ms, with 141 MB memory held instead of 1,100 MB.

- `parse` is async. It reads a string, bytes, a `Blob`, a `fetch` `Response`, a `ReadableStream` or an async iterable.
- It works in time slices of 5 ms, so the page or the event loop stays responsive. `signal` stops it, and `onProgress` reports how far it is.
- Optional: for more speed and a clear main thread, the `worker` option runs the parse in a worker that loads `@apexdevtools/apex-log-parser/next/worker`. In a browser, use a `blob:` URL for the worker.
- Optional: `toBuffers` and `fromBuffers` move a parsed log to another thread without a copy.
- Each event tells you what kind of work it is (`kind`), and gives the extra values on its log line, such as a query plan or heap bytes (`details`). `ofType` finds every event of the types you name. `columns` gives the times and tree links of every event as plain arrays.
- A Node build and a browser build are both available.
