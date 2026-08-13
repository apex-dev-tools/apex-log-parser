# @apexdevtools/apex-log-parser

[![npm version](https://img.shields.io/npm/v/@apexdevtools/apex-log-parser)](https://www.npmjs.com/package/@apexdevtools/apex-log-parser)
[![npm downloads](https://img.shields.io/npm/dm/@apexdevtools/apex-log-parser)](https://www.npmjs.com/package/@apexdevtools/apex-log-parser)
[![CI](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml/badge.svg)](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](./LICENSE)

Turn a Salesforce Apex debug log into a typed event tree — execution timings, governor limits, SOQL/DML counts. Zero dependencies.

This is the parser that powers the [Apex Log Analyzer](https://github.com/certinia/debug-log-analyzer) VS Code extension.

## Install

```bash
# pnpm
pnpm add @apexdevtools/apex-log-parser

# npm
npm install @apexdevtools/apex-log-parser

# yarn
yarn add @apexdevtools/apex-log-parser
```

## Get a log

The parser takes the raw log text. To get one:

```bash
# List the logs in the org, then download one
sf apex list log
sf apex get log --log-id 07L...

# Or stream new logs as they happen
sf apex tail log --color
```

You can also download a log from Setup → Environments → Logs → Debug Logs.

```typescript
import { readFileSync } from 'node:fs';
import { parse } from '@apexdevtools/apex-log-parser';

const log = parse(readFileSync('apex.log', 'utf8'));
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

printTree(parse(logText));
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

## Requirements

- **Node.js 20 or later.** The package targets ES2022 and runs in any runtime with ES modules —
  Node, Deno, Bun, and modern browsers. It reads no files and makes no network calls.
- **ESM only.** There is no CommonJS build, so `require()` does not work.
- **TypeScript declarations ship with the package.** No `@types` install is needed.

### Log levels change what you get

The parser reports what the log contains. A log captured at a low level is missing whole
categories of line, and the matching fields stay empty. This is the most common surprise:

| You want | The log needs |
| --- | --- |
| `duration` on method nodes | `APEX_CODE` at `FINE` or above, plus `APEX_PROFILING` |
| `governorLimits` | `APEX_PROFILING` at `FINE` or above, which emits the `CUMULATIVE_LIMIT_USAGE` block |
| SOQL and DML nodes | `DB` at `INFO` or above |
| Flow and Process Builder limit lines | `WORKFLOW` at `FINER` |

Without a `LIMIT_USAGE_FOR_NS` block, every `governorLimits` metric stays at its initial
`{ used: 0, limit: 0 }`. All-zero limits mean the log did not report them — not that the
transaction used nothing.

## API

Everything below is exported from the package root.

### `parse(logData: string): ApexLog`

Parses raw log text and returns the root of the tree. There is no parser object to construct and
no state to reset between calls.

### `ApexLog`

The root node. It is a `LogEvent` — it has `children`, `duration` and the rest — plus these:

| Field | Type | Meaning |
| --- | --- | --- |
| `governorLimits` | `GovernorLimits` | Final limit state, and per-namespace breakdown |
| `namespaces` | `string[]` | Every managed package namespace seen in the log |
| `debugLevels` | `DebugLevel[]` | The category/level pairs from the log header |
| `logIssues` | `LogIssue[]` | Problems found *in the log*, such as a truncated transaction |
| `parsingErrors` | `string[]` | Lines the parser could not handle |
| `exceptions` | `LogEvent[]` | Every `EXCEPTION_THROWN` event, flattened |
| `eventsById` | `LogEvent[]` | Every event, indexed by its `eventIndex` |
| `startTime` | `number \| null` | Timestamp of the first event, in nanoseconds |
| `size` | `number` | Length of the input text, in characters |

### `LogEvent`

Base class of every node.

| Field | Type | Meaning |
| --- | --- | --- |
| `type` | `LogEventType \| null` | `'METHOD_ENTRY'`, `'SOQL_EXECUTE_BEGIN'`, … `null` on the root |
| `text` | `string` | Display text built from the line's fields |
| `children` | `LogEvent[]` | Child events |
| `parent` | `LogEvent \| null` | Parent event |
| `timestamp` | `number` | Nanoseconds, from the log's own clock |
| `exitStamp` | `number \| null` | Nanoseconds, set when a matching exit line is found |
| `duration` | `SelfTotal` | `self` excludes children, `total` includes them |
| `eventIndex` | `number` | Unique, increasing, stable across a parse. Use it as an id |
| `lineNumber` | `LineNumber` | Source line in the Apex class, when the line reports one |
| `namespace` | `string` | Managed package namespace, or `'default'` |
| `category` | `LogCategory` | Timeline grouping, e.g. `'Method'`, `'DB'` |
| `debugCategory` | `DebugCategory` | The Salesforce log category, e.g. `'Apex Code'` |
| `debugLevel` | `LogLevel` | The level the line is emitted at, e.g. `'FINE'` |
| `cpuType` | `CPUType` | `'method'`, `'custom'`, `'loading'`, … |
| `isTruncated` | `boolean` | The log ended before the matching exit line |
| `discontinuity` | `boolean` | This line broke the call stack, e.g. an exception |

Counters, all `SelfTotal` so you can read either one node or a whole subtree:

`soqlCount`, `soqlRowCount`, `dmlCount`, `dmlRowCount`, `soslCount`, `soslRowCount`,
`thrownCount`, `heapAllocated`, `heapGross`. Plus `heapPeak`, a plain `number`.

### Event classes

The parser has a dedicated class for 171 event types, and falls back to `BasicLogLine` or
`BasicExitLine` for the rest. Ten of those classes are exported, for `instanceof` narrowing:

`ApexLog`, `CodeUnitStartedLine`, `DMLBeginLine`, `ExecutionStartedLine`, `HeapAllocateLine`,
`LimitUsageLine`, `LogEvent`, `MethodEntryLine`, `SOQLExecuteBeginLine`,
`SOQLExecuteExplainLine`.

```typescript
import { MethodEntryLine, SOQLExecuteBeginLine, parse } from '@apexdevtools/apex-log-parser';

for (const event of parse(logText).children) {
  if (event instanceof MethodEntryLine) {
    console.log('Method:', event.text, 'line', event.lineNumber);
  }
  if (event instanceof SOQLExecuteBeginLine) {
    console.log('SOQL:', event.text, event.soqlRowCount.total, 'rows');
  }
}
```

For any other event type, compare `event.type` as a string. It is typed as `LogEventType`, a
union of every known event name, so the compiler still catches a typo:

```typescript
if (event.type === 'EXCEPTION_THROWN') {
  console.log(event.text);
}
```

### Governor limits

`log.governorLimits` holds 13 metrics, each `{ used, limit }`:

`soqlQueries`, `soslQueries`, `queryRows`, `dmlStatements`, `publishImmediateDml`, `dmlRows`,
`cpuTime`, `heapSize`, `callouts`, `emailInvocations`, `futureCalls`, `queueableJobsAddedToQueue`,
`mobileApexPushCalls`.

It also carries `byNamespace: Map<string, Limits>` and `snapshots: GovernorSnapshot[]`, a
point-in-time record of each limit block as the transaction ran.

Individual limit lines expose their own reading. `LimitUsageLine` and the flow limit events have
`limitUsage: LimitObservation | null`, which is `{ metric, used, limit }` — `metric` being one of
the 13 keys above.

### Types and constants

Exported types: `CPUType`, `DebugCategory`, `GovernorLimits`, `GovernorSnapshot`, `IssueType`,
`Limits`, `LineNumber`, `LogCategory`, `LogEventType`, `LogIssue`, `LogLevel`, `LogSubCategory`,
`SelfTotal`, `LimitMetricKey`, `LimitObservation`.

`LogSubCategory` is deprecated — use `LogCategory`.

Exported values: `DebugLevel` (a class, `{ logCategory, logLevel }`), and the constants
`ALL_LOG_CATEGORIES`, `DEBUG_CATEGORY`, `LOG_CATEGORY`, `LOG_LEVEL`.

```typescript
import { DEBUG_CATEGORY, LOG_CATEGORY, LOG_LEVEL } from '@apexdevtools/apex-log-parser';
```

## Errors

`parse()` throws on a line it cannot read at all — a bad timestamp, line number or row count.
Wrap the call if the log comes from an untrusted source.

Everything softer is collected rather than thrown, and the two collections mean different things:

- `log.parsingErrors` — lines the parser did not understand. A parser problem.
- `log.logIssues` — problems in the transaction the log describes, such as a truncated log or an
  unexpected exit. Each is a `LogIssue` with `summary`, `description`, `type` and, when known,
  `startTime`, `endTime` and `eventIndex`.

```typescript
try {
  const log = parse(logText);
  if (log.parsingErrors.length) {
    console.warn('Parser could not read some lines:', log.parsingErrors);
  }
  for (const issue of log.logIssues) {
    console.warn(issue.type, issue.summary);
  }
} catch (err) {
  console.error('Log is not parseable:', err);
}
```

## Examples

### Find the slowest methods

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

console.table(findSlowest(parse(logText)));
```

### Count SOQL and DML

The root already aggregates the whole tree, so no walk is needed:

```typescript
import { parse } from '@apexdevtools/apex-log-parser';

const log = parse(logText);

console.log(`SOQL: ${log.soqlCount.total} queries, ${log.soqlRowCount.total} rows`);
console.log(`DML:  ${log.dmlCount.total} statements, ${log.dmlRowCount.total} rows`);
```

For the sample log above this prints `SOQL: 1 queries, 50 rows` and `DML: 1 statements, 50 rows`.

### Check governor limits

```typescript
import { parse } from '@apexdevtools/apex-log-parser';

const limits = parse(logText).governorLimits;

console.table({
  cpu: `${limits.cpuTime.used}/${limits.cpuTime.limit}ms`,
  soql: `${limits.soqlQueries.used}/${limits.soqlQueries.limit}`,
  dml: `${limits.dmlStatements.used}/${limits.dmlStatements.limit}`,
  heap: `${limits.heapSize.used}/${limits.heapSize.limit} bytes`,
});
```

### Limits per namespace

```typescript
import { parse } from '@apexdevtools/apex-log-parser';

const log = parse(logText);

for (const [namespace, limits] of log.governorLimits.byNamespace) {
  console.log(namespace, limits.soqlQueries.used, 'queries');
}
```

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

## Stability

This package is at 0.x. The API is in use by the Apex Log Analyzer and is not expected to churn,
but minor versions may still make breaking changes until 1.0.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, coding standards, and the PR process.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) or the [GitHub Releases](https://github.com/apex-dev-tools/apex-log-parser/releases) for version history.

## License

BSD-3-Clause - [Certinia Inc.](https://certinia.com)
