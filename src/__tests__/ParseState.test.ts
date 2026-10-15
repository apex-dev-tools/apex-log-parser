/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { NodeSource } from '../bytes/node.js';
import { SourceEngine } from '../engine/engine.js';
import type { ApexLog } from '../views/log.js';
import { apexLog } from '../views/log.js';
import { encode, parse } from './helpers.js';

describe('ApexLog.startTime', () => {
  it.each([
    ['the first line', '10:29:24.6 (6329577)', 37764600],
    ['midnight as 0', '00:00:00.0 (100)', 0],
    ['the end of the day', '23:59:59.9 (100)', 86399900],
    ['a two-digit fraction as hundredths', '14:30:05.12 (100)', 52205120],
    ['a three-digit fraction as milliseconds', '14:30:05.123 (100)', 52205123],
  ])('reads %s', (_name, stamp, expected) => {
    const log = parse(`${stamp}|EXECUTION_STARTED\n${stamp}|EXECUTION_FINISHED\n`);
    expect(log.startTime).toBe(expected);
  });

  it('is null for a log with no lines', () => {
    expect(parse('').startTime).toBeNull();
  });
});

describe('state per build', () => {
  const logA =
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    '09:18:22.6 (200)|HEAP_ALLOCATE|[84]|Bytes:152\n' +
    '09:18:22.6 (300)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000000|MyClass.myMethod\n' +
    '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|\n' +
    '  Number of SOQL queries: 8 out of 100\n' +
    '09:18:22.6 (600)|CODE_UNIT_FINISHED|MyClass.myMethod\n' +
    '09:19:13.82 (2000)|EXECUTION_FINISHED\n';
  const logB =
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    '09:18:22.6 (300)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000000|myNS.Other.run\n' +
    '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(myNS)|\n' +
    '  Number of SOQL queries: 3 out of 100\n' +
    '09:18:22.6 (600)|CODE_UNIT_FINISHED|myNS.Other.run\n' +
    '09:19:13.82 (2000)|EXECUTION_FINISHED\n';
  const facts = (log: ApexLog) => ({
    snapshots: log.limits.snapshots.length,
    namespaces: log.namespaces,
    soql: log.limits.final.soqlQueries.used,
    heapPeak: log.heapPeak,
    events: log.eventCount,
  });
  const fresh = (text: string): ApexLog =>
    apexLog(new SourceEngine((bytes) => new NodeSource(bytes)).build(encode(text)));

  it('carries no state from one log to the next', () => {
    const first = facts(parse(logA));
    const second = facts(parse(logB));
    expect(first).toEqual(facts(fresh(logA)));
    expect(second).toEqual(facts(fresh(logB)));
    expect(second).toEqual({ snapshots: 1, namespaces: ['myNS'], soql: 3, heapPeak: 0, events: 3 });
  });

  it('builds the same log twice to the same figures', () => {
    expect(facts(parse(logA))).toEqual(facts(parse(logA)));
  });
});
