---
'@apexdevtools/apex-log-parser': minor
---

Add `ApexLog.debugLevelSettings`: every `CATEGORY,LEVEL` entry of the log's settings line, verbatim and in log order. Each entry states its `token`, its `level`, and the `DebugLevels` property it names as `category`, or null for a category the parser does not know. An unknown category is no longer reported in `parsingErrors`, so a log that uses a new Salesforce category opens cleanly.
