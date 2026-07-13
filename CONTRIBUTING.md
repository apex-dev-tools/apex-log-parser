# Contributing

Thanks for your interest in contributing to `@apex-dev-tools/apex-log-parser`. This guide covers everything you need to get started.

By participating, you agree to abide by our [Code of Conduct](./CODE_OF_CONDUCT.md).

## Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 10+

## Setup

```bash
git clone https://github.com/apex-dev-tools/apex-debug-log-parser.git
cd apex-debug-log-parser
pnpm install
```

## Development Commands

```bash
pnpm run build        # Bundle JS (tsdown) + generate declarations (tsc)
pnpm run typecheck    # Type-check without emitting
pnpm run test         # Run tests once
pnpm run test:watch   # Run tests in watch mode
pnpm vitest run src/__tests__/ApexLogParser.test.ts  # Run a single test file
pnpm run lint         # Check formatting + lint rules
pnpm run lint:fix     # Auto-fix formatting + lint issues
pnpm run ci           # Full check: lint + typecheck + test
```

## Making Changes

1. **Fork and branch** from `main`
2. **Write code** following the existing patterns
3. **Add tests** for new functionality
4. **Run `pnpm run ci`** to verify everything passes
5. **Add a changeset** if your change affects the published package:
   ```bash
   pnpm changeset
   ```
6. **Open a PR** against `main`

## Commit Conventions

We use [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` new features
- `fix:` bug fixes
- `refactor:` code changes that neither fix bugs nor add features
- `test:` adding or updating tests
- `docs:` documentation changes
- `chore:` maintenance (deps, CI, tooling)

## Code Style

- **Formatter/Linter**: [Biome](https://biomejs.dev/) (configured in `biome.json`)
- **TypeScript**: strict mode with `isolatedDeclarations`
- **Indentation**: 2 spaces
- **Quotes**: single quotes
- **Trailing commas**: always
- **Imports**: organized automatically by Biome

Run `pnpm run lint:fix` before committing to auto-format.

## Adding New Event Types

When Salesforce adds new debug log event types:

1. Add the event name to the `_logEventNames` array in `src/types.ts`
2. Create a new class extending `LogEvent` (or `DurationLogEvent`) in `src/LogEvents.ts`
3. Register it in the `lineTypeMap` in `src/LogLineMapping.ts`
4. Add a test in `src/__tests__/EventMetadata.test.ts`
5. Update `data/salesforce-debug-log-events.json` if the event is documented

## Project Structure

```
src/
  index.ts            # Public API exports
  ApexLogParser.ts    # Main parser class
  LogEvents.ts        # 200+ event type classes
  LogLineMapping.ts   # Event type string to class mapping
  types.ts            # TypeScript types and constants
  __tests__/          # Vitest test files
data/                 # Salesforce event reference database
scripts/              # Internal tooling (scraper docs)
```

## Releasing (maintainers)

Releases are automated with [Changesets](https://github.com/changesets/changesets):

1. Merged PRs that include a changeset accumulate on `main`.
2. The [`release` workflow](./.github/workflows/release.yml) opens (or updates) a **Version Packages** PR that bumps the version and updates `CHANGELOG.md`.
3. Merging that PR publishes to npm (with provenance) via the `NPM_TOKEN` secret.

## Questions?

Open an [issue](https://github.com/apex-dev-tools/apex-debug-log-parser/issues) or start a [discussion](https://github.com/apex-dev-tools/apex-debug-log-parser/discussions).
