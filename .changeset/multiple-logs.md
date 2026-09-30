---
'@apexdevtools/apex-log-parser': patch
---

Parse only the first log of a text that holds several pasted-together logs, and report a `Multiple-Logs` log issue of type `error`. Before, the logs were merged into one tree with overlapping timestamps and nothing reported it. A new log starts at a settings line after the first event whose next line restarts the nanosecond counter. `ApexLog.size` is still the size of the whole text.
