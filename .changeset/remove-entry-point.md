---
'@apexdevtools/apex-log-parser': minor
---

Breaking: remove `ApexLog.entryPoint`. To migrate, use `apexLog.entryPoints[0] ?? null`.
