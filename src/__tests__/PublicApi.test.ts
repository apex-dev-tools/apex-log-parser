/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type {
  CPUType,
  DebugCategory,
  DebugLevels,
  GovernorLimits,
  GovernorSnapshot,
  IssueType,
  LimitMetricKey,
  LimitMetricMeta,
  LimitMetricUnit,
  LimitObservation,
  Limits,
  LimitValue,
  LineNumber,
  LogCategory,
  LogEventType,
  LogIssue,
  LogLevel,
  LogTimezone,
  NamespaceLimits,
  RunningTotalObservation,
  SelfTotal,
  Truncation,
  TruncationRegion,
  UserInfo,
} from '../index.js';
import * as root from '../index.js';

// The published surface is a contract with the log-viewer and the MCP server, so a change to it must
// be deliberate. Object.keys sees runtime bindings only, hence the type positions below.
const ROOT_EXPORTS = [
  'ALL_LIMIT_METRICS',
  'ALL_LOG_CATEGORIES',
  'ApexLog',
  'ApexLogParser',
  'CodeUnitStartedLine',
  'DMLBeginLine',
  'ExecutionStartedLine',
  'HeapAllocateLine',
  'LIMIT_METRIC',
  'LimitUsageLine',
  'LOG_CATEGORY',
  'LOG_LEVEL',
  'LogEvent',
  'MethodEntryLine',
  'parse',
  'SOQLExecuteBeginLine',
  'SOQLExecuteExplainLine',
  'SOSLExecuteBeginLine',
];

// Fails the typecheck, not the test run, if a public type is removed or renamed.
interface PublicTypeSurface {
  cpuType: CPUType;
  debugCategory: DebugCategory;
  debugLevels: DebugLevels;
  governorLimits: GovernorLimits;
  governorSnapshot: GovernorSnapshot;
  issueType: IssueType;
  limitMetricKey: LimitMetricKey;
  limitMetricMeta: LimitMetricMeta;
  limitMetricUnit: LimitMetricUnit;
  limitObservation: LimitObservation;
  limitValue: LimitValue;
  limits: Limits;
  lineNumber: LineNumber;
  logCategory: LogCategory;
  logEventType: LogEventType;
  logIssue: LogIssue;
  logLevel: LogLevel;
  logTimezone: LogTimezone;
  namespaceLimits: NamespaceLimits;
  runningTotalObservation: RunningTotalObservation;
  selfTotal: SelfTotal;
  truncation: Truncation;
  truncationRegion: TruncationRegion;
  userInfo: UserInfo;
}

describe('public API', () => {
  it('exports the parser, the event classes and the const companions only', () => {
    expect(new Set(Object.keys(root))).toEqual(new Set(ROOT_EXPORTS));
  });

  it('every public type is reachable from the entry point', () => {
    const surface: Pick<PublicTypeSurface, 'logLevel'> = { logLevel: root.LOG_LEVEL.Fine };
    expect(surface.logLevel).toBe('FINE');
  });
});
