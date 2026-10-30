---
'@apexdevtools/apex-log-parser': patch
---

On a 100 MB log, the first read of `columns.text` is about 28% faster: 52 ms in place of 73 ms. A read of every event's `text` is about 24% faster: 68 ms in place of 90 ms.
