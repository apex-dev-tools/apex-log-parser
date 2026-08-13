/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

// Parser
export { DebugLevel, parse } from './ApexLogParser.js';

// Types
export type {
  CPUType,
  DebugCategory,
  GovernorLimits,
  GovernorSnapshot,
  IssueType,
  Limits,
  LineNumber,
  LogCategory,
  LogEventType,
  LogIssue,
  LogLevel,
  LogSubCategory,
  SelfTotal,
} from './types.js';

// Constants
export { ALL_LOG_CATEGORIES, DEBUG_CATEGORY, LOG_CATEGORY, LOG_LEVEL } from './types.js';

// Events - classes used by consumers for instanceof narrowing and typing the tree
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
} from './LogEvents.js';

// Governor-limit observation types (the .limitUsage field type crosses into the log-viewer).
export type { LimitMetricKey, LimitObservation, RunningTotalObservation } from './limits.js';
