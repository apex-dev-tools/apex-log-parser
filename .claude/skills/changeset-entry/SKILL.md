---
name: changeset-entry
description: Write, review or trim a changeset in `.changeset/`. Use when a PR needs a changeset, when running `changeset add`, or when a changeset reads too long.
---

# Changeset entry

A changeset summary becomes one bullet in `CHANGELOG.md`. It is written for the person who upgrades.
How the change was made, why, and what else was considered belong in the pull request.

Never edit `CHANGELOG.md` by hand. `changeset version` writes it from these files.

## The file

```markdown
---
'@apexdevtools/apex-log-parser': minor
---

Add `ApexLog.entryPoints`, the entry point of every execution in the log (#90)
```

- **File name** says the change in kebab case: `entry-points.md`, not the random default.
- **One changeset per user-visible change.** Two changes in one PR → two files.
- **Bump:** `major` breaks a caller, `minor` adds, `patch` fixes. Before 1.0, a break is `minor`.
  Match the repo's released history.
- **No section words.** The changelog groups by bump (`### Minor Changes`), not by Added or Fixed.
  The verb says what kind of change it is.

## The summary

```
[Breaking: ]<present-tense verb> <what the user gets>[ (#<issue>)]
```

- **One sentence.** No semicolon or colon that joins two facts.
- **A second sentence only for a breaking change**: the exact edit the caller makes to migrate.
- **Present tense.** "Add", "Fix", "Remove" - not "Added".
- **`Breaking:` prefix** on any change that forces the caller to edit code.
- **Name the public API** in backticks: `ApexLog.size`, `parse()`. Nothing the caller cannot import.
- **Issue ref** as `(#97)` at the end, when an issue exists.

## Write for the reader, not the author

- **A fix names the symptom**, not the cause and not the fix mechanism.
- **No "before" or "previously".** The version bump already says it changed.
- **No list of every affected type or constant.** Name the change; the caller's compiler finds the rest.
- **No rationale, examples of the bug, or edge cases.** Those go in the PR.
- **No "X does not change".** Only what changed gets a line.
- **A performance entry carries its number** - a multiple or a percentage, and what it is of.

## What earns a changeset

A change the user of the published package can see: API, behaviour, output, docs on npm.
No changeset for a refactor, a test, CI, or a dev dependency.

Unreleased work: edit the existing changeset. Drop a fix for a bug that only ever existed on the
branch. Nobody met that bug.

## Wrong, then right

| Wrong | Right |
|---|---|
| `Breaking: remove the /types entry point. The root now exports every public type and the const companions (LOG_LEVEL, LOG_CATEGORY, ...). To migrate, ...` | `` Breaking: remove the `/types` entry point. To migrate, change `from '@apexdevtools/apex-log-parser/types'` to `from '@apexdevtools/apex-log-parser'`. `` |
| `Parse only the first log ... Before, the logs were merged into one tree and nothing reported it. A new log starts at a settings line after ...` | `` Parse only the first of several pasted-together logs, and report a `Multiple-Logs` issue `` |
| `Read userInfo from the first timestamped line only. Before, an anonymous Apex echo ... The search also no longer scans the whole log.` | `` Fix a wrong or missing `userInfo` when a log quotes a `USER_INFO` or `EXECUTION_STARTED` line `` |
| `Added a new field` | `` Add `ApexLog.debugLevelSettings`, every category and level from the settings line `` |
| `Improve search performance` | `Search a 100MB log 10× faster` |

## Trim a changeset

1. Read the whole file and the PR title.
2. Keep the first sentence if it names what the user gets. Rewrite it if it does not.
3. Cut every other sentence unless it is the migration step of a breaking change.
4. Check the bump still fits the trimmed summary.

Report each file with its old and new text. A cut the author disagrees with is invisible otherwise.

## Stacked branches and the release PR

- A changeset carried by two stacked branches must stay identical in both. Edit it in each branch.
- The release PR (`chore(release): version packages`) is generated. To change a pending entry, edit
  the changeset on the base branch through a normal PR, then let the release PR regenerate.
