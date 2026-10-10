---
'@apexdevtools/apex-log-parser': minor
---

Add `ApexLog.flowErrors`. It holds every `FLOW_ELEMENT_ERROR`, `FLOW_CREATE_INTERVIEW_ERROR` and `FLOW_START_INTERVIEWS_ERROR`, in log order. A flow can fail with no exception and no fatal error, so you do not need to walk the tree to find the failure.
