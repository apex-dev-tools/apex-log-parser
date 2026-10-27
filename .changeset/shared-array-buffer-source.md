---
'@apexdevtools/apex-log-parser': patch
---

`parse` accepts a `SharedArrayBuffer` with no cast. It read one before, but the types did not allow it.
