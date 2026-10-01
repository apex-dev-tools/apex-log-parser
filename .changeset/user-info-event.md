---
'@apexdevtools/apex-log-parser': minor
---

Breaking: add the header `USER_INFO` line to the tree as the first root event, so the root starts at it (#96). To find the execution, look for the `EXECUTION_STARTED` child instead of reading `children[0]`.
