---
'@apexdevtools/apex-log-parser': patch
---

Apply `HEAP_DEALLOCATE` to the running heap, it was parsed then discarded so `heapPeak` could overstate and `heapAllocated` was not net of frees (#73)
