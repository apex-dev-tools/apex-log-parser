---
'@apexdevtools/apex-log-parser': patch
---

`parse` accepts a DOM `fetch` `Response` and a DOM `ReadableStream` with no cast, when the DOM types are in `lib`. `StreamRead`: a done read can now carry a `value`. `parse` ignores it.
