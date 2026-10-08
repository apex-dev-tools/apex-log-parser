/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { explainPlan } from '../views/details.js';
import { parse } from './helpers.js';

const inExecution = (...lines: string[]): string =>
  ['09:18:22.6 (100)|EXECUTION_STARTED', ...lines, '09:19:13.82 (2000)|EXECUTION_FINISHED'].join(
    '\n',
  );

describe('SOQL details', () => {
  const log = parse(
    inExecution(
      '06:22:49.429 (200)|SOQL_EXECUTE_BEGIN|[895]|Aggregations:2|SELECT Id FROM MySObject__c WHERE Id = :recordId',
      '06:22:49.429 (300)|SOQL_EXECUTE_EXPLAIN|[895]|TableScan on MySObject__c : [MyField__c, AnotherField__c], cardinality: 2, sobjectCardinality: 2, relativeCost 1.3',
      '06:22:49.429 (400)|SOQL_EXECUTE_END|[895]|Rows:50',
    ),
  );

  it('reads the aggregations of a query', () => {
    expect(log.ofType('SOQL_EXECUTE_BEGIN')[0]?.details).toEqual({ aggregations: 2 });
  });

  it('reads every value of an explain plan', () => {
    expect(log.ofType('SOQL_EXECUTE_EXPLAIN')[0]?.details).toEqual({
      leadingOperationType: 'TableScan',
      sObjectType: 'MySObject__c',
      fields: ['MyField__c', 'AnotherField__c'],
      cardinality: 2,
      sObjectCardinality: 2,
      relativeCost: 1.3,
    });
    // ofType gives each type its own details, so this compiles with no narrowing.
    expect(log.ofType('SOQL_EXECUTE_EXPLAIN')[0]?.details?.relativeCost).toBe(1.3);
  });

  it('reads the same frozen object each time', () => {
    const [query] = log.ofType('SOQL_EXECUTE_BEGIN');
    const [plan] = log.ofType('SOQL_EXECUTE_EXPLAIN');
    expect(query?.details).not.toBeNull();
    expect(query?.details).toBe(query?.details);
    expect(Object.isFrozen(query?.details)).toBe(true);
    expect(Object.isFrozen(plan?.details?.fields)).toBe(true);
  });

  it('narrows details on type for a list of more than one type', () => {
    const sums = log
      .ofType('SOQL_EXECUTE_BEGIN', 'SOQL_EXECUTE_EXPLAIN')
      .map((e) =>
        e.type === 'SOQL_EXECUTE_BEGIN' ? e.details.aggregations : e.details?.relativeCost,
      );
    expect(sums).toEqual([2, 1.3]);
  });

  it('reads a plan as one field, as its text does', () => {
    const tail = parse(
      '06:22:49.429 (300)|SOQL_EXECUTE_EXPLAIN|[1]|TableScan on MyObject__c : [], cardinality: 1, sobjectCardinality: 1, relativeCost 1.3|more',
    );
    expect(tail.ofType('SOQL_EXECUTE_EXPLAIN')[0]?.details?.relativeCost).toBe(1.3);
  });

  it.each([
    ['no prefix', 'Aggregations', null],
    ['no digits', 'Aggregations:', null],
    ['text', 'Aggregations:abc', null],
    ['an empty field', '', null],
  ])('states null aggregations for %s', (_name, field, expected) => {
    const query = parse(
      `06:22:49.429 (200)|SOQL_EXECUTE_BEGIN|[1]|${field}|SELECT Id FROM Account`,
    );
    expect(query.ofType('SOQL_EXECUTE_BEGIN')[0]?.details).toEqual({ aggregations: expected });
  });
});

describe('explainPlan', () => {
  it('is null when the line states no plan', () => {
    expect(explainPlan('No explain plan is available')).toBeNull();
    expect(explainPlan(null)).toBeNull();
  });

  it('states an empty list for brackets with no field inside', () => {
    expect(explainPlan('TableScan on MyObject__c : [], cardinality: 1')?.fields).toEqual([]);
  });

  it('states null for each value the plan leaves out or states malformed', () => {
    expect(explainPlan('TableScan : [Id], cardinality: x')).toEqual({
      leadingOperationType: null,
      sObjectType: null,
      fields: ['Id'],
      cardinality: null,
      sObjectCardinality: null,
      relativeCost: null,
    });
  });
});

describe('DML_BEGIN details', () => {
  it.each([
    ['Op:Insert|Type:Account', { operation: 'Insert', sObjectType: 'Account' }],
    ['Op:Update|Type:ns2__MyObject__c', { operation: 'Update', sObjectType: 'ns2__MyObject__c' }],
    ['Insert|Account', { operation: null, sObjectType: null }],
  ])('reads %s', (fields, expected) => {
    const log = parse(`15:20:52.222 (100)|DML_BEGIN|[1]|${fields}|Rows:1`);
    expect(log.ofType('DML_BEGIN')[0]?.details).toEqual(expected);
  });
});

describe('CODE_UNIT_STARTED details', () => {
  it.each([
    ['Workflow:01I000000000AAA', 'Workflow'],
    ['Flow:01I000000000AAA', 'Flow'],
    ['Validation:MyObject:a00000000000AAA', 'Validation'],
    ['execute_anonymous_apex', null],
  ])('reads the code unit type of %s', (unit, expected) => {
    const log = parse(
      `09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|${unit}\n09:18:22.6 (300)|CODE_UNIT_FINISHED|${unit}`,
    );
    expect(log.ofType('CODE_UNIT_STARTED')[0]?.details).toEqual({ codeUnitType: expected });
  });
});

describe('limit and heap details', () => {
  const log = parse(
    inExecution(
      '09:18:22.6 (200)|HEAP_ALLOCATE|[84]|Bytes:152',
      '09:18:22.6 (250)|HEAP_ALLOCATE|[EXTERNAL]|Bytes:-4',
      '09:18:22.6 (260)|HEAP_DEALLOCATE|[85]|Bytes:16',
      '09:18:22.6 (270)|BULK_HEAP_ALLOCATE|Bytes:abc',
      '09:18:22.6 (300)|LIMIT_USAGE|[89]|SOQL|1|100',
      '09:18:22.6 (350)|LIMIT_USAGE|[89]|FIELDS_DESCRIBES|1|100',
      '09:18:22.6 (360)|LIMIT_USAGE|[89]|SOQL|x|100',
      '09:18:22.6 (400)|FLOW_BULK_ELEMENT_LIMIT_USAGE|1 SOQL queries, total 5 out of 100',
      '09:18:22.6 (410)|FLOW_BULK_ELEMENT_LIMIT_USAGE|SOQL queries, total 6 out of 100',
      '09:18:22.6 (420)|FLOW_ELEMENT_LIMIT_USAGE|2 ms CPU time, total 10 out of 15000',
      '09:18:22.6 (430)|FLOW_ELEMENT_LIMIT_USAGE|3 Aggregate queries, total 3 out of 300',
      '09:18:22.6 (450)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|DML statements: 3 out of 150',
      '09:18:22.6 (460)|FLOW_START_INTERVIEW_LIMIT_USAGE|no figures here',
    ),
  );
  const details = (type: Parameters<typeof log.ofType>[0]) =>
    log.ofType(type).map((e) => e.details);

  it('reads heap bytes as stated, signed for an allocation and positive for a free', () => {
    expect(details('HEAP_ALLOCATE')).toEqual([{ bytes: 152 }, { bytes: -4 }]);
    expect(details('HEAP_DEALLOCATE')).toEqual([{ bytes: 16 }]);
    expect(details('BULK_HEAP_ALLOCATE')).toEqual([{ bytes: null }]);
  });

  it('reads a LIMIT_USAGE code, with no metric for a code no figure tracks', () => {
    expect(details('LIMIT_USAGE')).toEqual([
      { metric: 'soqlQueries', label: 'SOQL', used: 1, limit: 100 },
      { metric: null, label: 'FIELDS_DESCRIBES', used: 1, limit: 100 },
      null,
    ]);
  });

  it('reads a running total as used, and the leading count as delta', () => {
    expect(details('FLOW_BULK_ELEMENT_LIMIT_USAGE')).toEqual([
      { metric: 'soqlQueries', label: 'SOQL queries', used: 5, limit: 100, delta: 1 },
      // A head with no leading count still reports its total.
      { metric: 'soqlQueries', label: 'SOQL queries', used: 6, limit: 100, delta: 0 },
    ]);
    expect(details('FLOW_ELEMENT_LIMIT_USAGE')).toEqual([
      { metric: 'cpuTime', label: 'ms CPU time', used: 10, limit: 15000, delta: 2 },
      { metric: null, label: 'Aggregate queries', used: 3, limit: 300, delta: 3 },
    ]);
  });

  it('reads a flow report of the form label: used out of limit', () => {
    expect(details('FLOW_INTERVIEW_FINISHED_LIMIT_USAGE')).toEqual([
      { metric: 'dmlStatements', label: 'DML statements', used: 3, limit: 150 },
    ]);
    expect(details('FLOW_START_INTERVIEW_LIMIT_USAGE')).toEqual([null]);
  });

  it('states no details for a type with none', () => {
    expect(log.children[0]?.details).toBeNull();
  });
});
