/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { EventFields } from './fields.js';
import type { AfterRule, FieldPosition, TextRule, TextSpec } from './text.js';
import {
  codeUnitText,
  codeUnitTypeText,
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
  DebugCategory,
  EventType,
  EventTypeInfo,
  Fields,
  Kind,
  Level,
  LineFields,
  Shape,
} from './types.js';
import { EVENT_TYPE_NAMES, KIND } from './types.js';

/** The rollup counter an event of a type adds one to. */
export type Count = 'soql' | 'sosl' | 'dml' | 'thrown';

/** The rollup counter a `rows` field adds to. */
export type RowsOf = 'soql' | 'sosl' | 'dml';

/**
 * How the engine finds an event's namespace. Each rule reads the fields `NAMESPACE_FIELDS` names.
 * - `none`: no namespace, and none taken from the frame. v0 stated `'default'` here.
 * - `method`: from the signature; a `System.Type.forName(` signature states none.
 * - `methodExit`: from an exit whose text has no `)`; the frame it closes takes it.
 */
export type NamespaceRule =
  | 'none'
  | 'method'
  | 'methodExit'
  | 'constructor'
  | 'codeUnit'
  | 'package'
  | 'limits';

/**
 * Scan-time work for one type that no declaration states. Each hook reads `HOOK_FIELDS`. Work on
 * text is not a hook: the views do it when a caller reads it.
 */
export type Hook = 'limitSnapshot' | 'limitException' | 'fatal' | 'flowTotal' | 'vfApexCall';

const NAMESPACE_FIELDS: { readonly [R in NamespaceRule]: readonly string[] } = {
  none: [],
  method: ['signature'],
  methodExit: ['classId', 'signature'],
  constructor: ['className'],
  codeUnit: ['unit', 'name', 'typeRef'],
  // The same field, read two ways: a package's last dotted part, or a limit block's bare name.
  package: ['namespace'],
  limits: ['namespace'],
};

// The text hooks read the event's text, so they name no field.
const HOOK_FIELDS: { readonly [H in Hook]: readonly string[] } = {
  limitSnapshot: [],
  limitException: [],
  fatal: [],
  flowTotal: ['usage'],
  vfApexCall: ['element', 'method', 'controller'],
};

/** How a frame of a type closes. */
export type Closes = 'exit' | 'next-line' | 'next-event';

interface CommonDef {
  /**
   * Omit to take the `debugCategory` when that is a kind, as for `callout`, else `other`. State
   * `other` to opt out.
   */
  readonly kind?: Kind;
  readonly debugCategory: DebugCategory;
  readonly level: Level;
  readonly symbols?: boolean;
  readonly acceptsText?: boolean;
  readonly discontinuity?: boolean;
  readonly after?: AfterRule;
  /** False for a type whose own time the platform does not count toward the Apex CPU limit. */
  readonly consumesCpuTime?: false;
}

/** A frame states `exits` or `closes`, which is what makes its shape a frame. */
interface FrameDef extends CommonDef {
  /** Not stated: a frame states `exits` or `closes`, which make its shape. */
  readonly shape?: never;
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
  readonly shape?: Exclude<Shape, 'frame' | 'exit'>;
  readonly exits?: never;
  readonly closes?: never;
}

/** An exit line. Its `debugCategory`, `level` and `kind` are those of the frame that lists it in `exits`. */
interface ExitDef extends Omit<CommonDef, 'debugCategory' | 'level' | 'kind'> {
  readonly shape: 'exit';
  /** Not stated: the frame that lists this exit in `exits` states `debugCategory`, `level` and `kind`. */
  readonly debugCategory?: never;
  readonly level?: never;
  readonly kind?: never;
  readonly exits?: never;
  readonly closes?: never;
}

type FieldName<T extends EventType> = keyof EventFields[T] & string;

/** One hand-written catalog entry. Omitted keys take the defaults in `infoOf`, `grammarOf` and `lineRulesOf`. */
type Def<T extends EventType> = (ExitClosedDef | OtherClosedDef | PointDef | ExitDef) & {
  /** The line's fields from field 2 on, in order. */
  readonly fields?: readonly FieldName<T>[];
  readonly text?: TextSpec<FieldName<T>>;
  readonly count?: Count;
  /** The row count the line states, credited to the frame the line opens or closes. */
  readonly rows?: { readonly field: FieldName<T>; readonly of: RowsOf };
  /** The heap bytes the line states, added to the running heap with `sign`. */
  readonly heap?: { readonly field: FieldName<T>; readonly sign: 1 | -1 };
  readonly namespace?: NamespaceRule;
  readonly hook?: Hook;
};

/**
 * The engine's half of an entry. Every key is present, so reads stay monomorphic.
 * `hasValidSymbols` is the type's default; an event can state its own.
 */
export interface Grammar {
  readonly closes: Closes | null;
  /** The position of the `line` field, or -1. Positions are -1 for none, so each stays an integer. */
  readonly lineField: number;
  /** A line after this type's line that starts no event is its text, not an `Invalid log line`. */
  readonly acceptsText: boolean;
  readonly discontinuity: boolean;
  readonly hasValidSymbols: boolean;
  readonly count: Count | null;
  readonly rowsField: number;
  readonly rowsOf: RowsOf | null;
  readonly heapField: number;
  /** 1 adds the bytes to the running heap, -1 takes them off. 0 when the type states no bytes. */
  readonly heapSign: 1 | -1 | 0;
  readonly namespace: NamespaceRule | null;
  readonly namespaceFields: readonly number[];
  readonly hook: Hook | null;
  readonly hookFields: readonly number[];
}

const NO_TYPES: readonly EventType[] = Object.freeze([]);
const NO_FIELDS: readonly string[] = Object.freeze([]);
const NO_POSITIONS: readonly number[] = Object.freeze([]);
/** The position of a line's first named field, after the timestamp and the type. */
export const FIRST_FIELD = 2;
/** What a `rows` field states before its count, as in `Rows:10`. */
export const ROWS_PREFIX = 'Rows:';
/** What a `heap` field states before its bytes, as in `Bytes:8`. */
export const HEAP_PREFIX = 'Bytes:';

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
  ADD_SCREEN_POP_ACTION: { debugCategory: 'workflow', level: 'INFO' },
  ADD_SKILL_REQUIREMENT_ACTION: { debugCategory: 'workflow', level: 'INFO' },
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
    heap: { field: 'bytes', sign: 1 },
    fields: ['bytes'],
    debugCategory: 'apexCode',
    level: 'FINEST',
    kind: 'heap',
    text: at('bytes'),
  },
  CALLOUT_REQUEST: {
    fields: ['line', 'request'],
    exits: ['CALLOUT_RESPONSE'],
    debugCategory: 'callout',
    level: 'INFO',
    consumesCpuTime: false,
    text: at('request'),
  },
  CALLOUT_REQUEST_FINALIZE: {
    fields: ['finalizationDetails'],
    debugCategory: 'callout',
    level: 'FINEST',
  },
  CALLOUT_REQUEST_PREPARE: {
    fields: ['preparationDetails'],
    debugCategory: 'callout',
    level: 'FINEST',
  },
  CALLOUT_RESPONSE: {
    fields: ['line', 'response'],
    shape: 'exit',
    text: at('response'),
  },
  CODE_UNIT_FINISHED: {
    fields: ['name', 'typeRef'],
    shape: 'exit',
    text: at('name'),
  },
  CODE_UNIT_STARTED: {
    namespace: 'codeUnit',
    fields: ['line', 'unit', 'name', 'typeRef'],
    kind: 'code-unit',
    exits: ['CODE_UNIT_FINISHED'],
    debugCategory: 'apexCode',
    level: 'ERROR',
    text: codeUnitText,
  },
  CONSTRUCTOR_ENTRY: {
    namespace: 'constructor',
    fields: ['line', 'classId', 'signature', 'className'],
    kind: 'method',
    exits: ['CONSTRUCTOR_EXIT'],
    debugCategory: 'apexCode',
    level: 'FINE',
    symbols: true,
    text: constructorText,
  },
  CONSTRUCTOR_EXIT: {
    fields: ['line', 'classId', 'signature', 'className'],
    shape: 'exit',
  },
  CUMULATIVE_LIMIT_USAGE: {
    namespace: 'none',
    kind: 'limits',
    exits: ['CUMULATIVE_LIMIT_USAGE_END'],
    debugCategory: 'apexProfiling',
    level: 'INFO',
  },
  CUMULATIVE_LIMIT_USAGE_END: {
    shape: 'exit',
  },
  CUMULATIVE_PROFILING: {
    namespace: 'none',
    fields: ['section', 'detail'],
    debugCategory: 'apexProfiling',
    level: 'FINE',
    acceptsText: true,
    text: join(' ', 'section', 'detail'),
  },
  CUMULATIVE_PROFILING_BEGIN: {
    namespace: 'none',
    exits: ['CUMULATIVE_PROFILING_END'],
    debugCategory: 'apexProfiling',
    level: 'FINE',
  },
  CUMULATIVE_PROFILING_END: { shape: 'exit' },
  CURSOR_CREATE_BEGIN: {
    fields: ['line', 'soqlQuery'],
    kind: 'soql',
    exits: ['CURSOR_CREATE_END'],
    debugCategory: 'database',
    level: 'INFO',
    consumesCpuTime: false,
  },
  CURSOR_CREATE_END: {
    fields: ['line', 'queryId', 'numberRowsResult'],
    shape: 'exit',
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
    count: 'dml',
    rows: { field: 'rows', of: 'dml' },
    namespace: 'none',
    fields: ['line', 'operation', 'objectType', 'rows'],
    kind: 'dml',
    exits: ['DML_END'],
    debugCategory: 'database',
    level: 'INFO',
    consumesCpuTime: false,
    text: rule(['operation', 'objectType'], (op, type) => (f) => `DML ${f.at(op)} ${f.at(type)}`),
  },
  DML_END: {
    fields: ['line'],
    shape: 'exit',
  },
  DUPLICATE_DETECTION_BEGIN: {
    exits: ['DUPLICATE_DETECTION_END'],
    debugCategory: 'system',
    level: 'INFO',
  },
  DUPLICATE_DETECTION_END: { shape: 'exit' },
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
  END_CALL: { debugCategory: 'workflow', level: 'INFO', kind: 'other' },
  ENTERING_MANAGED_PKG: {
    namespace: 'package',
    fields: ['namespace'],
    kind: 'package',
    closes: 'next-event',
    debugCategory: 'apexCode',
    level: 'FINE',
    text: managedPackageText,
  },
  EVENT_SERVICE_PUB_BEGIN: {
    fields: ['eventType'],
    exits: ['EVENT_SERVICE_PUB_END'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('eventType'),
  },
  EVENT_SERVICE_PUB_DETAIL: {
    fields: ['subscriptionIds', 'userId', 'eventMessageData'],
    debugCategory: 'workflow',
    level: 'FINER',
    text: join(' ', 'subscriptionIds', 'userId', 'eventMessageData'),
  },
  EVENT_SERVICE_PUB_END: {
    fields: ['eventType'],
    shape: 'exit',
    text: at('eventType'),
  },
  EVENT_SERVICE_SUB_BEGIN: {
    fields: ['eventType', 'action'],
    exits: ['EVENT_SERVICE_SUB_END'],
    debugCategory: 'workflow',
    level: 'INFO',
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
    text: join(' ', 'eventType', 'action'),
  },
  EXCEPTION_THROWN: {
    count: 'thrown',
    hook: 'limitException',
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
  },
  EXECUTION_STARTED: {
    namespace: 'none',
    kind: 'execution',
    exits: ['EXECUTION_FINISHED'],
    debugCategory: 'apexCode',
    level: 'ERROR',
  },
  EXTERNAL_SERVICE_CALLBACK: { debugCategory: 'callout', level: 'INFO' },
  EXTERNAL_SERVICE_REQUEST: {
    fields: ['requestDetails'],
    debugCategory: 'callout',
    level: 'INFO',
  },
  EXTERNAL_SERVICE_RESPONSE: {
    fields: ['responseDetails'],
    debugCategory: 'callout',
    level: 'INFO',
  },
  FATAL_ERROR: {
    hook: 'fatal',
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
    kind: 'flow',
    exits: ['FLOW_BULK_ELEMENT_END'],
    debugCategory: 'workflow',
    level: 'FINE',
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
  },
  FLOW_BULK_ELEMENT_LIMIT_USAGE: {
    hook: 'flowTotal',
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
    kind: 'flow',
    exits: ['FLOW_ELEMENT_END'],
    debugCategory: 'workflow',
    level: 'FINE',
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
    hook: 'flowTotal',
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
    kind: 'flow',
    exits: ['FLOW_START_INTERVIEW_END'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('flowName'),
  },
  FLOW_START_INTERVIEW_END: {
    fields: ['interviewId', 'flowName'],
    shape: 'exit',
  },
  FLOW_START_INTERVIEW_LIMIT_USAGE: {
    fields: ['usage'],
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'limits',
    text: at('usage'),
  },
  // Its text comes from its first interview: `views/lines.ts`.
  FLOW_START_INTERVIEWS_BEGIN: {
    fields: ['requests'],
    kind: 'flow',
    exits: ['FLOW_START_INTERVIEWS_END'],
    debugCategory: 'workflow',
    level: 'INFO',
  },
  FLOW_START_INTERVIEWS_END: {
    fields: ['requests'],
    shape: 'exit',
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
    exits: ['FORMULA_EVALUATE_END'],
    debugCategory: 'apexCode',
    level: 'FINER',
  },
  FORMULA_EVALUATE_END: { shape: 'exit' },
  FUNCTION_INVOCATION_REQUEST: {
    fields: ['invocationRequestDetails'],
    debugCategory: 'callout',
    level: 'INFO',
  },
  FUNCTION_INVOCATION_RESPONSE: {
    fields: ['invocationResponseDetails'],
    debugCategory: 'callout',
    level: 'INFO',
  },
  HEAP_ALLOCATE: {
    heap: { field: 'bytes', sign: 1 },
    fields: ['line', 'bytes'],
    debugCategory: 'apexCode',
    level: 'FINER',
    kind: 'heap',
    text: at('bytes'),
  },
  HEAP_DEALLOCATE: {
    heap: { field: 'bytes', sign: -1 },
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
    namespace: 'none',
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
    namespace: 'limits',
    hook: 'limitSnapshot',
    fields: ['namespace', 'usage'],
    debugCategory: 'apexProfiling',
    level: 'FINEST',
    kind: 'limits',
    acceptsText: true,
    text: at('namespace'),
    after: limitsForNamespaceAfter,
  },
  MATCH_ENGINE_BEGIN: {
    exits: ['MATCH_ENGINE_END'],
    debugCategory: 'system',
    level: 'INFO',
  },
  MATCH_ENGINE_END: { shape: 'exit' },
  MATCH_ENGINE_INVOCATION: {
    fields: ['invocationDetails'],
    debugCategory: 'system',
    level: 'INFO',
  },
  METHOD_ENTRY: {
    namespace: 'method',
    fields: ['line', 'classId', 'signature'],
    kind: 'method',
    exits: ['METHOD_EXIT'],
    debugCategory: 'apexCode',
    level: 'FINE',
    symbols: true,
    text: at('signature'),
  },
  METHOD_EXIT: {
    namespace: 'methodExit',
    fields: ['line', 'classId', 'signature'],
    shape: 'exit',
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
    text: join(' : ', 'credentialName', 'endpoint', 'method', 'credentialType'),
  },
  NAMED_CREDENTIAL_RESPONSE: {
    fields: ['body'],
    debugCategory: 'callout',
    level: 'INFO',
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
    text: rule(
      ['credentialName', 'statusCode', 'responseSize', 'calloutTime', 'connectTime'],
      (name, status, size, callout, connect) => (f) =>
        `${f.at(name)} : ${f.at(status)} ${f.at(size)} : ${f.at(callout)} ${f.at(connect)}`,
    ),
  },
  NBA_NODE_BEGIN: {
    fields: ['elementName', 'elementType'],
    exits: ['NBA_NODE_END'],
    debugCategory: 'nba',
    level: 'FINE',
    text: from('elementName', ' | '),
  },
  NBA_NODE_DETAIL: {
    fields: ['elementName', 'elementType', 'message'],
    debugCategory: 'nba',
    level: 'FINE',
    text: from('elementName', ' | '),
  },
  NBA_NODE_END: {
    fields: ['elementName', 'elementType', 'message'],
    shape: 'exit',
    text: from('elementName', ' | '),
  },
  NBA_NODE_ERROR: {
    fields: ['elementName', 'elementType', 'errorMessage'],
    debugCategory: 'nba',
    level: 'ERROR',
    text: from('elementName', ' | '),
  },
  NBA_OFFER_INVALID: {
    fields: ['name', 'id', 'reason'],
    debugCategory: 'nba',
    level: 'FINE',
    text: from('name', ' | '),
  },
  NBA_STRATEGY_BEGIN: {
    fields: ['strategyName'],
    exits: ['NBA_STRATEGY_END'],
    debugCategory: 'nba',
    level: 'FINE',
    text: from('strategyName', ' | '),
  },
  NBA_STRATEGY_END: {
    fields: ['strategyName', 'countOutputs'],
    shape: 'exit',
    text: from('strategyName', ' | '),
  },
  NBA_STRATEGY_ERROR: {
    fields: ['strategyName', 'errorMessage'],
    debugCategory: 'nba',
    level: 'ERROR',
    text: from('strategyName', ' | '),
  },
  ORG_CACHE_CONTAINS: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_GET: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_GET_BEGIN: {
    fields: ['key'],
    kind: 'cache',
    exits: ['ORG_CACHE_GET_END'],
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  ORG_CACHE_GET_CAPACITY: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_GET_END: {
    fields: ['hitMiss'],
    shape: 'exit',
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
    kind: 'cache',
    exits: ['ORG_CACHE_PUT_END'],
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  ORG_CACHE_PUT_END: { shape: 'exit' },
  ORG_CACHE_REMOVE: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_REMOVE_BEGIN: {
    fields: ['key'],
    kind: 'cache',
    exits: ['ORG_CACHE_REMOVE_END'],
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  ORG_CACHE_REMOVE_END: { shape: 'exit' },
  PLAY_PROMPT: { debugCategory: 'workflow', level: 'INFO', kind: 'other' },
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
    kind: 'soql',
    exits: ['QUERY_MORE_END'],
    debugCategory: 'database',
    level: 'INFO',
    consumesCpuTime: false,
    text: queryMoreText,
  },
  QUERY_MORE_END: {
    fields: ['line'],
    shape: 'exit',
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
    exits: ['RLM_CONFIGURATOR_END'],
    debugCategory: 'system',
    level: 'FINE',
  },
  RLM_CONFIGURATOR_DEPLOY: { debugCategory: 'system', level: 'FINE' },
  RLM_CONFIGURATOR_END: { shape: 'exit' },
  RLM_CONFIGURATOR_STATS: { debugCategory: 'system', level: 'FINE' },
  RLM_PRICING_BEGIN: {
    exits: ['RLM_PRICING_END'],
    debugCategory: 'system',
    level: 'FINE',
  },
  RLM_PRICING_END: { shape: 'exit' },
  ROUTE_WORK_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'other' },
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
    kind: 'cache',
    exits: ['SESSION_CACHE_GET_END'],
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  SESSION_CACHE_GET_CAPACITY: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_GET_END: {
    fields: ['hitMiss'],
    shape: 'exit',
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
    kind: 'cache',
    exits: ['SESSION_CACHE_PUT_END'],
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  SESSION_CACHE_PUT_END: {
    shape: 'exit',
  },
  SESSION_CACHE_REMOVE: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_REMOVE_BEGIN: {
    fields: ['key'],
    kind: 'cache',
    exits: ['SESSION_CACHE_REMOVE_END'],
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  SESSION_CACHE_REMOVE_END: {
    shape: 'exit',
  },
  SLA_CASE_MILESTONE: { debugCategory: 'workflow', level: 'FINE' },
  SLA_END: {
    fields: ['cases', 'loadTime', 'processingTime', 'milestones', 'newTrigger'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'cases', 'loadTime', 'processingTime', 'milestones', 'newTrigger'),
  },
  SLA_EVAL_MILESTONE: {
    fields: ['milestoneId'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('milestoneId'),
  },
  SLA_NULL_START_DATE: { debugCategory: 'workflow', level: 'INFO' },
  SLA_PROCESS_CASE: {
    fields: ['caseId'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('caseId'),
  },
  SOQL_EXECUTE_BEGIN: {
    count: 'soql',
    fields: ['line', 'aggregations', 'query'],
    kind: 'soql',
    exits: ['SOQL_EXECUTE_END'],
    debugCategory: 'database',
    level: 'INFO',
    consumesCpuTime: false,
    text: at('query'),
  },
  SOQL_EXECUTE_END: {
    rows: { field: 'rows', of: 'soql' },
    fields: ['line', 'rows'],
    shape: 'exit',
  },
  SOQL_EXECUTE_EXPLAIN: {
    fields: ['line', 'plan'],
    debugCategory: 'database',
    level: 'FINEST',
    kind: 'soql',
    text: at('plan'),
  },
  SOSL_EXECUTE_BEGIN: {
    count: 'sosl',
    fields: ['line', 'query'],
    kind: 'sosl',
    exits: ['SOSL_EXECUTE_END'],
    debugCategory: 'database',
    level: 'INFO',
    consumesCpuTime: false,
    text: rule(['query'], (query) => (f) => `SOSL: ${f.at(query)}`),
  },
  SOSL_EXECUTE_END: {
    rows: { field: 'rows', of: 'sosl' },
    fields: ['line', 'rows'],
    shape: 'exit',
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
    kind: 'method',
    exits: ['SYSTEM_CONSTRUCTOR_EXIT'],
    debugCategory: 'system',
    level: 'FINE',
    text: at('signature'),
  },
  SYSTEM_CONSTRUCTOR_EXIT: {
    fields: ['line', 'signature'],
    shape: 'exit',
  },
  SYSTEM_METHOD_ENTRY: {
    fields: ['line', 'signature'],
    kind: 'method',
    exits: ['SYSTEM_METHOD_EXIT'],
    debugCategory: 'system',
    level: 'FINE',
    text: at('signature'),
  },
  SYSTEM_METHOD_EXIT: {
    fields: ['line', 'signature'],
    shape: 'exit',
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
    acceptsText: true,
    text: at('errorMessage'),
  },
  VALIDATION_FAIL: { debugCategory: 'validation', level: 'INFO' },
  VALIDATION_FORMULA: {
    fields: ['formula', 'values'],
    debugCategory: 'validation',
    level: 'INFO',
    acceptsText: true,
    text: from('formula', '|'),
    after: validationFormulaAfter,
  },
  VALIDATION_PASS: { debugCategory: 'validation', level: 'INFO' },
  VALIDATION_RULE: {
    fields: ['ruleId', 'ruleName'],
    debugCategory: 'validation',
    level: 'INFO',
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
    text: at('element'),
  },
  // A line that names no method, or a page-message controller, opens no frame; the engine decides.
  VF_APEX_CALL_START: {
    hook: 'vfApexCall',
    fields: ['line', 'element', 'method', 'controller'],
    kind: 'method',
    exits: ['VF_APEX_CALL_END'],
    debugCategory: 'visualforce',
    level: 'FINE',
    symbols: true,
    text: vfApexCallText,
  },
  VF_DESERIALIZE_CONTINUATION_STATE_BEGIN: {
    exits: ['VF_DESERIALIZE_CONTINUATION_STATE_END'],
    debugCategory: 'visualforce',
    level: 'INFO',
  },
  VF_DESERIALIZE_CONTINUATION_STATE_END: {
    shape: 'exit',
  },
  VF_DESERIALIZE_VIEWSTATE_BEGIN: {
    fields: ['viewStateId'],
    exits: ['VF_DESERIALIZE_VIEWSTATE_END'],
    debugCategory: 'visualforce',
    level: 'INFO',
  },
  VF_DESERIALIZE_VIEWSTATE_END: {
    shape: 'exit',
  },
  VF_EVALUATE_FORMULA_BEGIN: {
    fields: ['viewStateId', 'formula'],
    exits: ['VF_EVALUATE_FORMULA_END'],
    debugCategory: 'visualforce',
    level: 'FINER',
    text: at('formula'),
  },
  VF_EVALUATE_FORMULA_END: {
    shape: 'exit',
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
    exits: ['VF_SERIALIZE_CONTINUATION_STATE_END'],
    debugCategory: 'visualforce',
    level: 'INFO',
  },
  VF_SERIALIZE_CONTINUATION_STATE_END: {
    shape: 'exit',
  },
  VF_SERIALIZE_VIEWSTATE_BEGIN: {
    fields: ['viewStateId'],
    exits: ['VF_SERIALIZE_VIEWSTATE_END'],
    debugCategory: 'visualforce',
    level: 'INFO',
  },
  VF_SERIALIZE_VIEWSTATE_END: {
    shape: 'exit',
  },
  WAVE_APP_LIFECYCLE: { fields: ['lifecycleEvent'], debugCategory: 'wave', level: 'INFO' },
  WF_ACTION: {
    fields: ['actionDescription'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('actionDescription'),
  },
  WF_ACTION_TASK: {
    fields: ['taskSubject', 'actionId', 'ruleName', 'ruleId', 'owner', 'dueDate'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'taskSubject', 'actionId', 'ruleName', 'ruleId', 'owner', 'dueDate'),
  },
  WF_ACTIONS_END: {
    fields: ['summaryActionsPerformed'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('summaryActionsPerformed'),
  },
  WF_APEX_ACTION: { debugCategory: 'workflow', level: 'INFO' },
  WF_APPROVAL: {
    fields: ['transitionType', 'record', 'nodeName'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'transitionType', 'record', 'nodeName'),
  },
  WF_APPROVAL_REMOVE: {
    fields: ['record'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('record'),
  },
  WF_APPROVAL_SUBMIT: {
    fields: ['submissionDetails'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('submissionDetails'),
  },
  WF_APPROVAL_SUBMITTER: {
    fields: ['submitterName', 'submitterId'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'submitterName', 'submitterId'),
  },
  WF_ASSIGN: {
    fields: ['owner', 'assigneeTemplateId'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'owner', 'assigneeTemplateId'),
  },
  WF_CHATTER_POST: {
    fields: ['chatterPostDetails'],
    debugCategory: 'workflow',
    level: 'INFO',
  },
  WF_CRITERIA_BEGIN: {
    fields: ['record', 'ruleName', 'ruleId', 'triggerType', 'recursiveCount'],
    exits: ['WF_CRITERIA_END', 'WF_RULE_NOT_EVALUATED'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: joinPresent(' : ', 'triggerType', 'ruleName'),
  },
  WF_CRITERIA_END: {
    fields: ['result'],
    shape: 'exit',
  },
  WF_EMAIL_ALERT: {
    fields: ['alert'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('alert'),
  },
  WF_EMAIL_SENT: {
    fields: ['template', 'recipients', 'ccEmails'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'template', 'recipients', 'ccEmails'),
  },
  WF_ENQUEUE_ACTIONS: {
    fields: ['summaryActionsEnqueued'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('summaryActionsEnqueued'),
  },
  WF_ESCALATION_ACTION: {
    fields: ['caseId', 'escalationDate'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'caseId', 'escalationDate'),
  },
  WF_ESCALATION_RULE: { debugCategory: 'workflow', level: 'INFO' },
  WF_EVAL_ENTRY_CRITERIA: {
    fields: ['processName', 'emailTemplateId', 'result'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'processName', 'emailTemplateId', 'result'),
  },
  WF_FIELD_UPDATE: {
    fields: ['record', 'field', 'value', 'detail', 'currentRule'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' ', 'record', 'field', 'value', 'detail', 'currentRule'),
  },
  WF_FLOW_ACTION_BEGIN: {
    fields: ['flowTriggerId'],
    debugCategory: 'workflow',
    level: 'INFO',
  },
  WF_FLOW_ACTION_DETAIL: {
    fields: ['first', 'second', 'third', 'currentRule'],
    debugCategory: 'workflow',
    level: 'FINE',
    text: flowActionDetailText,
  },
  WF_FLOW_ACTION_END: {
    fields: ['flowTriggerId'],
    debugCategory: 'workflow',
    level: 'INFO',
  },
  WF_FLOW_ACTION_ERROR: {
    fields: ['flowTriggerId', 'flowDefinitionId', 'message'],
    debugCategory: 'workflow',
    level: 'ERROR',
    acceptsText: true,
    text: flowActionErrorText,
  },
  WF_FLOW_ACTION_ERROR_DETAIL: {
    fields: ['message'],
    debugCategory: 'workflow',
    level: 'ERROR',
    acceptsText: true,
    text: from('message', '|'),
  },
  WF_FORMULA: {
    fields: ['formula', 'values'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    acceptsText: true,
    text: from('formula', '|'),
    after: wfFormulaAfter,
  },
  WF_HARD_REJECT: { debugCategory: 'workflow', level: 'INFO' },
  WF_KNOWLEDGE_ACTION: {
    fields: ['actionDetails'],
    debugCategory: 'workflow',
    level: 'INFO',
  },
  WF_NEXT_APPROVER: {
    fields: ['owner', 'nextOwnerType', 'field'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'owner', 'nextOwnerType', 'field'),
  },
  WF_NO_PROCESS_FOUND: { debugCategory: 'workflow', level: 'INFO' },
  WF_OUTBOUND_MSG: {
    fields: ['record', 'actionId', 'ruleName', 'ruleId'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'record', 'actionId', 'ruleName', 'ruleId'),
  },
  WF_PROCESS_FOUND: {
    fields: ['process', 'label'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'process', 'label'),
  },
  WF_PROCESS_NODE: {
    fields: ['processName'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('processName'),
  },
  WF_QUICK_CREATE: { debugCategory: 'workflow', level: 'INFO' },
  WF_REASSIGN_RECORD: {
    fields: ['record', 'owner'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'record', 'owner'),
  },
  WF_RESPONSE_NOTIFY: {
    fields: ['notifierName', 'notifierEmail', 'notifierTemplateId', 'replyEmail'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'notifierName', 'notifierEmail', 'notifierTemplateId', 'replyEmail'),
  },
  WF_RULE_ENTRY_ORDER: {
    fields: ['integerIndicatingOrder'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('integerIndicatingOrder'),
  },
  WF_RULE_EVAL_BEGIN: {
    fields: ['ruleType'],
    exits: ['WF_RULE_EVAL_END'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('ruleType'),
  },
  WF_RULE_EVAL_END: { shape: 'exit' },
  WF_RULE_EVAL_VALUE: {
    fields: ['value'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('value'),
  },
  WF_RULE_FILTER: {
    fields: ['filterCriteria'],
    debugCategory: 'workflow',
    level: 'INFO',
    acceptsText: true,
    text: at('filterCriteria'),
  },
  WF_RULE_INVOCATION: {
    fields: ['rule'],
    closes: 'next-line',
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('rule'),
  },
  WF_RULE_NOT_EVALUATED: {
    shape: 'exit',
  },
  WF_SEND_ACTION: { debugCategory: 'workflow', level: 'INFO' },
  WF_SOFT_REJECT: {
    fields: ['processName'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('processName'),
  },
  WF_SPOOL_ACTION_BEGIN: {
    fields: ['nodeType'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: at('nodeType'),
  },
  WF_TIME_TRIGGER: {
    fields: ['record', 'timeAction', 'timeActionContainer', 'evaluationTime'],
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' : ', 'record', 'timeAction', 'timeActionContainer', 'evaluationTime'),
  },
  WF_TIME_TRIGGERS_BEGIN: { debugCategory: 'workflow', level: 'INFO' },
  XDS_DETAIL: {
    fields: ['detail'],
    debugCategory: 'callout',
    level: 'FINER',
    text: at('detail'),
  },
  XDS_REQUEST_DETAIL: {
    fields: ['requestDetail'],
    debugCategory: 'callout',
    level: 'FINER',
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
    text: at('response'),
  },
  XDS_RESPONSE_ERROR: {
    fields: ['errorMessage'],
    debugCategory: 'callout',
    level: 'ERROR',
    text: at('errorMessage'),
  },
};

const typeIds = new Map(EVENT_TYPE_NAMES.map((type, typeId) => [type, typeId]));

interface Stated {
  readonly debugCategory: DebugCategory;
  readonly level: Level;
  readonly kind?: Kind;
}

/** The frame that lists each exit type in its `exits`, and what that frame states. */
const FRAME_OF = new Map<EventType, { frame: EventType; stated: Stated }>();
for (const frame of EVENT_TYPE_NAMES) {
  const def = ENTRIES[frame];
  if (!def.exits) continue;
  for (const exit of def.exits) {
    const first = FRAME_OF.get(exit);
    if (first) throw new Error(`${exit}: listed in exits by ${first.frame} and ${frame}; keep one`);
    FRAME_OF.set(exit, { frame, stated: def });
  }
}

/** What an entry states for its type info; an exit entry states none, so its frame's apply. */
function statedBy(type: EventType): Stated {
  const def = ENTRIES[type];
  if (def.shape !== 'exit') return def;
  const of = FRAME_OF.get(type);
  if (!of)
    throw new Error(
      `${type}: states shape 'exit', but no frame lists it in exits; add it to its frame's exits`,
    );
  return of.stated;
}

const KINDS: ReadonlySet<string> = new Set(Object.values(KIND));

function infoOf(type: EventType, typeId: number): EventTypeInfo {
  const def = ENTRIES[type];
  const { debugCategory, level, kind } = statedBy(type);
  return Object.freeze({
    typeId,
    type,
    fields: Object.freeze(fieldNamesOf(type)),
    shape: def.exits || def.closes ? 'frame' : (def.shape ?? 'leaf'),
    kind: kind ?? (KINDS.has(debugCategory) ? (debugCategory as Kind) : 'other'),
    consumesCpuTime: def.consumesCpuTime ?? true,
    debugCategory,
    debugLevel: level,
    exitTypes: def.exits ? Object.freeze(def.exits) : NO_TYPES,
  });
}

/** How `eventText` reads one type's line. Private, so it has one seam. */
interface LineRules {
  readonly rule: TextRule | null;
  readonly after: AfterRule | null;
}

const fieldNamesOf = (type: EventType): readonly string[] =>
  (ENTRIES[type].fields ?? NO_FIELDS) as readonly string[];

function grammarOf(type: EventType): Grammar {
  const def = ENTRIES[type];
  const fact = positionIn(type, 'a fact rule');
  const fields = fieldNamesOf(type);
  const line = fields.indexOf('line');
  const namespace = def.namespace ?? null;
  const hook = def.hook ?? null;
  const reads = (rule: string, names: readonly string[]): readonly number[] =>
    names.length ? Object.freeze(names.map(positionIn(type, rule))) : NO_POSITIONS;
  return Object.freeze({
    closes: def.exits ? 'exit' : (def.closes ?? null),
    lineField: line < 0 ? -1 : line + FIRST_FIELD,
    acceptsText: def.acceptsText ?? false,
    discontinuity: def.discontinuity ?? false,
    hasValidSymbols: def.symbols ?? false,
    count: def.count ?? null,
    rowsField: def.rows ? fact(def.rows.field) : -1,
    rowsOf: def.rows?.of ?? null,
    heapField: def.heap ? fact(def.heap.field) : -1,
    heapSign: def.heap?.sign ?? 0,
    namespace,
    namespaceFields: namespace
      ? reads(`the ${namespace} namespace rule`, NAMESPACE_FIELDS[namespace])
      : NO_POSITIONS,
    hook,
    hookFields: hook ? reads(`the ${hook} hook`, HOOK_FIELDS[hook]) : NO_POSITIONS,
  });
}

/** The type's `FieldPosition`, shared by every per-type rule; `reader` names the rule in the error. */
function positionIn(type: EventType, reader: string): FieldPosition {
  const fields = fieldNamesOf(type);
  return (name) => {
    const i = fields.indexOf(name);
    if (i < 0)
      throw new Error(`${type}: ${reader} reads '${name}', which is not one of its fields`);
    return i + FIRST_FIELD;
  };
}

function lineRulesOf(type: EventType): LineRules {
  const def = ENTRIES[type];
  return {
    rule: def.text?.(positionIn(type, 'a text rule')) ?? null,
    after: def.after ?? null,
  };
}

/** Every event type, indexed by type id. */
export const EVENT_TYPES: readonly EventTypeInfo[] = Object.freeze(EVENT_TYPE_NAMES.map(infoOf));

/** The engine's rules for each event type, indexed by type id. Internal. */
export const GRAMMAR: readonly Grammar[] = Object.freeze(EVENT_TYPE_NAMES.map(grammarOf));

const LINE_RULES: readonly LineRules[] = EVENT_TYPE_NAMES.map(lineRulesOf);

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
  const text = LINE_RULES[typeId];
  const grammar = GRAMMAR[typeId];
  if (!text || !grammar) return null;
  // An empty field is no text, so that a missing field and an absent rule read the same.
  const base = text.rule?.(f) || null;
  const more = grammar.acceptsText ? f.continuation() : '';
  const joined = base === null ? more : more ? `${base}\n${more}` : base;
  if (!joined) return null;
  return text.after ? text.after(joined) : joined;
}

/**
 * Where field `name` of a type's line is, as `LineFields.at` counts, or -1 when the type does not
 * list it. `last` is true for the type's last listed field.
 */
export function fieldPosition(typeId: number, name: string): { at: number; last: boolean } {
  const fields = EVENT_TYPES[typeId]?.fields ?? NO_FIELDS;
  const i = fields.indexOf(name);
  return { at: i < 0 ? -1 : i + FIRST_FIELD, last: i >= 0 && i === fields.length - 1 };
}

const UNIT_TYPE = codeUnitTypeText(positionIn('CODE_UNIT_STARTED', 'the code unit type'));

/** A `CODE_UNIT_STARTED` line's unit type, as `Flow`; null when the line states none. */
export function codeUnitType(f: LineFields): string | null {
  return UNIT_TYPE(f);
}
