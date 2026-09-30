---
'@apexdevtools/apex-log-parser': minor
---

Add `ApexLog.entryPoints`: the first code unit of each execution, in log order. In a log with more than one execution, `entryPoint` can be a short platform step such as `FutureHandler - state load`, so a caller can now see every execution with its `timestamp` and `duration` and choose which to name. `entryPoint` does not change.
