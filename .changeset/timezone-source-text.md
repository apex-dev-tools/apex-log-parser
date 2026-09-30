---
'@apexdevtools/apex-log-parser': minor
---

Add `text` and `offsetText` to `LogTimezone`. `text` is the timezone field exactly as the `USER_INFO` header stated it, so a caller can show it without rebuilding it from the parts. `offsetText` is the spelling that `offsetMinutes` was read from, e.g. `GMTZ`, and is null exactly when `offsetMinutes` is.
