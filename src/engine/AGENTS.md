# src/engine/AGENTS.md

For coding agents working on the engine. The root [AGENTS.md](../../AGENTS.md) and
[src/AGENTS.md](../AGENTS.md) still apply.

## Layout

- `builder.ts` — builds the tree in one pass, with pre-0.4 rules and order of side effects. A
  matched exit line gets no row: it folds into the frame it closes. A package entry the pre-0.4
  merge removed gets none either. Stops at a second log and reports it as an issue.
- `tables.ts` — the per-type tables the builder and the views read; the two frame tests on a row.
- `markers.ts` — work off the hot path: issues, parsing errors, limit blocks, hooks.
- `rollups.ts` — the passes after the build: the log's times, the rollups, the flow residuals.
- `header.ts` — the debug levels, `USER_INFO`, the start time.
- `issues.ts` — the log issues, and the truncation regions they make.
- `namespaces.ts` — the namespace rules, read from bytes.
- `engine.ts` — the `LogEngine`, which keeps one idle builder alive. `node.ts`, `browser.ts`: each
  build's `LogEngine`.
- `buffers.ts` — a build to typed arrays and plain values that structured clone carries whole, and
  back.
- `throws.ts` — each throw's outcome from the rows after it, in one pass on the first `isCaught`
  read.
- `variables.ts` — indexes the variable lines on the first `variables` read. Typed-array columns per
  write and per declaration. CSR lists: each frame's lines by name (declarations, then writes), each
  static's writes, the field writes by owner address, the writes that state each address's value,
  each address's objects as runs. A read is a binary search.

## Rollups

`LogBuilder.settle` runs, in order: the log's times (`setLogTimes`), `rollUp`, `applyFlowResiduals`,
the store trim. The last three stop at a deadline and go on from where they stopped. The residual
pass runs after `rollUp` because it adds to every ancestor itself.

- `rollUp` goes down from the last id, so each subtree is totalled before its root moves up. That
  holds because ids are in prefix order. A new counter rolls up once it is in the store's
  `COUNTERS`.
- `duration.self` is a subtraction: each row adds its total to its own self and takes it off its
  parent's.
- `heapPeak` composes by max, not sum. `heapAllocated.self` and `heapGross.self` come from leaves
  only.
