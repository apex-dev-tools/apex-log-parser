---
'@apexdevtools/apex-log-parser': minor
---

Breaking: a `USER_INFO` field the header did not state is now `null`, not `''`. `UserInfo.id` and `UserInfo.userName` are `string | null`, `LogTimezone.label` is `string | null`, and `UserInfo.timezone` is `null` when the header has no timezone field. A timezone field that states only an offset, such as `(GMT+01:00)`, now gives `label: null` where it gave `''`.
