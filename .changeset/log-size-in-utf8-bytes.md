---
'@apexdevtools/apex-log-parser': patch
---

Count `ApexLog.size` in UTF-8 bytes, as its declaration states. A log holding any non-ASCII character previously reported fewer bytes than it holds (#70).
