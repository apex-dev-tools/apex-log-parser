# @apex-dev-tools/apex-log-parser

[![npm version](https://img.shields.io/npm/v/@apex-dev-tools/apex-log-parser)](https://www.npmjs.com/package/@apex-dev-tools/apex-log-parser)
[![npm downloads](https://img.shields.io/npm/dm/@apex-dev-tools/apex-log-parser)](https://www.npmjs.com/package/@apex-dev-tools/apex-log-parser)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@apex-dev-tools/apex-log-parser)](https://bundlephobia.com/package/@apex-dev-tools/apex-log-parser)
[![CI](https://github.com/apex-dev-tools/apex-debug-log-parser/actions/workflows/ci.yml/badge.svg)](https://github.com/apex-dev-tools/apex-debug-log-parser/actions/workflows/ci.yml)
[![License: BSD-3-Clause](https://img.shields.io/badge/License-BSD_3--Clause-blue.svg)](./LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)

Parse Salesforce Apex debug logs into structured, navigable event trees with full TypeScript support.

Turn raw debug log text into a typed tree of 200+ event types, with computed execution times, governor limit tracking, SOQL/DML row counts, and managed package namespace detection.

> **Why this library?** It's the same parser that powers the [Apex Log Analyzer](https://github.com/certinia/debug-log-analyzer) VS Code extension — battle-tested on real-world logs, with zero runtime dependencies and a bundled database of documented Salesforce log events.

## Contents

- [Features](#features)
- [Install](#install)
- [Quick Start](#quick-start)
- [What You Get](#what-you-get)
- [API](#api)
- [Examples](#examples)
- [Event Database](#event-database)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## Features

- **200+ event types** parsed into strongly-typed classes (methods, SOQL, DML, flows, callouts, and more)
- **Hierarchical event tree** with parent/child relationships and automatic entry/exit matching
- **Execution timing** with self and total duration computed per node (nanosecond precision)
- **Governor limit tracking** with point-in-time snapshots per namespace
- **Per-line limit observations** — each `LIMIT_USAGE`/limit line exposed as a typed `{ metric, used, limit }` on the event
- **SOQL, DML, and SOSL row counts** aggregated up the call tree
- **Managed package namespace** detection and per-namespace metrics
- **Event database** of 299 documented Salesforce debug log event types bundled as JSON
- **Zero dependencies** and ESM-only

## Install

```bash
# pnpm
pnpm add @apex-dev-tools/apex-log-parser

# npm
npm install @apex-dev-tools/apex-log-parser

# yarn
yarn add @apex-dev-tools/apex-log-parser
```

## Quick Start

```typescript
import { parse } from '@apex-dev-tools/apex-log-parser';

// Parse a raw Apex debug log string
const log = parse(debugLogText);

// The result is a tree — walk it
for (const event of log.children) {
  console.log(event.type, event.text, `${event.duration.total}ns`);
}
```

## What You Get

The `parse()` function returns an `ApexLog` — the root of a tree where every node is a typed `LogEvent`:

```
ApexLog (root)
  .children[]           ← top-level events
  .duration.total       ← total execution time (ns)
  .governorLimits       ← final governor limit state

  LogEvent (each node)
    .type               ← "METHOD_ENTRY", "SOQL_EXECUTE_BEGIN", etc.
    .text               ← parsed display text
    .timestamp          ← nanosecond timestamp
    .duration.self      ← time in this node only
    .duration.total     ← time including children
    .children[]         ← child events
    .parent             ← parent event
    .namespace          ← managed package namespace
    .lineNumber         ← source line number
    .debugCategory      ← "Apex Code", "Database", etc.
    .debugLevel         ← "FINE", "INFO", "ERROR", etc.
    .soqlRowCount       ← { self, total } SOQL rows
    .dmlRowCount        ← { self, total } DML rows
    .cpuType            ← "method", "custom", "system", etc.
```

## API

### `parse(logData: string): ApexLog`

One-liner parse. Takes raw debug log text, returns the event tree.

```typescript
import { parse } from '@apex-dev-tools/apex-log-parser';

const log = parse(rawLogText);
```

### The `ApexLog` Result

`parse()` returns an `ApexLog` that exposes governor limits, parsing issues, and detected namespaces directly — no separate parser object needed.

```typescript
import { parse } from '@apex-dev-tools/apex-log-parser';

const log = parse(rawLogText);

console.log(log.governorLimits.cpuTime);    // { used: 1234, limit: 10000 }
console.log(log.governorLimits.soqlQueries); // { used: 5, limit: 100 }
console.log(log.logIssues);                  // any parsing warnings
console.log(log.namespaces);                 // array of detected namespaces
```

### Event Types

Every parsed line becomes a typed subclass of `LogEvent`. You can use `instanceof` to narrow:

```typescript
import {
  parse,
  MethodEntryLine,
  SOQLExecuteBeginLine,
  DMLBeginLine,
} from '@apex-dev-tools/apex-log-parser';

const log = parse(rawLogText);

for (const event of log.children) {
  if (event instanceof MethodEntryLine) {
    console.log('Method:', event.text, 'line', event.lineNumber);
  }
  if (event instanceof SOQLExecuteBeginLine) {
    console.log('SOQL:', event.text, event.soqlRowCount.total, 'rows');
  }
}
```

### Constants

```typescript
import {
  DEBUG_CATEGORY,  // { Database, Workflow, ApexCode, ... }
  LOG_CATEGORY,    // { Apex, System, DML, SOQL, Automation, ... }
  LOG_LEVEL,       // { Error, Warn, Info, Debug, Fine, Finer, Finest }
} from '@apex-dev-tools/apex-log-parser';
```

## Examples

### Find the Slowest Methods

```typescript
import { parse, MethodEntryLine } from '@apex-dev-tools/apex-log-parser';

function findSlowest(log, count = 10) {
  const methods = [];
  const stack = [...log.children];
  while (stack.length) {
    const node = stack.pop();
    if (node instanceof MethodEntryLine) {
      methods.push({ name: node.text, duration: node.duration.self });
    }
    stack.push(...node.children);
  }
  return methods.sort((a, b) => b.duration - a.duration).slice(0, count);
}

const log = parse(rawLogText);
console.table(findSlowest(log));
```

### Count SOQL Queries and DML Statements

```typescript
import { parse, SOQLExecuteBeginLine, DMLBeginLine } from '@apex-dev-tools/apex-log-parser';

const log = parse(rawLogText);
const stack = [...log.children];
let soqlCount = 0;
let dmlCount = 0;

while (stack.length) {
  const node = stack.pop();
  if (node instanceof SOQLExecuteBeginLine) soqlCount++;
  if (node instanceof DMLBeginLine) dmlCount++;
  stack.push(...node.children);
}

console.log(`SOQL: ${soqlCount}, DML: ${dmlCount}`);
```

### Check Governor Limits

```typescript
import { parse } from '@apex-dev-tools/apex-log-parser';

const log = parse(rawLogText);

const limits = log.governorLimits;
const usage = {
  cpu: `${limits.cpuTime.used}/${limits.cpuTime.limit}ms`,
  soql: `${limits.soqlQueries.used}/${limits.soqlQueries.limit}`,
  dml: `${limits.dmlStatements.used}/${limits.dmlStatements.limit}`,
  heap: `${limits.heapSize.used}/${limits.heapSize.limit} bytes`,
};

console.table(usage);
```

### Walk the Call Tree

```typescript
import { parse } from '@apex-dev-tools/apex-log-parser';

function printTree(node, depth = 0) {
  const indent = '  '.repeat(depth);
  const ms = (node.duration.total / 1_000_000).toFixed(2);
  console.log(`${indent}${node.type ?? 'ROOT'} ${node.text} (${ms}ms)`);
  for (const child of node.children) {
    printTree(child, depth + 1);
  }
}

const log = parse(rawLogText);
printTree(log);
```

## Event Database

This package includes a comprehensive database of 299 Salesforce debug log event types, sourced from official documentation and community research. Access it as a JSON import:

```typescript
import events from '@apex-dev-tools/apex-log-parser/data/events.json' with { type: 'json' };

// Each event has: name, category, level, fields, description, sources
for (const event of events.events) {
  console.log(event.event, event.category, event.level);
}
```

The database tracks:
- Event names, categories, and minimum log levels
- Field definitions for each event type
- Official vs community-discovered events
- Salesforce release tracking (when events were added/deprecated)
- Source attribution (official docs, community, manual testing)

## FAQ

### How do I parse a Salesforce Apex debug log in JavaScript/TypeScript?

Install `@apex-dev-tools/apex-log-parser` and call `parse()` with the raw log text. It returns a typed tree you can walk, filter, and analyze. See [Quick Start](#quick-start).

### What Apex debug log event types does this support?

The parser handles 200+ event types including `METHOD_ENTRY`/`EXIT`, `SOQL_EXECUTE_BEGIN`/`END`, `DML_BEGIN`/`END`, `CODE_UNIT_STARTED`/`FINISHED`, `FLOW_START_INTERVIEWS_BEGIN`, `CALLOUT_REQUEST`/`RESPONSE`, `EXCEPTION_THROWN`, `FATAL_ERROR`, and many more. The bundled [event database](#event-database) documents 299 known events.

### How do I analyze Salesforce governor limits programmatically?

Call `parse()` and read `log.governorLimits`. It contains SOQL queries, DML statements, CPU time, heap size, and more — with used/limit values and per-namespace snapshots. See [Check Governor Limits](#check-governor-limits).

### Does it handle managed package namespaces?

Yes. Each `LogEvent` has a `.namespace` property. The returned `ApexLog` lists all detected namespaces in `log.namespaces`, and governor limit snapshots are available per namespace via `log.governorLimits.byNamespace`.

### Does it work in the browser?

The parser is pure TypeScript with zero dependencies and targets ES2022. It works in any JavaScript runtime that supports ES modules (Node.js 20+, modern browsers, Deno, Bun).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for development setup, coding standards, and the PR process.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) or the [GitHub Releases](https://github.com/apex-dev-tools/apex-debug-log-parser/releases) for version history.

## License

BSD-3-Clause - [Certinia Inc.](https://certinia.com)
