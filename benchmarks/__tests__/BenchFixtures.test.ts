/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { nodeEngine } from '../../src/next/engine/node.js';
import type { ApexEvent } from '../../src/next/views/events.js';
import type { ApexLog } from '../../src/next/views/log.js';
import { apexLog as logOf } from '../../src/next/views/log.js';
import { benchLogs, makeLog, profileLog, profileSettings } from '../fixtures/fixtures.js';
import type { LogShape, ProfileName } from '../fixtures/measure.js';
import { LogTally, profileBands } from '../fixtures/measure.js';
import profiles from '../fixtures/profiles.json' with { type: 'json' };

// A changed log changes what the benchmarks measure, so it must be deliberate.
const pinnedHashes: Record<string, string> = {
  'small 19 KB': '95cfd663',
  'developer 1 MB': '4a867894',
  'uncommon paths 500 KB': 'db316a77',
};

// FNV-1a, because src/ has no node:crypto.
function hash(text: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    value = Math.imul(value ^ text.charCodeAt(i), 0x01000193) >>> 0;
  }
  return value.toString(16).padStart(8, '0');
}

// The events that open a generator frame. A trigger's code unit is one too, unless its DML_BEGIN opened it.
const frameTypes = new Set(['METHOD_ENTRY', 'CONSTRUCTOR_ENTRY', 'DML_BEGIN']);

const parse = (log: string): ApexLog => logOf(nodeEngine.build(new TextEncoder().encode(log)));

function opensFrame(event: ApexEvent): boolean {
  if (frameTypes.has(event.type)) return true;
  return (
    event.type === 'CODE_UNIT_STARTED' &&
    !!event.text?.includes('__sfdc_trigger') &&
    event.parent?.type !== 'DML_BEGIN'
  );
}

function frameDepth(events: readonly ApexEvent[]): number {
  return events.reduce(
    (deepest, event) =>
      Math.max(
        deepest,
        (opensFrame(event) ? 1 : 0) + (event.isFrame ? frameDepth(event.children) : 0),
      ),
    0,
  );
}

const idPattern = /(?<![\w.])[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?(?![\w.])/g;

describe.each(Object.entries(benchLogs))('bench log %s', (name, options) => {
  // Built per block and released after it, so only one log is in memory at a time.
  let log = '';
  let apexLog: ApexLog;
  beforeAll(() => {
    log = makeLog(options);
    apexLog = parse(log);
  });
  afterAll(() => {
    log = '';
    apexLog = parse('');
  });

  it('parses with no errors, issues or unclosed events', () => {
    expect(apexLog.parsingErrors).toEqual([]);
    expect(apexLog.issues).toEqual([]);
    expect(apexLog.truncatedEvents).toEqual([]);
  });

  it('holds the events it is named for', () => {
    const types = new Set<string>([...apexLog.events].map((event) => event.type));
    expect(options.covers.filter((type) => !types.has(type))).toEqual([]);
  });

  it('has its pinned content', () => {
    expect(hash(log)).toBe(pinnedHashes[name]);
  });

  it('times every event after its opening slow call past 2^31 ns', () => {
    const early = [...apexLog.events].filter((event) => event.timestamp < 2 ** 31);
    expect(early.map((event) => event.type)).toEqual([
      'USER_INFO',
      'EXECUTION_STARTED',
      'CODE_UNIT_STARTED',
      'METHOD_ENTRY',
    ]);
  });

  it('nests its frames to maxDepth, and no deeper than a DML leaf below it', () => {
    const depth = frameDepth(apexLog.children);
    expect(depth).toBeGreaterThanOrEqual(options.maxDepth);
    expect(depth).toBeLessThanOrEqual(options.maxDepth + 1);
  });

  it('holds placeholder content only', () => {
    const badIds = new Set<string>();
    for (const [id] of log.matchAll(idPattern)) {
      if (/\d/.test(id) && !/^[a-zA-Z0-9]{3}0+[A-Z]{3}$/.test(id)) badIds.add(id);
    }
    expect([...badIds]).toEqual([]);
    // The one address is the USER_INFO header's.
    expect(log.split('@').length).toBe(2);
    expect(log).toContain('|user@example.com|');
    expect([...apexLog.namespaces]).toEqual(['ns']);
  });

  it.runIf(options.mix.userDebugWrapped)('wraps USER_DEBUG text', () => {
    expect(
      [...apexLog.events].some(
        (event) => event.type === 'USER_DEBUG' && !!event.text?.includes('\n'),
      ),
    ).toBe(true);
  });

  it.runIf(options.crlf)('ends every line with CRLF', () => {
    expect(/(?<!\r)\n/.test(log)).toBe(false);
  });

  it.runIf((options.executions ?? 1) > 1)('holds each execution', () => {
    expect(apexLog.children.filter((event) => event.type === 'EXECUTION_STARTED').length).toBe(
      options.executions,
    );
  });
});

// A size inside each band, where its rare long blocks average out.
const profileChars: Record<ProfileName, number> = {
  small: 500_000,
  developer: 5_000_000,
  large: profileBands.large,
};

// Similar to the real logs of the band, not equal: the bench must stress the same paths.
describe.each(Object.keys(profileSettings) as ProfileName[])('profile %s', (name) => {
  const real = profiles[name];
  let synthetic: LogShape;
  beforeAll(() => {
    const tally = new LogTally();
    tally.add(makeLog(profileLog(name, 1, profileChars[name])));
    synthetic = tally.shape();
  });

  // As a set: an entry and its exit tie in a synthetic log, so their order is arbitrary.
  it('has the same 8 most frequent events', () => {
    const top = (weights: Record<string, number>) => Object.keys(weights).slice(0, 8).sort();
    expect(top(synthetic.weights)).toEqual(top(real.weights));
  });

  it('holds each event within 1.5x of its real share, for every event over 0.5% in either', () => {
    const floor = 5_000;
    const realWeights: Record<string, number> = real.weights;
    const types = new Set([...Object.keys(realWeights), ...Object.keys(synthetic.weights)]);
    const outside = [...types].filter((type) => {
      const want = realWeights[type] ?? 0;
      const got = synthetic.weights[type] ?? 0;
      return Math.max(want, got) >= floor && (got > want * 1.5 || got < want / 1.5);
    });
    expect(outside).toEqual([]);
  });

  it('is within 15% on line length and depth, and 4 points on wrapped lines', () => {
    expect(Math.abs(synthetic.charsPerEvent / real.charsPerEvent - 1)).toBeLessThan(0.15);
    expect(Math.abs(synthetic.meanDepth / real.meanDepth - 1)).toBeLessThan(0.15);
    expect(Math.abs(synthetic.wrappedLinePercent - real.wrappedLinePercent)).toBeLessThan(4);
  });
});
