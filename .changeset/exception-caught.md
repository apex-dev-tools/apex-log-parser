---
'@apexdevtools/apex-log-parser': minor
---

Add `details.caught` to each `EXCEPTION_THROWN` event. The parser reads it from the rows after the throw; the log does not state it. It is `true` when execution goes on after the throw, and `false` when a `FATAL_ERROR` ends it. Throws with only exit lines between them share one answer, so a throw that a catch block wraps and throws again is `false` too. It is `null` when the log cannot tell.
