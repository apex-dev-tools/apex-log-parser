/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { LogBuffers } from '../api/buffers.js';
import { toBuffers } from '../api/buffers.js';
import { fromBuffers as browserFromBuffers } from '../browser.js';
import { fromBuffers as nodeFromBuffers, parse } from '../node.js';
import type { ApexLog } from '../views/log.js';
import { encode } from './helpers.js';

declare function structuredClone<T>(value: T, options?: { transfer: ArrayBuffer[] }): T;

const LIMITS = [
  '09:00:00.0 (900)|CUMULATIVE_LIMIT_USAGE',
  '09:00:00.0 (900)|LIMIT_USAGE_FOR_NS|(default)|',
  '  Number of SOQL queries: 1 out of 100',
  '  Number of query rows: 2 out of 50000',
  '  Maximum CPU time: 10 out of 10000',
  '  Maximum heap size: 100 out of 6000000',
  '09:00:00.0 (900)|CUMULATIVE_LIMIT_USAGE_END',
];

// Every part of a build: the header, namespaces, counts, heap, details, a flow running total,
// limits, a skipped block, a frame left open and a line the parser cannot read.
const LOG = [
  '64.0 APEX_CODE,FINE;APEX_PROFILING,INFO;CALLOUT,INFO;DB,INFO;SYSTEM,DEBUG;WORKFLOW,INFO',
  '09:15:30.25 (1)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com|(GMT-08:00) Pacific Standard Time (America/Los_Angeles)|GMT-08:00',
  '09:00:00.0 (10)|EXECUTION_STARTED',
  '09:00:00.0 (20)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000AAA|ns.MyClass.run()',
  '09:00:00.0 (30)|ENTERING_MANAGED_PKG|ns',
  '09:00:00.0 (40)|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()',
  '09:00:00.0 (50)|SOQL_EXECUTE_BEGIN|[2]|Aggregations:1|SELECT Id FROM MyObject__c',
  '09:00:00.0 (55)|SOQL_EXECUTE_EXPLAIN|[2]|TableScan on MyObject__c : [], cardinality: 1, sobjectCardinality: 1, relativeCost 1.3',
  '09:00:00.0 (60)|SOQL_EXECUTE_END|[2]|Rows:2',
  '09:00:00.0 (70)|HEAP_ALLOCATE|[3]|Bytes:64',
  '09:00:00.0 (80)|USER_DEBUG|[4]|DEBUG|café ☕',
  'a line that continues the debug text',
  '09:00:00.0 (90)|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()',
  '09:00:00.0 (100)|FLOW_ELEMENT_BEGIN|abc-1|FlowRecordUpdate|Update_Account',
  '09:00:00.0 (110)|FLOW_ELEMENT_LIMIT_USAGE|1 DML statements, total 1 out of 150',
  '09:00:00.0 (120)|FLOW_ELEMENT_END|abc-1|FlowRecordUpdate|Update_Account',
  ...LIMITS,
  '*** Skipped 1,024 bytes of detailed log',
  '09:00:00.0 (1000)|NOT_A_REAL_EVENT|x',
  '09:00:00.0 (1100)|METHOD_ENTRY|[5]|01p000000000AAA|ns.MyClass.last()',
].join('\n');

/** Everything a log states through the views, as plain values. */
function summary(log: ApexLog): unknown {
  const ids = (events: readonly { id: number }[]) => events.map((e) => e.id);
  return {
    events: [...log.events].map((e) => ({
      id: e.id,
      type: e.type,
      parent: e.parent?.id ?? null,
      text: e.text,
      logLine: e.logLine,
      lineNumber: e.lineNumber,
      namespace: e.namespace,
      details: e.details,
      suffix: e.suffix,
      cpuType: e.cpuType,
      duration: e.duration,
      soqlRowCount: e.soqlRowCount,
      dmlCount: e.dmlCount,
      heapAllocated: e.heapAllocated,
      heapPeak: e.heapPeak,
      isTruncated: e.isTruncated,
      exitStamp: e.exitStamp,
    })),
    columns: Object.fromEntries(Object.entries(log.columns).map(([k, v]) => [k, [...v]])),
    size: log.size,
    startTime: log.startTime,
    executionEndTime: log.executionEndTime,
    isTruncated: log.isTruncated,
    truncation: {
      ...log.truncation,
      regions: log.truncation.regions.map((r) => ({ ...r, event: r.event?.id ?? null })),
    },
    truncatedEvents: ids(log.truncatedEvents),
    issues: log.issues.map((i) => ({ ...i, event: i.event?.id ?? null })),
    parsingErrors: log.parsingErrors,
    limits: log.limits,
    namespaces: log.namespaces,
    exceptions: ids(log.exceptions),
    entryPoints: ids(log.entryPoints),
    userInfo: log.userInfo,
    debugLevels: log.debugLevels,
    debugLevelSettings: log.debugLevelSettings,
    dmlCount: log.dmlCount,
    heapPeak: log.heapPeak,
  };
}

/** The parts of `LogBuffers.data` the tests break. */
interface Data {
  store: Record<string, unknown>;
  strings: Record<string, unknown>;
}

/** `log` moved through `postMessage`'s clone, as to another thread. */
function moved(log: ApexLog): LogBuffers {
  const { buffers, transfer } = toBuffers(log);
  return structuredClone(buffers, { transfer });
}

it('the fixture states every part of a build', async () => {
  const log = await parse(LOG);
  expect(log.userInfo).not.toBeNull();
  expect(log.namespaces).toEqual(['ns']);
  expect(log.limits.snapshots).toHaveLength(1);
  expect(log.issues.map((i) => i.summary)).toContain('Skipped-Lines');
  expect(log.truncation.regions).toHaveLength(1);
  expect(log.truncatedEvents.length).toBeGreaterThan(0);
  expect(log.parsingErrors).toHaveLength(1);
  expect(log.heapPeak).toBeGreaterThan(0);
  expect(log.ofType('FLOW_ELEMENT_BEGIN')[0]?.dmlCount.self).toBe(1);
  expect(log.ofType('SOQL_EXECUTE_EXPLAIN')[0]?.details).not.toBeNull();
});

describe.each([
  ['node', nodeFromBuffers],
  ['browser', browserFromBuffers],
])('toBuffers, then the %s build’s fromBuffers', (_build, fromBuffers) => {
  it('reads the same log after a move', async () => {
    const expected = summary(await parse(LOG));
    expect(summary(fromBuffers(moved(await parse(LOG))))).toEqual(expected);
  });

  it('reads the same log with no move, sharing its memory', async () => {
    const log = await parse(LOG);
    const again = fromBuffers(toBuffers(log).buffers);
    expect(summary(again)).toEqual(summary(log));
    expect(again.columns.type.buffer).toBe(log.columns.type.buffer);
  });

  it('reads a log with no events', async () => {
    const expected = summary(await parse(''));
    expect(summary(fromBuffers(moved(await parse(''))))).toEqual(expected);
  });

  it('rejects data toBuffers did not make', async () => {
    const { buffers } = toBuffers(await parse(LOG));
    expect(() => fromBuffers({} as LogBuffers)).toThrow('Not buffers that toBuffers made');
    expect(() => fromBuffers({ ...buffers, version: 0 })).toThrow('this version reads 1');
    const data = buffers.data as { store: { typeCount: number } };
    const otherCatalog = { ...data, store: { ...data.store, typeCount: 3 } };
    expect(() => fromBuffers({ ...buffers, data: otherCatalog })).toThrow('another event catalog');
  });

  it.each([
    ['no bytes', (d: Data) => ({ ...d, bytes: [] })],
    ['no string table', (d: Data) => ({ ...d, strings: undefined })],
    ['no rows', (d: Data) => ({ ...d, store: { ...d.store, count: 0 } })],
    ['a short pool', (d: Data) => ({ ...d, store: { ...d.store, counts: new Int32Array(0) } })],
    [
      'string ranges of the wrong kind',
      (d: Data) => ({ ...d, strings: { ...d.strings, starts: [] } }),
    ],
  ])('rejects data with %s', async (_what, broken) => {
    const { buffers } = toBuffers(await parse(LOG));
    const data = broken(buffers.data as Data);
    expect(() => fromBuffers({ ...buffers, data })).toThrow(TypeError);
  });

  it('rejects a column of the wrong kind', async () => {
    const { buffers } = toBuffers(await parse(LOG));
    const data = buffers.data as { store: { columns: unknown[] } };
    const columns = [...data.store.columns];
    columns[0] = new Float64Array((columns[0] as Uint16Array).length);
    const wrong = { ...data, store: { ...data.store, columns } };
    expect(() => fromBuffers({ ...buffers, data: wrong })).toThrow(TypeError);
  });
});

describe('toBuffers', () => {
  it('moves every buffer of the log, the source included, and leaves the log unreadable', async () => {
    const bytes = encode(LOG);
    const log = await parse(bytes);
    const { transfer } = toBuffers(log);
    expect(transfer).toContain(bytes.buffer);
    structuredClone(null, { transfer });
    expect(bytes.byteLength).toBe(0);
    expect(log.columns.type.length).toBe(0);
  });

  it('keeps a source that shares its buffer, as a pooled Buffer does, out of the move', async () => {
    const pool = new Uint8Array(LOG.length * 4);
    const encoded = encode(LOG);
    pool.set(encoded, 16);
    const log = await parse(pool.subarray(16, 16 + encoded.length));
    expect(toBuffers(log).transfer).not.toContain(pool.buffer);
  });

  it('moves bytes the parse made even when they are part of their buffer', async () => {
    // A response that states more than it sends leaves the log a part of the buffer read into.
    const encoded = encode(LOG);
    let sent = false;
    const body = {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true as const };
          sent = true;
          return { done: false as const, value: encoded };
        },
        cancel: async () => undefined,
        releaseLock: () => undefined,
      }),
    };
    const response = {
      ok: true,
      status: 200,
      bodyUsed: false,
      headers: {
        get: (name: string) => (name === 'content-length' ? String(encoded.length + 64) : null),
      },
      body,
    };
    const { buffers, transfer } = toBuffers(await parse(response));
    const bytes = (buffers.data as { bytes: Uint8Array }).bytes;
    expect(bytes.byteLength).toBeLessThan(bytes.buffer.byteLength);
    expect(transfer).toContain(bytes.buffer);
  });

  it('rejects an object that parse did not make', () => {
    expect(() => toBuffers({} as ApexLog)).toThrow('Not a log that parse made');
  });
});
