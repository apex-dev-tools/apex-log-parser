---
'@apexdevtools/apex-log-parser': minor
---

`ExplainPlan.relativeCost` reads a plan with a note after the cost, as `relativeCost 0 (with skinny table)`; it was `null`. The new `relativeCostNote` gives that note.
