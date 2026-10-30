# Apex Log Parser

[![npm version](https://img.shields.io/npm/v/@apexdevtools/apex-log-parser)](https://www.npmjs.com/package/@apexdevtools/apex-log-parser)
[![CI](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml/badge.svg)](https://github.com/apex-dev-tools/apex-log-parser/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](https://github.com/apex-dev-tools/apex-log-parser/blob/main/LICENSE)

Fast Apex log parser for Salesforce debug logs: a typed call tree with timings, governor limits
and SOQL/DML counts. TypeScript, Node.js and browser. No dependencies.

The parser behind the [Apex Log Analyzer](https://github.com/certinia/debug-log-analyzer) for
VS Code.

## Features

- **Fast.** A 20 MB log parses in 31 ms and holds 11 MB; 100 MB in 126 ms and 37 MB.
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

| Log size | v0.3           | v0.5          |
| -------- | -------------- | ------------- |
| 8 MB     | 84 ms, 77 MB   | 13 ms, 4 MB   |
| 20 MB    | 228 ms, 190 MB | 31 ms, 11 MB  |
| 50 MB    | 435 ms, 408 MB | 63 ms, 19 MB  |
| 100 MB   | 894 ms, 812 MB | 126 ms, 37 MB |

Synthetic logs, M4 Pro, Node.js 24. v0.5 is the median of 9 runs. The log is in memory before
the timer starts: bytes for v0.5, a string for v0.3. Memory is what the parsed log holds, without
the log itself.

Read, after the parse: a 100 MB real log, 432,000 events, median of 9 runs. A first read on a new
log makes the text or columns that the log keeps; a repeat read uses them again. First / repeat:

| Work                                       | Event objects | `log.columns` |
| ------------------------------------------ | ------------- | ------------- |
| Numbers only: depth, self time, SOQL count | 8 / 8 ms      | 2 / 1 ms      |
| Flame chart: tree walk, a label per frame  | 62 / 20 ms    | 46 / 2 ms     |
| Call tree: self time per method            | 56 / 16 ms    | 46 / 1 ms     |

The parse holds 27 MB. Reads add 0–2 MB through event objects, 4–6 MB through `columns` (27 MB
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
