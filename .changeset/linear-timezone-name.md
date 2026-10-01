---
'@apexdevtools/apex-log-parser': patch
---

Read the `USER_INFO` timezone field in linear time. A field with many ` (` could stall the parse for seconds.
