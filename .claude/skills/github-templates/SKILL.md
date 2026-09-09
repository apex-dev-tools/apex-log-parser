---
name: github-templates
description: File a GitHub issue or pull request through this repo's templates
allowed-tools: Bash, Read, Glob
---

Only the web UI applies a template. Every other route — a CLI, an MCP server, the REST API — files
the body you pass, with no warning, so the issue lands with no type, no title prefix and a free-form
body. Read the form first and build the body to match it.

## An issue

`.github/ISSUE_TEMPLATE/` holds `bug_report.yml`, `feature_request.yml` and `chore.yml`. Pick on
`name` and `description`, not on which is nearest to hand. The front matter says what to send:

| Front matter | What to send |
| --- | --- |
| `title: '🔧 chore: <title>'` | the title starts with that prefix, verbatim |
| `type: Task` | the issue type |
| `labels: ['chore']` | those labels |
| each body field's `label:` | an `###` heading, in the form's order |

A `validations: required` field must be answered. No form fits — a perf task, say — take the closest
and say in the body that it is the closest.

## A pull request

Send `.github/PULL_REQUEST_TEMPLATE.md` with every section filled in. Tick only what you ran; a box
left unticked needs one line saying why, and so does one that does not apply.

## Already filed without one

Edit it in place. The number is referenced from branches, commits and the changelog, so never close
and refile. Keep the body that is there and put the form's headings around it.

## Check it took

Read the issue or pull request back and confirm the title prefix, type and labels.
