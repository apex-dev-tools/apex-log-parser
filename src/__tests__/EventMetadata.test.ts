/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import eventDatabase from '../../data/salesforce-debug-log-events.json' with { type: 'json' };
import { ApexLogParser, debugLevelTokenByKey } from '../ApexLogParser.js';
import { BasicExitLine, BasicLogLine } from '../LogEvents.js';
import { getLogEventClass } from '../LogLineMapping.js';
import { DMLBeginLine, parse } from '../index.js';
import type { LogEventType } from '../types.js';

describe('Event debugLevel and debugCategory', () => {
  describe('new events are parsed (not null from getLogEventClass)', () => {
    const newEvents = [
      'APP_ANALYTICS_ERROR',
      'APP_ANALYTICS_FINE',
      'APP_ANALYTICS_WARN',
      'CURSOR_CREATE_BEGIN',
      'CURSOR_CREATE_END',
      'CURSOR_FETCH',
      'CURSOR_FETCH_PAGE',
      'DATA_ACCESS_EVALUATION',
      'DUPLICATE_RULE_FILTER_INVOCATION',
      'END_CALL',
      'EXTERNAL_SERVICE_CALLBACK',
      'FLOW_SCREEN_DETAIL',
      'FOR_UPDATE_LOCKS_RELEASE',
      'FORMULA_BUILD',
      'FORMULA_EVALUATE_BEGIN',
      'FORMULA_EVALUATE_END',
      'ORG_CACHE_CONTAINS',
      'ORG_CACHE_GET',
      'ORG_CACHE_GET_CAPACITY',
      'ORG_CACHE_GET_PARTITION',
      'ORG_CACHE_PUT',
      'ORG_CACHE_REMOVE',
      'PLAY_PROMPT',
      'POLICY_RULE_DEFINITION_CONDITION_EVALUATION_RESPONSE',
      'POLICY_RULE_EVALUATION_REQUEST',
      'POLICY_RULE_EVALUATION_RESPONSE',
      'POLICY_RULE_EVALUATION_SKIPPED',
      'POLICY_RULE_EVALUATION_START',
      'PUSH_NOTIFICATION_INVALID_CONFIGURATION',
      'PUSH_NOTIFICATION_INVALID_PAYLOAD',
      'QUERY_SQL_LOG',
      'RLM_CONFIGURATOR_BEGIN',
      'RLM_CONFIGURATOR_DEPLOY',
      'RLM_CONFIGURATOR_END',
      'RLM_CONFIGURATOR_STATS',
      'RLM_PRICING_BEGIN',
      'RLM_PRICING_END',
      'SAVEPOINT_RELEASE',
      'SAVEPOINT_RESET',
      'SCHEDULED_FLOW_DETAIL',
      'SESSION_CACHE_CONTAINS',
      'SESSION_CACHE_GET',
      'SESSION_CACHE_GET_CAPACITY',
      'SESSION_CACHE_GET_PARTITION',
      'SESSION_CACHE_PUT',
      'SESSION_CACHE_REMOVE',
      'SLA_CASE_MILESTONE',
      'USER_MODE_PERMSET_APPLIED',
      'WF_CHATTER_POST',
    ] as const;

    it.each(newEvents)('%s is recognised by getLogEventClass', (eventName) => {
      expect(getLogEventClass(eventName)).not.toBeNull();
    });
  });

  describe('debugLevel is set correctly on specialised events', () => {
    it.each([
      ['METHOD_ENTRY', 'FINE'],
      ['CODE_UNIT_STARTED', 'ERROR'],
      ['DML_BEGIN', 'INFO'],
      ['SOQL_EXECUTE_BEGIN', 'INFO'],
      ['EXCEPTION_THROWN', 'INFO'],
      ['USER_DEBUG', 'DEBUG'],
    ])('%s has debugLevel %s', (eventName, expectedLevel) => {
      const logLines: Record<string, string> = {
        METHOD_ENTRY: '15:20:52.222 (100)|METHOD_ENTRY|[1]|01p000000000000|MyClass.myMethod()',
        CODE_UNIT_STARTED:
          '15:20:52.222 (100)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000000|MyClass.myTrigger',
        DML_BEGIN: '15:20:52.222 (100)|DML_BEGIN|[1]|Op:Insert|Type:Account|Rows:1',
        SOQL_EXECUTE_BEGIN:
          '15:20:52.222 (100)|SOQL_EXECUTE_BEGIN|[1]|Aggregations:0|SELECT Id FROM Account',
        EXCEPTION_THROWN:
          '15:20:52.222 (100)|EXCEPTION_THROWN|[1]|System.NullPointerException: error',
        USER_DEBUG: '15:20:52.222 (100)|USER_DEBUG|[1]|DEBUG|test message',
      };
      const log = parse(logLines[eventName]!);
      const line = log.children[0];
      expect(line).toBeDefined();
      expect(line!.debugLevel).toBe(expectedLevel);
    });
  });

  it('debugCategory indexes debugLevels', () => {
    const apexLog = parse(
      '61.0 APEX_CODE,FINE;APEX_PROFILING,INFO\n' +
        '15:20:52.222 (100)|METHOD_ENTRY|[1]|01p000000000000|MyClass.myMethod()\n',
    );
    const line = apexLog.children[0];
    expect(line).toBeDefined();
    const category = line!.debugCategory;
    expect(category).toBe('apexCode');
    expect(category && apexLog.debugLevels[category]).toBe('FINE');
  });

  describe('debugCategory matches the bundled event database', () => {
    // Deriving the class literals from the database would add a lookup to a hot path - see #37.
    const database = eventDatabase as {
      categories: { name: string }[];
      events: { event: string; category: string }[];
    };

    const rows = database.events.map(({ event, category }) => {
      // `Rows:0` in every fragment slot, so the constructors which parse a row count accept the stub.
      const parts = ['15:20:52.222 (100)', event, '[1]', 'Rows:0', 'Rows:0', 'Rows:0', 'Rows:0'];
      const eventClass = getLogEventClass(event as LogEventType);
      // A fresh parser per event, so one constructor cannot fold state into the next.
      const debugCategory = eventClass
        ? new eventClass(new ApexLogParser(), parts).debugCategory
        : '';
      return {
        event,
        category,
        eventClass,
        generic: eventClass === BasicLogLine || eventClass === BasicExitLine,
        token: debugCategory ? debugLevelTokenByKey[debugCategory] : '',
      };
    });

    it('states a class for every database event', () => {
      expect(rows.length).toBeGreaterThan(0); // every other assertion here passes on an empty database
      expect(rows.filter((row) => row.eventClass === null).map((row) => row.event)).toEqual([]);
    });

    it('states the database category on every event with its own class', () => {
      expect(
        rows
          .filter((row) => !row.generic && row.token !== row.category)
          .map((row) => `${row.event}: ${row.token} != ${row.category}`),
      ).toEqual([]);
    });

    it('states no category only on the generic event classes', () => {
      expect(
        rows.filter((row) => (row.token === '') !== row.generic).map((row) => row.event),
      ).toEqual([]);
    });

    it('states a token for every category the database declares', () => {
      expect(Object.values(debugLevelTokenByKey).sort()).toEqual(
        database.categories.map((entry) => entry.name).sort(),
      );
    });
  });

  describe('DMLBeginLine.sObjectType', () => {
    it.each([
      ['15:20:52.222 (100)|DML_BEGIN|[1]|Op:Insert|Type:Account|Rows:1', 'Account'],
      [
        '15:20:52.222 (100)|DML_BEGIN|[1]|Op:Update|Type:ns2__MyObject__c|Rows:1',
        'ns2__MyObject__c',
      ],
    ])('parses the target object from %s', (logLine, expected) => {
      const line = parse(logLine).children[0];
      expect(line).toBeInstanceOf(DMLBeginLine);
      expect((line as DMLBeginLine).sObjectType).toBe(expected);
    });
  });
});
