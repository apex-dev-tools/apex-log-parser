# AGENTS.md

For coding agents. Usage docs: [README](./README.md). Each folder below has its own `AGENTS.md`;
read it before working there.

## What this is

`@apexdevtools/apex-log-parser` turns Salesforce Apex debug log text into a typed event tree:
timings, governor limits, SOQL/DML/SOSL counts. No runtime dependencies. ESM only.

## Layout

- `src/` — the parser and its tests. See `src/AGENTS.md`.
- `scripts/`, `data/` — the scraper, and the event database it makes. See `scripts/AGENTS.md`.
- `benchmarks/` — all benchmarks and their tools. See `benchmarks/AGENTS.md`.
- `scripts/` and `benchmarks/` are outside `tsconfig.json`, so `pnpm typecheck` does not see them;
  `tsconfig.scripts.json` does. `pnpm run ci` runs both.

## Commands

`pnpm run ci` — biome, `tsc --noEmit`, `tsc -p tsconfig.scripts.json`, vitest. Run before every
commit.

- `pnpm ci` is pnpm's `clean-install`: it deletes `node_modules` and reinstalls. Always write `run`.
- `pnpm run bench` — the benchmarks, no watch. Locally: wall time. CI on a pull request: instruction
  counts and allocations. Do not compare the two. A parser change that can affect large logs also
  needs `pnpm run bench:large` and `pnpm run bench:simulation` against `main`.
- `pnpm build` and `pnpm run bench` need Node `^22.18 || ^24.11 || >=26` for tsdown; the
  package supports any Node 22.
  CI builds on Node 24 only.

## Conventions

- Strict TypeScript, with `verbatimModuleSyntax` and `isolatedDeclarations`: every exported
  declaration states its type; type-only imports are statement-level `import type`.
- `noUncheckedIndexedAccess` makes each indexed read `T | undefined`, so parsing code carries `!`
  and `?? ''`.
- Import with a `.js` extension.
- Comment the why, not the what. In doubt, none. One line. Public API takes a doc block.
- Never paste a log from an org. Fixtures use `ns`, `MyClass`, `user@example.com` and ids
  zero-filled after the key prefix (`005000000000AAA`).
- Conventional commits, one concern per commit.
- A changeset states only the changes that matter most to a consumer: the public API, speed, heap.
  It is not a list of every change; a small fix needs none. Changesets writes `CHANGELOG.md`; never
  edit it by hand.
- File issues and pull requests through the templates in `.github/`. One filed without a template:
  fix it in place; never close and refile.
