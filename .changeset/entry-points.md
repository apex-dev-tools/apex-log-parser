---
'@apexdevtools/apex-log-parser': minor
---

Breaking: replace `ApexLog.entryPoint` with `ApexLog.entryPoints`, every code unit directly on the
root or directly under an execution, in log order. To migrate, use `apexLog.entryPoints[0] ?? null`.
In a log where one execution holds another, that can name a different code unit than before.
