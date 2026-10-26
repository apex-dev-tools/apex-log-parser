# Apex Log Parser

[![npm version](https://img.shields.io/npm/v/@apexdevtools/apex-log-parser)](https://www.npmjs.com/package/@apexdevtools/apex-log-parser)
[![CI](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml/badge.svg)](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](https://github.com/apex-dev-tools/apex-log-parser/blob/main/LICENSE)

Fast Apex log parser for Salesforce debug logs: a typed call tree with timings, governor limits
and SOQL/DML counts. TypeScript, Node.js and browser. No dependencies.

The parser behind the [Apex Log Analyzer](https://github.com/certinia/debug-log-analyzer) for
VS Code.

## Features

- **Fast.** A 100 MB log parses in 131 ms and holds 37 MB.
- **Any source.** A string, bytes, `Blob`, `fetch` `Response`, `ReadableStream` or async iterable.
- **Off the main thread.** Parses in 5 ms slices with `signal` and `onProgress`, or in a worker
  (`@apexdevtools/apex-log-parser/worker`).
- **Every documented event type**, matched to its exit, with self and total times in nanoseconds.
- **Counts up the tree:** SOQL, DML and SOSL statements and rows, exceptions and heap.
- **Governor limits** per namespace, with a snapshot for each limit block.
- **Variables** that each event of a `FINEST` log could see.
- **Column arrays** (`log.columns`) for fast repeated passes, as a flame chart or call tree.

## Performance

Parse:

| Log size | v0.2 | v0.3 | v0.4 |
| --- | --- | --- | --- |
| 8 MB | 106 ms, 104 MB | 86 ms, 77 MB | 15 ms, 4 MB |
| 20 MB | 274 ms, 259 MB | 221 ms, 190 MB | 33 ms, 11 MB |
| 50 MB | 550 ms, 555 MB | 426 ms, 408 MB | 66 ms, 19 MB |
| 100 MB | 1,116 ms, 1,105 MB | 829 ms, 812 MB | 131 ms, 37 MB |

Synthetic logs, median of 5 runs, M4 Pro, Node.js 24. The log is in memory before the timer
starts: bytes for v0.4, a string for v0.2 and v0.3. Memory is what the parsed log holds, without
the log itself.

Read, after the parse: a 95 MB real log, 432,000 events, first read / repeat read:

| Work | Event objects | `log.columns` |
| --- | --- | --- |
| Numbers only: depth, self time, SOQL count | 11 / 10 ms | 9 / 4 ms |
| Flame chart: tree walk, a label per frame | 108 / 26 ms | 87 / 16 ms |
| Call tree: self time per method | 117 / 36 ms | 83 / 5 ms |

The parse holds 25 MB. Reads add 0–2 MB through event objects, 3–6 MB through `columns` (26 MB
for every column). v0.3 held 761 MB.

## Usage

```bash
npm install @apexdevtools/apex-log-parser
```

```typescript
import { parse } from '@apexdevtools/apex-log-parser';

const log = await parse(logText);

// null when the log's debug levels did not record these lines.
console.log(`${log.soqlCount?.total} queries, ${log.dmlRowCount?.total} DML rows`);
console.log(`CPU: ${log.limits.final.cpuTime.used} ms`);

const slowest = [...log.ofType('METHOD_ENTRY')].sort((a, b) => b.duration.self - a.duration.self);
for (const method of slowest.slice(0, 10)) console.log(method.text, method.duration.self);
```

The type declarations document every field. Upgrading from v0.3 or earlier: see the
[CHANGELOG](https://github.com/apex-dev-tools/apex-log-parser/blob/main/CHANGELOG.md).

## Requirements

Node.js 22+ (the `worker` option needs 22.3+), modern browsers, Deno or Bun. ESM only.

## License

BSD-3-Clause - [Certinia Inc.](https://certinia.com)
