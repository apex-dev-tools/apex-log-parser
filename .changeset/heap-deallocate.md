---
'@apexdevtools/apex-log-parser': patch
---

Apply `HEAP_DEALLOCATE` to the running heap, it was parsed then discarded so `heapPeak` could overstate a later peak (#73)
