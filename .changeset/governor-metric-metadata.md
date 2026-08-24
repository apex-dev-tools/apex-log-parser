---
'@apexdevtools/apex-log-parser': minor
---

Export governor metric metadata. The `./types` entry point now exports `LIMIT_METRIC`, the label and
unit for each of the 13 governor metrics, and `ALL_LIMIT_METRICS`, the same entries as an ordered
array. `cpuTime` and `heapSize` state the CLDR identifiers `millisecond` and `byte`, so a consumer
can pass one straight to `Intl.NumberFormat`; every other metric states `count` and formats as a
plain number.
