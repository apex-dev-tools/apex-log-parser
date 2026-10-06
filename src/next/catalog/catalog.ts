/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { EVENT_LINES } from './fields.js';
import type { AfterRule, TextRule } from './text.js';
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
  /** The line states a line number, such as `[12]`, in field 2. */
  readonly line?: true;
  readonly acceptsText?: boolean;
  readonly discontinuity?: boolean;
  readonly text?: TextRule;
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

/** One hand-written catalog entry. Omitted keys take the defaults in `infoOf` and `grammarOf`. */
type Def = ExitClosedDef | OtherClosedDef | PointDef;

/**
 * The engine's half of an entry. Every key is present, so reads stay monomorphic. `cpuType`,
 * `suffix` and `hasValidSymbols` are the type's defaults; an event can state its own.
 */
export interface Grammar {
  readonly closes: Closes | null;
  readonly hasLineNumber: boolean;
  readonly acceptsText: boolean;
  readonly discontinuity: boolean;
  readonly text: TextRule | null;
  readonly after: AfterRule | null;
  readonly cpuType: CpuType | null;
  readonly suffix: string | null;
  readonly hasValidSymbols: boolean;
}

const NO_TYPES: readonly EventType[] = Object.freeze([]);

const atRules: TextRule[] = [];
const at = (i: number): TextRule => (atRules[i] ??= (f) => f.at(i));
const from =
  (i: number, separator: string): TextRule =>
  (f) =>
    f.from(i, separator);
// Loops rather than map/join, so a text read allocates only the string it returns.
const join =
  (separator: string, ...fields: number[]): TextRule =>
  (f) => {
    let text = '';
    let first = true;
    for (const i of fields) {
      text += first ? f.at(i) : separator + f.at(i);
      first = false;
    }
    return text;
  };
/** As `join`, but leaves out empty fields. */
const joinPresent =
  (separator: string, ...fields: number[]): TextRule =>
  (f) => {
    let text = '';
    for (const i of fields) {
      const field = f.at(i);
      if (field) text = text ? text + separator + field : field;
    }
    return text;
  };

const traceFlagsText: TextRule = (f) => `${f.at(4)}, line:${lineText(f.at(2))} - ${f.at(5)}`;
const queryMoreText: TextRule = (f) => `line: ${lineText(f.at(2))}`;
const savepointText: TextRule = (f) => `${f.at(3)}, line: ${lineText(f.at(2))}`;
const notificationText: TextRule = join(' : ', 3, 4, 5, 6, 7, 8);
const notificationSentText: TextRule = join(' : ', 3, 4, 5, 6, 7);

const ENTRIES: { readonly [T in EventType]: Def } = {
  ADD_SCREEN_POP_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  ADD_SKILL_REQUIREMENT_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  AE_PERSIST_VALIDATION: { debugCategory: 'apexCode', level: 'ERROR' },
  APP_ANALYTICS_ERROR: { debugCategory: 'apexCode', level: 'ERROR' },
  APP_ANALYTICS_FINE: { debugCategory: 'apexCode', level: 'FINE' },
  APP_ANALYTICS_WARN: { debugCategory: 'apexCode', level: 'WARN' },
  APP_CONTAINER_INITIATED: { debugCategory: 'wave', level: 'FINE' },
  ASSET_DIFF_DETAIL: { debugCategory: 'wave', level: 'FINEST' },
  ASSET_DIFF_SUMMARY: { debugCategory: 'wave', level: 'FINE' },
  BULK_COUNTABLE_STATEMENT_EXECUTE: { debugCategory: 'apexCode', level: 'INFO', kind: 'statement' },
  BULK_DML_RETRY: { debugCategory: 'database', level: 'INFO', kind: 'dml', text: at(2) },
  BULK_HEAP_ALLOCATE: { debugCategory: 'apexCode', level: 'FINEST', kind: 'heap', text: at(2) },
  CALLOUT_REQUEST: {
    shape: 'frame',
    kind: 'callout',
    exits: ['CALLOUT_RESPONSE'],
    category: 'Callout',
    debugCategory: 'callout',
    level: 'INFO',
    cpu: 'free',
    line: true,
    text: at(3),
  },
  CALLOUT_REQUEST_FINALIZE: { debugCategory: 'callout', level: 'FINEST', kind: 'callout' },
  CALLOUT_REQUEST_PREPARE: { debugCategory: 'callout', level: 'FINEST', kind: 'callout' },
  CALLOUT_RESPONSE: {
    shape: 'exit',
    kind: 'callout',
    debugCategory: 'callout',
    level: 'INFO',
    line: true,
    text: at(3),
  },
  CODE_UNIT_FINISHED: {
    shape: 'exit',
    kind: 'code-unit',
    debugCategory: 'apexCode',
    level: 'ERROR',
    text: at(2),
  },
  CODE_UNIT_STARTED: {
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
    shape: 'frame',
    kind: 'method',
    exits: ['CONSTRUCTOR_EXIT'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'FINE',
    cpu: 'method',
    suffix: ' (constructor)',
    symbols: true,
    line: true,
    text: constructorText,
  },
  CONSTRUCTOR_EXIT: {
    shape: 'exit',
    kind: 'method',
    debugCategory: 'apexCode',
    level: 'FINE',
    line: true,
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
    debugCategory: 'apexProfiling',
    level: 'FINE',
    acceptsText: true,
    text: join(' ', 2, 3),
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
    shape: 'frame',
    kind: 'soql',
    exits: ['CURSOR_CREATE_END'],
    category: 'SOQL',
    debugCategory: 'database',
    level: 'INFO',
    cpu: 'method',
  },
  CURSOR_CREATE_END: { shape: 'exit', kind: 'soql', debugCategory: 'database', level: 'INFO' },
  CURSOR_FETCH: { debugCategory: 'database', level: 'INFO', kind: 'soql' },
  CURSOR_FETCH_PAGE: { debugCategory: 'database', level: 'INFO', kind: 'soql' },
  DATA_ACCESS_EVALUATION: { debugCategory: 'dataAccess', level: 'FINE' },
  DATAWEAVE_USER_DEBUG: { debugCategory: 'apexCode', level: 'DEBUG', kind: 'debug' },
  DML_BEGIN: {
    shape: 'frame',
    kind: 'dml',
    exits: ['DML_END'],
    category: 'DML',
    debugCategory: 'database',
    level: 'INFO',
    cpu: 'free',
    line: true,
    text: (f) => `DML ${f.at(3)} ${f.at(4)}`,
  },
  DML_END: { shape: 'exit', kind: 'dml', debugCategory: 'database', level: 'INFO', line: true },
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
    debugCategory: 'system',
    level: 'DEBUG',
    text: from(2, ' | '),
  },
  DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY: {
    debugCategory: 'system',
    level: 'INFO',
    text: from(2, ' | '),
  },
  DUPLICATE_DETECTION_RULE_INVOCATION: {
    debugCategory: 'system',
    level: 'INFO',
    text: join(' - ', 3, 4),
  },
  DUPLICATE_RULE_FILTER: { debugCategory: 'system', level: 'INFO' },
  DUPLICATE_RULE_FILTER_INVOCATION: { debugCategory: 'system', level: 'DEBUG' },
  DUPLICATE_RULE_FILTER_RESULT: { debugCategory: 'system', level: 'INFO' },
  DUPLICATE_RULE_FILTER_VALUE: { debugCategory: 'system', level: 'INFO' },
  EMAIL_QUEUE: { debugCategory: 'apexCode', level: 'INFO', line: true, acceptsText: true },
  END_CALL: { debugCategory: 'workflow', level: 'INFO' },
  ENTERING_MANAGED_PKG: {
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
    shape: 'frame',
    kind: 'workflow',
    exits: ['EVENT_SERVICE_PUB_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at(2),
  },
  EVENT_SERVICE_PUB_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'workflow',
    text: join(' ', 2, 3, 4),
  },
  EVENT_SERVICE_PUB_END: {
    shape: 'exit',
    kind: 'workflow',
    debugCategory: 'workflow',
    level: 'INFO',
    text: at(2),
  },
  EVENT_SERVICE_SUB_BEGIN: {
    shape: 'frame',
    kind: 'workflow',
    exits: ['EVENT_SERVICE_SUB_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' ', 2, 3),
  },
  EVENT_SERVICE_SUB_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'workflow',
    text: join(' ', 2, 3, 4, 5, 6),
  },
  EVENT_SERVICE_SUB_END: {
    shape: 'exit',
    kind: 'workflow',
    debugCategory: 'workflow',
    level: 'INFO',
    text: join(' ', 2, 3),
  },
  EXCEPTION_THROWN: {
    debugCategory: 'apexCode',
    level: 'INFO',
    kind: 'exception',
    line: true,
    acceptsText: true,
    discontinuity: true,
    text: at(3),
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
  EXTERNAL_SERVICE_REQUEST: { debugCategory: 'callout', level: 'INFO', kind: 'callout' },
  EXTERNAL_SERVICE_RESPONSE: { debugCategory: 'callout', level: 'INFO', kind: 'callout' },
  FATAL_ERROR: {
    debugCategory: 'apexCode',
    level: 'ERROR',
    kind: 'exception',
    acceptsText: true,
    discontinuity: true,
    text: at(2),
  },
  FLOW_ACTIONCALL_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 3, 4, 5, 6),
  },
  FLOW_ASSIGNMENT_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 3, 4, 5),
  },
  FLOW_BULK_ELEMENT_BEGIN: {
    shape: 'frame',
    kind: 'flow',
    exits: ['FLOW_BULK_ELEMENT_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'FINE',
    cpu: 'custom',
    text: join(' - ', 2, 3),
  },
  FLOW_BULK_ELEMENT_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 2, 3, 4),
  },
  FLOW_BULK_ELEMENT_END: { shape: 'exit', kind: 'flow', debugCategory: 'workflow', level: 'FINE' },
  FLOW_BULK_ELEMENT_LIMIT_USAGE: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'limits',
    text: at(2),
  },
  FLOW_BULK_ELEMENT_NOT_SUPPORTED: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
    text: join(' : ', 2, 3, 4),
  },
  FLOW_COLLECTION_PROCESSOR_DETAIL: { debugCategory: 'workflow', level: 'FINER', kind: 'flow' },
  FLOW_CREATE_INTERVIEW_BEGIN: { debugCategory: 'workflow', level: 'INFO', kind: 'flow' },
  FLOW_CREATE_INTERVIEW_END: { debugCategory: 'workflow', level: 'INFO', kind: 'flow' },
  FLOW_CREATE_INTERVIEW_ERROR: {
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'flow',
    text: join(' : ', 2, 3, 4, 5),
  },
  FLOW_ELEMENT_BEGIN: {
    shape: 'frame',
    kind: 'flow',
    exits: ['FLOW_ELEMENT_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'FINE',
    cpu: 'custom',
    text: join(' ', 3, 4),
  },
  FLOW_ELEMENT_DEFERRED: {
    debugCategory: 'workflow',
    level: 'FINE',
    kind: 'flow',
    text: join(' ', 2, 3),
  },
  FLOW_ELEMENT_END: { shape: 'exit', kind: 'flow', debugCategory: 'workflow', level: 'FINE' },
  FLOW_ELEMENT_ERROR: {
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'flow',
    acceptsText: true,
    text: from(2, '|'),
    after: flowElementErrorAfter,
  },
  FLOW_ELEMENT_FAULT: {
    debugCategory: 'workflow',
    level: 'WARN',
    kind: 'flow',
    text: join(' : ', 2, 3, 4),
  },
  FLOW_ELEMENT_LIMIT_USAGE: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'limits',
    text: at(2),
  },
  FLOW_INTERVIEW_FINISHED: { debugCategory: 'workflow', level: 'INFO', kind: 'flow', text: at(3) },
  FLOW_INTERVIEW_FINISHED_LIMIT_USAGE: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'limits',
    text: at(2),
  },
  FLOW_INTERVIEW_PAUSED: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
    text: join(' : ', 2, 3, 4),
  },
  FLOW_INTERVIEW_RESUMED: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
    text: join(' : ', 2, 3),
  },
  FLOW_LOOP_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 3, 4),
  },
  FLOW_RULE_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 3, 4),
  },
  FLOW_SCHEDULED_PATH_QUEUED: { debugCategory: 'workflow', level: 'FINER', kind: 'flow' },
  FLOW_SCREEN_DETAIL: { debugCategory: 'workflow', level: 'FINER', kind: 'flow' },
  FLOW_START_INTERVIEW_BEGIN: {
    shape: 'frame',
    kind: 'flow',
    exits: ['FLOW_START_INTERVIEW_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    suffix: ' (flow)',
    text: at(3),
  },
  FLOW_START_INTERVIEW_END: {
    shape: 'exit',
    kind: 'flow',
    debugCategory: 'workflow',
    level: 'INFO',
  },
  FLOW_START_INTERVIEW_LIMIT_USAGE: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'limits',
    text: at(2),
  },
  // Text and suffix come from its first interview and enclosing code unit, not its line.
  FLOW_START_INTERVIEWS_BEGIN: {
    shape: 'frame',
    kind: 'flow',
    exits: ['FLOW_START_INTERVIEWS_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
  },
  FLOW_START_INTERVIEWS_END: {
    shape: 'exit',
    kind: 'flow',
    debugCategory: 'workflow',
    level: 'INFO',
  },
  FLOW_START_INTERVIEWS_ERROR: {
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'flow',
    acceptsText: true,
    text: from(2, '|'),
    after: flowInterviewsErrorAfter,
  },
  FLOW_START_SCHEDULED_RECORDS: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'flow',
    text: join(' : ', 2, 3),
  },
  FLOW_SUBFLOW_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 2, 3, 4, 5),
  },
  FLOW_VALUE_ASSIGNMENT: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    acceptsText: true,
    text: join(' ', 3, 4),
  },
  FLOW_WAIT_EVENT_RESUMING_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 2, 3, 4, 5),
  },
  FLOW_WAIT_EVENT_WAITING_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 2, 3, 4, 5, 6),
  },
  FLOW_WAIT_RESUMING_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 2, 3, 4),
  },
  FLOW_WAIT_WAITING_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINER',
    kind: 'flow',
    text: join(' : ', 2, 3, 4, 5),
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
  FUNCTION_INVOCATION_REQUEST: { debugCategory: 'callout', level: 'INFO', kind: 'callout' },
  FUNCTION_INVOCATION_RESPONSE: { debugCategory: 'callout', level: 'INFO', kind: 'callout' },
  HEAP_ALLOCATE: {
    debugCategory: 'apexCode',
    level: 'FINER',
    kind: 'heap',
    line: true,
    text: at(3),
  },
  HEAP_DEALLOCATE: { debugCategory: 'apexCode', level: 'FINER', kind: 'heap', line: true },
  HEAP_DUMP: { debugCategory: 'apexCode', level: 'INFO', kind: 'heap' },
  IDEAS_QUERY_EXECUTE: { debugCategory: 'database', level: 'FINEST', kind: 'soql' },
  INVOCABLE_ACTION_DETAIL: { debugCategory: 'workflow', level: 'FINER', kind: 'flow' },
  INVOCABLE_ACTION_ERROR: { debugCategory: 'workflow', level: 'ERROR', kind: 'flow' },
  JSON_DIFF_DETAIL: { debugCategory: 'wave', level: 'FINEST' },
  JSON_DIFF_SUMMARY: { debugCategory: 'wave', level: 'FINE' },
  LIMIT_USAGE: {
    debugCategory: 'apexProfiling',
    level: 'FINEST',
    kind: 'limits',
    line: true,
    text: (f) => `${f.at(3)} ${f.at(4)} out of ${f.at(5)}`,
  },
  LIMIT_USAGE_FOR_NS: {
    debugCategory: 'apexProfiling',
    level: 'FINEST',
    kind: 'limits',
    acceptsText: true,
    text: at(2),
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
  MATCH_ENGINE_INVOCATION: { debugCategory: 'system', level: 'INFO' },
  METHOD_ENTRY: {
    shape: 'frame',
    kind: 'method',
    exits: ['METHOD_EXIT'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'FINE',
    cpu: 'method',
    symbols: true,
    line: true,
    text: (f) => f.at(4) || null,
  },
  METHOD_EXIT: {
    shape: 'exit',
    kind: 'method',
    debugCategory: 'apexCode',
    level: 'FINE',
    line: true,
    text: methodExitText,
  },
  NAMED_CREDENTIAL_REQUEST: {
    debugCategory: 'callout',
    level: 'INFO',
    kind: 'callout',
    text: join(' : ', 3, 4, 5, 6),
  },
  NAMED_CREDENTIAL_RESPONSE: {
    debugCategory: 'callout',
    level: 'INFO',
    kind: 'callout',
    text: at(2),
  },
  NAMED_CREDENTIAL_RESPONSE_DETAIL: {
    debugCategory: 'callout',
    level: 'FINER',
    kind: 'callout',
    text: (f) => `${f.at(3)} : ${f.at(4)} ${f.at(5)} : ${f.at(6)} ${f.at(7)}`,
  },
  NBA_NODE_BEGIN: {
    shape: 'frame',
    kind: 'nba',
    exits: ['NBA_NODE_END'],
    category: 'Automation',
    debugCategory: 'nba',
    level: 'FINE',
    cpu: 'method',
    text: from(2, ' | '),
  },
  NBA_NODE_DETAIL: { debugCategory: 'nba', level: 'FINE', kind: 'nba', text: from(2, ' | ') },
  NBA_NODE_END: {
    shape: 'exit',
    kind: 'nba',
    debugCategory: 'nba',
    level: 'FINE',
    text: from(2, ' | '),
  },
  NBA_NODE_ERROR: { debugCategory: 'nba', level: 'ERROR', kind: 'nba', text: from(2, ' | ') },
  NBA_OFFER_INVALID: { debugCategory: 'nba', level: 'FINE', kind: 'nba', text: from(2, ' | ') },
  NBA_STRATEGY_BEGIN: {
    shape: 'frame',
    kind: 'nba',
    exits: ['NBA_STRATEGY_END'],
    category: 'Automation',
    debugCategory: 'nba',
    level: 'FINE',
    cpu: 'method',
    text: from(2, ' | '),
  },
  NBA_STRATEGY_END: {
    shape: 'exit',
    kind: 'nba',
    debugCategory: 'nba',
    level: 'FINE',
    text: from(2, ' | '),
  },
  NBA_STRATEGY_ERROR: { debugCategory: 'nba', level: 'ERROR', kind: 'nba', text: from(2, ' | ') },
  ORG_CACHE_CONTAINS: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_GET: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_GET_BEGIN: {
    shape: 'frame',
    kind: 'cache',
    exits: ['ORG_CACHE_GET_END'],
    category: 'Apex',
    debugCategory: 'apexCode',
    level: 'INFO',
    cpu: 'method',
  },
  ORG_CACHE_GET_CAPACITY: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_GET_END: { shape: 'exit', kind: 'cache', debugCategory: 'apexCode', level: 'INFO' },
  ORG_CACHE_GET_PARTITION: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_MEMORY_USAGE: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_PUT: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  ORG_CACHE_PUT_BEGIN: {
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
    debugCategory: 'dataAccess',
    level: 'FINER',
  },
  POLICY_RULE_EVALUATION_REQUEST: { debugCategory: 'dataAccess', level: 'FINE' },
  POLICY_RULE_EVALUATION_RESPONSE: { debugCategory: 'dataAccess', level: 'FINER' },
  POLICY_RULE_EVALUATION_SKIPPED: { debugCategory: 'dataAccess', level: 'FINER' },
  POLICY_RULE_EVALUATION_START: { debugCategory: 'dataAccess', level: 'FINER' },
  POP_TRACE_FLAGS: {
    debugCategory: 'system',
    level: 'INFO',
    line: true,
    text: traceFlagsText,
  },
  PUSH_NOTIFICATION_INVALID_APP: {
    debugCategory: 'apexCode',
    level: 'ERROR',
    text: join('.', 2, 3),
  },
  PUSH_NOTIFICATION_INVALID_CERTIFICATE: {
    debugCategory: 'apexCode',
    level: 'ERROR',
    text: join('.', 2, 3),
  },
  PUSH_NOTIFICATION_INVALID_CONFIGURATION: { debugCategory: 'apexCode', level: 'WARN' },
  PUSH_NOTIFICATION_INVALID_NOTIFICATION: {
    debugCategory: 'apexCode',
    level: 'ERROR',
    text: (f) => `${f.at(2)}.${notificationText(f)}`,
  },
  PUSH_NOTIFICATION_INVALID_PAYLOAD: { debugCategory: 'apexCode', level: 'WARN' },
  PUSH_NOTIFICATION_NO_DEVICES: {
    debugCategory: 'apexCode',
    level: 'DEBUG',
    text: join('.', 2, 3),
  },
  PUSH_NOTIFICATION_NOT_ENABLED: { debugCategory: 'apexCode', level: 'INFO' },
  PUSH_NOTIFICATION_SENT: {
    debugCategory: 'apexCode',
    level: 'DEBUG',
    text: (f) => `${f.at(2)}.${notificationSentText(f)}`,
  },
  PUSH_TRACE_FLAGS: {
    debugCategory: 'system',
    level: 'INFO',
    line: true,
    text: traceFlagsText,
  },
  QUERY_MORE_BEGIN: {
    shape: 'frame',
    kind: 'soql',
    exits: ['QUERY_MORE_END'],
    category: 'SOQL',
    debugCategory: 'database',
    level: 'INFO',
    cpu: 'custom',
    line: true,
    text: queryMoreText,
  },
  QUERY_MORE_END: {
    shape: 'exit',
    kind: 'soql',
    debugCategory: 'database',
    level: 'INFO',
    line: true,
    text: queryMoreText,
  },
  QUERY_MORE_ITERATIONS: {
    debugCategory: 'database',
    level: 'INFO',
    kind: 'soql',
    line: true,
    text: (f) => `line: ${lineText(f.at(2))}, iterations:${f.at(3)}`,
  },
  QUERY_SQL_LOG: { debugCategory: 'apexCode', level: 'INFO', kind: 'soql' },
  REFERENCED_OBJECT_LIST: { debugCategory: 'apexProfiling', level: 'FINEST' },
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
  RULES_EXECUTION_DETAIL: { debugCategory: 'wave', level: 'FINER' },
  RULES_EXECUTION_SUMMARY: { debugCategory: 'wave', level: 'FINE' },
  SAVEPOINT_RELEASE: { debugCategory: 'database', level: 'INFO' },
  SAVEPOINT_RESET: { debugCategory: 'database', level: 'INFO' },
  SAVEPOINT_ROLLBACK: {
    debugCategory: 'database',
    level: 'INFO',
    line: true,
    text: savepointText,
  },
  SAVEPOINT_SET: {
    debugCategory: 'database',
    level: 'INFO',
    line: true,
    text: savepointText,
  },
  SCHEDULED_FLOW_DETAIL: { debugCategory: 'workflow', level: 'INFO', kind: 'flow' },
  SCRIPT_EXECUTION: { debugCategory: 'apexCode', level: 'INFO' },
  SESSION_CACHE_CONTAINS: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_GET: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_GET_BEGIN: {
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
    shape: 'exit',
    kind: 'cache',
    debugCategory: 'apexCode',
    level: 'INFO',
  },
  SESSION_CACHE_GET_PARTITION: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_MEMORY_USAGE: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_PUT: { debugCategory: 'apexCode', level: 'INFO', kind: 'cache' },
  SESSION_CACHE_PUT_BEGIN: {
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
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 2, 3, 4, 5, 6),
  },
  SLA_EVAL_MILESTONE: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow', text: at(2) },
  SLA_NULL_START_DATE: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  SLA_PROCESS_CASE: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow', text: at(2) },
  SOQL_EXECUTE_BEGIN: {
    shape: 'frame',
    kind: 'soql',
    exits: ['SOQL_EXECUTE_END'],
    category: 'SOQL',
    debugCategory: 'database',
    level: 'INFO',
    cpu: 'free',
    line: true,
    text: at(4),
  },
  SOQL_EXECUTE_END: {
    shape: 'exit',
    kind: 'soql',
    debugCategory: 'database',
    level: 'INFO',
    line: true,
  },
  SOQL_EXECUTE_EXPLAIN: {
    debugCategory: 'database',
    level: 'FINEST',
    kind: 'soql',
    line: true,
    text: at(3),
  },
  SOSL_EXECUTE_BEGIN: {
    shape: 'frame',
    kind: 'sosl',
    exits: ['SOSL_EXECUTE_END'],
    category: 'SOQL',
    debugCategory: 'database',
    level: 'INFO',
    cpu: 'free',
    line: true,
    text: (f) => `SOSL: ${f.at(3)}`,
  },
  SOSL_EXECUTE_END: {
    shape: 'exit',
    kind: 'sosl',
    debugCategory: 'database',
    level: 'INFO',
    line: true,
  },
  STACK_FRAME_VARIABLE_LIST: {
    debugCategory: 'apexProfiling',
    level: 'FINE',
    kind: 'variable',
    acceptsText: true,
  },
  STATEMENT_EXECUTE: { debugCategory: 'apexCode', level: 'FINER', kind: 'statement', line: true },
  STATIC_VARIABLE_LIST: {
    debugCategory: 'apexProfiling',
    level: 'FINE',
    kind: 'variable',
    acceptsText: true,
  },
  SYSTEM_CONSTRUCTOR_ENTRY: {
    shape: 'frame',
    kind: 'method',
    exits: ['SYSTEM_CONSTRUCTOR_EXIT'],
    category: 'System',
    debugCategory: 'system',
    level: 'FINE',
    cpu: 'method',
    suffix: ' (system constructor)',
    line: true,
    text: at(3),
  },
  SYSTEM_CONSTRUCTOR_EXIT: {
    shape: 'exit',
    kind: 'method',
    debugCategory: 'system',
    level: 'FINE',
    line: true,
  },
  SYSTEM_METHOD_ENTRY: {
    shape: 'frame',
    kind: 'method',
    exits: ['SYSTEM_METHOD_EXIT'],
    category: 'System',
    debugCategory: 'system',
    level: 'FINE',
    cpu: 'method',
    line: true,
    text: at(3),
  },
  SYSTEM_METHOD_EXIT: {
    shape: 'exit',
    kind: 'method',
    debugCategory: 'system',
    level: 'FINE',
    line: true,
  },
  SYSTEM_MODE_ENTER: { debugCategory: 'system', level: 'INFO', text: at(2) },
  SYSTEM_MODE_EXIT: { debugCategory: 'system', level: 'INFO', text: at(2) },
  TEMPLATE_PROCESSING_ERROR: { debugCategory: 'wave', level: 'ERROR' },
  TEMPLATED_ASSET: { debugCategory: 'wave', level: 'FINE' },
  TESTING_LIMITS: {
    debugCategory: 'apexProfiling',
    level: 'INFO',
    kind: 'limits',
    acceptsText: true,
  },
  TOTAL_EMAIL_RECIPIENTS_QUEUED: { debugCategory: 'apexProfiling', level: 'FINE', text: at(2) },
  TRANSFORMATION_SUMMARY: { debugCategory: 'wave', level: 'FINE' },
  USER_DEBUG: {
    debugCategory: 'apexCode',
    level: 'DEBUG',
    kind: 'debug',
    line: true,
    acceptsText: true,
    text: from(3, ' | '),
  },
  USER_DEBUG_DEBUG: { debugCategory: 'apexCode', level: 'DEBUG', kind: 'debug' },
  USER_DEBUG_ERROR: { debugCategory: 'apexCode', level: 'ERROR', kind: 'debug' },
  USER_DEBUG_FINE: { debugCategory: 'apexCode', level: 'FINE', kind: 'debug' },
  USER_DEBUG_FINER: { debugCategory: 'apexCode', level: 'FINER', kind: 'debug' },
  USER_DEBUG_FINEST: { debugCategory: 'apexCode', level: 'FINEST', kind: 'debug' },
  USER_DEBUG_INFO: { debugCategory: 'apexCode', level: 'INFO', kind: 'debug' },
  USER_DEBUG_WARN: { debugCategory: 'apexCode', level: 'WARN', kind: 'debug' },
  USER_INFO: {
    debugCategory: 'apexCode',
    level: 'ERROR',
    line: true,
    text: joinPresent(' ', 3, 4),
  },
  USER_MODE_PERMSET_APPLIED: { debugCategory: 'database', level: 'FINE' },
  VALIDATION_ERROR: {
    debugCategory: 'validation',
    level: 'INFO',
    kind: 'validation',
    acceptsText: true,
    text: at(2),
  },
  VALIDATION_FAIL: { debugCategory: 'validation', level: 'INFO', kind: 'validation' },
  VALIDATION_FORMULA: {
    debugCategory: 'validation',
    level: 'INFO',
    kind: 'validation',
    acceptsText: true,
    text: from(2, '|'),
    after: validationFormulaAfter,
  },
  VALIDATION_PASS: { debugCategory: 'validation', level: 'INFO', kind: 'validation', text: at(3) },
  VALIDATION_RULE: { debugCategory: 'validation', level: 'INFO', kind: 'validation', text: at(3) },
  VARIABLE_ASSIGNMENT: {
    debugCategory: 'apexCode',
    level: 'FINEST',
    kind: 'variable',
    line: true,
    text: from(3, ' | '),
  },
  VARIABLE_SCOPE_BEGIN: {
    debugCategory: 'apexCode',
    level: 'FINEST',
    kind: 'variable',
    line: true,
    text: from(3, ' | '),
  },
  VARIABLE_SCOPE_END: { debugCategory: 'apexCode', level: 'FINEST', kind: 'variable' },
  VF_APEX_CALL: { debugCategory: 'apexCode', level: 'INFO', kind: 'visualforce' },
  VF_APEX_CALL_END: {
    shape: 'exit',
    kind: 'method',
    debugCategory: 'visualforce',
    level: 'FINE',
    text: at(2),
  },
  // A line that names no method, or a page-message controller, opens no frame; the engine decides.
  VF_APEX_CALL_START: {
    shape: 'frame',
    kind: 'method',
    exits: ['VF_APEX_CALL_END'],
    category: 'Apex',
    debugCategory: 'visualforce',
    level: 'FINE',
    cpu: 'method',
    suffix: ' (VF APEX)',
    symbols: true,
    line: true,
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
    shape: 'frame',
    kind: 'visualforce',
    exits: ['VF_EVALUATE_FORMULA_END'],
    category: 'System',
    debugCategory: 'visualforce',
    level: 'FINER',
    cpu: 'custom',
    suffix: ' (VF FORMULA)',
    text: at(3),
  },
  VF_EVALUATE_FORMULA_END: {
    shape: 'exit',
    kind: 'visualforce',
    debugCategory: 'visualforce',
    level: 'FINER',
    text: at(2),
  },
  VF_PAGE_MESSAGE: {
    debugCategory: 'apexCode',
    level: 'INFO',
    kind: 'visualforce',
    acceptsText: true,
    text: at(2),
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
  WAVE_APP_LIFECYCLE: { debugCategory: 'wave', level: 'INFO' },
  WF_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow', text: at(2) },
  WF_ACTION_TASK: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 2, 3, 4, 5, 6, 7),
  },
  WF_ACTIONS_END: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow', text: at(2) },
  WF_APEX_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_APPROVAL: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 2, 3, 4),
  },
  WF_APPROVAL_REMOVE: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow', text: at(2) },
  WF_APPROVAL_SUBMIT: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at(2),
  },
  WF_APPROVAL_SUBMITTER: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 2, 3, 4),
  },
  WF_ASSIGN: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 2, 3),
  },
  WF_CHATTER_POST: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_CRITERIA_BEGIN: {
    shape: 'frame',
    kind: 'workflow',
    exits: ['WF_CRITERIA_END', 'WF_RULE_NOT_EVALUATED'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: joinPresent(' : ', 5, 3),
  },
  WF_CRITERIA_END: { shape: 'exit', kind: 'workflow', debugCategory: 'workflow', level: 'INFO' },
  WF_EMAIL_ALERT: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 2, 3, 4),
  },
  WF_EMAIL_SENT: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 2, 3, 4),
  },
  WF_ENQUEUE_ACTIONS: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow', text: at(2) },
  WF_ESCALATION_ACTION: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 2, 3),
  },
  WF_ESCALATION_RULE: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_EVAL_ENTRY_CRITERIA: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 2, 3, 4),
  },
  WF_FIELD_UPDATE: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' ', 2, 3, 4, 5, 6),
  },
  WF_FLOW_ACTION_BEGIN: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_FLOW_ACTION_DETAIL: {
    debugCategory: 'workflow',
    level: 'FINE',
    kind: 'workflow',
    text: flowActionDetailText,
  },
  WF_FLOW_ACTION_END: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_FLOW_ACTION_ERROR: {
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'workflow',
    acceptsText: true,
    text: flowActionErrorText,
  },
  WF_FLOW_ACTION_ERROR_DETAIL: {
    debugCategory: 'workflow',
    level: 'ERROR',
    kind: 'workflow',
    acceptsText: true,
    text: (f) => f.from(2, '|') || null,
  },
  WF_FORMULA: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    acceptsText: true,
    text: from(2, '|'),
    after: wfFormulaAfter,
  },
  WF_HARD_REJECT: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_KNOWLEDGE_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_NEXT_APPROVER: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 2, 3, 4),
  },
  WF_NO_PROCESS_FOUND: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_OUTBOUND_MSG: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 2, 3, 4, 5),
  },
  WF_PROCESS_FOUND: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: join(' : ', 2, 3),
  },
  WF_PROCESS_NODE: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at(2),
  },
  WF_QUICK_CREATE: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_REASSIGN_RECORD: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 2, 3),
  },
  WF_RESPONSE_NOTIFY: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 2, 3, 4, 5),
  },
  WF_RULE_ENTRY_ORDER: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow', text: at(2) },
  WF_RULE_EVAL_BEGIN: {
    shape: 'frame',
    kind: 'workflow',
    exits: ['WF_RULE_EVAL_END'],
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at(2),
  },
  WF_RULE_EVAL_END: { shape: 'exit', kind: 'workflow', debugCategory: 'workflow', level: 'INFO' },
  WF_RULE_EVAL_VALUE: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow', text: at(2) },
  WF_RULE_FILTER: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    acceptsText: true,
    text: at(2),
  },
  WF_RULE_INVOCATION: {
    shape: 'frame',
    kind: 'workflow',
    closes: 'next-line',
    category: 'Automation',
    debugCategory: 'workflow',
    level: 'INFO',
    cpu: 'custom',
    text: at(2),
  },
  WF_RULE_NOT_EVALUATED: {
    shape: 'exit',
    kind: 'workflow',
    debugCategory: 'workflow',
    level: 'INFO',
  },
  WF_SEND_ACTION: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  WF_SOFT_REJECT: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow', text: at(2) },
  WF_SPOOL_ACTION_BEGIN: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: at(2),
  },
  WF_TIME_TRIGGER: {
    debugCategory: 'workflow',
    level: 'INFO',
    kind: 'workflow',
    text: join(' : ', 2, 3, 4, 5),
  },
  WF_TIME_TRIGGERS_BEGIN: { debugCategory: 'workflow', level: 'INFO', kind: 'workflow' },
  XDS_DETAIL: { debugCategory: 'callout', level: 'FINER', kind: 'callout', text: at(2) },
  XDS_REQUEST_DETAIL: { debugCategory: 'callout', level: 'FINER', kind: 'callout' },
  XDS_RESPONSE: {
    debugCategory: 'callout',
    level: 'INFO',
    kind: 'callout',
    text: join(' : ', 2, 3, 4, 5, 6),
  },
  XDS_RESPONSE_DETAIL: { debugCategory: 'callout', level: 'FINER', kind: 'callout', text: at(2) },
  XDS_RESPONSE_ERROR: { debugCategory: 'callout', level: 'ERROR', kind: 'callout', text: at(2) },
};

type EventLine = Pick<EventTypeInfo, 'description' | 'observed' | 'fields'>;

// Checks that `fields.ts` covers every type, in the shape `infoOf` reads.
const LINES: { readonly [T in EventType]: EventLine } = EVENT_LINES;

const typeIds = new Map(EVENT_TYPE_NAMES.map((type, typeId) => [type, typeId]));

function infoOf(type: EventType, typeId: number): EventTypeInfo {
  const def = ENTRIES[type];
  const line = LINES[type];
  return Object.freeze({
    typeId,
    type,
    description: line.description,
    fields: Object.freeze(line.fields.map((field) => Object.freeze({ ...field }))),
    observed: line.observed,
    shape: def.shape ?? 'leaf',
    kind: def.kind ?? 'other',
    category: def.category ?? null,
    debugCategory: def.debugCategory,
    debugLevel: def.level,
    exitTypes: def.exits ? Object.freeze(def.exits) : NO_TYPES,
  });
}

function grammarOf(type: EventType): Grammar {
  const def = ENTRIES[type];
  return Object.freeze({
    closes: def.shape === 'frame' ? (def.closes ?? 'exit') : null,
    hasLineNumber: def.line ?? false,
    acceptsText: def.acceptsText ?? false,
    discontinuity: def.discontinuity ?? false,
    text: def.text ?? null,
    after: def.after ?? null,
    cpuType: def.cpu ?? null,
    suffix: def.suffix ?? null,
    hasValidSymbols: def.symbols ?? false,
  });
}

/** Every event type, indexed by type id. */
export const EVENT_TYPES: readonly EventTypeInfo[] = Object.freeze(EVENT_TYPE_NAMES.map(infoOf));

/** The engine's rules for each event type, indexed by type id. Internal. */
export const GRAMMAR: readonly Grammar[] = Object.freeze(EVENT_TYPE_NAMES.map(grammarOf));

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
 * An event's text: its type's rule, then its continuation lines, then its type's rewrite.
 * Null when the line states no text and has no continuation.
 */
export function eventText(typeId: number, f: Fields): string | null {
  const grammar = GRAMMAR[typeId];
  if (!grammar) return null;
  // An empty field is no text, so that a missing field and an absent rule read the same.
  const base = grammar.text?.(f) || null;
  const rest = grammar.acceptsText ? f.rest : '';
  if (base === null && !rest) return null;
  const text = base === null ? rest.slice(1) : base + rest;
  return grammar.after ? grammar.after(text) : text;
}
