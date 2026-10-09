---
'@apexdevtools/apex-log-parser': minor
---

Add `@apexdevtools/apex-log-parser/next`, a preview of the new parser. Its async `parse` reads a string, bytes, a `Blob`, a `fetch` `Response` or a stream, and it yields while it works. `toBuffers` and `fromBuffers` move a parsed log to another thread without a copy. The API can change before v1.
