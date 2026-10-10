/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexEvent } from '../views/events.js';
import { at, HEADER, logOf, outline, parse } from './helpers.js';

const kids = (event: ApexEvent | undefined): readonly ApexEvent[] =>
  event?.isFrame ? event.children : [];
const span = (e: ApexEvent | undefined) => [e?.type, e?.timestamp, e?.exitStamp];

describe('frames the next line closes', () => {
  it('ends each at the next line, and the last, with no line after it, where it starts', () => {
    const log = parse(
      '00:00:00.757 (1)|WF_APPROVAL_SUBMIT|[Record: myrecord1 anId1]\n' +
        '00:00:00.757 (2)|WF_PROCESS_FOUND|ProcessDefinitionNameOrId:<processId>|Applicable process was found.\n' +
        '00:00:00.757 (3)|WF_APPROVAL_SUBMIT|[Record: myrecord2 anId2]\n' +
        '00:00:00.757 (4)|WF_PROCESS_FOUND|ProcessDefinitionNameOrId:<processId>|Applicable process was found.',
    );
    expect(log.duration).toEqual({ self: 0, total: 3 });
    expect(log.children.map((e) => [e.type, e.timestamp, e.duration.total, e.parent])).toEqual([
      ['WF_APPROVAL_SUBMIT', 1, 1, null],
      ['WF_PROCESS_FOUND', 2, 1, null],
      ['WF_APPROVAL_SUBMIT', 3, 1, null],
      ['WF_PROCESS_FOUND', 4, 0, null],
    ]);
  });

  it('ends each at the next event, whether that opens a frame or closes the parent', () => {
    const approvers =
      '00:00:00.757 (1)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:ApprovalProcessActions\n' +
      '00:00:00.757 (2)|WF_NEXT_APPROVER|My User|Related User|: Approver\n' +
      '00:00:00.757 (3)|WF_NEXT_APPROVER|My User|Related User|: Approver\n' +
      '00:00:00.757 (4)|WF_NEXT_APPROVER|My User|Related User|: Approver\n';
    const thenMethod = parse(
      approvers +
        '00:00:00.757 (5)|METHOD_ENTRY|[17]|01p000000000AAA|ns.MyClass.myMethod()\n' +
        '00:00:00.757 (6)|METHOD_EXIT|[17]|01p000000000AAA|ns.MyClass.myMethod()\n' +
        '00:00:00.757 (7)|CODE_UNIT_FINISHED|Workflow:ApprovalProcessActions\n',
    );
    expect(thenMethod.duration).toEqual({ self: 0, total: 6 });
    expect(kids(thenMethod.children[0]).map(span)).toEqual([
      ['WF_NEXT_APPROVER', 2, 3],
      ['WF_NEXT_APPROVER', 3, 4],
      ['WF_NEXT_APPROVER', 4, 5],
      ['METHOD_ENTRY', 5, 6],
    ]);

    const thenExit = parse(
      `${approvers}00:00:00.757 (5)|CODE_UNIT_FINISHED|Workflow:ApprovalProcessActions\n`,
    );
    expect(thenExit.duration).toEqual({ self: 0, total: 4 });
    expect(kids(thenExit.children[0]).map(span)).toEqual([
      ['WF_NEXT_APPROVER', 2, 3],
      ['WF_NEXT_APPROVER', 3, 4],
      ['WF_NEXT_APPROVER', 4, 5],
    ]);
  });
});

describe('where the log starts', () => {
  it('starts at the first timestamped line, so a USER_INFO is the first event', () => {
    const log = parse(
      '64.0 APEX_CODE,FINE;APEX_PROFILING,FINE\n' +
        '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com|Greenwich Mean Time|GMT+01:00\n' +
        '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
        '09:18:22.6 (6586704)|CODE_UNIT_STARTED|[EXTERNAL]|066000000000AAA|ns.VFRemote: ns.MyController invoke(save)\n' +
        '09:19:13.82 (51592737891)|CODE_UNIT_FINISHED|ns.VFRemote: ns.MyController invoke(save)\n' +
        '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n',
    );
    expect(log.children.map((e) => e.type)).toEqual(['USER_INFO', 'EXECUTION_STARTED']);
    expect(kids(log.children[1]).map((e) => e.type)).toEqual(['CODE_UNIT_STARTED']);
    expect([log.timestamp, log.parsingErrors]).toEqual([6508409, []]);
  });

  it('reads the settings line from the header only', () => {
    const log = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|USER_DEBUG|[1]|DEBUG|pasted header follows:\n' +
        '64.0 APEX_CODE,FINE;APEX_PROFILING,FINE\n' +
        '09:18:22.6 (300)|EXECUTION_FINISHED\n',
    );
    expect([log.debugLevels, log.debugLevelSettings]).toEqual([{}, []]);
  });

  it('starts after a header line that states no nanosecond counter', () => {
    const log = parse(
      '64.0 APEX_CODE,FINE;APEX_PROFILING,FINE\n' +
        '09:18:22.6|USER_INFO|[EXTERNAL]|005000000000AAA\n' +
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|EXECUTION_FINISHED\n',
    );
    expect(log.children.map((e) => e.type)).toEqual(['EXECUTION_STARTED']);
    expect(log.debugLevels).toEqual({ apexCode: 'FINE', apexProfiling: 'FINE' });
  });

  it('starts at the first event of a log with no EXECUTION_STARTED', () => {
    const log = parse(
      '64.0 APEX_CODE,FINE;APEX_PROFILING,FINE\n' +
        'Execute Anonymous: System.debug(1);\n' +
        '09:18:22.6 (100)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000AAA|__sfdc_trigger/ns/Invoice\n' +
        '09:18:22.6 (200)|CODE_UNIT_FINISHED|__sfdc_trigger/ns/Invoice\n',
    );
    expect(log.children.map((e) => e.type)).toEqual(['CODE_UNIT_STARTED']);
    expect([log.debugLevels, log.parsingErrors]).toEqual([
      { apexCode: 'FINE', apexProfiling: 'FINE' },
      [],
    ]);
  });
});

describe('suffixes', () => {
  it('names the frames whose text cannot say what they are', () => {
    const log = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000AAA|__sfdc_trigger/ns/Invoice\n' +
        '09:18:22.6 (300)|ENTERING_MANAGED_PKG|ns\n' +
        '09:18:22.6 (400)|FLOW_START_INTERVIEW_BEGIN|91080693a3c1|Account Before Save LC\n' +
        '09:18:22.6 (500)|FLOW_START_INTERVIEW_END|91080693a3c1|Account Before Save LC\n' +
        '09:18:22.6 (600)|CODE_UNIT_FINISHED|__sfdc_trigger/ns/Invoice\n' +
        '09:18:22.6 (700)|EXECUTION_FINISHED\n',
    );
    expect([...log.events].map((e) => [e.type, e.suffix])).toEqual([
      ['EXECUTION_STARTED', null],
      ['CODE_UNIT_STARTED', ' (code unit)'],
      ['ENTERING_MANAGED_PKG', ' (managed package)'],
      ['FLOW_START_INTERVIEW_BEGIN', ' (flow)'],
    ]);
  });
});

describe('issues from exceptions', () => {
  it('reports a limit exception and a fatal error, but no other exception', () => {
    const log = logOf(
      `${at(1)}|LIMIT_USAGE_FOR_NS|(default)|`,
      '  Maximum CPU time: 15 out of 10000 ******* CLOSE TO LIMIT',
      `${at(2)}|EXCEPTION_THROWN|[1]|System.NullPointerException`,
      `${at(3)}|EXCEPTION_THROWN|[2]|System.LimitException: Too many SOQL queries: 101`,
      `${at(4)}|FATAL_ERROR|System.LimitException: Too many SOQL queries: 101`,
      '',
      'Class.ns.MyClass.run: line 2, column 1',
    );
    expect(log.limits.snapshots[0]?.limits.cpuTime.used).toBe(15);
    // The fatal error's description is its stack, after the blank line.
    expect(log.issues.map((i) => [i.type, i.event?.id, i.summary, i.description])).toEqual([
      ['error', 3, 'System.LimitException: Too many SOQL queries: 101', ''],
      [
        'fatal',
        4,
        'System.LimitException: Too many SOQL queries: 101',
        'Class.ns.MyClass.run: line 2, column 1',
      ],
    ]);
  });

  it('states no description for a fatal error with no stack lines', () => {
    const log = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
        '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p000000000AAA|MyClass.run()\n' +
        '16:16:04.97 (1000)|FATAL_ERROR|System.LimitException: ns:Too many SOQL queries: 101\n' +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );
    expect(log.issues.map((i) => [i.type, i.summary, i.description])).toEqual([
      ['fatal', 'System.LimitException: ns:Too many SOQL queries: 101', ''],
    ]);
  });

  it('keeps the whole first line of an exception as its summary, however long', () => {
    const message =
      'System.LimitException: Update failed. First exception on row 0 with id a00000000000000AAA; ' +
      'first error: CANNOT_EXECUTE_FLOW_TRIGGER, this message runs well past the old 99 character cap';
    const log = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
        `16:16:04.97 (1000)|EXCEPTION_THROWN|[60]|${message}\n` +
        '09:19:13.82 (2000)|EXECUTION_FINISHED\n',
    );
    expect(log.issues.map((i) => [i.summary, i.description])).toEqual([[message, '']]);
  });
});

describe('frames and leaves by line', () => {
  it('holds a limit block inside the cumulative usage frame', () => {
    const log = parse(
      '09:18:22.6 (6574780)|EXECUTION_STARTED\n' +
        '14:29:44.163 (40163621912)|CUMULATIVE_LIMIT_USAGE\n' +
        '14:29:44.163 (40163621912)|LIMIT_USAGE_FOR_NS|(default)|\n' +
        '  Number of SOQL queries: 8 out of 100\n' +
        '14:29:44.163 (40163621912)|CUMULATIVE_LIMIT_USAGE_END\n' +
        '09:19:13.82 (51595120059)|EXECUTION_FINISHED\n',
    );
    const usage = kids(log.children[0]);
    expect(usage.map((e) => e.type)).toEqual(['CUMULATIVE_LIMIT_USAGE']);
    expect(kids(usage[0]).map((e) => e.type)).toEqual(['LIMIT_USAGE_FOR_NS']);
  });

  it('reads a flow value that spans lines as one text', () => {
    const log = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.670 (200)|FLOW_VALUE_ASSIGNMENT|91080693a3c1|myVariable_old|{Id=a00000000000000AAA, Notes__c=1Z 000 0001\n' +
        '1Z 000 0002\n' +
        '1Z 000 0003}\n' +
        '09:19:13.82 (300)|EXECUTION_FINISHED',
    );
    expect(kids(log.children[0]).map((e) => [e.type, e.text])).toEqual([
      [
        'FLOW_VALUE_ASSIGNMENT',
        'myVariable_old {Id=a00000000000000AAA, Notes__c=1Z 000 0001\n1Z 000 0002\n1Z 000 0003}',
      ],
    ]);
  });

  it('makes every page messages VF call a leaf, so none holds the calls after it', () => {
    const calls = [
      '/apexpage/pagemessagescomponentcontroller.apex <init>',
      '/apexpage/pagemessagescomponentcontroller.apex set(conEscape)',
      'PageMessagesComponentController set(conEscape)',
      'PageMessagesComponentController invoke(setconEscape)',
      '/apexpage/pagemessagescomponentcontroller.apex get(severities)',
      'pagemessagecomponentcontroller invoke(getstyleClass)',
      'severityMessages invoke(getlabel)',
      'severity',
      'isSingle',
      'messages',
    ];
    const log = parse(
      calls.map((c, i) => `09:15:43.263 (${i + 1})|VF_APEX_CALL_START|[EXTERNAL]|${c}`).join('\n'),
    );
    expect(log.children.map((e) => e.isFrame)).toEqual(calls.map(() => false));
  });
});

const PROCESS_BUILDER =
  '17:52:34.317 (1350000000)|EXECUTION_STARTED\n' +
  '17:52:35.317 (1363038330)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:01I000000000AAA\n' +
  '17:52:35.370 (1363038331)|FLOW_START_INTERVIEWS_BEGIN|1\n' +
  '17:52:35.370 (1363038332)|FLOW_START_INTERVIEW_BEGIN|91080693a3c1|Example Process Builder\n' +
  '17:52:35.370 (1363038333)|FLOW_START_INTERVIEWS_BEGIN|1\n' +
  '17:52:35.370 (1363038334)|FLOW_START_INTERVIEW_BEGIN|91080693a3c1|Example Flow\n' +
  '17:52:35.370 (1363038335)|FLOW_START_INTERVIEW_END|91080693a3c1|Example Flow\n' +
  '17:52:35.370 (1363038336)|FLOW_START_INTERVIEWS_END|1\n' +
  '17:52:35.370 (1363038337)|FLOW_START_INTERVIEW_END|91080693a3c1|Example Process Builder\n' +
  '17:52:35.370 (1363038338)|FLOW_START_INTERVIEWS_END|1\n' +
  '17:52:35.317 (1363038339)|CODE_UNIT_FINISHED|Workflow:01I000000000AAA\n' +
  '17:52:36.317 (1500000000)|EXECUTION_FINISHED\n';

describe('flows', () => {
  it('names a flow a process builder started as a flow, with its own times', () => {
    const log = parse(PROCESS_BUILDER);
    const [builder, flow] = log.ofType('FLOW_START_INTERVIEWS_BEGIN');
    expect([builder?.text, builder?.suffix, flow?.text, flow?.suffix]).toEqual([
      'Example Process Builder',
      ' (Process Builder)',
      'Example Flow',
      ' (Flow)',
    ]);
    expect(flow?.parent?.type).toBe('FLOW_START_INTERVIEW_BEGIN');
    expect([flow?.duration, kids(flow)[0]?.duration]).toEqual([
      { self: 2, total: 3 },
      { self: 1, total: 1 },
    ]);
  });
});

describe("the log's times", () => {
  it('ends the log at its last line, and the execution at the last frame that ends', () => {
    const log = parse(
      PROCESS_BUILDER +
        '17:52:36.320 (1510000000)|FLOW_START_INTERVIEWS_BEGIN|2\n' +
        '17:52:36.320 (1520000000)|FLOW_START_INTERVIEWS_END|2\n' +
        '17:52:36.321 (1530000000)|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: 0 out of 100',
    );
    expect([log.exitStamp, log.executionEndTime]).toEqual([1530000000, 1520000000]);
  });

  it('states an execution end of 0 for a log of leaves only', () => {
    const log = parse(
      [1500000000, 1510000000, 1520000000, 1530000000]
        .map(
          (ns, i) =>
            `17:52:36.321 (${ns})|FLOW_INTERVIEW_FINISHED_LIMIT_USAGE|SOQL queries: ${i} out of 100`,
        )
        .join('\n'),
    );
    expect([log.exitStamp, log.executionEndTime]).toEqual([1530000000, 0]);
  });
});

describe('package entries', () => {
  it('merges a run of one namespace, ends it at a frame, and keeps the DML that ends one', () => {
    const log = parse(
      '11:52:06.13 (100)|EXECUTION_STARTED\n' +
        '11:52:06.13 (200)|METHOD_ENTRY|[185]|01p000000000AAA|ns.MyClass.myMethod()\n' +
        '11:52:06.13 (151717928)|ENTERING_MANAGED_PKG|ns\n' +
        '11:52:06.13 (300)|METHOD_EXIT|[185]|01p000000000AAA|ns.MyClass.myMethod()\n' +
        '11:52:06.13 (400)|ENTERING_MANAGED_PKG|ns\n' +
        '11:52:06.13 (500)|ENTERING_MANAGED_PKG|ns\n' +
        '11:52:06.13 (600)|ENTERING_MANAGED_PKG|ns\n' +
        '11:52:06.13 (700)|ENTERING_MANAGED_PKG|ns2\n' +
        '11:52:06.13 (725)|DML_BEGIN|[194]|Op:Update|Type:ns2__MyObject__c|Rows:1\n' +
        '11:52:06.13 (750)|DML_END|[194]\n' +
        '11:52:06.13 (800)|ENTERING_MANAGED_PKG|ns2\n' +
        '11:52:06.13 (900)|ENTERING_MANAGED_PKG|ns2\n' +
        '11:52:06.13 (1000)|ENTERING_MANAGED_PKG|ns2\n' +
        '11:52:06.13 (1100)|ENTERING_MANAGED_PKG|ns2\n',
    );
    expect([log.children.length, log.exitStamp, log.executionEndTime]).toEqual([1, 1100, 1100]);
    const top = kids(log.children[0]);
    expect(top.map((e) => [e.type, e.timestamp, e.exitStamp, e.namespace])).toEqual([
      // A three-part name states a namespace only once the log has stated it.
      ['METHOD_ENTRY', 200, 300, null],
      ['ENTERING_MANAGED_PKG', 400, 700, 'ns'],
      ['ENTERING_MANAGED_PKG', 700, 725, 'ns2'],
      ['DML_BEGIN', 725, 750, null],
      ['ENTERING_MANAGED_PKG', 800, 1100, 'ns2'],
    ]);
    expect(kids(top[0]).map((e) => [e.type, e.namespace])).toEqual([
      ['ENTERING_MANAGED_PKG', 'ns'],
    ]);
  });
});

describe('the settings line', () => {
  it('states the level of each category it declares, and no other', () => {
    const log = parse(
      '43.0 APEX_CODE,FINE;APEX_PROFILING,NONE;CALLOUT,NONE;DB,INFO;NBA,NONE;SYSTEM,NONE;VALIDATION,INFO;VISUALFORCE,NONE;WAVE,NONE;WORKFLOW,INFO\n' +
        '09:18:22.6 (6508409)|USER_INFO|[EXTERNAL]|005000000000AAA|user@example.com.sandbox|Greenwich Mean Time|GMTZ\n' +
        '09:18:22.6 (6574780)|EXECUTION_STARTED',
    );
    expect(log.debugLevels).toEqual({
      apexCode: 'FINE',
      apexProfiling: 'NONE',
      callout: 'NONE',
      database: 'INFO',
      nba: 'NONE',
      system: 'NONE',
      validation: 'INFO',
      visualforce: 'NONE',
      wave: 'NONE',
      workflow: 'INFO',
    });
    expect(log.parsingErrors).toEqual([]);
  });

  it('keeps every entry as stated, reports only an unknown level, and ignores an empty entry', () => {
    const log = parse(
      '61.0 APEX_CODE,FINE;APEX_PROFILING,WIBBLE;FUTURE_CATEGORY,FINE;;NO_COMMA;NO_LEVEL,;DB,FINE,EXTRA\n' +
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|EXECUTION_FINISHED\n',
    );
    expect(log.debugLevels).toEqual({ apexCode: 'FINE' });
    expect(log.debugLevelSettings).toEqual([
      { token: 'APEX_CODE', level: 'FINE', category: 'apexCode' },
      { token: 'APEX_PROFILING', level: 'WIBBLE', category: 'apexProfiling' },
      { token: 'FUTURE_CATEGORY', level: 'FINE', category: null },
      { token: 'NO_COMMA', level: null, category: null },
      { token: 'NO_LEVEL', level: null, category: null },
      { token: 'DB', level: 'FINE,EXTRA', category: 'database' },
    ]);
    expect(log.parsingErrors).toEqual([
      'Unsupported debug level: APEX_PROFILING,WIBBLE',
      'Unsupported debug level: DB,FINE,EXTRA',
    ]);
  });
});

describe('the end of the log', () => {
  it('ends a max-size region at the log end when nothing follows, after the Unexpected-End', () => {
    const log = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n\n' +
        '15:20:52.222 (200)|METHOD_ENTRY|[185]|01p000000000AAA|MyClass.run()\n' +
        '15:20:52.222 (1000)|METHOD_EXIT|[185]|01p000000000AAA|MyClass.run()\n' +
        '*********** MAXIMUM DEBUG LOG SIZE REACHED ***********\n',
    );
    expect(log.children[0]?.exitStamp).toBe(1000);
    expect(log.issues.map((i) => i.summary)).toEqual(['Max-Size-reached', 'Unexpected-End']);
    expect(log.truncation.regions.map((r) => [r.kind, r.startTime, r.endTime])).toEqual([
      ['max-size', 1000, 1000],
    ]);
  });
});

describe('the tree', () => {
  it('keeps an exit line no frame matches as a child, with an Unexpected-Exit issue on it', () => {
    const log = logOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|CONSTRUCTOR_EXIT|[9]|01p000000000AAA|ns.Other`,
      `${at(3)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
    );
    expect(outline(log)).toEqual(['METHOD_ENTRY@1-3', '  CONSTRUCTOR_EXIT@2']);
    expect(log.issues.map((i) => [i.summary, i.startTime, i.event?.id])).toEqual([
      ['Unexpected-Exit', 2, 2],
    ]);
  });

  it('unwinds every frame an exception passes, and an exit closes the frame it matches below', () => {
    const log = logOf(
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.outer()`,
      `${at(2)}|METHOD_ENTRY|[2]|01p000000000AAA|ns.MyClass.inner()`,
      `${at(3)}|EXCEPTION_THROWN|[3]|System.NullPointerException`,
      `${at(4)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.outer()`,
      `${at(5)}|METHOD_ENTRY|[5]|01p000000000AAA|ns.MyClass.next()`,
      `${at(6)}|METHOD_ENTRY|[6]|01p000000000AAA|ns.MyClass.deep()`,
      `${at(7)}|METHOD_EXIT|[5]|01p000000000AAA|ns.MyClass.next()`,
    );
    expect(outline(log)).toEqual([
      'METHOD_ENTRY@1-4',
      '  METHOD_ENTRY@2-4',
      '    EXCEPTION_THROWN@3',
      'METHOD_ENTRY@5-7',
      '  METHOD_ENTRY@6-7',
    ]);
    expect(log.issues).toEqual([]);
  });

  it('times the log from a last package entry before it merges', () => {
    const log = logOf(
      `${at(1)}|ENTERING_MANAGED_PKG|ns`,
      `${at(2)}|STATEMENT_EXECUTE|[1]`,
      `${at(3)}|ENTERING_MANAGED_PKG|ns`,
    );
    expect(outline(log)).toEqual(['ENTERING_MANAGED_PKG@1-3', 'STATEMENT_EXECUTE@2']);
    expect([log.exitStamp, log.executionEndTime]).toEqual([3, 2]);
  });

  it('reads a CRLF log as an LF log, and starts at the first timestamped line', () => {
    const lines = [
      `${at(1)}|METHOD_ENTRY|[1]|01p000000000AAA|ns.MyClass.run()`,
      `${at(2)}|METHOD_EXIT|[1]|01p000000000AAA|ns.MyClass.run()`,
    ];
    const crlf = parse(['garbage before the log', HEADER, ...lines, ''].join('\r\n'));
    expect(outline(crlf)).toEqual(outline(logOf(...lines)));
    expect(crlf.parsingErrors).toEqual([]);
  });
});

describe('parsing errors', () => {
  it('reports each line that is no event and no text, and each unknown name once', () => {
    const log = logOf(
      `${at(1)}|USER_DEBUG|[1]|DEBUG|first`,
      'second',
      `${at(2)}|STATEMENT_EXECUTE|[2]`,
      'not text',
      'x|NOT_A_TYPE',
      'x|NOT_A_TYPE',
      '64.0 APEX_CODE,FINE;APEX_PROFILING,INFO',
      `${at(3)}|STATEMENT_EXECUTE|[]`,
    );
    expect(outline(log)).toEqual(['USER_DEBUG@1', 'STATEMENT_EXECUTE@2', 'STATEMENT_EXECUTE@3']);
    // A bad line number is an error, not the end of the parse.
    expect(log.parsingErrors).toEqual([
      'Invalid log line: not text',
      'Unsupported log event name: NOT_A_TYPE',
      `Invalid line number: ${at(3)}|STATEMENT_EXECUTE|[]`,
    ]);
    expect(log.event(3)?.lineNumber).toBeNull();
  });
});
