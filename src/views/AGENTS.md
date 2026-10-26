# src/views/AGENTS.md

For coding agents working on the views. The root [AGENTS.md](../../AGENTS.md) and
[src/AGENTS.md](../AGENTS.md) still apply.

## Layout

- `events.ts` — the store as events: one runtime class for every type; a new view on each read,
  so the log keeps no object per event.
- `lines.ts` — an event's text, raw line and fields, read from the source when a caller asks,
  through the catalog's rules. The flow interviews name needs the tree, so it is the one rule held
  here.
- `details.ts` — the values a line states beyond its text (`aggregations`, a limit usage), and the
  values the rows after it give (a throw's `isCaught`); one reader per type. `EventDetails` lists
  them; `ofType` types each event's `details`.
- `variables.ts` — turns what `engine/variables.ts` finds into frozen `Variable`s, shared between
  events.
- `columns.ts` — `columns`: every event as typed arrays by id, each made on its first read. The
  count getters come from `COUNT_ROLLUPS` in `events.ts`, as the events' do.
- `log.ts` — row 0 as `ApexLog`, the root; each figure that needs work is made on first read. A
  merged package run can end after the leaves that follow it, so `at()` searches frames only.
