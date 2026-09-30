---
'@apexdevtools/apex-log-parser': minor
---

Breaking: remove the `/types` entry point. The root entry point now exports every public type and the const companions (`LOG_LEVEL`, `LOG_CATEGORY`, `LIMIT_METRIC`, `ALL_LIMIT_METRICS`, `ALL_LOG_CATEGORIES`). To migrate, change `from '@apexdevtools/apex-log-parser/types'` to `from '@apexdevtools/apex-log-parser'`.
