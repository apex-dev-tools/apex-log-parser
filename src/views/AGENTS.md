# src/views/AGENTS.md

For coding agents working on the views. The root [AGENTS.md](../../AGENTS.md) still applies.

## Layout

- `events.ts` — the store as events: one runtime class for every type; each event made on first
  read, then the same object for its id.
- `lines.ts` — an event's text, raw line and fields, read from the source when a caller asks,
  through the catalog's rules. The flow interviews name needs the tree, so it is the one rule held
  here.
- `details.ts` — the values a line states beyond its text (`aggregations`, a limit usage), and the
  values the rows after it give (a throw's `isCaught`); one reader per type. `EventDetails` lists
  them; `ofType` types each event's `details`.
- `variables.ts` — turns what `engine/variables.ts` finds into frozen `Variable`s, shared between
  events.
- `log.ts` — row 0 as `ApexLog`, the root; each figure that needs work is made on first read. A
  merged package run can end after the leaves that follow it, so `at()` searches frames only.
