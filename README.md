# @apexdevtools/apex-log-parser

[![npm version](https://img.shields.io/npm/v/@apexdevtools/apex-log-parser)](https://www.npmjs.com/package/@apexdevtools/apex-log-parser)
[![npm downloads](https://img.shields.io/npm/dm/@apexdevtools/apex-log-parser)](https://www.npmjs.com/package/@apexdevtools/apex-log-parser)
[![CI](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml/badge.svg)](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](./LICENSE)

Turn a Salesforce Apex debug log into a typed event tree with execution timings, governor
limits and SOQL/DML counts. In Node and in the browser.

It is the parser behind the [Apex Log Analyzer](https://github.com/certinia/debug-log-analyzer)
VS Code extension and its [MCP server](https://github.com/certinia/debug-log-analyzer-mcp).

## Features

- **Fast and small.** On synthetic logs of 8 to 100 MB, it parses 5–8× faster than v0.3 and keeps
  6× less memory.
- **Responsive.** `parse` is async and works in time slices of 5 ms, so the page or the event
  loop stays responsive. Stop it with an `AbortSignal`, and follow it with `onProgress`.
- **Any source.** A string, bytes, a `Blob`, a `fetch` `Response`, a `ReadableStream` or an async
  iterable.
- **Node and browser builds**, with one API. An optional worker moves the parse off the main
  thread.
- **Every documented event type**, each with its kind of work (`kind`), its timeline group, its
  debug level and its extra values (`details`), such as a query's plan or whether a throw was
  caught.
- **An event tree** where each entry is matched to its exit, with self and total times in
  nanoseconds.
- **Counts up the tree**: SOQL, DML and SOSL statements and rows, exceptions and heap.
- **Governor limits** per namespace, with a snapshot for each limit block in the log.
- **No dependencies**, ESM only.

## Install

```bash
npm install @apexdevtools/apex-log-parser
```

## Quick start

Given this log:

```
64.0 APEX_CODE,FINE;APEX_PROFILING,FINEST;CALLOUT,NONE;DB,INFO;NBA,NONE;SYSTEM,NONE;VALIDATION,NONE;VISUALFORCE,NONE;WAVE,NONE;WORKFLOW,NONE
09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com|Greenwich Mean Time|GMTZ
09:18:22.6 (6574780)|EXECUTION_STARTED
09:18:22.6 (6600000)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000AAA|AccountService.refresh()
09:18:22.6 (7000000)|METHOD_ENTRY|[12]|01p000000000AAA|AccountService.loadAccounts()
09:18:22.6 (7100000)|SOQL_EXECUTE_BEGIN|[14]|Aggregations:0|SELECT Id, Name FROM Account WHERE Industry = :industry
09:18:22.6 (9100000)|SOQL_EXECUTE_END|[14]|Rows:50
09:18:22.6 (9200000)|METHOD_EXIT|[12]|01p000000000AAA|AccountService.loadAccounts()
09:18:22.6 (9300000)|DML_BEGIN|[20]|Op:Update|Type:Account|Rows:50
09:18:22.6 (9800000)|DML_END|[20]
09:18:22.6 (9900000)|CODE_UNIT_FINISHED|AccountService.refresh()
09:18:22.6 (10100000)|EXECUTION_FINISHED
```

This code:

```typescript
import { type ApexEvent, parse } from '@apexdevtools/apex-log-parser';

const ms = (ns: number): string => (ns / 1_000_000).toFixed(2);

function printTree(events: readonly ApexEvent[], depth = 0): void {
  for (const event of events) {
    console.log(`${'  '.repeat(depth)}${event.type} ${event.text ?? ''} (${ms(event.duration.total)}ms)`);
    if (event.isFrame) printTree(event.children, depth + 1);
  }
}

const log = await parse(logData);
console.log(`${log.eventCount} events, ${ms(log.duration.total)}ms`);
printTree(log.children);
```

Prints:

```
6 events, 3.59ms
USER_INFO 005000000000AAA user@example.com (0.00ms)
EXECUTION_STARTED  (3.53ms)
  CODE_UNIT_STARTED AccountService.refresh() (3.30ms)
    METHOD_ENTRY AccountService.loadAccounts() (2.20ms)
      SOQL_EXECUTE_BEGIN SELECT Id, Name FROM Account WHERE Industry = :industry (2.00ms)
    DML_BEGIN DML Op:Update Type:Account (0.50ms)
```

Note the shape:

- `parse()` returns the log, `ApexLog`. Its `children` are the events at the top of the log.
- A frame (`isFrame: true`) spans time and has `children`. A leaf is one point in time, and its
  `children` is always empty.
- `METHOD_EXIT`, `SOQL_EXECUTE_END` and `DML_END` are not events of their own. Each closes its
  matching entry and sets that event's `exitStamp` and `duration`.
- `text` is null when the line states nothing, as for `EXECUTION_STARTED`. Use `text ?? type` for
  a label.

## Summarise a transaction

The log sums the whole tree, so SOQL and DML totals need no walk. Governor limits are on the log
too: `final` is what the transaction had used when the log ended, and `peak` is the highest each
metric reached. Check `peak` against a limit, because counters can fall mid-log.

`ofType` gives every event of the types you name, typed by its type. To rank methods, sort on
`duration.self`. It excludes children, so it measures the time spent in the method itself, not in
what it called.

```typescript
const log = await parse(logData);
const { final, peak } = log.limits;

console.log(`SOQL: ${log.soqlCount.total} queries, ${log.soqlRowCount.total} rows`);
console.log(`DML:  ${log.dmlCount.total} statements, ${log.dmlRowCount.total} rows`);
console.log(`CPU:  ${final.cpuTime.used}/${final.cpuTime.limit}ms`);
console.log(`SOQL: ${peak.soqlQueries.used} at peak (${peak.soqlQueries.percentUsed}%)`);

const methods = [...log.ofType('METHOD_ENTRY')].sort((a, b) => b.duration.self - a.duration.self);
console.table(methods.slice(0, 10).map((m) => ({ method: m.text, selfNs: m.duration.self })));

for (const query of log.ofType('SOQL_EXECUTE_BEGIN')) {
  // details is typed by the event type: here the aggregations, and the plan when the log states one.
  console.log(query.lineNumber, query.soqlRowCount.self, query.details.explain?.relativeCost);
}
```

## In the browser

The browser build has the same API. Pass the `fetch` response, so the parse reads the body as it
arrives:

```typescript
import { parse } from '@apexdevtools/apex-log-parser';

const log = await parse(await fetch(logUrl));
```

## Large logs

`parse` yields to the host between slices. For a progress bar and a cancel button:

```typescript
const controller = new AbortController();
const log = await parse(file, {
  signal: controller.signal,
  onProgress: ({ phase, bytes, totalBytes }) => updateBar(phase, bytes, totalBytes),
});
```

`totalBytes` is null when the source does not state its length. An abort rejects the promise with
the signal's reason within one slice.

### Parse in a worker

For more speed and a clear main thread, the `worker` option runs the parse in a worker. The read
stays on your thread, and the bytes move to the worker. It pays for logs of a few MB and up: a
small log parses faster on the main thread.

The worker runs `@apexdevtools/apex-log-parser/worker`. In Node:

```typescript
import { Worker } from 'node:worker_threads';

const worker = new Worker(new URL(import.meta.resolve('@apexdevtools/apex-log-parser/worker')));
const log = await parse(bytes, { worker });
```

In a browser, serve that file and start a `Worker` from it. It is one classic script with no
imports, so where a page cannot start a worker from a URL, as in a VS Code webview, start it from
a `blob:` URL:

```typescript
const script = await (await fetch(workerFileUrl)).text();
const worker = new Worker(URL.createObjectURL(new Blob([script], { type: 'text/javascript' })));
const log = await parse(await fetch(logUrl), { worker });
```

One worker can run many parses, one after another. Bytes that you hold are copied, so you keep
them.

### Move a log between threads

`toBuffers` turns a parsed log into buffers that `postMessage` moves without a copy, and
`fromBuffers` opens them on the other side. Both sides must use the same version of this package.

```typescript
import { fromBuffers, toBuffers } from '@apexdevtools/apex-log-parser';

const { buffers, transfer } = toBuffers(log);
port.postMessage(buffers, transfer);

// On the other thread:
const log = fromBuffers(message.data);
```

### Read every event

For a flame chart or other work over every event, `columns` gives the tree links and times as
typed arrays indexed by id, with no object per event:

```typescript
const { type, depth, timestamp, durationTotal } = log.columns;
for (let id = 1; id <= log.eventCount; id++) {
  // eventType(type[id]) gives the type's name, category and kind.
  draw(type[id], depth[id], timestamp[id], durationTotal[id]);
}
```

## API

Everything comes from the package root: `parse`, `toBuffers`, `fromBuffers`, the event catalog
(`EVENT_TYPES`, `eventType`), every type, and the const companions that go with them
(`CATEGORY`, `CPU_TYPE`, `DEBUG_CATEGORY`, `EVENT_TYPE_NAMES`, `ISSUE_TYPE`, `KIND`, `LEVEL`,
`LIMIT_UNIT`, `PARSE_PHASE`, `SHAPE`, `TRUNCATION_KIND`). `DEBUG_CATEGORY_TOKEN` gives the header
token of each debug category, and `LIMIT_METRICS` gives the unit of each limit metric:

```typescript
import { eventType, parse, type ApexLog } from '@apexdevtools/apex-log-parser';
```

`ApexLog` is the log. Besides its rollups and `children`, it has `event(id)`, `ofType()`, `at(ns)`,
`columns`, `limits`, `namespaces`, `debugLevels`, `debugLevelSettings`, `userInfo`, `entryPoints`,
`exceptions`, `truncation`, `truncatedEvents`, `issues` and `parsingErrors`.

The type declarations in the package document every field, event type and type, so your editor
shows them.

## Tips

**Capture the log at the right levels.** The parser reports what the log contains. A log captured
at a low level is missing whole categories of line, and the matching fields stay empty. This is
the most common surprise:

| You want | The log needs |
| --- | --- |
| `duration` on method events | `APEX_CODE` at `FINE` or above, plus `APEX_PROFILING` |
| `limits` | `APEX_PROFILING` at `FINE` or above, which writes the `CUMULATIVE_LIMIT_USAGE` block |
| SOQL and DML events | `DB` at `INFO` or above |
| Flow and Process Builder limit lines | `WORKFLOW` at `FINER` |

**All-zero limits mean "not reported".** Without a `LIMIT_USAGE_FOR_NS` block, every
`limits.final` and `limits.peak` metric stays at `{ used: 0, limit: null, percentUsed: null }`. That
is not a transaction that used nothing.

**Read totals from the log.** It already sums the tree, so you do not need to walk it to count
SOQL or DML.

**Use `id` as a key within one parse.** Ids start at 1 and follow log order. `event(id)` gives the
same object on every call, so an event also works as a `WeakMap` key. Ids are not stable across
parses.

**Two lists, two meanings.** `parsingErrors` holds lines the parser could not read, which is a
parser problem. `issues` holds problems in the transaction the log describes, such as a truncated
log or an unexpected exit.

**Null means "not stated".** A value the log does not state is `null`, never `0` or `''`, so you
can tell the two apart.

## Requirements

- **Node.js 22 or later.** The `worker` option needs Node 22.3 or later in Node.
- **Modern browsers**, Deno and Bun. The package targets ES2022, reads no files and makes no
  network calls of its own.
- **ESM only.** There is no CommonJS build, so `require()` does not work.
- **TypeScript declarations ship with the package.** No `@types` install is needed.

**Tests under jsdom**, as in Jest's `jsdom` environment, do not have all the globals the parser
uses. Both builds need `structuredClone`. The Node build needs `setImmediate`. The browser build
needs `MessageChannel` where `scheduler.yield` is not available. Add the missing ones in a setup
file. For the Node build:

```typescript
import { setImmediate } from 'node:timers';
import { deserialize, serialize } from 'node:v8';

globalThis.setImmediate ??= setImmediate;
globalThis.structuredClone ??= (value) => deserialize(serialize(value));
```

To upgrade from v0, see the v1 entry in the [CHANGELOG](./CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, coding standards, and the PR process.

## License

BSD-3-Clause - [Certinia Inc.](https://certinia.com)
