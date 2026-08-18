/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

// Runtime only. Types and the const companions live in '@apexdevtools/apex-log-parser/types'.

// ApexLogParser is public because every event constructor takes one, so a consumer that builds
// events needs it.
export { ApexLogParser, DebugLevel, parse } from './ApexLogParser.js';

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
