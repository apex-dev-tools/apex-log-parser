# benchmarks/AGENTS.md

Guidance for coding agents working on the benchmarks. The root [AGENTS.md](../AGENTS.md) still
applies.

## Layout

- `parse.bench.ts` — the `pnpm run bench` suite, which CodSpeed runs on every pull request.
- `fixtures/` — the synthetic logs. `fixtures.ts` generates them from a seed, with placeholder
  content only. Its profiles (small, developer and large) take their event mix, depth and wrapped
  lines from `profiles.json`, which holds only numbers measured from real logs. A new hot path in
  the parser needs a shape there. `largeLogs` are the logs for `bench:large`.
- `scripts/large.ts` — `pnpm run bench:large`, the 8, 20, 50, 75 and 100 MB synthetic logs, which
  are too slow for the CodSpeed job. Local only. Run it with `--json=<path>` on one branch and
  `--baseline=<path>` on the other to compare them. `--engine=next` times the new parser; its
  `--baseline` can be a legacy run's JSON.
- `scripts/profiles.ts` — measures a local folder of real logs by size band and prints
  `fixtures/profiles.json`. Local only.
- `scripts/compare/` — `pnpm run compare <dir> --out=<dir>`: runs a folder of logs through each
  parse engine, diffs their output field by field, and times them. `known.ts` holds one rule per
  known difference between `next` and `legacy`. A rule undoes its own difference on one field, and
  the field counts as explained only when it then equals legacy. A new deliberate difference needs
  a rule there.
- `scripts/micro/` — `pnpm run bench:micro --file=<log>`: the micro-benchmarks behind the engine's
  low-level choices (`docs/adr/0004`), in Node and headless Chromium.
- `scripts/versus.ts` — the one wording for a comparison: `4.4× faster (-77.6%)`.
- `__tests__/` — `BenchFixtures.test.ts` checks the synthetic logs, and that each profile stays
  close to its real logs. The other suites test the scripts. All run in `pnpm run ci`.

The scripts import `scripts/cli.ts` and `scripts/child.ts`, which the scraper shares.
`tsconfig.scripts.json` type-checks this folder, with node types.

## Rules

- Every benchmark output states the raw figures, then the times and the percent change, from
  `scripts/versus.ts`.
- Real logs never go into the repository or CI. `scripts/profiles.ts` prints numbers, never log
  text. Never commit the output of `compare`; it names the logs.
- Local `pnpm run bench` numbers are wall time; CI reports instruction counts. Do not compare the
  two.
