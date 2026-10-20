# scripts/AGENTS.md

For coding agents working on the scraper and the event database. The root
[AGENTS.md](../AGENTS.md) still applies.

## Layout

- `../data/` — the event database, made by `pnpm scrape`. Edit the scraper, not the JSON. Not
  published; the parser never reads it. `Catalog.test.ts`, `CatalogDocs.test.ts` and the scripts do.
- `scrape.ts` — the scraper. Reads both official sources over plain HTTP; endpoints and failure
  modes in `scraper.md`. `--report=<path>` writes the run as JSON, for `ci/report.ts`.
- `validate-data.ts` — `pnpm run validate:data`: the event database against its own `$schema`. Not
  in `pnpm run ci`; the scrape workflow runs it.
- `cli.ts` — argument reading and the entry-point guard all scripts use. No other imports, so a
  small script does not load the scraper's module graph to read one flag.
- `ci/` — the scrape workflow's logic, so the YAML only declares what runs. `actions.ts`: Actions
  plumbing (step outputs, job summary, annotations). `report.ts`: the pull request body. `seed.ts`:
  seeds `data/` from the open automation branch. See `.github/workflows/README.md`.

`tsconfig.scripts.json` type-checks this folder, with node types.
