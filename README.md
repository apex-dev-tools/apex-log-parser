# Apex Log Parser

[![npm version](https://img.shields.io/npm/v/@apexdevtools/apex-log-parser)](https://www.npmjs.com/package/@apexdevtools/apex-log-parser)
[![npm downloads](https://img.shields.io/npm/dm/@apexdevtools/apex-log-parser)](https://www.npmjs.com/package/@apexdevtools/apex-log-parser)
[![CI](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml/badge.svg)](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](https://github.com/apex-dev-tools/apex-log-parser/blob/main/LICENSE)

Fast Apex log parser for Salesforce debug logs: a typed call tree with timings, governor limits
and SOQL/DML counts. TypeScript, Node.js and browser.

It parses a 100 MB log in 131 ms and holds 37 MB of memory, with no dependencies.

It is the parser behind the [Apex Log Analyzer](https://github.com/certinia/debug-log-analyzer)
VS Code extension and its [MCP server](https://github.com/certinia/debug-log-analyzer-mcp).

## Features

- **Fast and small.** A 100 MB log parses in 131 ms vs 829 ms in v0.3 (6× faster), and holds
  37 MB vs 812 MB (22× less). See [Performance](#performance).
- **Responsive.** `parse` is async and works in time slices of 5 ms. It takes an `AbortSignal`
  and an `onProgress` callback, and can run in a worker.
- **Any source.** A string, bytes, a `Blob`, a `fetch` `Response`, a `ReadableStream` or an async
  iterable.
- **Every documented event type**, each with its kind of work (`kind`), its debug level and its
  extra values (`details`), such as a query's plan or whether a throw was caught.
- **An event tree** where each entry is matched to its exit, with self and total times in
  nanoseconds.
- **Variables** that each event of a `FINEST` log could see, as the log recorded them, and the
  object at any address the log writes.
- **Counts up the tree**: SOQL, DML and SOSL statements and rows, exceptions and heap.
- **Governor limits** per namespace, with a snapshot for each limit block in the log.

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
USER_INFO user@example.com : 005000000000AAA (0.00ms)
EXECUTION_STARTED  (3.53ms)
  CODE_UNIT_STARTED AccountService.refresh() (3.30ms)
    METHOD_ENTRY AccountService.loadAccounts() (2.20ms)
      SOQL_EXECUTE_BEGIN SELECT Id, Name FROM Account WHERE Industry = :industry (2.00ms)
    DML_BEGIN DML Op:Update Type:Account (0.50ms)
```

Note the shape:

- A frame (`isFrame: true`) spans time and has `children`. A leaf is one point in time, and its
  `children` is always empty.
- `METHOD_EXIT`, `SOQL_EXECUTE_END` and `DML_END` are not events of their own. Each closes its
  matching entry and sets that event's `duration`.
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

// null when the log's debug levels did not record these lines.
console.log(`SOQL: ${log.soqlCount?.total} queries, ${log.soqlRowCount?.total} rows`);
console.log(`DML:  ${log.dmlCount?.total} statements, ${log.dmlRowCount?.total} rows`);
console.log(`CPU:  ${final.cpuTime.used}/${final.cpuTime.limit}ms`);
console.log(`SOQL: ${peak.soqlQueries.used} at peak (${peak.soqlQueries.percentUsed}%)`);

const methods = [...log.ofType('METHOD_ENTRY')].sort((a, b) => b.duration.self - a.duration.self);
console.table(methods.slice(0, 10).map((m) => ({ method: m.text, selfNs: m.duration.self })));

for (const query of log.ofType('SOQL_EXECUTE_BEGIN')) {
  // details is typed by the event type: here the aggregations, and the plan when the log states one.
  // soqlRowCount is null for a query with no end line, as one an exception stopped.
  console.log(query.lineNumber, query.soqlRowCount?.self, query.details.explain?.relativeCost);
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
const { type, depth, startTimestamp, durationTotal } = log.columns;
for (let id = 1; id <= log.eventCount; id++) {
  // eventType(type[id]) gives the type's name and kind.
  draw(type[id], depth[id], startTimestamp[id], durationTotal[id]);
}
```

## API

Everything comes from the package root: `parse`, `toBuffers`, `fromBuffers`, the event catalog
(`EVENT_TYPES`, `eventType`), every type and its const companion. The type declarations document
every field, so your editor shows them.

`ApexLog` is the log. Besides its rollups and `children`, it has `event(id)`, `ofType()`, `at(ns)`,
`columns`, `limits`, `namespaces`, `debugLevels`, `debugLevelSettings`, `userInfo`, `entryPoints`,
`exceptions`, `truncation`, `unclosedFrames`, `issues` and `parsingErrors`.

## Tips

**Capture the log at the right levels.** The parser reports what the log contains. A count or
heap figure the header's level does not record is `null`, not 0. This is the most common surprise:

| You want | The log needs |
| --- | --- |
| `duration` on method events | `APEX_CODE` at `FINE` or above, plus `APEX_PROFILING` |
| `limits` | `APEX_PROFILING` at `FINE` or above, which writes the `CUMULATIVE_LIMIT_USAGE` block |
| SOQL and DML events and counts | `DB` at `INFO` or above |
| `heapAllocated`, `heapGross`, `heapPeak` | `APEX_CODE` at `FINER` or above |
| Flow and Process Builder limit lines | `WORKFLOW` at `FINER` |

**All-zero limits mean "not reported".** Without a `LIMIT_USAGE_FOR_NS` block, every
`limits.final` and `limits.peak` metric stays at `{ used: 0, limit: null, percentUsed: null }`. That
is not a transaction that used nothing.

**Use `id` as a key within one parse.** Ids start at 1 and follow log order. Each read gives a new
event object, so the log holds no object per event: key a `Map` by `id`, not by the event. Ids are
not stable across parses.

**Two lists, two meanings.** `parsingErrors` holds lines the parser could not read, which is a
parser problem. `issues` holds problems in the transaction the log describes, such as a truncated
log or an unexpected exit.

## Performance

_Measured on a 12-core M4 Pro, 24 GB RAM, Node.js 24.22.1; v0.2 and v0.3 on 24.20.0._

Synthetic debug logs, the median of 5 runs. Each log is in memory before the timer
starts: as bytes for v0.4, and as a string for v0.2 and v0.3, which read only strings. Memory is
what the parsed log holds, without the log's own bytes or string.

Parse time:

| Log size | v0.2 | v0.3 | v0.4 |
| --- | --- | --- | --- |
| 8 MB | 106 ms | 86 ms | 15 ms |
| 20 MB | 274 ms | 221 ms | 33 ms |
| 50 MB | 550 ms | 426 ms | 66 ms |
| 75 MB | 831 ms | 632 ms | 99 ms |
| 100 MB | 1,116 ms | 829 ms | 131 ms |

Memory:

| Log size | v0.2 | v0.3 | v0.4 |
| --- | --- | --- | --- |
| 8 MB | 104 MB | 77 MB | 4 MB |
| 20 MB | 259 MB | 190 MB | 11 MB |
| 50 MB | 555 MB | 408 MB | 19 MB |
| 75 MB | 828 MB | 608 MB | 28 MB |
| 100 MB | 1,105 MB | 812 MB | 37 MB |

To measure on your machine, clone the repository and run `pnpm run bench:large`.

## Requirements

- **Node.js 22 or later.** The `worker` option needs Node 22.3 or later in Node.
- **Modern browsers**, Deno and Bun. The package targets ES2022, reads no files and makes no
  network calls of its own.
- **ESM only.** There is no CommonJS build, so `require()` does not work.
- **TypeScript declarations ship with the package.** No `@types` install is needed.

**Tests under jsdom**, as in Jest's `jsdom` environment, lack globals the parser uses. Add them in
a setup file: `structuredClone` for both builds, `setImmediate` for the Node build, and
`MessageChannel` for the browser build where `scheduler.yield` is not available.

To upgrade from a version before 0.4, see the 0.4.0 entry in the [CHANGELOG](https://github.com/apex-dev-tools/apex-log-parser/blob/main/CHANGELOG.md).

## Contributing

See [CONTRIBUTING.md](https://github.com/apex-dev-tools/apex-log-parser/blob/main/CONTRIBUTING.md) for development setup, coding standards, and the PR process.

## License

BSD-3-Clause - [Certinia Inc.](https://certinia.com)
