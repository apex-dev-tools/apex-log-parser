# Workflows

The YAML says what runs. The scripts decide what happens, so the logic is testable
(`scripts/__tests__/ci.test.ts`) and runs locally.

| Workflow | Trigger |
| --- | --- |
| `ci.yml` | push and pull request on `main` |
| `benchmark.yml` | push and pull request on `main`; pull request adds heap; dispatch adds walltime |
| `codeql.yml` | schedule and pull request |
| `release.yml` | push on `main`, through Changesets |
| `scrape-events.yml` | quarterly schedule, dispatch, or another workflow |

## benchmark.yml

Runs `node --run bench` under [CodSpeed](https://codspeed.io) in simulation mode. CodSpeed
counts CPU instructions, not wall time, so a run on a shared runner is repeatable. It runs V8
with `--no-opt`, so it does not measure code that TurboFan optimised. A manual dispatch also
runs walltime mode on a CodSpeed macro runner: real time, with the full JIT. Each push
to `main` records a baseline. On a pull request, CodSpeed posts a comment with the change
per benchmark, and its check fails when a benchmark regresses past the threshold set on
codspeed.io.

The benchmarks are in `benchmarks/parse.bench.ts`. They parse 3 synthetic logs of 19 KB to 2 MB,
which `benchmarks/fixtures/fixtures.ts` generates, and `BenchFixtures.test.ts` checks those logs in
normal CI. The plugin parses each log 8 times under simulation, so the logs stay small to keep
the job between 1 and 2 minutes. An instruction count changes by the same percentage at 1 MB as at 20 MB,
unless the cost grows faster than the log. Logs of 8 to 100 MB show garbage
collection in wall time, so `pnpm run bench:large` parses them locally.

CodSpeed cannot see the V8 heap, so the `heap` job measures it on each pull request. It runs
`bench:large` once per log on the base commit, then on the head with `--baseline`, on one runner,
and fails when a log's heap grows by more than 2%. The job summary lists every log. It reports
time too, but does not gate on it.

Each log opens with one 2.5 s method, so every later time is past 2^31 ns. Node's V8 stores a
number that large as a separate heap object, as it stores most times in a long real log. V8
with pointer compression, as in Chrome and Electron, does so from 2^30 ns.

### Why it is built this way

| Choice | Reason |
| --- | --- |
| Simulation mode | Wall time on a shared runner varies by more than the regressions to catch. Instruction counts vary by about 1%. |
| Walltime on dispatch only | Macro runner minutes are billed: 600 a month on the free plan. A pull request would run fork code on the runner. |
| Macro runner for walltime | Wall time on a shared runner is too noisy. The org must allow public repositories in the runner group, or the job queues and never starts. |
| Logs of 2.5 MB in all | Each bench parses 8 times under Valgrind, and the job holds up the merge. |
| Exact Node version | Instruction counts move with the V8 version. A bump shifts the baseline once; acknowledge it on codspeed.io. |
| No `paths:` filter | A required check that does not run stays "Expected" and blocks the merge. |
| `id-token: write` at job level | CodSpeed authenticates with OIDC, so no secret is stored. |
| Fork pull requests | GitHub gives a fork no OIDC token, so CodSpeed uploads without a token. This works for a public repository. Never use `pull_request_target`. |
| One concurrency group per `main` commit | Each `main` commit is a baseline. A shared group drops a pending run even with `cancel-in-progress` off. |
| The CodSpeed check is required, not this job | The job passes on a regression. Only the CodSpeed check fails. |
| Heap gate at 2% | Heap moves by 0.3% at most between runs. Time moves by up to 6%, so it is not gated. |
| Base and head in one heap job | No stored baseline and no write token, so fork pull requests work. Both runs share a runner and a Node version. |
| The base runs its own `bench:large` | The head reads the base's `--json`. A change to that file's shape must keep reading the old one. |

To accept a deliberate regression, acknowledge it on the pull request's CodSpeed report.

## scrape-events.yml

Updates `data/salesforce-debug-log-events.json` from the two official Salesforce
sources and opens a pull request. It never pushes to `main`.

### Its scripts

| Step | Script |
| --- | --- |
| `pnpm run ci:seed` | `scripts/ci/seed.ts` |
| `pnpm scrape` | `scripts/scrape.ts` |
| `pnpm run ci:report` | `scripts/ci/report.ts`, on `scripts/ci/actions.ts` |

The scraper writes a run record with `--report=`. The report script renders the pull
request body and the job summary from that record, so no step parses stdout.

### Why it is built this way

| Choice | Reason |
| --- | --- |
| Cron `0 9 1 3,7,11 *` | The month after each Salesforce release, so the docs have turned over. |
| `fetch-depth: 0` | The seed step reads the automation branch, which a shallow clone lacks. |
| Seed `data/` first | A missed merge would otherwise relabel `release_added` and force-push away hand curation. |
| One fixed branch | An unmerged pull request is updated in place, never duplicated. |
| `delete-branch: true` | Deletes only after merge or close, so the next run starts clean. |
| Two gates recorded, not fatal | `pnpm run ci` goes red exactly when the scrape found a new event, which is the run most worth a pull request. |
| Failure raised last | The report and the pull request exist first, so the evidence survives. |
| Pull request only from the default branch | `create-pull-request` cuts its branch from the ref the workflow ran on. Cut from anywhere else, the pull request's merge base is wrong and its diff replays that branch. |
| Inputs reach scripts as env | Never interpolated into a shell. |
| `permissions` at job level | Least privilege by default; only this job may write. |

A step cannot read another step's exit code, so each gate is recorded with
`continue-on-error` and its `outcome` is passed to the report script. That part stays
in YAML because nothing else can express it. The report script decides whether the run
passed and says so in its `ok` output; the last step only obeys it.

### Calling it from another workflow

```yaml
jobs:
  scrape:
    permissions:
      contents: write
      pull-requests: write
    uses: ./.github/workflows/scrape-events.yml
    with:
      api_version: '67'
      branch: auto/scrape-debug-log-events
```

Inputs: `api_version` and `branch`, both optional — empty means the current GA release
and `auto/scrape-debug-log-events`. Outputs: `changed` and `pull_request`.

Same-repo callers use `./` with no `@ref`, and ride the caller's commit. A called
workflow can only reduce the token permissions the caller granted, so the caller must
grant both.

Calling it from **another repository** needs two more things, and is not set up:
`actions/checkout` in a called workflow checks out the caller's repository, not this
one, so the scripts would have to be checked out explicitly or published as a
package. The event database also lives only here.
