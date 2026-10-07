/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { EventFields } from './fields.js';
import type { AfterRule, TextRule, TextSpec } from './text.js';
import {
  codeUnitText,
  constructorText,
  flowActionDetailText,
  flowActionErrorText,
  flowElementErrorAfter,
  flowInterviewsErrorAfter,
  limitsForNamespaceAfter,
  lineText,
  managedPackageText,
  methodExitText,
  rule,
  validationFormulaAfter,
  vfApexCallText,
  wfFormulaAfter,
} from './text.js';
import type {
  Category,
  CpuType,
  DebugCategory,
  EventType,
  EventTypeInfo,
  Fields,
  Kind,
  Level,
  Shape,
} from './types.js';
import { EVENT_TYPE_NAMES } from './types.js';

/** How a frame of a type closes. */
export type Closes = 'exit' | 'next-line' | 'next-event';

interface CommonDef {
  readonly kind?: Kind;
  readonly debugCategory: DebugCategory;
  readonly level: Level;
  readonly symbols?: boolean;
  readonly acceptsText?: boolean;
  readonly discontinuity?: boolean;
  readonly after?: AfterRule;
}

interface FrameDef extends CommonDef {
  readonly shape: 'frame';
  readonly category: Category;
  readonly cpu: CpuType;
  readonly suffix?: string;
}

/** A frame that an exit line of one of `exits` closes. */
interface ExitClosedDef extends FrameDef {
  readonly exits: readonly EventType[];
  readonly closes?: never;
}

/** A frame that the next line, or the next event, closes. */
interface OtherClosedDef extends FrameDef {
  readonly closes: Exclude<Closes, 'exit'>;
  readonly exits?: never;
}

interface PointDef extends CommonDef {
  readonly shape?: Exclude<Shape, 'frame'>;
  readonly category?: never;
  readonly cpu?: never;
  readonly suffix?: never;
  readonly exits?: never;
  readonly closes?: never;
}

type FieldName<T extends EventType> = keyof EventFields[T] & string;

/** One hand-written catalog entry. Omitted keys take the defaults in `infoOf`, `grammarOf` and `textOf`. */
type Def<T extends EventType> = (ExitClosedDef | OtherClosedDef | PointDef) & {
  /** The line's fields from field 2 on, in order. */
  readonly fields?: readonly FieldName<T>[];
  readonly text?: TextSpec<FieldName<T>>;
};

/**
 * The engine's half of an entry. Every key is present, so reads stay monomorphic. `cpuType`,
 * `suffix` and `hasValidSymbols` are the type's defaults; an event can state its own.
 */
export interface Grammar {
  readonly closes: Closes | null;
  readonly hasLineNumber: boolean;
  /** A line after this type's line that starts no event is its text, not an `Invalid log line`. */
  readonly acceptsText: boolean;
  readonly discontinuity: boolean;
  readonly cpuType: CpuType | null;
  readonly suffix: string | null;
  readonly hasValidSymbols: boolean;
}

const NO_TYPES: readonly EventType[] = Object.freeze([]);
const NO_FIELDS: readonly string[] = Object.freeze([]);

const atRules: TextRule[] = [];
const at = <const K extends string>(name: K): TextSpec<K> =>
  rule([name], (i) => (atRules[i] ??= (f) => f.at(i)));
const from = <const K extends string>(name: K, separator: string): TextSpec<K> =>
  rule([name], (i) => (f) => f.from(i, separator));
// Loops rather than map/join, so a text read allocates only the string it returns.
const joinAt =
  (separator: string, fields: readonly number[]): TextRule =>
  (f) => {
    let text = '';
    let first = true;
    for (const i of fields) {
      text += first ? f.at(i) : separator + f.at(i);
      first = false;
    }
    return text;
  };
const join = <const K extends string>(separator: string, ...names: K[]): TextSpec<K> =>
  rule(names, (...fields) => joinAt(separator, fields));
/** As `join`, but leaves out empty fields. */
const joinPresent = <const K extends string>(separator: string, ...names: K[]): TextSpec<K> =>
  rule(names, (...fields) => (f) => {
    let text = '';
    for (const i of fields) {
      const field = f.at(i);
      if (field) text = text ? text + separator + field : field;
    }
    return text;
  });

const traceFlagsText = rule(
  ['line', 'className', 'traceFlags'],
  (line, className, traceFlags) => (f) =>
    `${f.at(className)}, line:${lineText(f.at(line))} - ${f.at(traceFlags)}`,
);
const queryMoreText = rule(['line'], (line) => (f) => `line: ${lineText(f.at(line))}`);
const savepointText = rule(
  ['line', 'savepoint'],
  (line, savepoint) => (f) => `${f.at(savepoint)}, line: ${lineText(f.at(line))}`,
);
/** `<appNamespace>.<the rest, joined by ' : '>`. */
const notificationText = <const K extends string>(...rest: K[]): TextSpec<K | 'appNamespace'> =>
  rule(['appNamespace', ...rest], (namespace, ...fields) => {
    const joined = joinAt(' : ', fields);
    return (f) => `${f.at(namespace)}.${joined(f)}`;
  });

const ENTRIES: { readonly [T in EventType]: Def<T> } = {
  ADD_SCREEN_POP_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  ADD_SKILL_REQUIREMENT_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  AE_PERSIST_VALIDATION: { debugCategory: 'apexCode', level: 'ERROR' },
  APP_ANALYTICS_ERROR: { debugCategory: 'apexCode', level: 'ERROR' },
  APP_ANALYTICS_FINE: { debugCategory: 'apexCode', level: 'FINE' },
  APP_ANALYTICS_WARN: { debugCategory: 'apexCode', level: 'WARN' },
  APP_CONTAINER_INITIATED: { debugCategory: 'wave', level: 'FINE' },
  ASSET_DIFF_DETAIL: { fields: ['diffDetail'], debugCategory: 'wave', level: 'FINEST' },
  ASSET_DIFF_SUMMARY: { fields: ['diffSummary'], debugCategory: 'wave', level: 'FINE' },
  BULK_COUNTABLE_STATEMENT_EXECUTE: {
    fields: ['bulkStatementExecution'],
    debugCategory: 'apexCode',
    level: 'INFO',
    kind: 'statement',
  },
  BULK_DML_RETRY: { debugCategory: 'database', level: 'INFO', kind: 'dml' },
  BULK_HEAP_ALLOCATE: {
    fields: ['bytes'],
    debugCategory: 'apexCode',
    level: 'FINEST',
    kind: 'heap',
    text: at('bytes'),
  },
  CALLOUT_REQUEST: {
    fields: ['line', 'request'],
    shape: 'frame',
    kind: 'callout',
    exits: ['CALLOUT_RESPONSE'],
    category: 'Callout',
    debugCategory: 'callout',
    level: 'INFO',
    cpu: 'free',
    text: at('request'),
  },
  CALLOUT_REQUEST_FINALIZE: {
    fields: ['finalizationDetails'],
    debugCategory: 'callout',
    level: 'FINEST',
    kind: 'callout',
  },
  CALLOUT_REQUEST_PREPARE: {
    fields: ['preparationDetails'],
    debugCategory: 'callout',
    level: 'FINEST',
    kind: 'callout',
  },
  CALLOUT_RESPONSE: {
    fields: ['line', 'response'],
    shape: 'exit',
    kind: 'callout',
    debugCategory: 'callout',
    level: 'INFO',
    text: at('response'),
  },
  CODE_UNIT_FINISHED: {
    fields: ['name', 'typeRef'],
    shape: 'exit',
    kind: 'code-unit',
    debugCategory: 'apexCode',
    level: 'ERROR',
    text: at('name'),
  },
  CODE_UNIT_STARTED: {
    fields: ['line', 'unit', 'name', 'typeRef'],
    shape: 'frame',
    kind: 'code-unit',
    exits: ['CODE_UNIT_FINISHED'],
    category: 'Code Unit',
    debugCategory: 'apexCode',
    level: 'ERROR',
    cpu: 'method',
    suffix: ' (code unit)',
    text: codeUnitText,
  },
  CONSTRUCTOR_ENTRY: {
    fields: ['line', 'classId', 'signature', 'className'],
    shape: 'frame',
    kind: 'method',
    exits: ['CONSTRUCTOR_EXIT'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'FINE',
    cpu: 'method',
    suffix: ' (constructor)',
    symbols: true,
    text: constructorText,
  },
  CONSTRUCTOR_EXIT: {
    fields: ['line', 'classId', 'signature', 'className'],
    shape: 'exit',
    kind: 'method',
    debugCategory: 'apexCode',
    level: 'FINE',
  },
  CUMULATIVE_LIMIT_USAGE: {
    shape: 'frame',
    kind: 'limits',
    exits: ['CUMULATIVE_LIMIT_USAGE_END'],
    category: 'System',
    debugCategory: 'apexProfiling',
    level: 'INFO',
    cpu: 'system',
  },
  CUMULATIVE_LIMIT_USAGE_END: {
    shape: 'exit',
    kind: 'limits',
    debugCategory: 'apexProfiling',
    level: 'INFO',
  },
  CUMULATIVE_PROFILING: {
    fields: ['section', 'detail'],
    debugCategory: 'apexProfiling',
    level: 'FINE',
    acceptsText: true,
    text: join(' ', 'section', 'detail'),
  },
  CUMULATIVE_PROFILING_BEGIN: {
    shape: 'frame',
    exits: ['CUMULATIVE_PROFILING_END'],
    category: 'System',
    debugCategory: 'apexProfiling',
    level: 'FINE',
    cpu: 'custom',
  },
  CUMULATIVE_PROFILING_END: { shape: 'exit', debugCategory: 'apexProfiling', level: 'FINE' },
  CURSOR_CREATE_BEGIN: {
    fields: ['line', 'soqlQuery'],
    shape: 'frame',
    kind: 'soql',
    exits: ['CURSOR_CREATE_END'],
    category: 'SOQL',
    debugCategory: 'database',
    level: 'INFO',
    cpu: 'method',
  },
  CURSOR_CREATE_END: {
    fields: ['line', 'queryId', 'numberRowsResult'],
    shape: 'exit',
    kind: 'soql',
    debugCategory: 'database',
    level: 'INFO',
  },
  CURSOR_FETCH: {
    fields: ['line', 'queryId', 'cursorOffsetPosition', 'numberRowsFetched'],
    debugCategory: 'database',
    level: 'INFO',
    kind: 'soql',
  },
  CURSOR_FETCH_PAGE: {
    fields: ['line', 'queryId', 'cursorOffsetPosition', 'numberRowsCurrent'],
    debugCategory: 'database',
    level: 'INFO',
    kind: 'soql',
  },
  DATA_ACCESS_EVALUATION: {
    fields: ['request', 'responseDataAccess'],
    debugCategory: 'dataAccess',
    level: 'FINE',
  },
  DATAWEAVE_USER_DEBUG: {
    fields: ['debugOutput'],
    debugCategory: 'apexCode',
    level: 'DEBUG',
    kind: 'debug',
  },
  DML_BEGIN: {
    fields: ['line', 'operation', 'objectType', 'rows'],
    shape: 'frame',
    kind: 'dml',
    exits: ['DML_END'],
    category: 'DML',
    debugCategory: 'database',
    level: 'INFO',
    cpu: 'free',
    text: rule(['operation', 'objectType'], (op, type) => (f) => `DML ${f.at(op)} ${f.at(type)}`),
  },
  DML_END: {
    fields: ['line'],
    shape: 'exit',
    kind: 'dml',
    debugCategory: 'database',
    level: 'INFO',
  },
  DUPLICATE_DETECTION_BEGIN: {
    shape: 'frame',
    exits: ['DUPLICATE_DETECTION_END'],
    category: 'System',
    debugCategory: 'system',
    level: 'INFO',
    cpu: 'custom',
  },
  DUPLICATE_DETECTION_END: { shape: 'exit', debugCategory: 'system', level: 'INFO' },
  DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS: {
    fields: ['entityType', 'actionTaken', 'duplicateRecordIds'],
    debugCategory: 'system',
    level: 'DEBUG',
    text: from('entityType', ' | '),
  },
  DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY: {
    fields: ['entityType', 'recordsToBeSaved', 'detail', 'duplicatesFound'],
    debugCategory: 'system',
    level: 'INFO',
    text: from('entityType', ' | '),
  },
  DUPLICATE_DETECTION_RULE_INVOCATION: {
    fields: ['ruleId', 'ruleName', 'dmlType'],
    debugCategory: 'system',
    level: 'INFO',
    text: join(' - ', 'ruleName', 'dmlType'),
  },
  DUPLICATE_RULE_FILTER: { fields: ['filterCriteria'], debugCategory: 'system', level: 'INFO' },
  DUPLICATE_RULE_FILTER_INVOCATION: { debugCategory: 'system', level: 'DEBUG' },
  DUPLICATE_RULE_FILTER_RESULT: {
    fields: ['filterResult'],
    debugCategory: 'system',
    level: 'INFO',
  },
  DUPLICATE_RULE_FILTER_VALUE: { fields: ['filterValue'], debugCategory: 'system', level: 'INFO' },
  EMAIL_QUEUE: {
    fields: ['line', 'email'],
    debugCategory: 'apexCode',
    level: 'INFO',
    acceptsText: true,
  },
  END_CALL: { debugCategory: 'workflow', level: 'INFO' },
  ENTERING_MANAGED_PKG: {
    fields: ['namespace'],
    shape: 'frame',
    kind: 'package',
    closes: 'next-event',
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'FINE',
    cpu: 'pkg',
    suffix: ' (managed package)',
    text: managedPackageText,
  },
  EVENT_SERVICE_PUB_BEGIN: {
    fields: ['eventType'],
    shape: 'frame',
    kind: 'workflow',
    exits: ['EVENT_SERVICE_PUB_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at('eventType'),
  },
  EVENT_SERVICE_PUB_DETAIL: {
    fields: ['subscriptionIds', 'userId', 'eventMessageData'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'workflow',
    text: join(' ', 'subscriptionIds', 'userId', 'eventMessageData'),
  },
  EVENT_SERVICE_PUB_END: {
    fields: ['eventType'],
    shape: 'exit',
    kind: 'workflow',
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('eventType'),
  },
  EVENT_SERVICE_SUB_BEGIN: {
    fields: ['eventType', 'action'],
    shape: 'frame',
    kind: 'workflow',
    exits: ['EVENT_SERVICE_SUB_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' ', 'eventType', 'action'),
  },
  EVENT_SERVICE_SUB_DETAIL: {
    fields: [
      'subscriptionId',
      'subscriptionInstanceId',
      'referenceData',
      'userId',
      'eventMessageData',
    ],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'workflow',
    text: join(
      ' ',
      'subscriptionId',
      'subscriptionInstanceId',
      'referenceData',
      'userId',
      'eventMessageData',
    ),
  },
  EVENT_SERVICE_SUB_END: {
    fields: ['eventType', 'action'],
    shape: 'exit',
    kind: 'workflow',
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' ', 'eventType', 'action'),
  },
  EXCEPTION_THROWN: {
    fields: ['line', 'exception'],
    debugCategory: 'apexCode',
    level: 'INFO',
    kind: 'exception',
    acceptsText: true,
    discontinuity: true,
    text: at('exception'),
  },
  EXECUTION_FINISHED: {
    shape: 'exit',
    kind: 'execution',
    debugCategory: 'apexCode',
    level: 'ERROR',
  },
  EXECUTION_STARTED: {
    shape: 'frame',
    kind: 'execution',
    exits: ['EXECUTION_FINISHED'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'ERROR',
    cpu: 'method',
  },
  EXTERNAL_SERVICE_CALLBACK: { debugCategory: 'callout', level: 'INFO', kind: 'callout' },
  EXTERNAL_SERVICE_REQUEST: {
    fields: ['requestDetails'],
    debugCategory: 'callout',
    level: 'INFO',
    kind: 'callout',
  },
  EXTERNAL_SERVICE_RESPONSE: {
    fields: ['responseDetails'],
    debugCategory: 'callout',
    level: 'INFO',
    kind: 'callout',
  },
  FATAL_ERROR: {
    fields: ['exception'],
    debugCategory: 'apexCode',
    level: 'ERROR',
    kind: 'exception',
    acceptsText: true,
    discontinuity: true,
    text: at('exception'),
  },
  FLOW_ACTIONCALL_DETAIL: {
    fields: ['interviewId', 'elementName', 'actionType', 'action', 'succeeded', 'error'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 'elementName', 'actionType', 'action', 'succeeded'),
  },
  FLOW_ASSIGNMENT_DETAIL: {
    fields: ['interviewId', 'reference', 'operator', 'value'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 'reference', 'operator', 'value'),
  },
  FLOW_BULK_ELEMENT_BEGIN: {
    fields: ['interviewId', 'elementType'],
    shape: 'frame',
    kind: 'flow',
    exits: ['FLOW_BULK_ELEMENT_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'FINE',
    cpu: 'custom',
    text: join(' - ', 'interviewId', 'elementType'),
  },
  FLOW_BULK_ELEMENT_DETAIL: {
    fields: ['interviewId', 'element', 'records'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 'interviewId', 'element', 'records'),
  },
  FLOW_BULK_ELEMENT_END: {
    fields: ['interviewId', 'element', 'records', 'executionTime'],
    shape: 'exit',
    kind: 'flow',
    debugCategory: 'workflow',
    level: 'FINE',
  },
  FLOW_BULK_ELEMENT_LIMIT_USAGE: {
    fields: ['usage'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'limits',
    text: at('usage'),
  },
  FLOW_BULK_ELEMENT_NOT_SUPPORTED: {
    fields: ['operation', 'elementName', 'entityNameDoesn'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
    text: join(' : ', 'operation', 'elementName', 'entityNameDoesn'),
  },
  FLOW_COLLECTION_PROCESSOR_DETAIL: {
    fields: ['processorDetails'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
  },
  FLOW_CREATE_INTERVIEW_BEGIN: {
    fields: ['orgId', 'definitionId', 'versionId'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
  },
  FLOW_CREATE_INTERVIEW_END: {
    fields: ['interviewId', 'flowName'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
  },
  FLOW_CREATE_INTERVIEW_ERROR: {
    fields: ['message', 'organizationId', 'definitionId', 'versionId'],
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'flow',
    text: join(' : ', 'message', 'organizationId', 'definitionId', 'versionId'),
  },
  FLOW_ELEMENT_BEGIN: {
    fields: ['interviewId', 'elementType', 'elementName'],
    shape: 'frame',
    kind: 'flow',
    exits: ['FLOW_ELEMENT_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'FINE',
    cpu: 'custom',
    text: join(' ', 'elementType', 'elementName'),
  },
  FLOW_ELEMENT_DEFERRED: {
    fields: ['elementType', 'elementName'],
    debugCategory: 'workflow',
    level: 'FINE',
    kind: 'flow',
    text: join(' ', 'elementType', 'elementName'),
  },
  FLOW_ELEMENT_END: {
    fields: ['interviewId', 'elementType', 'elementName'],
    shape: 'exit',
    kind: 'flow',
    debugCategory: 'workflow',
    level: 'FINE',
  },
  FLOW_ELEMENT_ERROR: {
    fields: ['message', 'elementType', 'elementName'],
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'flow',
    acceptsText: true,
    text: from('message', '|'),
    after: flowElementErrorAfter,
  },
  FLOW_ELEMENT_FAULT: {
    fields: ['message', 'elementType', 'elementName'],
    debugCategory: 'workflow',
    level: 'WARN',
    kind: 'flow',
    text: join(' : ', 'message', 'elementType', 'elementName'),
  },
  FLOW_ELEMENT_LIMIT_USAGE: {
    fields: ['usage'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'limits',
    text: at('usage'),
  },
  FLOW_INTERVIEW_FINISHED: {
    fields: ['interviewId', 'flowName'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
    text: at('flowName'),
  },
  FLOW_INTERVIEW_FINISHED_LIMIT_USAGE: {
    fields: ['usage'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'limits',
    text: at('usage'),
  },
  FLOW_INTERVIEW_PAUSED: {
    fields: ['interviewId', 'flowName', 'userPaused'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
    text: join(' : ', 'interviewId', 'flowName', 'userPaused'),
  },
  FLOW_INTERVIEW_RESUMED: {
    fields: ['interviewId', 'flowName'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
    text: join(' : ', 'interviewId', 'flowName'),
  },
  FLOW_LOOP_DETAIL: {
    fields: ['interviewId', 'index', 'value'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 'index', 'value'),
  },
  FLOW_RULE_DETAIL: {
    fields: ['interviewId', 'ruleName', 'result', 'detail'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 'ruleName', 'result'),
  },
  FLOW_SCHEDULED_PATH_QUEUED: { debugCategory: 'workflow', level: 'FINER', kind: 'flow' },
  FLOW_SCREEN_DETAIL: {
    fields: ['screenDetails'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
  },
  FLOW_START_INTERVIEW_BEGIN: {
    fields: ['interviewId', 'flowName'],
    shape: 'frame',
    kind: 'flow',
    exits: ['FLOW_START_INTERVIEW_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    suffix: ' (flow)',
    text: at('flowName'),
  },
  FLOW_START_INTERVIEW_END: {
    fields: ['interviewId', 'flowName'],
    shape: 'exit',
    kind: 'flow',
    debugCategory: 'workflow',
    level: 'INFO',
  },
  FLOW_START_INTERVIEW_LIMIT_USAGE: {
    fields: ['usage'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'limits',
    text: at('usage'),
  },
  // Text and suffix come from its first interview and enclosing code unit, not its line.
  FLOW_START_INTERVIEWS_BEGIN: {
    fields: ['requests'],
    shape: 'frame',
    kind: 'flow',
    exits: ['FLOW_START_INTERVIEWS_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
  },
  FLOW_START_INTERVIEWS_END: {
    fields: ['requests'],
    shape: 'exit',
    kind: 'flow',
    debugCategory: 'workflow',
    level: 'INFO',
  },
  FLOW_START_INTERVIEWS_ERROR: {
    fields: ['message', 'interviewId', 'flowName'],
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'flow',
    acceptsText: true,
    text: from('message', '|'),
    after: flowInterviewsErrorAfter,
  },
  FLOW_START_SCHEDULED_RECORDS: {
    fields: ['message', 'numberRecordsFlow'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
    text: join(' : ', 'message', 'numberRecordsFlow'),
  },
  FLOW_SUBFLOW_DETAIL: {
    fields: ['interviewId', 'name', 'definitionId', 'versionId'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 'interviewId', 'name', 'definitionId', 'versionId'),
  },
  FLOW_VALUE_ASSIGNMENT: {
    fields: ['interviewId', 'key', 'value'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    acceptsText: true,
    text: join(' ', 'key', 'value'),
  },
  FLOW_WAIT_EVENT_RESUMING_DETAIL: {
    fields: ['interviewId', 'elementName', 'eventName', 'eventType'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 'interviewId', 'elementName', 'eventName', 'eventType'),
  },
  FLOW_WAIT_EVENT_WAITING_DETAIL: {
    fields: ['interviewId', 'elementName', 'eventName', 'eventType', 'conditionsMet'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 'interviewId', 'elementName', 'eventName', 'eventType', 'conditionsMet'),
  },
  FLOW_WAIT_RESUMING_DETAIL: {
    fields: ['interviewId', 'elementName', 'persistedInterviewId'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 'interviewId', 'elementName', 'persistedInterviewId'),
  },
  FLOW_WAIT_WAITING_DETAIL: {
    fields: ['interviewId', 'elementName', 'numberEventsElement', 'persistedInterviewId'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 'interviewId', 'elementName', 'numberEventsElement', 'persistedInterviewId'),
  },
  FOR_UPDATE_LOCKS_RELEASE: { debugCategory: 'database', level: 'WARN' },
  FORMULA_BUILD: { debugCategory: 'apexCode', level: 'DEBUG' },
  FORMULA_EVALUATE_BEGIN: {
    shape: 'frame',
    exits: ['FORMULA_EVALUATE_END'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'FINER',
    cpu: 'method',
  },
  FORMULA_EVALUATE_END: { shape: 'exit', debugCategory: 'apexCode', level: 'FINER' },
  FUNCTION_INVOCATION_REQUEST: {
    fields: ['invocationRequestDetails'],
    debugCategory: 'callout',
    level: 'INFO',
    kind: 'callout',
  },
  FUNCTION_INVOCATION_RESPONSE: {
    fields: ['invocationResponseDetails'],
    debugCategory: 'callout',
    level: 'INFO',
    kind: 'callout',
  },
  HEAP_ALLOCATE: {
    fields: ['line', 'bytes'],
    debugCategory: 'apexCode',
    level: 'FINER',
    kind: 'heap',
    text: at('bytes'),
  },
  HEAP_DEALLOCATE: {
    fields: ['line', 'bytes'],
    debugCategory: 'apexCode',
    level: 'FINER',
    kind: 'heap',
  },
  HEAP_DUMP: { fields: ['heapDumpData'], debugCategory: 'apexCode', level: 'INFO', kind: 'heap' },
  IDEAS_QUERY_EXECUTE: {
    fields: ['line'],
    debugCategory: 'database',
    level: 'FINEST',
    kind: 'soql',
  },
  INVOCABLE_ACTION_DETAIL: {
    fields: ['actionDetails'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
  },
  INVOCABLE_ACTION_ERROR: {
    fields: ['errorDetails'],
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'flow',
  },
  JSON_DIFF_DETAIL: { fields: ['diffDetail'], debugCategory: 'wave', level: 'FINEST' },
  JSON_DIFF_SUMMARY: { fields: ['diffSummary'], debugCategory: 'wave', level: 'FINE' },
  LIMIT_USAGE: {
    fields: ['line', 'limit', 'used', 'max'],
    debugCategory: 'apexProfiling',
    level: 'FINEST',
    kind: 'limits',
    text: rule(
      ['limit', 'used', 'max'],
      (limit, used, max) => (f) => `${f.at(limit)} ${f.at(used)} out of ${f.at(max)}`,
    ),
  },
  LIMIT_USAGE_FOR_NS: {
    fields: ['namespace', 'usage'],
    debugCategory: 'apexProfiling',
    level: 'FINEST',
    kind: 'limits',
    acceptsText: true,
    text: at('namespace'),
    after: limitsForNamespaceAfter,
  },
  MATCH_ENGINE_BEGIN: {
    shape: 'frame',
    exits: ['MATCH_ENGINE_END'],
    category: 'System',
    debugCategory: 'system',
    level: 'INFO',
    cpu: 'method',
  },
  MATCH_ENGINE_END: { shape: 'exit', debugCategory: 'system', level: 'INFO' },
  MATCH_ENGINE_INVOCATION: {
    fields: ['invocationDetails'],
    debugCategory: 'system',
    level: 'INFO',
  },
  METHOD_ENTRY: {
    fields: ['line', 'classId', 'signature'],
    shape: 'frame',
    kind: 'method',
    exits: ['METHOD_EXIT'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'FINE',
    cpu: 'method',
    symbols: true,
    text: at('signature'),
  },
  METHOD_EXIT: {
    fields: ['line', 'classId', 'signature'],
    shape: 'exit',
    kind: 'method',
    debugCategory: 'apexCode',
    level: 'FINE',
    text: methodExitText,
  },
  NAMED_CREDENTIAL_REQUEST: {
    fields: [
      'credentialId',
      'credentialName',
      'endpoint',
      'method',
      'credentialType',
      'authorization',
      'requestSize',
      'retryOn401',
      'connectionId',
      'connectionName',
      'connectionStatus',
      'hostType',
      'hostRegion',
      'hourlyDataUsage',
    ],
    debugCategory: 'callout',
    level: 'INFO',
    kind: 'callout',
    text: join(' : ', 'credentialName', 'endpoint', 'method', 'credentialType'),
  },
  NAMED_CREDENTIAL_RESPONSE: {
    fields: ['body'],
    debugCategory: 'callout',
    level: 'INFO',
    kind: 'callout',
    text: at('body'),
  },
  NAMED_CREDENTIAL_RESPONSE_DETAIL: {
    fields: [
      'credentialId',
      'credentialName',
      'statusCode',
      'responseSize',
      'calloutTime',
      'connectTime',
      'connectionId',
      'connectionName',
      'hourlyDataUsage',
    ],
    debugCategory: 'callout',
    level: 'FINER',
    kind: 'callout',
    text: rule(
      ['credentialName', 'statusCode', 'responseSize', 'calloutTime', 'connectTime'],
      (name, status, size, callout, connect) => (f) =>
        `${f.at(name)} : ${f.at(status)} ${f.at(size)} : ${f.at(callout)} ${f.at(connect)}`,
    ),
  },
  NBA_NODE_BEGIN: {
    fields: ['elementName', 'elementType'],
    shape: 'frame',
    kind: 'nba',
    exits: ['NBA_NODE_END'],
    category: 'Automation',
    debugCategory: 'nba',
    level: 'FINE',
    cpu: 'method',
    text: from('elementName', ' | '),
  },
  NBA_NODE_DETAIL: {
    fields: ['elementName', 'elementType', 'message'],
    debugCategory: 'nba',
    level: 'FINE',
    kind: 'nba',
    text: from('elementName', ' | '),
  },
  NBA_NODE_END: {
    fields: ['elementName', 'elementType', 'message'],
    shape: 'exit',
    kind: 'nba',
    debugCategory: 'nba',
    level: 'FINE',
    text: from('elementName', ' | '),
  },
  NBA_NODE_ERROR: {
    fields: ['elementName', 'elementType', 'errorMessage'],
    debugCategory: 'nba',
    level: 'ERROR',
    kind: 'nba',
    text: from('elementName', ' | '),
  },
  NBA_OFFER_INVALID: {
    fields: ['name', 'id', 'reason'],
    debugCategory: 'nba',
    level: 'FINE',
    kind: 'nba',
    text: from('name', ' | '),
  },
  NBA_STRATEGY_BEGIN: {
    fields: ['strategyName'],
    shape: 'frame',
    kind: 'nba',
    exits: ['NBA_STRATEGY_END'],
    category: 'Automation',
    debugCategory: 'nba',
    level: 'FINE',
    cpu: 'method',
    text: from('strategyName', ' | '),
  },
  NBA_STRATEGY_END: {
    fields: ['strategyName', 'countOutputs'],
    shape: 'exit',
    kind: 'nba',
    debugCategory: 'nba',
    level: 'FINE',
    text: from('strategyName', ' | '),
  },
  NBA_STRATEGY_ERROR: {
    fields: ['strategyName', 'errorMessage'],
    debugCategory: 'nba',
    level: 'ERROR',
    kind: 'nba',
    text: from('strategyName', ' | '),
  },
  ORG_CACHE_CONTAINS: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_GET: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_GET_BEGIN: {
    fields: ['key'],
    shape: 'frame',
    kind: 'cache',
    exits: ['ORG_CACHE_GET_END'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'INFO',
    cpu: 'method',
  },
  ORG_CACHE_GET_CAPACITY: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_GET_END: {
    fields: ['hitMiss'],
    shape: 'exit',
    kind: 'cache',
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  ORG_CACHE_GET_PARTITION: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_MEMORY_USAGE: {
    fields: ['memoryUsage'],
    debugCategory: 'apexCode',
    level: 'INFO',
    kind: 'cache',
  },
  ORG_CACHE_PUT: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_PUT_BEGIN: {
    fields: ['key'],
    shape: 'frame',
    kind: 'cache',
    exits: ['ORG_CACHE_PUT_END'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'INFO',
    cpu: 'method',
  },
  ORG_CACHE_PUT_END: { shape: 'exit', kind: 'cache', debugCategory: 'apexCode', level: 'INFO' },
  ORG_CACHE_REMOVE: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_REMOVE_BEGIN: {
    fields: ['key'],
    shape: 'frame',
    kind: 'cache',
    exits: ['ORG_CACHE_REMOVE_END'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'INFO',
    cpu: 'method',
  },
  ORG_CACHE_REMOVE_END: { shape: 'exit', kind: 'cache', debugCategory: 'apexCode', level: 'INFO' },
  PLAY_PROMPT: { debugCategory: 'workflow', level: 'INFO' },
  POLICY_RULE_DEFINITION_CONDITION_EVALUATION_RESPONSE: {
    fields: ['response'],
    debugCategory: 'dataAccess',
    level: 'FINER',
  },
  POLICY_RULE_EVALUATION_REQUEST: {
    fields: ['request'],
    debugCategory: 'dataAccess',
    level: 'FINE',
  },
  POLICY_RULE_EVALUATION_RESPONSE: {
    fields: ['response'],
    debugCategory: 'dataAccess',
    level: 'FINER',
  },
  POLICY_RULE_EVALUATION_SKIPPED: {
    fields: ['object'],
    debugCategory: 'dataAccess',
    level: 'FINER',
  },
  POLICY_RULE_EVALUATION_START: { fields: ['rule'], debugCategory: 'dataAccess', level: 'FINER' },
  POP_TRACE_FLAGS: {
    fields: ['line', 'classId', 'className', 'traceFlags'],
    debugCategory: 'system',
    level: 'INFO',
    text: traceFlagsText,
  },
  PUSH_NOTIFICATION_INVALID_APP: {
    fields: ['appNamespace', 'appName'],
    debugCategory: 'apexCode',
    level: 'ERROR',
    text: join('.', 'appNamespace', 'appName'),
  },
  PUSH_NOTIFICATION_INVALID_CERTIFICATE: {
    fields: ['appNamespace', 'appName'],
    debugCategory: 'apexCode',
    level: 'ERROR',
    text: join('.', 'appNamespace', 'appName'),
  },
  PUSH_NOTIFICATION_INVALID_CONFIGURATION: { debugCategory: 'apexCode', level: 'WARN' },
  PUSH_NOTIFICATION_INVALID_NOTIFICATION: {
    fields: [
      'appNamespace',
      'appName',
      'serviceType',
      'userId',
      'device',
      'payload',
      'payloadLength',
    ],
    debugCategory: 'apexCode',
    level: 'ERROR',
    text: notificationText(
      'appName',
      'serviceType',
      'userId',
      'device',
      'payload',
      'payloadLength',
    ),
  },
  PUSH_NOTIFICATION_INVALID_PAYLOAD: { debugCategory: 'apexCode', level: 'WARN' },
  PUSH_NOTIFICATION_NO_DEVICES: {
    fields: ['appNamespace', 'appName'],
    debugCategory: 'apexCode',
    level: 'DEBUG',
    text: join('.', 'appNamespace', 'appName'),
  },
  PUSH_NOTIFICATION_NOT_ENABLED: { debugCategory: 'apexCode', level: 'INFO' },
  PUSH_NOTIFICATION_SENT: {
    fields: ['appNamespace', 'appName', 'serviceType', 'userId', 'device', 'payload'],
    debugCategory: 'apexCode',
    level: 'DEBUG',
    text: notificationText('appName', 'serviceType', 'userId', 'device', 'payload'),
  },
  PUSH_TRACE_FLAGS: {
    fields: ['line', 'classId', 'className', 'traceFlags'],
    debugCategory: 'system',
    level: 'INFO',
    text: traceFlagsText,
  },
  QUERY_MORE_BEGIN: {
    fields: ['line'],
    shape: 'frame',
    kind: 'soql',
    exits: ['QUERY_MORE_END'],
    category: 'SOQL',
    debugCategory: 'database',
    level: 'INFO',
    cpu: 'custom',
    text: queryMoreText,
  },
  QUERY_MORE_END: {
    fields: ['line'],
    shape: 'exit',
    kind: 'soql',
    debugCategory: 'database',
    level: 'INFO',
    text: queryMoreText,
  },
  QUERY_MORE_ITERATIONS: {
    fields: ['line', 'iterations'],
    debugCategory: 'database',
    level: 'INFO',
    kind: 'soql',
    text: rule(
      ['line', 'iterations'],
      (line, iterations) => (f) => `line: ${lineText(f.at(line))}, iterations:${f.at(iterations)}`,
    ),
  },
  QUERY_SQL_LOG: { debugCategory: 'apexCode', level: 'INFO', kind: 'soql' },
  REFERENCED_OBJECT_LIST: {
    fields: ['referencedObjects'],
    debugCategory: 'apexProfiling',
    level: 'FINEST',
  },
  RLM_CONFIGURATOR_BEGIN: {
    shape: 'frame',
    exits: ['RLM_CONFIGURATOR_END'],
    category: 'System',
    debugCategory: 'system',
    level: 'FINE',
    cpu: 'method',
  },
  RLM_CONFIGURATOR_DEPLOY: { debugCategory: 'system', level: 'FINE' },
  RLM_CONFIGURATOR_END: { shape: 'exit', debugCategory: 'system', level: 'FINE' },
  RLM_CONFIGURATOR_STATS: { debugCategory: 'system', level: 'FINE' },
  RLM_PRICING_BEGIN: {
    shape: 'frame',
    exits: ['RLM_PRICING_END'],
    category: 'System',
    debugCategory: 'system',
    level: 'FINE',
    cpu: 'method',
  },
  RLM_PRICING_END: { shape: 'exit', debugCategory: 'system', level: 'FINE' },
  ROUTE_WORK_ACTION: { debugCategory: 'workflow', level: 'INFO' },
  RULES_EXECUTION_DETAIL: { fields: ['executionDetail'], debugCategory: 'wave', level: 'FINER' },
  RULES_EXECUTION_SUMMARY: { fields: ['summaryData'], debugCategory: 'wave', level: 'FINE' },
  SAVEPOINT_RELEASE: { debugCategory: 'database', level: 'INFO' },
  SAVEPOINT_RESET: { debugCategory: 'database', level: 'INFO' },
  SAVEPOINT_ROLLBACK: {
    fields: ['line', 'savepoint'],
    debugCategory: 'database',
    level: 'INFO',
    text: savepointText,
  },
  SAVEPOINT_SET: {
    fields: ['line', 'savepoint'],
    debugCategory: 'database',
    level: 'INFO',
    text: savepointText,
  },
  SCHEDULED_FLOW_DETAIL: { debugCategory: 'workflow', level: 'INFO', kind: 'flow' },
  SCRIPT_EXECUTION: { debugCategory: 'apexCode', level: 'INFO' },
  SESSION_CACHE_CONTAINS: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_GET: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_GET_BEGIN: {
    fields: ['key'],
    shape: 'frame',
    kind: 'cache',
    exits: ['SESSION_CACHE_GET_END'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'INFO',
    cpu: 'method',
  },
  SESSION_CACHE_GET_CAPACITY: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_GET_END: {
    fields: ['hitMiss'],
    shape: 'exit',
    kind: 'cache',
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  SESSION_CACHE_GET_PARTITION: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_MEMORY_USAGE: {
    fields: ['memoryUsage'],
    debugCategory: 'apexCode',
    level: 'INFO',
    kind: 'cache',
  },
  SESSION_CACHE_PUT: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_PUT_BEGIN: {
    fields: ['key'],
    shape: 'frame',
    kind: 'cache',
    exits: ['SESSION_CACHE_PUT_END'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'INFO',
    cpu: 'method',
  },
  SESSION_CACHE_PUT_END: {
    shape: 'exit',
    kind: 'cache',
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  SESSION_CACHE_REMOVE: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_REMOVE_BEGIN: {
    fields: ['key'],
    shape: 'frame',
    kind: 'cache',
    exits: ['SESSION_CACHE_REMOVE_END'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'INFO',
    cpu: 'method',
  },
  SESSION_CACHE_REMOVE_END: {
    shape: 'exit',
    kind: 'cache',
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  SLA_CASE_MILESTONE: { debugCategory: 'workflow', level: 'FINE', kind: 'workflow' },
  SLA_END: {
    fields: ['cases', 'loadTime', 'processingTime', 'milestones', 'newTrigger'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 'cases', 'loadTime', 'processingTime', 'milestones', 'newTrigger'),
  },
  SLA_EVAL_MILESTONE: {
    fields: ['milestoneId'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at('milestoneId'),
  },
  SLA_NULL_START_DATE: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  SLA_PROCESS_CASE: {
    fields: ['caseId'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at('caseId'),
  },
  SOQL_EXECUTE_BEGIN: {
    fields: ['line', 'aggregations', 'query'],
    shape: 'frame',
    kind: 'soql',
    exits: ['SOQL_EXECUTE_END'],
    category: 'SOQL',
    debugCategory: 'database',
    level: 'INFO',
    cpu: 'free',
    text: at('query'),
  },
  SOQL_EXECUTE_END: {
    fields: ['line', 'rows'],
    shape: 'exit',
    kind: 'soql',
    debugCategory: 'database',
    level: 'INFO',
  },
  SOQL_EXECUTE_EXPLAIN: {
    fields: ['line', 'plan'],
    debugCategory: 'database',
    level: 'FINEST',
    kind: 'soql',
    text: at('plan'),
  },
  SOSL_EXECUTE_BEGIN: {
    fields: ['line', 'query'],
    shape: 'frame',
    kind: 'sosl',
    exits: ['SOSL_EXECUTE_END'],
    category: 'SOQL',
    debugCategory: 'database',
    level: 'INFO',
    cpu: 'free',
    text: rule(['query'], (query) => (f) => `SOSL: ${f.at(query)}`),
  },
  SOSL_EXECUTE_END: {
    fields: ['line', 'rows'],
    shape: 'exit',
    kind: 'sosl',
    debugCategory: 'database',
    level: 'INFO',
  },
  STACK_FRAME_VARIABLE_LIST: {
    fields: ['frame'],
    debugCategory: 'apexProfiling',
    level: 'FINE',
    kind: 'variable',
    acceptsText: true,
  },
  STATEMENT_EXECUTE: {
    fields: ['line'],
    debugCategory: 'apexCode',
    level: 'FINER',
    kind: 'statement',
  },
  STATIC_VARIABLE_LIST: {
    fields: ['variables'],
    debugCategory: 'apexProfiling',
    level: 'FINE',
    kind: 'variable',
    acceptsText: true,
  },
  SYSTEM_CONSTRUCTOR_ENTRY: {
    fields: ['line', 'signature'],
    shape: 'frame',
    kind: 'method',
    exits: ['SYSTEM_CONSTRUCTOR_EXIT'],
    category: 'System',
    debugCategory: 'system',
    level: 'FINE',
    cpu: 'method',
    suffix: ' (system constructor)',
    text: at('signature'),
  },
  SYSTEM_CONSTRUCTOR_EXIT: {
    fields: ['line', 'signature'],
    shape: 'exit',
    kind: 'method',
    debugCategory: 'system',
    level: 'FINE',
  },
  SYSTEM_METHOD_ENTRY: {
    fields: ['line', 'signature'],
    shape: 'frame',
    kind: 'method',
    exits: ['SYSTEM_METHOD_EXIT'],
    category: 'System',
    debugCategory: 'system',
    level: 'FINE',
    cpu: 'method',
    text: at('signature'),
  },
  SYSTEM_METHOD_EXIT: {
    fields: ['line', 'signature'],
    shape: 'exit',
    kind: 'method',
    debugCategory: 'system',
    level: 'FINE',
  },
  SYSTEM_MODE_ENTER: { fields: ['mode'], debugCategory: 'system', level: 'INFO', text: at('mode') },
  SYSTEM_MODE_EXIT: { fields: ['mode'], debugCategory: 'system', level: 'INFO', text: at('mode') },
  TEMPLATE_PROCESSING_ERROR: { fields: ['errorDetails'], debugCategory: 'wave', level: 'ERROR' },
  TEMPLATED_ASSET: { fields: ['assetDetails'], debugCategory: 'wave', level: 'FINE' },
  TESTING_LIMITS: {
    debugCategory: 'apexProfiling',
    level: 'INFO',
    kind: 'limits',
    acceptsText: true,
  },
  TOTAL_EMAIL_RECIPIENTS_QUEUED: {
    fields: ['recipients'],
    debugCategory: 'apexProfiling',
    level: 'FINE',
    text: at('recipients'),
  },
  TRANSFORMATION_SUMMARY: { fields: ['summaryData'], debugCategory: 'wave', level: 'FINE' },
  USER_DEBUG: {
    fields: ['line', 'level', 'message'],
    debugCategory: 'apexCode',
    level: 'DEBUG',
    kind: 'debug',
    acceptsText: true,
    text: from('level', ' | '),
  },
  USER_DEBUG_DEBUG: {
    fields: ['line', 'debugMessage'],
    debugCategory: 'apexCode',
    level: 'DEBUG',
    kind: 'debug',
  },
  USER_DEBUG_ERROR: {
    fields: ['line', 'debugMessage'],
    debugCategory: 'apexCode',
    level: 'ERROR',
    kind: 'debug',
  },
  USER_DEBUG_FINE: {
    fields: ['line', 'debugMessage'],
    debugCategory: 'apexCode',
    level: 'FINE',
    kind: 'debug',
  },
  USER_DEBUG_FINER: {
    fields: ['line', 'debugMessage'],
    debugCategory: 'apexCode',
    level: 'FINER',
    kind: 'debug',
  },
  USER_DEBUG_FINEST: {
    fields: ['line', 'debugMessage'],
    debugCategory: 'apexCode',
    level: 'FINEST',
    kind: 'debug',
  },
  USER_DEBUG_INFO: {
    fields: ['line', 'debugMessage'],
    debugCategory: 'apexCode',
    level: 'INFO',
    kind: 'debug',
  },
  USER_DEBUG_WARN: {
    fields: ['line', 'debugMessage'],
    debugCategory: 'apexCode',
    level: 'WARN',
    kind: 'debug',
  },
  USER_INFO: {
    fields: ['line', 'userId', 'username', 'timezone', 'timezoneGmt'],
    debugCategory: 'apexCode',
    level: 'ERROR',
    text: joinPresent(' ', 'userId', 'username'),
  },
  USER_MODE_PERMSET_APPLIED: { debugCategory: 'database', level: 'FINE' },
  VALIDATION_ERROR: {
    fields: ['errorMessage'],
    debugCategory: 'validation',
    level: 'INFO',
    kind: 'validation',
    acceptsText: true,
    text: at('errorMessage'),
  },
  VALIDATION_FAIL: { debugCategory: 'validation', level: 'INFO', kind: 'validation' },
  VALIDATION_FORMULA: {
    fields: ['formula', 'values'],
    debugCategory: 'validation',
    level: 'INFO',
    kind: 'validation',
    acceptsText: true,
    text: from('formula', '|'),
    after: validationFormulaAfter,
  },
  VALIDATION_PASS: { debugCategory: 'validation', level: 'INFO', kind: 'validation' },
  VALIDATION_RULE: {
    fields: ['ruleId', 'ruleName'],
    debugCategory: 'validation',
    level: 'INFO',
    kind: 'validation',
    text: at('ruleName'),
  },
  VARIABLE_ASSIGNMENT: {
    fields: ['line', 'name', 'value', 'address'],
    debugCategory: 'apexCode',
    level: 'FINEST',
    kind: 'variable',
    text: from('name', ' | '),
  },
  VARIABLE_SCOPE_BEGIN: {
    fields: ['line', 'name', 'type', 'isReference', 'isStatic'],
    debugCategory: 'apexCode',
    level: 'FINEST',
    kind: 'variable',
    text: from('name', ' | '),
  },
  VARIABLE_SCOPE_END: { debugCategory: 'apexCode', level: 'FINEST', kind: 'variable' },
  VF_APEX_CALL: { debugCategory: 'apexCode', level: 'INFO', kind: 'visualforce' },
  VF_APEX_CALL_END: {
    fields: ['element', 'method'],
    shape: 'exit',
    kind: 'method',
    debugCategory: 'visualforce',
    level: 'FINE',
    text: at('element'),
  },
  // A line that names no method, or a page-message controller, opens no frame; the engine decides.
  VF_APEX_CALL_START: {
    fields: ['line', 'element', 'method', 'controller'],
    shape: 'frame',
    kind: 'method',
    exits: ['VF_APEX_CALL_END'],
    category: 'Apex',
    debugCategory: 'visualforce',
    level: 'FINE',
    cpu: 'method',
    suffix: ' (VF APEX)',
    symbols: true,
    text: vfApexCallText,
  },
  VF_DESERIALIZE_CONTINUATION_STATE_BEGIN: {
    shape: 'frame',
    kind: 'visualforce',
    exits: ['VF_DESERIALIZE_CONTINUATION_STATE_END'],
    category: 'Apex',
    debugCategory: 'visualforce',
    level: 'INFO',
    cpu: 'method',
  },
  VF_DESERIALIZE_CONTINUATION_STATE_END: {
    shape: 'exit',
    kind: 'visualforce',
    debugCategory: 'visualforce',
    level: 'INFO',
  },
  VF_DESERIALIZE_VIEWSTATE_BEGIN: {
    fields: ['viewStateId'],
    shape: 'frame',
    kind: 'visualforce',
    exits: ['VF_DESERIALIZE_VIEWSTATE_END'],
    category: 'System',
    debugCategory: 'visualforce',
    level: 'INFO',
    cpu: 'method',
  },
  VF_DESERIALIZE_VIEWSTATE_END: {
    shape: 'exit',
    kind: 'visualforce',
    debugCategory: 'visualforce',
    level: 'INFO',
  },
  VF_EVALUATE_FORMULA_BEGIN: {
    fields: ['viewStateId', 'formula'],
    shape: 'frame',
    kind: 'visualforce',
    exits: ['VF_EVALUATE_FORMULA_END'],
    category: 'System',
    debugCategory: 'visualforce',
    level: 'FINER',
    cpu: 'custom',
    suffix: ' (VF FORMULA)',
    text: at('formula'),
  },
  VF_EVALUATE_FORMULA_END: {
    shape: 'exit',
    kind: 'visualforce',
    debugCategory: 'visualforce',
    level: 'FINER',
  },
  VF_PAGE_MESSAGE: {
    fields: ['message'],
    debugCategory: 'apexCode',
    level: 'INFO',
    kind: 'visualforce',
    acceptsText: true,
    text: at('message'),
  },
  VF_SERIALIZE_CONTINUATION_STATE_BEGIN: {
    shape: 'frame',
    kind: 'visualforce',
    exits: ['VF_SERIALIZE_CONTINUATION_STATE_END'],
    category: 'Apex',
    debugCategory: 'visualforce',
    level: 'INFO',
    cpu: 'method',
  },
  VF_SERIALIZE_CONTINUATION_STATE_END: {
    shape: 'exit',
    kind: 'visualforce',
    debugCategory: 'visualforce',
    level: 'INFO',
  },
  VF_SERIALIZE_VIEWSTATE_BEGIN: {
    fields: ['viewStateId'],
    shape: 'frame',
    kind: 'visualforce',
    exits: ['VF_SERIALIZE_VIEWSTATE_END'],
    category: 'System',
    debugCategory: 'visualforce',
    level: 'INFO',
    cpu: 'method',
  },
  VF_SERIALIZE_VIEWSTATE_END: {
    shape: 'exit',
    kind: 'visualforce',
    debugCategory: 'visualforce',
    level: 'INFO',
  },
  WAVE_APP_LIFECYCLE: { fields: ['lifecycleEvent'], debugCategory: 'wave', level: 'INFO' },
  WF_ACTION: {
    fields: ['actionDescription'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at('actionDescription'),
  },
  WF_ACTION_TASK: {
    fields: ['taskSubject', 'actionId', 'ruleName', 'ruleId', 'owner', 'dueDate'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 'taskSubject', 'actionId', 'ruleName', 'ruleId', 'owner', 'dueDate'),
  },
  WF_ACTIONS_END: {
    fields: ['summaryActionsPerformed'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at('summaryActionsPerformed'),
  },
  WF_APEX_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_APPROVAL: {
    fields: ['transitionType', 'record', 'nodeName'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 'transitionType', 'record', 'nodeName'),
  },
  WF_APPROVAL_REMOVE: {
    fields: ['record'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at('record'),
  },
  WF_APPROVAL_SUBMIT: {
    fields: ['submissionDetails'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at('submissionDetails'),
  },
  WF_APPROVAL_SUBMITTER: {
    fields: ['submitterName', 'submitterId'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 'submitterName', 'submitterId'),
  },
  WF_ASSIGN: {
    fields: ['owner', 'assigneeTemplateId'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 'owner', 'assigneeTemplateId'),
  },
  WF_CHATTER_POST: {
    fields: ['chatterPostDetails'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
  },
  WF_CRITERIA_BEGIN: {
    fields: ['record', 'ruleName', 'ruleId', 'triggerType', 'recursiveCount'],
    shape: 'frame',
    kind: 'workflow',
    exits: ['WF_CRITERIA_END', 'WF_RULE_NOT_EVALUATED'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: joinPresent(' : ', 'triggerType', 'ruleName'),
  },
  WF_CRITERIA_END: {
    fields: ['result'],
    shape: 'exit',
    kind: 'workflow',
    debugCategory: 'workflow',
    level: 'INFO',
  },
  WF_EMAIL_ALERT: {
    fields: ['alert'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at('alert'),
  },
  WF_EMAIL_SENT: {
    fields: ['template', 'recipients', 'ccEmails'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 'template', 'recipients', 'ccEmails'),
  },
  WF_ENQUEUE_ACTIONS: {
    fields: ['summaryActionsEnqueued'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at('summaryActionsEnqueued'),
  },
  WF_ESCALATION_ACTION: {
    fields: ['caseId', 'escalationDate'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 'caseId', 'escalationDate'),
  },
  WF_ESCALATION_RULE: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_EVAL_ENTRY_CRITERIA: {
    fields: ['processName', 'emailTemplateId', 'result'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 'processName', 'emailTemplateId', 'result'),
  },
  WF_FIELD_UPDATE: {
    fields: ['record', 'field', 'value', 'detail', 'currentRule'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' ', 'record', 'field', 'value', 'detail', 'currentRule'),
  },
  WF_FLOW_ACTION_BEGIN: {
    fields: ['flowTriggerId'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
  },
  WF_FLOW_ACTION_DETAIL: {
    fields: ['first', 'second', 'third', 'currentRule'],
    debugCategory: 'workflow',
    level: 'FINE',
    kind: 'workflow',
    text: flowActionDetailText,
  },
  WF_FLOW_ACTION_END: {
    fields: ['flowTriggerId'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
  },
  WF_FLOW_ACTION_ERROR: {
    fields: ['flowTriggerId', 'flowDefinitionId', 'message'],
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'workflow',
    acceptsText: true,
    text: flowActionErrorText,
  },
  WF_FLOW_ACTION_ERROR_DETAIL: {
    fields: ['message'],
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'workflow',
    acceptsText: true,
    text: from('message', '|'),
  },
  WF_FORMULA: {
    fields: ['formula', 'values'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    acceptsText: true,
    text: from('formula', '|'),
    after: wfFormulaAfter,
  },
  WF_HARD_REJECT: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_KNOWLEDGE_ACTION: {
    fields: ['actionDetails'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
  },
  WF_NEXT_APPROVER: {
    fields: ['owner', 'nextOwnerType', 'field'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 'owner', 'nextOwnerType', 'field'),
  },
  WF_NO_PROCESS_FOUND: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_OUTBOUND_MSG: {
    fields: ['record', 'actionId', 'ruleName', 'ruleId'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 'record', 'actionId', 'ruleName', 'ruleId'),
  },
  WF_PROCESS_FOUND: {
    fields: ['process', 'label'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 'process', 'label'),
  },
  WF_PROCESS_NODE: {
    fields: ['processName'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at('processName'),
  },
  WF_QUICK_CREATE: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_REASSIGN_RECORD: {
    fields: ['record', 'owner'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 'record', 'owner'),
  },
  WF_RESPONSE_NOTIFY: {
    fields: ['notifierName', 'notifierEmail', 'notifierTemplateId', 'replyEmail'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 'notifierName', 'notifierEmail', 'notifierTemplateId', 'replyEmail'),
  },
  WF_RULE_ENTRY_ORDER: {
    fields: ['integerIndicatingOrder'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at('integerIndicatingOrder'),
  },
  WF_RULE_EVAL_BEGIN: {
    fields: ['ruleType'],
    shape: 'frame',
    kind: 'workflow',
    exits: ['WF_RULE_EVAL_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at('ruleType'),
  },
  WF_RULE_EVAL_END: { shape: 'exit', kind: 'workflow', debugCategory: 'workflow', level: 'INFO' },
  WF_RULE_EVAL_VALUE: {
    fields: ['value'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at('value'),
  },
  WF_RULE_FILTER: {
    fields: ['filterCriteria'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    acceptsText: true,
    text: at('filterCriteria'),
  },
  WF_RULE_INVOCATION: {
    fields: ['rule'],
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at('rule'),
  },
  WF_RULE_NOT_EVALUATED: {
    shape: 'exit',
    kind: 'workflow',
    debugCategory: 'workflow',
    level: 'INFO',
  },
  WF_SEND_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_SOFT_REJECT: {
    fields: ['processName'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at('processName'),
  },
  WF_SPOOL_ACTION_BEGIN: {
    fields: ['nodeType'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at('nodeType'),
  },
  WF_TIME_TRIGGER: {
    fields: ['record', 'timeAction', 'timeActionContainer', 'evaluationTime'],
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 'record', 'timeAction', 'timeActionContainer', 'evaluationTime'),
  },
  WF_TIME_TRIGGERS_BEGIN: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  XDS_DETAIL: {
    fields: ['detail'],
    debugCategory: 'callout',
    level: 'FINER',
    kind: 'callout',
    text: at('detail'),
  },
  XDS_REQUEST_DETAIL: {
    fields: ['requestDetail'],
    debugCategory: 'callout',
    level: 'FINER',
    kind: 'callout',
  },
  XDS_RESPONSE: {
    fields: [
      'externalDataSource',
      'externalObject',
      'requestDetails',
      'numberReturnedRecords',
      'systemUsage',
    ],
    debugCategory: 'callout',
    level: 'INFO',
    kind: 'callout',
    text: join(
      ' : ',
      'externalDataSource',
      'externalObject',
      'requestDetails',
      'numberReturnedRecords',
      'systemUsage',
    ),
  },
  XDS_RESPONSE_DETAIL: {
    fields: ['response'],
    debugCategory: 'callout',
    level: 'FINER',
    kind: 'callout',
    text: at('response'),
  },
  XDS_RESPONSE_ERROR: {
    fields: ['errorMessage'],
    debugCategory: 'callout',
    level: 'ERROR',
    kind: 'callout',
    text: at('errorMessage'),
  },
};

const typeIds = new Map(EVENT_TYPE_NAMES.map((type, typeId) => [type, typeId]));

function infoOf(type: EventType, typeId: number): EventTypeInfo {
  const def = ENTRIES[type];
  return Object.freeze({
    typeId,
    type,
    fields: Object.freeze(fieldNamesOf(type)),
    shape: def.shape ?? 'leaf',
    kind: def.kind ?? 'other',
    category: def.category ?? null,
    debugCategory: def.debugCategory,
    debugLevel: def.level,
    exitTypes: def.exits ? Object.freeze(def.exits) : NO_TYPES,
  });
}

/** How `eventText` builds one type's text. Private, so text has one seam. */
interface TextOf {
  readonly rule: TextRule | null;
  readonly after: AfterRule | null;
}

const fieldNamesOf = (type: EventType): readonly string[] =>
  (ENTRIES[type].fields ?? NO_FIELDS) as readonly string[];

function grammarOf(type: EventType): Grammar {
  const def = ENTRIES[type];
  return Object.freeze({
    closes: def.shape === 'frame' ? (def.closes ?? 'exit') : null,
    hasLineNumber: fieldNamesOf(type)[0] === 'line',
    acceptsText: def.acceptsText ?? false,
    discontinuity: def.discontinuity ?? false,
    cpuType: def.cpu ?? null,
    suffix: def.suffix ?? null,
    hasValidSymbols: def.symbols ?? false,
  });
}

function textOf(type: EventType): TextOf {
  const def = ENTRIES[type];
  const fields = fieldNamesOf(type);
  const position = (name: string): number => {
    const i = fields.indexOf(name);
    if (i < 0)
      throw new Error(`${type}: a text rule reads '${name}', which is not one of its fields`);
    return i + 2;
  };
  return {
    rule: def.text?.(position) ?? null,
    after: def.after ?? null,
  };
}

/** Every event type, indexed by type id. */
export const EVENT_TYPES: readonly EventTypeInfo[] = Object.freeze(EVENT_TYPE_NAMES.map(infoOf));

/** The engine's rules for each event type, indexed by type id. Internal. */
export const GRAMMAR: readonly Grammar[] = Object.freeze(EVENT_TYPE_NAMES.map(grammarOf));

const TEXT: readonly TextOf[] = EVENT_TYPE_NAMES.map(textOf);

/** The type info for a type name. */
export function eventType(type: EventType): EventTypeInfo;
/** The type info for a type id, such as a value of `columns.type`. Null when no type has it. */
export function eventType(typeId: number): EventTypeInfo | null;
export function eventType(type: EventType | number): EventTypeInfo | null {
  const typeId = typeof type === 'number' ? type : typeIds.get(type);
  return (typeId !== undefined && EVENT_TYPES[typeId]) || null;
}

/** The type id of a type name, or -1 when the catalog does not hold it. Internal. */
export function idOfType(name: string): number {
  return typeIds.get(name as EventType) ?? -1;
}

/**
 * An event's text: its type's rule, then its continuation lines if the type takes text, then its
 * type's rewrite. Null when neither gives any text.
 */
export function eventText(typeId: number, f: Fields): string | null {
  const text = TEXT[typeId];
  const grammar = GRAMMAR[typeId];
  if (!text || !grammar) return null;
  // An empty field is no text, so that a missing field and an absent rule read the same.
  const base = text.rule?.(f) || null;
  const more = grammar.acceptsText ? f.continuation() : '';
  const joined = base === null ? more : more ? `${base}\n${more}` : base;
  if (!joined) return null;
  return text.after ? text.after(joined) : joined;
}
