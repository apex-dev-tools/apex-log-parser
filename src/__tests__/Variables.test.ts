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

  it('shares the statics between events with no static line between them', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.First.run()`,
      `${at(1100)}|VARIABLE_ASSIGNMENT|[2]|ns.Cache.hits|1`,
      `${at(1150)}|VARIABLE_ASSIGNMENT|[2]|ns.Other.flag|true`,
      `${at(1200)}|VARIABLE_ASSIGNMENT|[3]|a|1`,
      `${at(1300)}|VARIABLE_ASSIGNMENT|[4]|b|2`,
      `${at(1400)}|VARIABLE_ASSIGNMENT|[5]|ns.Cache.hits|2`,
      `${at(1500)}|METHOD_EXIT|[1]|01p000000000AAA|ns.First.run()`,
    );
    const statics = (text: string) => eventWith(log, text).variables?.statics;
    expect(statics('|a|1')).toBe(statics('|b|2'));
    const later = statics('|ns.Cache.hits|2');
    expect(later).not.toBe(statics('|b|2'));
    expect(later?.[0]?.variables[0]?.value).toBe('2');
    expect(later?.[1]?.variables[0]).toBe(statics('|b|2')?.[1]?.variables[0]);
  });

  it('reads this as the frame wrote it, and its fields without `this.`', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`,
      `${at(1060)}|VARIABLE_SCOPE_BEGIN|[9]|this|ns.Outer|true|false`,
      `${at(1070)}|VARIABLE_ASSIGNMENT|[9]|this|{}|0xbbb`,
      `${at(1150)}|VARIABLE_ASSIGNMENT|[3]|this.total|42|0xbbb`,
      `${at(1160)}|VARIABLE_ASSIGNMENT|[4]|this.child|0xccc|0xbbb`,
      `${at(1300)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Outer.run()`,
    );
    const outer = eventWith(log, 'ns.Outer.run()').variables;
    expect(outer?.this).toEqual({
      name: 'this',
      type: 'ns.Outer',
      value: '{}',
      address: '0xbbb',
      id: 3,
    });
    // A field line's address is its owner's, so a field's address is its value's, if any.
    expect(outer?.fields).toEqual([
      { name: 'child', type: null, value: '0xccc', address: '0xccc', id: 5 },
      { name: 'total', type: null, value: '42', address: null, id: 4 },
    ]);
  });

  it('merges the fields of every frame of the class on the stack, the latest write winning', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`,
      `${at(1100)}|VARIABLE_ASSIGNMENT|[2]|this.fromCaller|"set early"`,
      `${at(1150)}|VARIABLE_ASSIGNMENT|[2]|this.both|1`,
      `${at(1200)}|METHOD_ENTRY|[5]|01p000000000AAA|ns.Other.help()`,
      `${at(1250)}|VARIABLE_ASSIGNMENT|[3]|this.notMine|1`,
      `${at(1300)}|METHOD_ENTRY|[5]|01p000000000AAA|ns.Outer.step()`,
      `${at(1350)}|VARIABLE_ASSIGNMENT|[6]|this.fromCallee|7`,
      `${at(1360)}|VARIABLE_ASSIGNMENT|[6]|this.both|2`,
      `${at(1400)}|METHOD_EXIT|[5]|01p000000000AAA|ns.Outer.step()`,
      `${at(1450)}|METHOD_EXIT|[5]|01p000000000AAA|ns.Other.help()`,
      `${at(1500)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Outer.run()`,
    );
    const fields = eventWith(log, 'ns.Outer.step()').variables?.fields;
    expect(fields?.map((v) => [v.name, v.value])).toEqual([
      ['both', '2'],
      ['fromCallee', '7'],
      ['fromCaller', '"set early"'],
    ]);
  });

  it('leaves out a frame on another object of the class, unless the log names neither', () => {
    const two = (outerAddress: string) =>
      logOf(
        `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Same.outer()`,
        `${at(1100)}|VARIABLE_ASSIGNMENT|[2]|this.outerOnly|"A"${outerAddress}`,
        `${at(1200)}|METHOD_ENTRY|[9]|01p000000000AAA|ns.Same.inner()`,
        `${at(1300)}|VARIABLE_ASSIGNMENT|[10]|this.innerOnly|"B"|0xbbb`,
        `${at(1400)}|METHOD_EXIT|[9]|01p000000000AAA|ns.Same.inner()`,
        `${at(1500)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Same.outer()`,
      );
    const fieldNames = (log: ApexLog, text: string) =>
      eventWith(log, text).variables?.fields.map((v) => v.name);
    const apart = two('|0xaaa');
    expect(fieldNames(apart, 'ns.Same.inner()')).toEqual(['innerOnly']);
    expect(fieldNames(apart, 'ns.Same.outer()')).toEqual(['outerOnly']);
    expect(fieldNames(two(''), 'ns.Same.inner()')).toEqual(['innerOnly', 'outerOnly']);
  });

  it('gives a frame the fields a returned constructor set, and those with no address', () => {
    const log = logOf(
      `${at(1000)}|CONSTRUCTOR_ENTRY|[62]|01p000000000AAA|<init>()|ns.Selector`,
      `${at(1010)}|VARIABLE_SCOPE_BEGIN|[1]|this|ns.Selector|true|false`,
      `${at(1020)}|VARIABLE_ASSIGNMENT|[1]|this|{}|0xaaa`,
      `${at(1030)}|VARIABLE_ASSIGNMENT|[2]|this.sObj|"Account"|0xaaa`,
      `${at(1040)}|CONSTRUCTOR_EXIT|[62]|01p000000000AAA|<init>()|ns.Selector`,
      `${at(1050)}|METHOD_ENTRY|[70]|01p000000000AAA|ns.Selector.query()`,
      `${at(1060)}|VARIABLE_ASSIGNMENT|[71]|this|{}|0xaaa`,
      `${at(1070)}|VARIABLE_ASSIGNMENT|[73]|this.plain|"no address"`,
      `${at(1080)}|METHOD_EXIT|[70]|01p000000000AAA|ns.Selector.query()`,
    );
    const fields = eventWith(log, 'ns.Selector.query()').variables?.fields;
    expect(fields?.map((v) => v.name)).toEqual(['plain', 'sObj']);
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

describe('objectAt', () => {
  it('reads the value as the event stood, and where the log first states it when it has not yet', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.First.run()`,
      `${at(1050)}|VARIABLE_ASSIGNMENT|[2]|alias|0xaaa`,
      `${at(1100)}|VARIABLE_ASSIGNMENT|[3]|view|{"ref":"0xaaa"}`,
      `${at(1150)}|METHOD_EXIT|[1]|01p000000000AAA|ns.First.run()`,
      `${at(1200)}|METHOD_ENTRY|[9]|01p000000000AAA|ns.Second.run()`,
      `${at(1250)}|VARIABLE_ASSIGNMENT|[10]|held|{"n":1}|0xaaa`,
      `${at(1300)}|VARIABLE_ASSIGNMENT|[11]|held|{"n":2}|0xaaa`,
      `${at(1350)}|METHOD_EXIT|[9]|01p000000000AAA|ns.Second.run()`,
    );
    // The value is an address, so it reads the object there; one only nested in a value does too.
    expect(eventWith(log, '|alias|').variables?.locals[0]?.address).toBe('0xaaa');
    expect(eventWith(log, 'ns.First.run()').objectAt('0xaaa')).toEqual({
      className: null,
      value: null,
      laterAt: eventWith(log, '{"n":1}').id,
      fields: [],
    });
    expect(eventWith(log, '{"n":1}').objectAt('0xaaa')?.value).toBe('{"n":1}');
    expect(eventWith(log, 'ns.Second.run()').objectAt('0xaaa')).toMatchObject({
      value: '{"n":2}',
      laterAt: null,
    });
  });

  it('takes the value from a write of this, and only fields from a field write', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`,
      `${at(1100)}|VARIABLE_ASSIGNMENT|[2]|this.sortDir|"asc"|0xf1e`,
      `${at(1150)}|VARIABLE_ASSIGNMENT|[3]|this|{"sortDir":"asc"}|0xaaa`,
      `${at(1200)}|VARIABLE_ASSIGNMENT|[4]|alias|0xbbb`,
      `${at(1900)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Outer.run()`,
    );
    const outer = eventWith(log, 'ns.Outer.run()');
    expect(outer.objectAt('0xf1e')).toEqual({
      className: null,
      value: null,
      laterAt: null,
      fields: [{ name: 'sortDir', type: null, value: '"asc"', address: null, id: 2 }],
    });
    expect(outer.objectAt('0xaaa')?.value).toBe('{"sortDir":"asc"}');
    // The log never wrote what is at 0xbbb.
    expect(outer.objectAt('0xbbb')).toBeNull();
    expect(outer.objectAt('0xnothere')).toBeNull();
  });

  it('names the class the object was constructed as, not its superclass, from its declaration on', () => {
    const log = logOf(
      `${at(1000)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.Outer.run()`,
      `${at(1050)}|CONSTRUCTOR_ENTRY|[17]|01p000000000AAA|<init>()|ns.Handler`,
      `${at(1060)}|VARIABLE_SCOPE_BEGIN|[11]|this|ns.Handler|true|false`,
      `${at(1070)}|VARIABLE_ASSIGNMENT|[11]|this|{}|0x7b4`,
      `${at(1080)}|CONSTRUCTOR_ENTRY|[12]|01p000000000AAA|<init>()|ns.BaseHandler`,
      `${at(1090)}|VARIABLE_SCOPE_BEGIN|[15]|this|ns.BaseHandler|true|false`,
      `${at(1100)}|VARIABLE_ASSIGNMENT|[15]|this|{}|0x7b4`,
      `${at(1110)}|CONSTRUCTOR_EXIT|[12]|01p000000000AAA|<init>()|ns.BaseHandler`,
      `${at(1120)}|CONSTRUCTOR_EXIT|[17]|01p000000000AAA|<init>()|ns.Handler`,
      `${at(1200)}|METHOD_ENTRY|[3]|01p000000000AAA|ns.Base.run()`,
      `${at(1210)}|VARIABLE_SCOPE_BEGIN|[3]|this|ns.Base|true|false`,
      `${at(1220)}|VARIABLE_ASSIGNMENT|[3]|this|{}|0xccc`,
      `${at(1230)}|METHOD_EXIT|[3]|01p000000000AAA|ns.Base.run()`,
      `${at(1300)}|METHOD_ENTRY|[4]|01p000000000AAA|ns.Second.run()`,
      `${at(1310)}|VARIABLE_ASSIGNMENT|[4]|this|{}|0xddd`,
      `${at(1320)}|METHOD_EXIT|[4]|01p000000000AAA|ns.Second.run()`,
      `${at(1900)}|METHOD_EXIT|[1]|01p000000000AAA|ns.Outer.run()`,
    );
    const outer = eventWith(log, 'ns.Outer.run()');
    expect(outer.objectAt('0x7b4')?.className).toBe('ns.Handler');
    expect(eventWith(log, 'CONSTRUCTOR_ENTRY').objectAt('0x7b4')?.className).toBe('ns.Handler');
    expect(eventWith(log, '|ns.Handler|true|').objectAt('0x7b4')?.className).toBeNull();
    // An object made outside the log is named by the type a method declared `this` as.
    expect(outer.objectAt('0xccc')?.className).toBe('ns.Base');
    // A frame that never declared `this` names no class.
    expect(outer.objectAt('0xddd')?.className).toBeNull();
  });

  it('reads a reused address as a new object, in objectAt and in fields', () => {
    const log = logOf(
      `${at(1000)}|CONSTRUCTOR_ENTRY|[1]|01p000000000AAA|<init>()|ns.First`,
      `${at(1010)}|VARIABLE_SCOPE_BEGIN|[1]|this|ns.First|true|false`,
      `${at(1020)}|VARIABLE_ASSIGNMENT|[1]|this|{}|0xbbb`,
      `${at(1030)}|VARIABLE_ASSIGNMENT|[2]|this.one|1|0xbbb`,
      `${at(1040)}|CONSTRUCTOR_EXIT|[1]|01p000000000AAA|<init>()|ns.First`,
      `${at(1050)}|CONSTRUCTOR_ENTRY|[9]|01p000000000AAA|<init>()|ns.First`,
      `${at(1060)}|VARIABLE_SCOPE_BEGIN|[9]|this|ns.First|true|false`,
      `${at(1070)}|VARIABLE_ASSIGNMENT|[9]|this|{}|0xbbb`,
      `${at(1080)}|VARIABLE_ASSIGNMENT|[10]|this.two|2|0xbbb`,
      `${at(1090)}|CONSTRUCTOR_EXIT|[9]|01p000000000AAA|<init>()|ns.First`,
      `${at(1100)}|METHOD_ENTRY|[20]|01p000000000AAA|ns.First.go()`,
      `${at(1120)}|VARIABLE_ASSIGNMENT|[20]|this|{}|0xbbb`,
      `${at(1130)}|METHOD_EXIT|[20]|01p000000000AAA|ns.First.go()`,
    );
    const go = eventWith(log, 'ns.First.go()');
    expect(go.objectAt('0xbbb')?.fields.map((v) => v.name)).toEqual(['two']);
    expect(go.variables?.fields.map((v) => v.name)).toEqual(['two']);
    expect(
      eventWith(log, 'this.one')
        .objectAt('0xbbb')
        ?.fields.map((v) => v.name),
    ).toEqual(['one']);
  });
});
