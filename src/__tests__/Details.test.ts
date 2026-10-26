/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { explainPlan } from '../views/details.js';
import type { ProfilingRow } from '../views/profiling.js';
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

  it('reads the aggregations of a query, and its plan from its explain child', () => {
    const [query] = log.ofType('SOQL_EXECUTE_BEGIN');
    expect(query?.details).toEqual({
      aggregations: 2,
      explain: log.ofType('SOQL_EXECUTE_EXPLAIN')[0]?.details,
    });
    expect(query?.details.explain?.relativeCost).toBe(1.3);
  });

  it('states a null plan for a query with no explain child', () => {
    const bare = parse(
      inExecution(
        '06:22:49.429 (200)|SOQL_EXECUTE_BEGIN|[1]|Aggregations:0|SELECT Id FROM Account',
        '06:22:49.429 (400)|SOQL_EXECUTE_END|[1]|Rows:1',
      ),
    );
    expect(bare.ofType('SOQL_EXECUTE_BEGIN')[0]?.details).toEqual({
      aggregations: 0,
      explain: null,
    });
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
    expect(query.ofType('SOQL_EXECUTE_BEGIN')[0]?.details).toEqual({
      aggregations: expected,
      explain: null,
    });
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

describe('FLOW_ELEMENT_ERROR details', () => {
  it.each([
    [
      'a one-line message',
      [
        '09:18:22.6 (200)|FLOW_ELEMENT_ERROR|Required fields are missing.|FlowRecordCreate|Create_Account',
      ],
      { elementType: 'FlowRecordCreate', elementName: 'Create_Account' },
    ],
    [
      'a message over lines',
      [
        '09:18:22.6 (200)|FLOW_ELEMENT_ERROR|You have reached the limit.',
        'Try again later.|FlowActionCall|myRule_1_A1',
      ],
      { elementType: 'FlowActionCall', elementName: 'myRule_1_A1' },
    ],
    [
      'a message that holds a |',
      ['09:18:22.6 (200)|FLOW_ELEMENT_ERROR|Bad value: a|b|FlowDecision|Check_Status'],
      { elementType: 'FlowDecision', elementName: 'Check_Status' },
    ],
    [
      'no element',
      ['09:18:22.6 (200)|FLOW_ELEMENT_ERROR|An error occurred.'],
      { elementType: null, elementName: null },
    ],
    [
      'one field after the message',
      ['09:18:22.6 (200)|FLOW_ELEMENT_ERROR|msg|X'],
      { elementType: null, elementName: null },
    ],
    [
      'an empty message',
      ['09:18:22.6 (200)|FLOW_ELEMENT_ERROR||FlowDecision|Check_Status'],
      { elementType: 'FlowDecision', elementName: 'Check_Status' },
    ],
    [
      'an element line that another line follows',
      [
        '09:18:22.6 (200)|FLOW_ELEMENT_ERROR|You have reached the limit.',
        '|FlowActionCall|myRule_1_A1',
        'Try again later.',
      ],
      { elementType: null, elementName: null },
    ],
  ])('reads the element after %s', (_name, lines, expected) => {
    expect(parse(inExecution(...lines)).ofType('FLOW_ELEMENT_ERROR')[0]?.details).toEqual(expected);
  });
});

describe('FLOW_START_INTERVIEWS_BEGIN details', () => {
  const interviews = (unit: string | null): string => {
    const body = [
      '09:18:22.6 (300)|FLOW_START_INTERVIEWS_BEGIN|1',
      '09:18:22.6 (310)|FLOW_START_INTERVIEWS_END|1',
    ];
    return unit === null
      ? body.join('\n')
      : [
          `09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|${unit}`,
          ...body,
          `09:18:22.6 (400)|CODE_UNIT_FINISHED|${unit}`,
        ].join('\n');
  };
  const flowTypes = (text: string) =>
    parse(text)
      .ofType('FLOW_START_INTERVIEWS_BEGIN')
      .map((e) => e.details.flowType);

  it.each([
    ['a Flow code unit', 'Flow:01I000000000AAA', 'flow'],
    ['a Workflow code unit', 'Workflow:01I000000000AAA', 'process-builder'],
    ['a code unit of another kind', 'Validation:MyObject:a00000000000AAA', null],
    ['no code unit', null, null],
  ])('is %s: %s', (_name, unit, expected) => {
    expect(flowTypes(interviews(unit))).toEqual([expected]);
  });

  it('is null when the nearest code unit is of another kind, though a Flow is above it', () => {
    const text = [
      '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|Flow:01I000000000AAA',
      '09:18:22.6 (210)|CODE_UNIT_STARTED|[EXTERNAL]|Validation:MyObject:a00000000000AAA',
      '09:18:22.6 (300)|FLOW_START_INTERVIEWS_BEGIN|1',
      '09:18:22.6 (310)|FLOW_START_INTERVIEWS_END|1',
      '09:18:22.6 (390)|CODE_UNIT_FINISHED|Validation:MyObject:a00000000000AAA',
      '09:18:22.6 (400)|CODE_UNIT_FINISHED|Flow:01I000000000AAA',
    ].join('\n');
    expect(flowTypes(text)).toEqual([null]);
  });

  it('is flow for interviews inside another interviews frame, whatever started it', () => {
    const text = [
      '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:01I000000000AAA',
      '09:18:22.6 (300)|FLOW_START_INTERVIEWS_BEGIN|1',
      '09:18:22.6 (310)|FLOW_START_INTERVIEW_BEGIN|01I000000000AAA|Outer',
      '09:18:22.6 (320)|FLOW_START_INTERVIEWS_BEGIN|1',
      '09:18:22.6 (330)|FLOW_START_INTERVIEWS_END|1',
      '09:18:22.6 (340)|FLOW_START_INTERVIEW_END|01I000000000AAA|Outer',
      '09:18:22.6 (350)|FLOW_START_INTERVIEWS_END|1',
      '09:18:22.6 (400)|CODE_UNIT_FINISHED|Workflow:01I000000000AAA',
    ].join('\n');
    expect(flowTypes(text)).toEqual(['process-builder', 'flow']);
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

describe('LIMIT_USAGE_FOR_NS details', () => {
  // Two blocks at one timestamp: a caller cannot match these to log.limits.snapshots by time.
  const log = parse(
    inExecution(
      '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|(default)|',
      '  Number of SOQL queries: 3 out of 100',
      '  Maximum CPU time: 12 out of 10000',
      '09:18:22.6 (500)|LIMIT_USAGE_FOR_NS|ns|',
      '  Number of SOQL queries: 7 out of 100',
      '09:18:22.6 (600)|LIMIT_USAGE_FOR_NS|(default)|',
    ),
  );
  const [first, second] = log.ofType('LIMIT_USAGE_FOR_NS');

  it('gives each block the figures log.limits.snapshots gives it, an empty block too', () => {
    const details = log.ofType('LIMIT_USAGE_FOR_NS').map((e) => e.details.limits);
    expect(details).toHaveLength(3);
    expect(details).toEqual(log.limits.snapshots.map((s) => s.limits));
    expect(first?.details.limits.soqlQueries.used).toBe(3);
  });

  it('gives each of two blocks at one timestamp its own figures', () => {
    expect(second?.startTimestamp).toBe(first?.startTimestamp);
    expect(second?.details.limits.soqlQueries.used).toBe(7);
  });
});

describe('CUMULATIVE_PROFILING details', () => {
  const log = parse(
    inExecution(
      '09:18:22.6 (500)|CUMULATIVE_PROFILING_BEGIN',
      '09:18:22.6 (510)|CUMULATIVE_PROFILING|SOQL operations|',
      'Class.MyClass.run: line 10, column 1: [SELECT Id',
      '    FROM Account]: executed 96 times in 209 ms',
      'Class.MyClass.find: line 12, column 1: Database.query(String): executed 1 time in 3 ms',
      '(ns): [SELECT Id FROM Account]: executed 2 times in 4 ms',
      '',
      '09:18:22.6 (520)|CUMULATIVE_PROFILING|No profiling information for SOSL operations',
      '',
      '09:18:22.6 (530)|CUMULATIVE_PROFILING|DML operations|',
      'Class.MyClass.save: line 99, column 1: Insert: List<ns__Obj__c>: executed 1 time in 155 ms',
      '',
      '09:18:22.6 (540)|CUMULATIVE_PROFILING|method invocations|',
      'External entry point: public void invoke(): executed 1 time in 60 ms',
      'Class.MyClass.<init>: line 5, column 1: public MyClass(): executed 1 time in 1 ms',
      'Trigger.MyTrigger: line 15, column 1: public static void run(String): executed 4 times in 9 ms',
      '',
      '09:18:22.6 (550)|CUMULATIVE_PROFILING|stack frames|',
      'Class.MyClass.go: line 7, column 3: public void go(): executed 1 time in 2 ms',
      'MyClass.stop(): executed 2 times in 5 ms',
      '',
      '09:18:22.6 (560)|CUMULATIVE_PROFILING_END',
    ),
  );
  const [soql, sosl, dml, methods, unknown] = log
    .ofType('CUMULATIVE_PROFILING')
    .map((e) => e.details);

  it('maps each header to its section, and an empty one to no rows', () => {
    expect([soql, sosl, dml, methods].map((d) => [d?.section, d?.rows.length])).toEqual([
      ['soql', 3],
      ['sosl', 0],
      ['dml', 1],
      ['methods', 3],
    ]);
  });

  it('reads a query that spans lines as one row, with its line breaks', () => {
    expect(soql?.rows[0]?.detail).toBe('[SELECT Id\n    FROM Account]');
  });

  it('keeps a detail that holds a colon whole', () => {
    expect(dml?.rows[0]).toMatchObject({
      location: 'Class.MyClass.save',
      lineNumber: 99,
      detail: 'Insert: List<ns__Obj__c>',
    });
  });

  it('reads each form of location', () => {
    const where = (r: ProfilingRow | undefined) => [
      r?.location,
      r?.namespace,
      r?.lineNumber,
      r?.column,
    ];
    expect([...(methods?.rows ?? []), soql?.rows[2]].map(where)).toEqual([
      ['External entry point', null, null, null],
      ['Class.MyClass.<init>', null, 5, 1],
      ['Trigger.MyTrigger', null, 15, 1],
      [null, 'ns', null, null],
    ]);
    expect(soql?.rows[2]?.detail).toBe('[SELECT Id FROM Account]');
  });

  it('reads the count, and the time in nanoseconds', () => {
    expect(soql?.rows.slice(0, 2).map((r) => [r.count, r.duration])).toEqual([
      [96, 209_000_000],
      [1, 3_000_000],
    ]);
  });

  it('states no section for a header it does not know, but still reads its rows', () => {
    expect(unknown?.section).toBeNull();
    expect(unknown?.rows.map((r) => r.detail)).toEqual(['public void go()', 'MyClass.stop()']);
  });

  it('reads a row that states no location as its detail alone', () => {
    expect(unknown?.rows[1]).toMatchObject({
      location: null,
      lineNumber: null,
      detail: 'MyClass.stop()',
    });
  });

  it('leaves out a row that a truncated log cuts off', () => {
    const cut = parse(
      [
        '09:18:22.6 (100)|EXECUTION_STARTED',
        '09:18:22.6 (540)|CUMULATIVE_PROFILING|method invocations|',
        'Class.MyClass.run: line 10, column 1: public void run(): executed 1 time in 2 ms',
        'Class.MyClass.find: line 12, column 1: public void fi',
      ].join('\n'),
    );
    expect(cut.ofType('CUMULATIVE_PROFILING')[0]?.details.rows.map((r) => r.detail)).toEqual([
      'public void run()',
    ]);
  });
});

describe('EXCEPTION_THROWN details', () => {
  const THROW =
    '09:18:22.6 (300)|EXCEPTION_THROWN|[5]|System.NullPointerException: Attempt to de-reference a null object';
  const FATAL =
    '09:18:22.6 (500)|FATAL_ERROR|System.NullPointerException: Attempt to de-reference a null object';
  const DEBUG = '09:18:22.6 (600)|USER_DEBUG|[9]|DEBUG|went on';
  const ENTRY = '09:18:22.6 (200)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.run()';
  const EXIT = '09:18:22.6 (400)|METHOD_EXIT|[1]|01p000000000AAA|MyClass.run()';
  const SKIP = '*** Skipped 1,024 bytes of detailed log';
  const isCaught = (...lines: string[]) =>
    parse(inExecution(...lines))
      .ofType('EXCEPTION_THROWN')
      .map((e) => e.details.isCaught);

  it('is caught when execution goes on after the throw', () => {
    expect(isCaught(ENTRY, THROW, EXIT, DEBUG)).toEqual([true]);
  });

  it('is not caught when the frames exit and a fatal error follows', () => {
    expect(isCaught(ENTRY, THROW, EXIT, FATAL)).toEqual([false]);
  });

  it('ends a run of throws at the first row that is not a throw or an exit', () => {
    expect(isCaught(THROW, DEBUG, THROW, FATAL)).toEqual([true, false]);
  });

  it('gives a run of throws the answer of the row after the run', () => {
    expect(isCaught(THROW, THROW, FATAL)).toEqual([false, false]);
    expect(isCaught(THROW, EXIT, THROW, DEBUG)).toEqual([true, true]);
  });

  it('skips an exit line that closes no frame', () => {
    expect(isCaught(THROW, EXIT, FATAL)).toEqual([false]);
  });

  it('is caught when the platform drops lines before the throw only', () => {
    expect(isCaught(SKIP, THROW, DEBUG)).toEqual([true]);
  });

  it('reads each throw against the next part the platform dropped', () => {
    expect(isCaught(THROW, SKIP, DEBUG, THROW, DEBUG)).toEqual([null, true]);
    expect(isCaught(THROW, DEBUG, SKIP, THROW, DEBUG)).toEqual([true, true]);
  });

  it.each([
    ['the log ends after it', [THROW]],
    ['the limit block follows it', [THROW, '09:18:22.6 (900)|CUMULATIVE_LIMIT_USAGE']],
    ['a test limit block follows it', [THROW, '09:18:22.6 (900)|TESTING_LIMITS']],
    ['the platform drops lines after it', [THROW, SKIP, DEBUG]],
    [
      'the log reaches its maximum size after it',
      [ENTRY, THROW, '*** MAXIMUM DEBUG LOG SIZE REACHED ***', DEBUG],
    ],
  ])('is null when %s', (_name, lines) => {
    expect(isCaught(...lines)).toEqual([null]);
  });
});
