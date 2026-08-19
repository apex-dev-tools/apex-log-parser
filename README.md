# @apexdevtools/apex-log-parser

[![npm version](https://img.shields.io/npm/v/@apexdevtools/apex-log-parser)](https://www.npmjs.com/package/@apexdevtools/apex-log-parser)
[![npm downloads](https://img.shields.io/npm/dm/@apexdevtools/apex-log-parser)](https://www.npmjs.com/package/@apexdevtools/apex-log-parser)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@apexdevtools/apex-log-parser)](https://bundlephobia.com/package/@apexdevtools/apex-log-parser)
[![CI](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml/badge.svg)](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](./LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

Turn a Salesforce Apex debug log into a typed event tree — execution timings, governor limits,
SOQL/DML counts.

> **Why this library?** It is the same parser that powers the
> [Apex Log Analyzer](https://github.com/certinia/debug-log-analyzer) VS Code extension —
> proven on real logs, with zero runtime dependencies and a bundled database of documented
> Salesforce log events.

## Features

- **171 event types** parsed into typed classes — methods, SOQL, DML, flows, callouts, and more
- **Hierarchical event tree** with parent/child links and automatic entry/exit matching
- **Execution timing** per node, self and total, at nanosecond precision
- **Governor limit tracking** with point-in-time snapshots, per namespace
- **Per-line limit observations** — each limit line exposed as `{ metric, used, limit }`
- **SOQL, DML and SOSL counts** aggregated up the tree
- **Managed package namespace** detection and per-namespace metrics
- **Event database** of 299 documented Salesforce log event types, bundled as JSON
- **Zero dependencies**, ESM only

## Install

```bash
# pnpm
pnpm add @apexdevtools/apex-log-parser

# npm
npm install @apexdevtools/apex-log-parser

# yarn
yarn add @apexdevtools/apex-log-parser
```

## Quick start

Given this log:

```
64.0 APEX_CODE,FINE;APEX_PROFILING,FINEST;CALLOUT,NONE;DB,INFO;NBA,NONE;SYSTEM,NONE;VALIDATION,NONE;VISUALFORCE,NONE;WAVE,NONE;WORKFLOW,NONE
09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|0050W000006W3LM|user@example.com|Greenwich Mean Time|GMTZ
09:18:22.6 (6574780)|EXECUTION_STARTED
09:18:22.6 (6600000)|CODE_UNIT_STARTED|[EXTERNAL]|01p4J00000FpS6t|AccountService.refresh()
09:18:22.6 (7000000)|METHOD_ENTRY|[12]|01p4J00000FpS6t|AccountService.loadAccounts()
09:18:22.6 (7100000)|SOQL_EXECUTE_BEGIN|[14]|Aggregations:0|SELECT Id, Name FROM Account WHERE Industry = :industry
09:18:22.6 (9100000)|SOQL_EXECUTE_END|[14]|Rows:50
09:18:22.6 (9200000)|METHOD_EXIT|[12]|01p4J00000FpS6t|AccountService.loadAccounts()
09:18:22.6 (9300000)|DML_BEGIN|[20]|Op:Update|Type:Account|Rows:50
09:18:22.6 (9800000)|DML_END|[20]
09:18:22.6 (9900000)|CODE_UNIT_FINISHED|AccountService.refresh()
09:18:22.6 (10100000)|EXECUTION_FINISHED
```

This code:

```typescript
import { type LogEvent, parse } from '@apexdevtools/apex-log-parser';

function printTree(node: LogEvent, depth = 0): void {
  const indent = '  '.repeat(depth);
  const ms = (node.duration.total / 1_000_000).toFixed(2);
  console.log(`${indent}${node.type ?? 'LOG_ROOT'} ${node.text} (${ms}ms)`);
  for (const child of node.children) {
    printTree(child, depth + 1);
  }
}

const log = parse(logData);

printTree(log);
```

Prints:

```
LOG_ROOT LOG_ROOT (3.53ms)
  EXECUTION_STARTED EXECUTION_STARTED (3.53ms)
    CODE_UNIT_STARTED AccountService.refresh() (3.30ms)
      METHOD_ENTRY AccountService.loadAccounts() (2.20ms)
        SOQL_EXECUTE_BEGIN SELECT Id, Name FROM Account WHERE Industry = :industry (2.00ms)
      DML_BEGIN DML Op:Update Type:Account (0.50ms)
```

Note the shape. `parse()` returns the root, which is itself a `LogEvent`, so the same walk works
from any node. `METHOD_EXIT`, `SOQL_EXECUTE_END` and `DML_END` are not nodes of their own — each
one closes its matching begin event and sets that event's `exitStamp` and `duration`.

The root aggregates the whole tree, so totals need no walk:

```typescript
console.log(`SOQL: ${log.soqlCount.total} queries, ${log.soqlRowCount.total} rows`);
console.log(`DML:  ${log.dmlCount.total} statements, ${log.dmlRowCount.total} rows`);
// SOQL: 1 queries, 50 rows
// DML:  1 statements, 50 rows
```

Governor limits are on the root too. `final` states what the transaction had used when the log
ended, `peak` the highest each metric reached — check `peak` against a ceiling, because counters
fall mid-log. Each metric states `{ used, limit, percentUsed }`:

```typescript
const { final, peak } = log.governorLimits;

console.log(`CPU:  ${final.cpuTime.used}/${final.cpuTime.limit}ms`);
console.log(`SOQL: ${peak.soqlQueries.used} at peak (${peak.soqlQueries.percentUsed}%)`);
console.log(`Heap: ${peak.heapSize.used}/${peak.heapSize.limit} bytes`);
```

## Find the slowest methods

`duration.self` excludes children, so it ranks by time spent in the method itself rather than in
what it called.

```typescript
import { type LogEvent, MethodEntryLine, parse } from '@apexdevtools/apex-log-parser';

function findSlowest(log: LogEvent, count = 10): { name: string; duration: number }[] {
  const methods: { name: string; duration: number }[] = [];
  const stack: LogEvent[] = [...log.children];
  while (stack.length) {
    const node = stack.pop();
    if (!node) {
      break;
    }
    if (node instanceof MethodEntryLine) {
      methods.push({ name: node.text, duration: node.duration.self });
    }
    stack.push(...node.children);
  }
  return methods.sort((a, b) => b.duration - a.duration).slice(0, count);
}

console.table(findSlowest(parse(logData)));
```

## API

`parse(logData: string): ApexLog` — that is the whole entry point. There is no state to reset
between calls, and `ApexLogParser.parse` gives each call its own parser. `ApexLog` is the root `LogEvent`, and adds `governorLimits`, `namespaces`,
`debugLevels`, `userInfo`, `entryPoint`, `truncation`, `logIssues`, `parsingErrors`,
`exceptions` and `eventsById`.

There are two entry points. The root exports runtime values only: `parse`, the `ApexLogParser`
class, and the event classes you need for `instanceof` narrowing. Every type, and the
const companions that go with them, come from `@apexdevtools/apex-log-parser/types`:

```typescript
import { parse } from '@apexdevtools/apex-log-parser';
import { LOG_LEVEL, type GovernorLimits } from '@apexdevtools/apex-log-parser/types';
```

Every field, event class and type is described in the shipped declarations, so your editor has the
full surface.

## Tips

**Capture the log at the right levels.** The parser reports what the log contains. A log captured
at a low level is missing whole categories of line, and the matching fields stay empty. This is
the most common surprise:

| You want | The log needs |
| --- | --- |
| `duration` on method nodes | `APEX_CODE` at `FINE` or above, plus `APEX_PROFILING` |
| `governorLimits` | `APEX_PROFILING` at `FINE` or above, which emits the `CUMULATIVE_LIMIT_USAGE` block |
| SOQL and DML nodes | `DB` at `INFO` or above |
| Flow and Process Builder limit lines | `WORKFLOW` at `FINER` |

**All-zero limits mean "not reported".** Without a `LIMIT_USAGE_FOR_NS` block, every
`governorLimits.final` and `governorLimits.peak` metric stays at
`{ used: 0, limit: 0, percentUsed: null }`. That is not a transaction that used nothing.

**Read totals from the root.** It already aggregates the tree — walking it to count SOQL or DML
is wasted work.

**Use `eventIndex` as an id.** It is unique, increasing and stable across a parse.

**Two collections, two meanings.** `parsingErrors` holds lines the parser did not understand — a
parser problem. `logIssues` holds problems in the transaction the log describes, such as a
truncated log or an unexpected exit.

## Event database

The package bundles a database of 299 Salesforce debug log event types, from official
documentation and community research. It is data only — the parser does not read it at runtime.

```typescript
import events from '@apexdevtools/apex-log-parser/data/events.json' with { type: 'json' };

for (const event of events.events) {
  console.log(event.event, event.category, event.level);
}
```

Each entry records the event name, category and minimum log level, its field definitions, whether
it is officially documented or community-discovered, the Salesforce release that added or
deprecated it, and where the information came from.

## FAQ

### How do I parse a Salesforce Apex debug log in JavaScript or TypeScript?

Install `@apexdevtools/apex-log-parser` and call `parse()` with the raw log text. It returns a
typed tree you can walk, filter and analyse. See [Quick start](#quick-start).

### What Apex debug log event types does it support?

171 event types have a dedicated class, including `METHOD_ENTRY`/`EXIT`,
`SOQL_EXECUTE_BEGIN`/`END`, `DML_BEGIN`/`END`, `CODE_UNIT_STARTED`/`FINISHED`,
`FLOW_START_INTERVIEWS_BEGIN`, `CALLOUT_REQUEST`/`RESPONSE`, `EXCEPTION_THROWN` and `FATAL_ERROR`.
Anything else falls back to a generic line class, so no log line is lost. The bundled
[event database](#event-database) documents 299 known events.

### How do I analyse Salesforce governor limits programmatically?

Call `parse()` and read `log.governorLimits` — `final` and `peak`, each stating 13 metrics with
`used`, `limit` and `percentUsed`, plus `byNamespace` and point-in-time `snapshots`. See [Quick start](#quick-start), and read
[Tips](#tips) first if every metric comes back zero.

## Requirements

- **Node.js 20 or later.** The package targets ES2022 and runs in any runtime with ES modules —
  Node, Deno, Bun, and modern browsers. It reads no files and makes no network calls.
- **ESM only.** There is no CommonJS build, so `require()` does not work.
- **TypeScript declarations ship with the package.** No `@types` install is needed.

## Stability

This package is at 0.x. The API is in use by the Apex Log Analyzer and is not expected to churn,
but minor versions may still make breaking changes until 1.0.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, coding standards, and the PR process.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) or the [GitHub Releases](https://github.com/apex-dev-tools/apex-log-parser/releases) for version history.

## License

BSD-3-Clause - [Certinia Inc.](https://certinia.com)
