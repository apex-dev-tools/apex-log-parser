/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

// The only entry point. Listed by name so internal declarations stay internal: export only what a
// consumer needs at run time, not what its tests could reuse.

// ApexLogParser is public because every event constructor takes one, so a consumer that builds
// events needs it.
export { ApexLogParser, parse } from './ApexLogParser.js';

// Event classes, for instanceof narrowing. For any other event type compare event.type as a string.
export {
  ApexLog,
  CodeUnitStartedLine,
  DMLBeginLine,
  ExecutionStartedLine,
  HeapAllocateLine,
  LimitUsageLine,
  LogEvent,
  MethodEntryLine,
  SOQLExecuteBeginLine,
  SOQLExecuteExplainLine,
  SOSLExecuteBeginLine,
} from './LogEvents.js';

export type { LimitMetricKey, LimitObservation, RunningTotalObservation } from './limits.js';
export type {
  CPUType,
  DebugCategory,
  DebugLevels,
  GovernorLimits,
  GovernorSnapshot,
  IssueType,
  LimitMetricMeta,
  LimitMetricUnit,
  Limits,
  LimitValue,
  LineNumber,
  LogCategory,
  LogEventType,
  LogIssue,
  LogLevel,
  LogTimezone,
  NamespaceLimits,
  SelfTotal,
  Truncation,
  TruncationRegion,
  UserInfo,
} from './types.js';
// The const companions of the unions above.
export {
  ALL_LIMIT_METRICS,
  ALL_LOG_CATEGORIES,
  LIMIT_METRIC,
  LOG_CATEGORY,
  LOG_LEVEL,
} from './types.js';
