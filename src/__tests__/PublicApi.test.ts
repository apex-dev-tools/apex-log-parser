/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import * as root from '../index.js';
import * as publicTypes from '../publicTypes.js';
import type {
  CPUType,
  DebugCategory,
  DebugLevels,
  GovernorLimits,
  GovernorSnapshot,
  IssueType,
  LimitMetricKey,
  LimitObservation,
  Limits,
  LineNumber,
  LogCategory,
  LogEventType,
  LogIssue,
  LogLevel,
  LogTimezone,
  RunningTotalObservation,
  SelfTotal,
  Truncation,
  TruncationRegion,
  UserInfo,
} from '../publicTypes.js';

// The published surface is a contract with the log-viewer and the MCP server, so a change to it must
// be deliberate. Object.keys sees runtime bindings only, hence the type positions below.
const ROOT_EXPORTS = [
  'ApexLog',
  'ApexLogParser',
  'CodeUnitStartedLine',
  'DMLBeginLine',
  'ExecutionStartedLine',
  'HeapAllocateLine',
  'LimitUsageLine',
  'LogEvent',
  'MethodEntryLine',
  'parse',
  'SOQLExecuteBeginLine',
  'SOQLExecuteExplainLine',
  'SOSLExecuteBeginLine',
];

const TYPES_RUNTIME_EXPORTS = ['ALL_LOG_CATEGORIES', 'LOG_CATEGORY', 'LOG_LEVEL'];

// Fails the typecheck, not the test run, if a public type is removed or renamed.
interface PublicTypeSurface {
  cpuType: CPUType;
  debugCategory: DebugCategory;
  debugLevels: DebugLevels;
  governorLimits: GovernorLimits;
  governorSnapshot: GovernorSnapshot;
  issueType: IssueType;
  limitMetricKey: LimitMetricKey;
  limitObservation: LimitObservation;
  limits: Limits;
  lineNumber: LineNumber;
  logCategory: LogCategory;
  logEventType: LogEventType;
  logIssue: LogIssue;
  logLevel: LogLevel;
  logTimezone: LogTimezone;
  runningTotalObservation: RunningTotalObservation;
  selfTotal: SelfTotal;
  truncation: Truncation;
  truncationRegion: TruncationRegion;
  userInfo: UserInfo;
}

describe('public API', () => {
  it('root exports the parser and the event classes only', () => {
    expect(new Set(Object.keys(root))).toEqual(new Set(ROOT_EXPORTS));
  });

  it('the types entry point exports the const companions', () => {
    expect(new Set(Object.keys(publicTypes))).toEqual(new Set(TYPES_RUNTIME_EXPORTS));
  });

  it('every public type is reachable from the types entry point', () => {
    const surface: Pick<PublicTypeSurface, 'logLevel'> = { logLevel: publicTypes.LOG_LEVEL.Fine };
    expect(surface.logLevel).toBe('FINE');
  });
});
