---
'@apexdevtools/apex-log-parser': minor
---

Add a const for each public union that had none: `KIND`, `SHAPE`, `CPU_TYPE`, `ISSUE_TYPE`, `PARSE_PHASE` and `TRUNCATION_KIND`. Add the `ParsePhase` and `TruncationKind` types.

Add `DEBUG_CATEGORY_TOKEN`, which gives the log header token of each debug category, such as `apexCode` → `APEX_CODE`. It is the inverse of `DEBUG_CATEGORY`. Its type is `DebugCategoryToken`.
