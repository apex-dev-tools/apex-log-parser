---
'@apexdevtools/apex-log-parser': minor
---

Breaking: replace `ApexLog.entryPoint` with `ApexLog.entryPoints`, every top-level code unit in log
order. To migrate, use `apexLog.entryPoints[0] ?? null`.
