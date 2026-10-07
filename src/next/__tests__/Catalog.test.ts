/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import eventDatabase from '../../../data/salesforce-debug-log-events.json' with { type: 'json' };
import { EVENT_TYPES, eventText, eventType, GRAMMAR, idOfType } from '../catalog/catalog.js';
import type { EventType } from '../catalog/types.js';
import { DEBUG_CATEGORY } from '../catalog/types.js';
import { fieldsOf } from './helpers.js';

const database = eventDatabase as {
  categories: { name: string }[];
  events: { event: string; category: string; level: string }[];
};

const text = (
  type: EventType,
  line: string,
  continuation: string | (() => string) = '',
): string | null =>
  eventText(idOfType(type), fieldsOf(`00:00:00.0 (1)|${type}|${line}`, continuation));

describe('the catalog against the event database', () => {
  it('holds every documented event, and no other', () => {
    expect(database.events.length).toBeGreaterThan(0);
    expect(EVENT_TYPES.map((info) => info.type).sort()).toEqual(
      database.events.map((event) => event.event).sort(),
    );
  });

  it('states the documented debug category and level for every event', () => {
    const drift = database.events.flatMap(({ event, category, level }) => {
      // By type id, so an event the catalog lacks is listed rather than thrown.
      const info = eventType(idOfType(event));
      const documented = DEBUG_CATEGORY[category as keyof typeof DEBUG_CATEGORY];
      if (!info) return [`${event}: not in the catalog`];
      return info.debugCategory === documented && info.debugLevel === level
        ? []
        : [`${event}: ${info.debugCategory} ${info.debugLevel} != ${category} ${level}`];
    });
    expect(drift).toEqual([]);
  });

  it('knows every documented category token', () => {
    expect(Object.keys(DEBUG_CATEGORY).sort()).toEqual(
      database.categories.map((entry) => entry.name).sort(),
    );
  });
});

describe('type info', () => {
  it('is indexed by type id and frozen', () => {
    EVENT_TYPES.forEach((info, typeId) => {
      expect(info.typeId).toBe(typeId);
      expect(eventType(typeId)).toBe(info);
      expect(eventType(info.type)).toBe(info);
      expect(Object.isFrozen(info)).toBe(true);
      expect(Object.isFrozen(info.exitTypes)).toBe(true);
      expect(Object.isFrozen(info.fields)).toBe(true);
    });
    expect(Object.isFrozen(EVENT_TYPES)).toBe(true);
  });

  it('gives null for a type id no type has', () => {
    expect(eventType(-1)).toBeNull();
    expect(eventType(EVENT_TYPES.length)).toBeNull();
    expect(idOfType('NOT_AN_EVENT')).toBe(-1);
  });

  // The entry types make a frame state either exit types or another way to close.
  it('closes every frame that waits for an exit line with at least one exit-line type', () => {
    const bad = EVENT_TYPES.flatMap((info) => {
      if (GRAMMAR[info.typeId]?.closes !== 'exit') return [];
      if (!info.exitTypes.length) return [`${info.type}: no exit types`];
      return info.exitTypes
        .filter((exit) => eventType(exit).shape !== 'exit')
        .map((exit) => `${info.type}: ${exit} is not an exit line`);
    });
    expect(bad).toEqual([]);
  });

  it('closes some frame with every exit-line type', () => {
    const closing = new Set(EVENT_TYPES.flatMap((info) => info.exitTypes));
    expect(
      EVENT_TYPES.filter((info) => info.shape === 'exit' && !closing.has(info.type)).map(
        (info) => info.type,
      ),
    ).toEqual([]);
  });
});

describe('field layouts', () => {
  it('names each field once per type, in camelCase', () => {
    const bad = EVENT_TYPES.flatMap((info) =>
      info.fields
        .filter((name, i) => !/^[a-z][a-zA-Z0-9]*$/.test(name) || info.fields.indexOf(name) !== i)
        .map((name) => `${info.type}: ${name}`),
    );
    expect(bad).toEqual([]);
  });

  // A rename to or from `line` changes what the engine reads, so the full list is pinned.
  it('reads a line number on exactly these types', () => {
    const types = EVENT_TYPES.filter((info) => GRAMMAR[info.typeId]?.hasLineNumber).map(
      (info) => info.type,
    );
    expect(types).toMatchInlineSnapshot(`
      [
        "CALLOUT_REQUEST",
        "CALLOUT_RESPONSE",
        "CODE_UNIT_STARTED",
        "CONSTRUCTOR_ENTRY",
        "CONSTRUCTOR_EXIT",
        "CURSOR_CREATE_BEGIN",
        "CURSOR_CREATE_END",
        "CURSOR_FETCH",
        "CURSOR_FETCH_PAGE",
        "DML_BEGIN",
        "DML_END",
        "EMAIL_QUEUE",
        "EXCEPTION_THROWN",
        "HEAP_ALLOCATE",
        "HEAP_DEALLOCATE",
        "IDEAS_QUERY_EXECUTE",
        "LIMIT_USAGE",
        "METHOD_ENTRY",
        "METHOD_EXIT",
        "POP_TRACE_FLAGS",
        "PUSH_TRACE_FLAGS",
        "QUERY_MORE_BEGIN",
        "QUERY_MORE_END",
        "QUERY_MORE_ITERATIONS",
        "SAVEPOINT_ROLLBACK",
        "SAVEPOINT_SET",
        "SOQL_EXECUTE_BEGIN",
        "SOQL_EXECUTE_END",
        "SOQL_EXECUTE_EXPLAIN",
        "SOSL_EXECUTE_BEGIN",
        "SOSL_EXECUTE_END",
        "STATEMENT_EXECUTE",
        "SYSTEM_CONSTRUCTOR_ENTRY",
        "SYSTEM_CONSTRUCTOR_EXIT",
        "SYSTEM_METHOD_ENTRY",
        "SYSTEM_METHOD_EXIT",
        "USER_DEBUG",
        "USER_DEBUG_DEBUG",
        "USER_DEBUG_ERROR",
        "USER_DEBUG_FINE",
        "USER_DEBUG_FINER",
        "USER_DEBUG_FINEST",
        "USER_DEBUG_INFO",
        "USER_DEBUG_WARN",
        "USER_INFO",
        "VARIABLE_ASSIGNMENT",
        "VARIABLE_SCOPE_BEGIN",
        "VF_APEX_CALL_START",
      ]
    `);
  });
});

describe('event text', () => {
  it('is null when the line states none', () => {
    expect(text('STATEMENT_EXECUTE', '[12]')).toBeNull();
    expect(eventText(idOfType('FATAL_ERROR'), fieldsOf('00:00:00.0 (1)|FATAL_ERROR'))).toBeNull();
    expect(text('USER_INFO', '[EXTERNAL]')).toBeNull();
  });

  it('is null when a type that takes text states none and has no continuation', () => {
    expect(text('EXCEPTION_THROWN', '[12]|')).toBeNull();
  });

  it('is the continuation alone when the text field is empty', () => {
    expect(text('EXCEPTION_THROWN', '[12]|', 'message')).toBe('message');
  });

  it('reads only the fields a real line states', () => {
    expect(text('WF_EMAIL_ALERT', 'alert')).toBe('alert');
    expect(text('WF_APPROVAL_SUBMITTER', 'Name|005000000000AAA')).toBe('Name : 005000000000AAA');
    expect(text('VALIDATION_PASS', '')).toBeNull();
  });

  it('prints a missing field as empty, not "undefined"', () => {
    expect(text('WF_EMAIL_SENT', 'a')).toBe('a :  : ');
  });

  it('appends continuation lines on types that take them', () => {
    expect(text('USER_DEBUG', '[3]|DEBUG|first', 'second')).toBe('DEBUG | first\nsecond');
    expect(text('STATEMENT_EXECUTE', '[3]', 'ignored')).toBeNull();
  });

  it('reads the continuation lazily, once, and only for types that take text', () => {
    const continuation = vi.fn(() => 'more');
    text('STATEMENT_EXECUTE', '[3]', continuation);
    text('XDS_RESPONSE_ERROR', 'error', continuation);
    expect(continuation).not.toHaveBeenCalled();
    text('USER_DEBUG', '[3]|DEBUG|first', continuation);
    expect(continuation).toHaveBeenCalledTimes(1);
  });

  it('is the continuation alone when the line states no text', () => {
    expect(text('STACK_FRAME_VARIABLE_LIST', 'Frame', 'x = 1')).toBe('x = 1');
  });

  it('rewrites the text after the continuation is appended', () => {
    expect(text('WF_FORMULA', 'Formula:A|Values:B')).toBe('Formula:A : Values:B');
    expect(text('LIMIT_USAGE_FOR_NS', '(default)', '  Number of SOQL queries: 1 out of 100')).toBe(
      '(default)\nNumber of SOQL queries: 1/100',
    );
  });

  it('joins every listed field once, with no stray spaces', () => {
    expect(text('WF_FIELD_UPDATE', 'a|b|c|d|e')).toBe('a b c d e');
    expect(text('EVENT_SERVICE_SUB_DETAIL', 'a|b|c|d|e')).toBe('a b c d e');
    expect(text('WF_FLOW_ACTION_DETAIL', 'a|b|c|d')).toBe('a : b : c : d');
  });

  it('reads method, constructor and code unit names', () => {
    expect(text('METHOD_ENTRY', '[1]|01p000000000000|ns.MyClass.run()')).toBe('ns.MyClass.run()');
    expect(text('CONSTRUCTOR_ENTRY', '[1]|01p000000000000|<init>(Integer)|ns.MyClass')).toBe(
      'ns.MyClass(Integer)',
    );
    expect(text('CODE_UNIT_STARTED', '[EXTERNAL]|01p000000000000|MyClass.myTrigger')).toBe(
      'MyClass.myTrigger',
    );
    expect(text('ENTERING_MANAGED_PKG', 'ns.sub')).toBe('sub');
  });
});
