/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
// Placeholder names and ids only: no text here comes from an org, only the numbers in profiles.json.
import type { ProfileName } from './measure.js';
import profiles from './profiles.json' with { type: 'json' };

type Field = string | number;

class LogWriter {
  readonly lines: string[] = [];
  readonly random: () => number;
  /** Log length so far, in UTF-16 code units. */
  size = 0;
  private nanos = 2_500_000;
  /** Closers of the open frames, innermost last. */
  private readonly frames: (() => void)[] = [];
  private readonly profile: Profile;

  constructor(random: () => number, profile: Profile) {
    this.random = random;
    this.profile = profile;
  }

  /** The profile's mean wrapped lines for an event of `type`. */
  wrappedLines(type: string): number {
    return this.profile.wrappedLinesPerEvent[type] ?? 0;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.random() * (max - min + 1));
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(0, items.length - 1)] as T;
  }

  lineNumber(): string {
    return `[${this.int(1, 500)}]`;
  }

  event(type: string, ...fields: Field[]): void {
    this.nanos += this.int(1_000, 400_000);
    const ms = Math.floor(this.nanos / 1_000_000);
    const clock = `09:${pad(Math.floor(ms / 60_000) % 60)}:${pad(Math.floor(ms / 1000) % 60)}.${String(ms % 1000).padStart(3, '0')}`;
    this.text([`${clock} (${this.nanos})`, type, ...fields].join('|'));
  }

  /** Moves the clock on, as a slow call does between its entry and exit. */
  wait(nanos: number): void {
    this.nanos += nanos;
  }

  /** A line with no timestamp: header, or the wrapped text of the event before it. */
  text(line: string): void {
    this.lines.push(line);
    this.size += line.length + 1;
  }

  /** An event whose first line is `fields` then `lines[0]`, and whose text wraps onto the rest. */
  wrapped(type: string, fields: Field[], lines: string[]): void {
    const [first = '', ...rest] = lines;
    this.event(type, ...fields, first);
    for (const line of rest) this.text(line);
  }

  /** Opens a frame, or at `maxDepth` closes the innermost one instead. */
  frame(open: () => void, close: () => void): void {
    if (this.frames.length >= this.profile.maxDepth) {
      this.close();
      return;
    }
    open();
    this.frames.push(close);
  }

  close(): void {
    this.frames.pop()?.();
  }

  closeAll(): void {
    while (this.frames.length) this.close();
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

// mulberry32: a seeded PRNG, so a fixture never changes between runs.
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const methods: readonly (readonly [string, string])[] = [
  ['01p000000000AAA', 'MyClass.getDefaultCurrencyIsoCode()'],
  ['01p000000000AAA', 'MyClass.Inner.handleRecordChanges(String, List<SObject>)'],
  ['01p000000000AAA', 'MyTriggerHandler.beforeUpdate(Map<Id,SObject>, Map<Id,SObject>)'],
  ['01p000000000AAA', 'MyDomain.validateRecordsBeforeInsert(List<SObject>)'],
  ['01p000000000AAB', 'ns.MyAccountService.calculateRollupTotals(List<Account>)'],
  ['01p000000000AAB', 'ns.MyUnitOfWork.registerDirty(SObject, Schema.SObjectField)'],
  ['01p000000000AAB', 'ns.MyService.Inner.applyDiscountsToOpportunityLines(Map<Id,SObject>)'],
  ['01p000000000AAB', 'ns.MyInvoiceService.postInvoicesAndUpdateBalances(Set<Id>, Boolean)'],
  ['', 'MyAccountsSelector.selectByIdWithContacts(Set<Id>)'],
];
const classes = [
  'MyClass',
  'MyClass.RecordWrapper',
  'ns.MyAccountService',
  'ns.MyAccountService.AccountRollupCalculator',
];
const systemMethods = [
  'System.debug(ANY)',
  'List<SObject>.add(Object)',
  'Map<Id,SObject>.get(Object)',
  'String.isBlank(String)',
  'Database.query(String, System.AccessLevel)',
  'Map<Id,SObject>.putAll(List<SObject>)',
  'Schema.SObjectType.getDescribe()',
];
const variables = [
  'this.name',
  'records',
  'i',
  'ns.MyAccountService.cache',
  'result',
  'recordsById',
];
const objects = ['Account', 'Contact', 'ns__MyObject__c'];
const dmlOperations = ['Insert', 'Update', 'Delete'];
const limitCodes = ['SOQL', 'SOQL_ROWS', 'DML', 'DML_ROWS'];
const statics = [
  '_cache',
  '_is_running',
  '_records_by_id',
  '_trigger_disabled',
  '_settings_loaded',
];

function record(w: LogWriter): string {
  return `{"Id":"001000000000AAA","Name":"Record ${w.int(1, 1000)}","Amount__c":${w.int(0, 100_000)},"Status__c":"Open"}`;
}

function codeUnit(w: LogWriter, unit: string, body: () => void): void {
  w.event('CODE_UNIT_STARTED', '[EXTERNAL]', unit);
  body();
  w.event('CODE_UNIT_FINISHED', unit);
}

const triggerUnit = 'MyTrigger on Account trigger event BeforeUpdate';

function triggerStarted(w: LogWriter): void {
  w.event(
    'CODE_UNIT_STARTED',
    '[EXTERNAL]',
    '01q000000000AAA',
    triggerUnit,
    '__sfdc_trigger/MyTrigger',
  );
}

function limitsBlock(w: LogWriter): void {
  w.event('CUMULATIVE_LIMIT_USAGE');
  for (const namespace of ['(default)', 'ns']) {
    w.event('LIMIT_USAGE_FOR_NS', namespace, '');
    w.text(`  Number of SOQL queries: ${w.int(0, 100)} out of 100`);
    w.text(`  Number of query rows: ${w.int(0, 50_000)} out of 50000`);
    w.text('  Number of SOSL queries: 0 out of 20');
    w.text(`  Number of DML statements: ${w.int(0, 150)} out of 150`);
    w.text('  Number of Publish Immediate DML: 0 out of 150');
    w.text(`  Number of DML rows: ${w.int(0, 10_000)} out of 10000`);
    w.text(`  Maximum CPU time: ${w.int(0, 10_000)} out of 10000`);
    w.text(`  Maximum heap size: ${w.int(0, 6_000_000)} out of 6000000`);
    w.text('  Number of callouts: 0 out of 100');
    w.text('  Number of Email Invocations: 0 out of 10');
    w.text('  Number of future calls: 0 out of 50');
    w.text('  Number of queueable jobs added to the queue: 0 out of 50');
    w.text('  Number of Mobile Apex push calls: 0 out of 10');
  }
  w.event('CUMULATIVE_LIMIT_USAGE_END');
}

type Shape =
  | 'method'
  | 'construct'
  | 'close'
  | 'statement'
  | 'heap'
  | 'variableAssignment'
  | 'variableScope'
  | 'managedPackage'
  | 'systemModeEnter'
  | 'systemModeExit'
  | 'systemMethod'
  | 'vfFormula'
  | 'vfApexCall'
  | 'userDebug'
  | 'userDebugJson'
  | 'userDebugWrapped'
  | 'staticVariables'
  | 'exception'
  | 'soql'
  | 'dml'
  | 'limitUsage'
  | 'limits'
  | 'codeUnitFrame'
  | 'trigger'
  | 'validation'
  | 'workflow'
  | 'flow';

interface ShapeSpec {
  /** The events whose profile weight the shape takes. */
  weightOf: readonly string[];
  /** Events it writes once each besides its own, whose weight another shape takes. */
  alsoWrites?: readonly string[];
  /** Rare and long, so placed at its exact rate: chance would give a small log none or several. */
  rate?: true;
  /** Writes one event, or a group the platform always writes together. */
  write(w: LogWriter): void;
}

/** The entry and exit writers of one random method call. */
function methodEvents(w: LogWriter): [open: () => void, close: () => void] {
  const [id, name] = w.pick(methods);
  const line = w.lineNumber();
  return [
    () => w.event('METHOD_ENTRY', line, id, name),
    () => w.event('METHOD_EXIT', line, id, name),
  ];
}

const shapes: Readonly<Record<Shape, ShapeSpec>> = {
  method: {
    weightOf: ['METHOD_ENTRY'],
    write(w) {
      const [open, close] = methodEvents(w);
      w.frame(open, close);
    },
  },
  construct: {
    weightOf: ['CONSTRUCTOR_ENTRY'],
    write(w) {
      const fields = [
        w.lineNumber(),
        '01p000000000AAA',
        '<init>(Map<Id,SObject>, List<SObject>)',
        w.pick(classes),
      ];
      w.frame(
        () => w.event('CONSTRUCTOR_ENTRY', ...fields),
        () => w.event('CONSTRUCTOR_EXIT', ...fields),
      );
    },
  },
  close: {
    weightOf: ['METHOD_EXIT', 'CONSTRUCTOR_EXIT', 'CODE_UNIT_FINISHED'],
    write(w) {
      w.close();
    },
  },
  statement: {
    weightOf: ['STATEMENT_EXECUTE'],
    write(w) {
      w.event('STATEMENT_EXECUTE', w.lineNumber());
    },
  },
  heap: {
    weightOf: ['HEAP_ALLOCATE'],
    write(w) {
      w.event('HEAP_ALLOCATE', w.lineNumber(), `Bytes:${w.int(4, 512)}`);
    },
  },
  variableAssignment: {
    weightOf: ['VARIABLE_ASSIGNMENT'],
    write(w) {
      const roll = w.random();
      if (roll < 0.3) {
        w.event('VARIABLE_ASSIGNMENT', w.lineNumber(), w.pick(variables), w.int(0, 1000));
      } else {
        const value = roll < 0.5 ? `"Record ${w.int(1, 1000)}"` : record(w);
        const address = `0x${w.int(0x1000, 0xffffff).toString(16)}`;
        w.event('VARIABLE_ASSIGNMENT', w.lineNumber(), w.pick(variables), value, address);
      }
    },
  },
  variableScope: {
    weightOf: ['VARIABLE_SCOPE_BEGIN'],
    write(w) {
      w.event(
        'VARIABLE_SCOPE_BEGIN',
        w.lineNumber(),
        w.pick(variables),
        'Map<Id,SObject>',
        'true',
        'false',
      );
    },
  },
  managedPackage: {
    weightOf: ['ENTERING_MANAGED_PKG'],
    write(w) {
      w.event('ENTERING_MANAGED_PKG', 'ns');
    },
  },
  systemModeEnter: {
    weightOf: ['SYSTEM_MODE_ENTER'],
    write(w) {
      w.event('SYSTEM_MODE_ENTER', 'false');
    },
  },
  systemModeExit: {
    weightOf: ['SYSTEM_MODE_EXIT'],
    write(w) {
      w.event('SYSTEM_MODE_EXIT', 'false');
    },
  },
  systemMethod: {
    weightOf: ['SYSTEM_METHOD_ENTRY'],
    write(w) {
      const line = w.lineNumber();
      const name = w.pick(systemMethods);
      w.event('SYSTEM_METHOD_ENTRY', line, name);
      w.event('SYSTEM_METHOD_EXIT', line, name);
    },
  },
  vfFormula: {
    weightOf: ['VF_EVALUATE_FORMULA_BEGIN'],
    write(w) {
      w.event('VF_EVALUATE_FORMULA_BEGIN', '066000000000AAA', '{!record.Name}');
      w.event('VF_EVALUATE_FORMULA_END');
    },
  },
  vfApexCall: {
    weightOf: ['VF_APEX_CALL_START'],
    write(w) {
      w.event(
        'VF_APEX_CALL_START',
        '[EXTERNAL]',
        '01p000000000AAA',
        'MyController get(record)',
        'MyController',
      );
      w.event('VF_APEX_CALL_END', 'MyController', 'get(record)');
    },
  },
  userDebug: {
    weightOf: ['USER_DEBUG'],
    write(w) {
      w.event(
        'USER_DEBUG',
        w.lineNumber(),
        'DEBUG',
        `Record ${w.int(1, 1000)} processed by MyClass.run with status Open`,
      );
    },
  },
  userDebugJson: {
    weightOf: [],
    write(w) {
      // Large logs often serialise whole records onto one line.
      const records = Array.from({ length: w.int(5, 40) }, () => record(w));
      w.event('USER_DEBUG', w.lineNumber(), 'DEBUG', `[${records.join(',')}]`);
    },
  },
  userDebugWrapped: {
    weightOf: [],
    write(w) {
      const rows = Array.from({ length: w.int(2, 10) }, () => `  ${record(w)},`);
      // A wrapped line can hold a '|', and a blank line.
      w.wrapped(
        'USER_DEBUG',
        [w.lineNumber(), 'DEBUG'],
        ['{"records":[', ...rows, '  | Name | Amount |', '', ']}'],
      );
    },
  },
  staticVariables: {
    weightOf: ['STATIC_VARIABLE_LIST'],
    rate: true,
    write(w) {
      const lines = Array.from(
        { length: Math.round(w.wrappedLines('STATIC_VARIABLE_LIST') * (0.5 + w.random())) },
        () => `${w.pick(classes)}:${w.pick(statics)}:${w.int(0, 100_000)}`,
      );
      w.wrapped('STATIC_VARIABLE_LIST', [], ['', ...lines]);
    },
  },
  exception: {
    weightOf: ['EXCEPTION_THROWN'],
    write(w) {
      w.event(
        'EXCEPTION_THROWN',
        w.lineNumber(),
        'System.NullPointerException: Attempt to de-reference a null object',
      );
    },
  },
  soql: {
    weightOf: ['SOQL_EXECUTE_BEGIN'],
    write(w) {
      const line = w.lineNumber();
      w.event(
        'SOQL_EXECUTE_BEGIN',
        line,
        'Aggregations:0',
        `SELECT Id, Name FROM ${w.pick(objects)} WHERE Id IN :ids`,
      );
      if (w.random() < 0.5) {
        w.event(
          'SOQL_EXECUTE_EXPLAIN',
          line,
          'Index on Account : [Id], cardinality: 1, sobjectCardinality: 100, relativeCost 0.1',
        );
      }
      w.event('SOQL_EXECUTE_END', line, `Rows:${w.int(0, 200)}`);
    },
  },
  dml: {
    weightOf: ['DML_BEGIN'],
    write(w) {
      const line = w.lineNumber();
      w.event(
        'DML_BEGIN',
        line,
        `Op:${w.pick(dmlOperations)}`,
        `Type:${w.pick(objects)}`,
        `Rows:${w.int(1, 200)}`,
      );
      w.event('DML_END', line);
    },
  },
  limitUsage: {
    weightOf: ['LIMIT_USAGE'],
    write(w) {
      w.event('LIMIT_USAGE', w.lineNumber(), w.pick(limitCodes), w.int(0, 100), 100);
    },
  },
  limits: {
    weightOf: ['CUMULATIVE_LIMIT_USAGE'],
    rate: true,
    write: limitsBlock,
  },
  codeUnitFrame: {
    weightOf: ['CODE_UNIT_STARTED'],
    write(w) {
      w.frame(
        () => triggerStarted(w),
        () => w.event('CODE_UNIT_FINISHED', triggerUnit),
      );
    },
  },
  // A trigger fired by its DML; only the flow bench asks for it, as real logs hold far fewer DML.
  trigger: {
    weightOf: [],
    write(w) {
      const line = w.lineNumber();
      w.frame(
        () => {
          w.event('DML_BEGIN', line, 'Op:Update', 'Type:Account', `Rows:${w.int(1, 200)}`);
          triggerStarted(w);
        },
        () => {
          w.event('CODE_UNIT_FINISHED', triggerUnit);
          w.event('DML_END', line);
        },
      );
    },
  },
  validation: {
    weightOf: ['VALIDATION_RULE'],
    alsoWrites: ['CODE_UNIT_STARTED', 'CODE_UNIT_FINISHED'],
    write(w) {
      codeUnit(w, 'Validation:Account:001000000000AAA', () => {
        w.event('VALIDATION_RULE', '03d000000000AAA', 'My_Validation_Rule');
        w.wrapped(
          'VALIDATION_FORMULA',
          [],
          [
            'AND(',
            '  ISBLANK(Name),',
            `  Amount__c > ${w.int(0, 100)}`,
            ')|Name=Record 1, Amount__c=5',
          ],
        );
        w.event('VALIDATION_PASS');
      });
    },
  },
  workflow: {
    weightOf: ['WF_CRITERIA_BEGIN'],
    alsoWrites: ['CODE_UNIT_STARTED', 'CODE_UNIT_FINISHED'],
    write(w) {
      const record = '[Account: Record 1 001000000000AAA]';
      codeUnit(w, 'Workflow:Account', () => {
        w.event('WF_RULE_EVAL_BEGIN', 'Workflow');
        w.event(
          'WF_CRITERIA_BEGIN',
          record,
          'My Rule',
          '01Q000000000AAA',
          'ON_CREATE_OR_TRIGGERING_UPDATE',
          0,
        );
        w.event('WF_RULE_FILTER', '[Account : Name equals Record 1]');
        w.event('WF_RULE_EVAL_VALUE', w.int(0, 100));
        w.wrapped(
          'WF_FORMULA',
          [],
          ['Formula:AND(', '  ISCHANGED(Name),', '  NOT(ISBLANK(Name))', ')|Values:Name=Record 1'],
        );
        w.event('WF_CRITERIA_END', 'true');
        w.event(
          'WF_FIELD_UPDATE',
          record,
          'Field:Account: Description',
          'Value:Updated',
          'Id=04Y000000000AAA',
        );
        w.event('WF_RULE_EVAL_END');
      });
    },
  },
  flow: {
    weightOf: ['FLOW_START_INTERVIEW_BEGIN'],
    write(w) {
      const interview = `0000000000000000000000000000000000000-${w.int(1000, 9999)}`;
      const element = (type: string, name: string, body: () => void) => {
        w.event('FLOW_ELEMENT_BEGIN', interview, type, name);
        body();
        w.event('FLOW_ELEMENT_END', interview, type, name);
      };
      w.event('FLOW_START_INTERVIEWS_BEGIN', 1);
      w.event(
        'FLOW_CREATE_INTERVIEW_BEGIN',
        '00D000000000AAA',
        '300000000000AAA',
        '301000000000AAA',
      );
      w.event('FLOW_CREATE_INTERVIEW_END', interview, 'My Flow');
      w.event('FLOW_START_INTERVIEW_BEGIN', interview, 'My Flow');
      w.event('FLOW_START_INTERVIEW_LIMIT_USAGE', `SOQL queries: ${w.int(0, 100)} out of 100`);
      element('FlowDecision', 'My_Decision', () => {
        w.event('FLOW_RULE_DETAIL', interview, 'My_Decision', 'true', 'true');
      });
      element('FlowAssignment', 'Set_Values', () => {
        w.event('FLOW_ASSIGNMENT_DETAIL', interview, 'myVariable', 'ASSIGN', 'Record 1');
        w.event(
          'FLOW_VALUE_ASSIGNMENT',
          interview,
          'myVariable',
          '{Id=001000000000AAA, Name=Record 1}',
        );
      });
      element('FlowRecordUpdate', 'Update_Record', () => {
        w.event('FLOW_ELEMENT_LIMIT_USAGE', `1 DML statements, total ${w.int(1, 150)} out of 150`);
        w.event('FLOW_ELEMENT_LIMIT_USAGE', `1 DML rows, total ${w.int(1, 10_000)} out of 10000`);
      });
      if (w.random() < 0.3) {
        // A wrapped message with the element's fields on its last line.
        w.wrapped(
          'FLOW_ELEMENT_ERROR',
          [],
          ['Required fields are missing: [Name]', 'Fix the record.|FlowRecordCreate|Create_Record'],
        );
      }
      w.event('FLOW_START_INTERVIEW_END', interview, 'My Flow');
      w.event('FLOW_INTERVIEW_FINISHED', interview, 'My Flow');
      w.event('FLOW_INTERVIEW_FINISHED_LIMIT_USAGE', `DML statements: ${w.int(1, 150)} out of 150`);
      w.event('FLOW_START_INTERVIEWS_END', 1);
    },
  },
};

/** Relative weight of each shape; a profile's mix sums to about a million. Integers only. */
export type Mix = Readonly<Partial<Record<Shape, number>>>;

/** A size band of real logs: its event mix, how deep its frames go, and its wrapped lines. */
interface Profile {
  mix: Mix;
  maxDepth: number;
  /** Mean wrapped lines per event, by type, from profiles.json. */
  wrappedLinesPerEvent: Readonly<Record<string, number>>;
}

function mixOf(weights: Readonly<Record<string, number>>): Mix {
  const specs = Object.entries(shapes) as [Shape, ShapeSpec][];
  const own = (spec: ShapeSpec) =>
    spec.weightOf.reduce((sum, event) => sum + (weights[event] ?? 0), 0);
  // Events that other shapes also write are already in the log, so the owning shape takes the rest.
  const written = new Map<string, number>();
  for (const [, spec] of specs) {
    for (const event of spec.alsoWrites ?? [])
      written.set(event, (written.get(event) ?? 0) + own(spec));
  }
  const rest = (event: string) => Math.max(0, (weights[event] ?? 0) - (written.get(event) ?? 0));
  return Object.fromEntries(
    specs
      .map(([shape, spec]) => [shape, spec.weightOf.reduce((sum, event) => sum + rest(event), 0)])
      .filter(([, weight]) => weight),
  );
}

// maxDepth is tuned by hand to the profile's meanDepth, and needs a re-tune when profiles.json changes.
function profileOf(name: ProfileName, maxDepth: number): Profile {
  const { weights, wrappedLinesPerEvent } = profiles[name];
  return { mix: mixOf(weights), maxDepth, wrappedLinesPerEvent };
}

const large = profileOf('large', 34);

export const profileSettings: Readonly<Record<ProfileName, Profile>> = {
  small: profileOf('small', 9),
  developer: profileOf('developer', 20),
  // Large logs often write whole records onto one USER_DEBUG line, which lifts chars per event.
  large: {
    ...large,
    mix: { ...large.mix, userDebug: 0, userDebugJson: profiles.large.weights.USER_DEBUG },
  },
};

interface LogOptions extends Profile {
  seed: number;
  /** Approximate size of the log, in UTF-16 code units. */
  chars: number;
  executions?: number;
  crlf?: boolean;
}

/** A log of one profile's shape. */
export function profileLog(name: ProfileName, seed: number, chars: number): LogOptions {
  return { ...profileSettings[name], seed, chars };
}

export function makeLog(options: LogOptions): string {
  // Either would write nothing for ever.
  if (options.maxDepth < 1) throw new Error('maxDepth must be at least 1');
  const entries = Object.entries(options.mix) as [Shape, number][];
  if (!entries.some(([shape, weight]) => shape !== 'close' && weight > 0)) {
    throw new Error('The mix needs a shape other than close');
  }
  const w = new LogWriter(seededRandom(options.seed), options);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  const isRated = ([shape]: [Shape, number]) => 'rate' in shapes[shape];
  const blocks = entries
    .filter(isRated)
    .map(([shape, weight]) => ({ shape, rate: weight / total, due: 0 }));
  const others = entries.filter((entry) => !isRated(entry));
  const othersTotal = others.reduce((sum, [, weight]) => sum + weight, 0);
  const choose = (): Shape => {
    // Every block accrues on every call, so a due block does not hold back the others' rates.
    for (const block of blocks) block.due += block.rate;
    const due = blocks.find((block) => block.due >= 1);
    if (due) {
      due.due--;
      return due.shape;
    }
    let roll = w.int(0, othersTotal - 1);
    for (const [shape, weight] of others) {
      if (roll < weight) return shape;
      roll -= weight;
    }
    throw new Error('The mix has no weight');
  };

  w.text(
    '64.0 APEX_CODE,FINEST;APEX_PROFILING,INFO;CALLOUT,INFO;DB,INFO;NBA,INFO;SYSTEM,DEBUG;VALIDATION,INFO;VISUALFORCE,INFO;WAVE,INFO;WORKFLOW,INFO',
  );
  w.event(
    'USER_INFO',
    '[EXTERNAL]',
    '005000000000AAA',
    'user@example.com',
    '(GMT+00:00) Greenwich Mean Time (Europe/London)',
    'GMTZ',
  );
  const { executions = 1, crlf = false } = options;
  for (let execution = 1; execution <= executions; execution++) {
    w.event('EXECUTION_STARTED');
    codeUnit(w, 'execute_anonymous_apex', () => {
      // One slow call first, so later times pass 2^31 ns, where Node's V8 boxes them, as in a long real log.
      if (execution === 1) {
        const [open, close] = methodEvents(w);
        open();
        w.wait(2_500_000_000);
        close();
      }
      const end = (options.chars * execution) / executions;
      while (w.size < end) shapes[choose()].write(w);
      w.closeAll();
      limitsBlock(w);
    });
    w.event('EXECUTION_FINISHED');
  }

  const eol = crlf ? '\r\n' : '\n';
  return w.lines.join(eol) + eol;
}

interface BenchLog extends LogOptions {
  /** Event types the log must hold, for what the bench is named for. */
  covers: readonly string[];
}

const developer = profileSettings.developer;
const developerCovers = ['METHOD_ENTRY', 'CONSTRUCTOR_ENTRY', 'STATEMENT_EXECUTE', 'HEAP_ALLOCATE'];

/** The logs CodSpeed parses on every pull request, by bench name. */
export const benchLogs: Readonly<Record<string, BenchLog>> = {
  // The median real small log, 19 KB in 2026-10, with the header. Seed 5 reaches maxDepth at this size.
  'small 19 KB': {
    ...profileLog('small', 5, 17_500),
    covers: ['METHOD_ENTRY', 'SYSTEM_MODE_ENTER', 'SYSTEM_METHOD_ENTRY', 'LIMIT_USAGE_FOR_NS'],
  },
  // The developer band's floor: its 8 MB median takes over 2 min under simulation.
  'developer 1 MB': { ...profileLog('developer', 2, 1_000_000), covers: developerCovers },
  // The paths an average log seldom reaches, in one bench so the job stays short.
  'uncommon paths 500 KB': {
    ...profileLog('developer', 3, 500_000),
    maxDepth: 60,
    executions: 3,
    crlf: true,
    // More opens than closes, so the walk climbs to maxDepth and stays near it.
    mix: {
      ...developer.mix,
      method: Math.round((developer.mix.close ?? 0) * 1.2),
      soql: 20_000,
      dml: 10_000,
      heap: 250_000,
      limitUsage: 10_000,
      limits: 3_000,
      userDebugWrapped: 30_000,
      staticVariables: 3_000,
      trigger: 6_000,
      flow: 12_000,
      workflow: 8_000,
      validation: 8_000,
    },
    covers: [
      'SOQL_EXECUTE_BEGIN',
      'DML_BEGIN',
      'HEAP_ALLOCATE',
      'LIMIT_USAGE',
      'LIMIT_USAGE_FOR_NS',
      'USER_DEBUG',
      'STATIC_VARIABLE_LIST',
      'FLOW_ELEMENT_BEGIN',
      'FLOW_ELEMENT_ERROR',
      'WF_FORMULA',
      'VALIDATION_FORMULA',
      'CODE_UNIT_STARTED',
    ],
  },
};

/** Logs too large for a short CodSpeed job, for `pnpm run bench:large` to parse locally. */
export const largeLogs: Readonly<Record<string, LogOptions>> = {
  // The median developer log.
  'medium 8 MB': profileLog('developer', 6, 8_000_000),
  // A log cut at the 20 MB default limit is a developer log.
  'large 20 MB': profileLog('developer', 7, 20_000_000),
  'XL 100 MB': profileLog('large', 12, 100_000_000),
};
