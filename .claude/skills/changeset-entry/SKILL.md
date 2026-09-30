---
name: changeset-entry
description: Write, review or trim a changeset in `.changeset/`. Use when a PR needs a changeset, when running `changeset add`, or when a changeset reads too long.
---

# Changeset entry

The summary becomes one `CHANGELOG.md` bullet, read by the person who upgrades. Everything else
goes in the PR.

```markdown
---
'@apexdevtools/apex-log-parser': minor
---

Add `ApexLog.entryPoints`, the entry point of every execution in the log (#90)
```

## Rules

- **One sentence**, present tense. A second sentence only for a breaking change's migration step.
- **`Breaking:` prefix** when the caller must edit code. Before 1.0 that is still `minor`.
- **A fix names the symptom**, not the cause or the mechanism.
- **Cut:** "before" or "previously", rationale, edge cases, "X does not change", and any list of
  affected types. The PR holds the detail; the compiler finds the types.
- **A performance entry states its number** and what it is of.
- **One file per user-visible change**, named for it: `entry-points.md`.
- **No changeset** for a refactor, test, CI or dev dependency.
- **Unreleased work:** edit its changeset. Drop a fix for a bug that never shipped.
- **Stacked branches** carrying one changeset: keep it identical in each.
- **Release PR** is generated: change the changeset on the base branch, never the release PR.

## Wrong, then right

| Wrong | Right |
|---|---|
| `Breaking: remove the /types entry point. The root now exports every public type and the const companions (LOG_LEVEL, LOG_CATEGORY, ...). To migrate, ...` | `` Breaking: remove the `/types` entry point. To migrate, change `from '@apexdevtools/apex-log-parser/types'` to `from '@apexdevtools/apex-log-parser'`. `` |
| `Read userInfo from the first timestamped line only. Before, an anonymous Apex echo ... The search also no longer scans the whole log.` | `` Fix a wrong or missing `userInfo` when a log quotes a `USER_INFO` or `EXECUTION_STARTED` line `` |
| `Improve search performance` | `Search a 100MB log 10× faster` |

When trimming, show each file's old and new text.
