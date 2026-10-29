---
'@apexdevtools/apex-log-parser': minor
---

Breaking: `ApexEvent.namespace` and `Columns.namespace` give `'default'` for code in no package, not `null` or -1, and `ApexLog.namespaces` lists it. To migrate, compare with the new `DEFAULT_NAMESPACE` in place of `null`.
