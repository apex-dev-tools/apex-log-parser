/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent } from '../views/events.js';
import type { ApexLog } from '../views/log.js';
import { at, logOf } from './helpers.js';

/** The first event whose line holds `text`. */
function eventWith(log: ApexLog, text: string): ApexEvent {
  const found = [...log.events].find((e) => e.logLine.includes(text));
  if (!found) throw new Error(`No line holds ${text}`);
  return found;
}

const names = (event: ApexEvent): string[] | undefined =>
  event.variables?.locals.map((v) => v.name);

const OUTER = [
  `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`,
  `${at(1100)}|VARIABLE_SCOPE_BEGIN|[2]|total|Integer|true|false`,
  `${at(1200)}|VARIABLE_ASSIGNMENT|[2]|total|1`,
  `${at(1300)}|METHOD_ENTRY|[5]|01p000000000AAA|ns.Inner.step()`,
  `${at(1400)}|VARIABLE_ASSIGNMENT|[6]|inner|"deep"|0x1a`,
  `${at(1500)}|METHOD_EXIT|[5]|01p000000000AAA|ns.Inner.step()`,
  `${at(1600)}|VARIABLE_ASSIGNMENT|[8]|total|2`,
  `${at(1700)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Outer.run()`,
];

describe('variables', () => {
  it("gives each local's last write by the end of the frame, with its type and id", () => {
    const log = logOf(...OUTER);
    const outer = eventWith(log, 'ns.Outer.run()');
    expect(outer.variables?.frame).toBe(outer);
    expect(outer.variables?.locals).toEqual([
      {
        name: 'total',
        type: 'Integer',
        value: '2',
        address: null,
        id: eventWith(log, '|total|2').id,
      },
    ]);
    expect(eventWith(log, '"deep"').variables?.locals).toEqual([
      { name: 'inner', type: null, value: '"deep"', address: '0x1a', id: 5 },
    ]);
  });

  it("keeps a caller's locals out of the frame it called", () => {
    const log = logOf(...OUTER);
    expect(names(eventWith(log, 'ns.Inner.step()'))).toEqual(['inner']);
  });

  it('answers a query from the Apex frame that issued it, as it stood when the query ran', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`,
      `${at(1050)}|VARIABLE_ASSIGNMENT|[2]|compId|"first"`,
      `${at(1100)}|VARIABLE_ASSIGNMENT|[3]|qry|"SELECT Id FROM Account"`,
      `${at(1150)}|SYSTEM_METHOD_ENTRY|[4]|Database.query(String)`,
      `${at(1200)}|SOQL_EXECUTE_BEGIN|[4]|Aggregations:0|SELECT Id FROM Account`,
      `${at(1250)}|SOQL_EXECUTE_END|[4]|Rows:1`,
      `${at(1300)}|SYSTEM_METHOD_EXIT|[4]|Database.query(String)`,
      `${at(1350)}|VARIABLE_ASSIGNMENT|[7]|compId|"after the query"`,
      `${at(1400)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Outer.run()`,
    );
    const query = eventWith(log, 'SOQL_EXECUTE_BEGIN').variables;
    expect(query?.frame).toBe(eventWith(log, 'ns.Outer.run()'));
    expect(query?.locals.map((v) => [v.name, v.value])).toEqual([
      ['compId', '"first"'],
      ['qry', '"SELECT Id FROM Account"'],
    ]);
    expect(eventWith(log, 'ns.Outer.run()').variables?.locals[0]?.value).toBe('"after the query"');
  });

  it('lists a local declared and never written, with no value and no id', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`,
      `${at(1100)}|VARIABLE_SCOPE_BEGIN|[2]|never|Boolean|true|false`,
      `${at(1200)}|VARIABLE_ASSIGNMENT|[3]|written|1`,
      `${at(1300)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Outer.run()`,
    );
    expect(eventWith(log, 'ns.Outer.run()').variables?.locals).toEqual([
      { name: 'never', type: 'Boolean', value: null, address: null, id: null },
      { name: 'written', type: null, value: '1', address: null, id: 3 },
    ]);
  });

  it('leaves this, fields and statics out of the locals', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`,
      `${at(1050)}|VARIABLE_SCOPE_BEGIN|[1]|this|ns.Outer|true|false`,
      `${at(1060)}|VARIABLE_SCOPE_BEGIN|[1]|ns.Cache.HITS|Integer|false|true`,
      `${at(1100)}|VARIABLE_ASSIGNMENT|[1]|this|{}|0xaaa`,
      `${at(1200)}|VARIABLE_ASSIGNMENT|[2]|count|1`,
      `${at(1300)}|VARIABLE_ASSIGNMENT|[3]|this.count|7|0xaaa`,
      `${at(1400)}|VARIABLE_ASSIGNMENT|[4]|ns.Cache.HITS|4`,
      `${at(1500)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Outer.run()`,
    );
    expect(names(eventWith(log, 'ns.Outer.run()'))).toEqual(['count']);
  });

  it('groups the statics by class, written in any frame by then, both sorted', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.First.run()`,
      `${at(1050)}|VARIABLE_SCOPE_BEGIN|[1]|ns.Cache.hits|Integer|false|true`,
      `${at(1100)}|VARIABLE_ASSIGNMENT|[2]|ns.Cache.hits|1`,
      `${at(1150)}|VARIABLE_ASSIGNMENT|[2]|ns.Other.flag|true|0x2b`,
      `${at(1200)}|METHOD_EXIT|[1]|01p000000000AAA|ns.First.run()`,
      `${at(1300)}|METHOD_ENTRY|[9]|01p000000000AAA|ns.Second.run()`,
      `${at(1350)}|VARIABLE_ASSIGNMENT|[3]|ns.Cache.hits|2`,
      `${at(1400)}|VARIABLE_ASSIGNMENT|[10]|ns.Cache.misses|9`,
      `${at(1500)}|METHOD_EXIT|[9]|01p000000000AAA|ns.Second.run()`,
    );
    const statics = (text: string) => eventWith(log, text).variables?.statics;
    expect(statics('ns.First.run()')).toEqual([
      {
        className: 'ns.Cache',
        variables: [{ name: 'hits', type: 'Integer', value: '1', address: null, id: 3 }],
      },
      {
        className: 'ns.Other',
        variables: [{ name: 'flag', type: null, value: 'true', address: '0x2b', id: 4 }],
      },
    ]);
    // A write after the event is not in its statics; the latest by then is.
    expect(statics('ns.Second.run()')?.[0]?.variables.map((v) => [v.name, v.value])).toEqual([
      ['hits', '2'],
      ['misses', '9'],
    ]);
  });

  it('lists a static declared by then and never written, and not one declared later', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.First.run()`,
      `${at(1100)}|VARIABLE_ASSIGNMENT|[2]|seen|1`,
      `${at(1200)}|METHOD_EXIT|[1]|01p000000000AAA|ns.First.run()`,
      `${at(1300)}|METHOD_ENTRY|[9]|01p000000000AAA|ns.Second.run()`,
      `${at(1400)}|VARIABLE_SCOPE_BEGIN|[10]|ns.Late.field|Integer|true|true`,
      `${at(1500)}|METHOD_EXIT|[9]|01p000000000AAA|ns.Second.run()`,
    );
    expect(eventWith(log, 'ns.First.run()').variables?.statics).toEqual([]);
    expect(eventWith(log, 'ns.Second.run()').variables?.statics).toEqual([
      {
        className: 'ns.Late',
        variables: [{ name: 'field', type: 'Integer', value: null, address: null, id: null }],
      },
    ]);
  });

  it('keeps every local of a log with more names than the first table holds', () => {
    // Each write holds a value address and an owner too, so name ids step past the table's end.
    const writes = Array.from(
      { length: 100 },
      (_, i) => `${at(1100 + i)}|VARIABLE_ASSIGNMENT|[2]|v${i}|0x${i}a|0x${i}b`,
    );
    const log = logOf(`${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`, ...writes);
    expect(log.event(1)?.variables?.locals).toHaveLength(100);
  });

  it('is the same object on each read', () => {
    const log = logOf(...OUTER);
    const outer = eventWith(log, 'ns.Outer.run()');
    expect(outer.variables).toBe(outer.variables);
    expect(Object.isFrozen(outer.variables?.locals[0])).toBe(true);
  });

  it('is null for an event in no frame, or a log with no variable lines', () => {
    const log = logOf(
      `${at(1)}|VARIABLE_ASSIGNMENT|[1]|top|1`,
      `${at(2)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`,
      `${at(3)}|STATEMENT_EXECUTE|[2]`,
      `${at(4)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Outer.run()`,
    );
    expect(eventWith(log, '|top|').variables).toBeNull();
    // A frame with no variable line of its own still answers, with nothing in it.
    expect(eventWith(log, 'STATEMENT_EXECUTE').variables?.locals).toEqual([]);
    const none = logOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`,
      `${at(2)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Outer.run()`,
    );
    expect(none.event(1)?.variables).toBeNull();
  });
});
