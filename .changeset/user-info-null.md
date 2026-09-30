---
'@apexdevtools/apex-log-parser': minor
---

Breaking: report a `USER_INFO` field the log does not state as `null`, not `''`. To migrate, handle `null` in `UserInfo.id`, `UserInfo.userName`, `UserInfo.timezone` and `LogTimezone.label`.
