---
'@apexdevtools/apex-log-parser': patch
---

Parse a `Response` whose `Content-Length` is larger than its body. The log no longer keeps the unused part of the buffer, and a length too large to allocate no longer fails the parse.
