---
name: log-event-fields
description: Work out what an Apex log event's fields mean when the parser does not name them
allowed-tools: Bash, Read, Grep, Glob
---

A log line is `HH:mm:ss.S (nanos)|EVENT_TYPE|…`, pipe delimited. The parser names the fields it
needs, not every field of every event. Establish the rest in this order. Never guess.

## 1. Ask the parser

- `src/catalog/catalog.ts` holds one entry per event type in `ENTRIES`. Its `fields` lists the
  names of the fields after the type, in line order. Its text rule names the fields it reads.
- `src/catalog/fields.ts` documents each field in `EventFields`, with its `Format:`. A `@remarks`
  line means no real log confirms the layout yet.
- `event.field(name)` reads one named field. A name the entry does not list throws. The last
  listed field runs to the end of the line, so a value that holds `|` stays whole, and any field
  after it is part of it.
- `event.details` holds the typed values that `src/views/details.ts` reads for some types, such as
  `aggregations` or an explain plan. `event.logLine` holds the whole first line.

## 2. Ask the event database

- `data/salesforce-debug-log-events.json` holds the documented field order and the level each event
  needs. `pnpm scrape` regenerates it; `scripts/scraper.md` names the two sources.
- The database gives the order. It does not say what a field means when it is empty, when two lines
  share one value, or when the runtime could not serialise it.

## 3. Measure

Read the event out of real logs and count. One line proves nothing.

```bash
grep -h '|EVENT_TYPE|' <log> | head -3              # the shape
grep -c '|EVENT_TYPE|' <log>                        # whether it is worth handling
grep -h '|EVENT_TYPE|' <log> | awk -F'|' '{print NF}' | sort | uniq -c   # which fields are optional
```

State the hypothesis, then hunt its counter-example. To test "field N is this line's own value",
count how many distinct values one N takes: more than one and N names something else.

Check the log's own header (`APEX_CODE,…`) before concluding an event is absent: it may only be
missing at that level.

## Rules that hold for any event

- Read by pipe position. `split('|')` on a value is wrong: a trailing field can be present and
  empty (`…|a|null|`), which then reads as part of the value.
- Check length before slicing a value. A logged value can reach tens of thousands of characters, and
  a whole-log walk touches every line.
- Timestamps repeat, so they order nothing. Order by `id`.
- A line's meaning can depend on the line above it, or on the frame it sits in.
- Never trust a value as JSON: the log writes duplicate keys and truncation markers.

## Write the answer down

- A field layout belongs in the event's catalog entry (`fields`) and in its `EventFields` doc in
  `src/catalog/fields.ts`. Follow "Adding an event type" in `AGENTS.md`, and state the unit on any
  new field. `CatalogDocs.test.ts` fails when the docs miss a field.
- A typed value goes in `EventDetails`, with a reader in `src/views/details.ts`.
- A field the log did not state is `null`. Never a default, and never an absent field.
- A rule no layout can state belongs in a one-line comment where the code relies on it, plus a test
  that fails if the rule breaks.
- Counts measured from private logs stay out of the repo. State the rule, not the corpus. Fixtures
  use `ns`, `MyClass`, `user@example.com`.
