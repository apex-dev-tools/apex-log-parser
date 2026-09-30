---
'@apexdevtools/apex-log-parser': patch
---

Read `userInfo` from the log's first timestamped line only. Before, an anonymous Apex echo that contained `|EXECUTION_STARTED` hid the header, and in a log with no `EXECUTION_STARTED` a `USER_INFO` line quoted in a debug message could be taken for it. The search also no longer scans the whole log.
