/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type {
  AnyDetails,
  ApexEvent,
  ApexLog,
  Columns,
  CountColumn,
  DebugCategory,
  DebugCategoryToken,
  DebugLevelSetting,
  DetailsOf,
  EndedBy,
  EventDetails,
  EventFields,
  EventOf,
  EventType,
  EventTypeInfo,
  ExplainPlan,
  FlowType,
  FrameEvent,
  GovernorLimits,
  HeapColumn,
  IssueType,
  Kind,
  LeafEvent,
  Level,
  LimitMetric,
  LimitSnapshot,
  Limits,
  LimitUnit,
  LimitUsage,
  LimitValue,
  LogAbortSignal,
  LogBlob,
  LogBuffers,
  LogIssue,
  LogPlace,
  LogResponse,
  LogSource,
  LogStream,
  LogTimezone,
  LogTruncation,
  LogTruncationRegion,
  LogWorker,
  NamespaceLimits,
  ObjectState,
  ParseOptions,
  ParsePhase,
  ParseProgress,
  Rollups,
  RunningUsage,
  SelfTotal,
  Shape,
  StaticClass,
  StreamRead,
  TextColumn,
  TransferableLog,
  TruncationKind,
  UserInfo,
  Variable,
  Variables,
} from '../browser.js';
import * as browser from '../browser.js';
import * as node from '../node.js';

// The package root is what every consumer imports, so a change to it must be deliberate.
// Object.keys sees runtime bindings only, hence the type positions below.
const PUBLIC_EXPORTS = [
  'DEBUG_CATEGORY',
  'DEBUG_CATEGORY_TOKEN',
  'ENDED_BY',
  'EVENT_TYPE_NAMES',
  'EVENT_TYPES',
  'eventType',
  'FLOW_TYPE',
  'fromBuffers',
  'ISSUE_TYPE',
  'KIND',
  'LEVEL',
  'LIMIT_METRICS',
  'LIMIT_UNIT',
  'LINE_NUMBER',
  'parse',
  'PARSE_PHASE',
  'SHAPE',
  'toBuffers',
  'TRUNCATION_KIND',
];

// Fails the typecheck, not the test run, if a public type is removed or renamed.
interface PublicTypeSurface {
  anyDetails: AnyDetails;
  apexEvent: ApexEvent;
  apexLog: ApexLog;
  columns: Columns;
  countColumn: CountColumn;
  debugCategory: DebugCategory;
  debugCategoryToken: DebugCategoryToken;
  debugLevelSetting: DebugLevelSetting;
  detailsOf: DetailsOf<'SOQL_EXECUTE_BEGIN'>;
  endedBy: EndedBy;
  eventDetails: EventDetails;
  eventFields: EventFields;
  eventOf: EventOf<'METHOD_ENTRY'>;
  eventType: EventType;
  eventTypeInfo: EventTypeInfo;
  explainPlan: ExplainPlan;
  flowType: FlowType;
  frameEvent: FrameEvent;
  governorLimits: GovernorLimits;
  heapColumn: HeapColumn;
  issueType: IssueType;
  kind: Kind;
  leafEvent: LeafEvent;
  level: Level;
  limitMetric: LimitMetric;
  limits: Limits;
  limitSnapshot: LimitSnapshot;
  limitUnit: LimitUnit;
  limitUsage: LimitUsage;
  limitValue: LimitValue;
  logAbortSignal: LogAbortSignal;
  logBlob: LogBlob;
  logBuffers: LogBuffers;
  logIssue: LogIssue;
  logPlace: LogPlace;
  logResponse: LogResponse;
  logSource: LogSource;
  logStream: LogStream;
  logTimezone: LogTimezone;
  logTruncation: LogTruncation;
  logTruncationRegion: LogTruncationRegion;
  logWorker: LogWorker;
  namespaceLimits: NamespaceLimits;
  objectState: ObjectState;
  parseOptions: ParseOptions;
  parsePhase: ParsePhase;
  parseProgress: ParseProgress;
  rollups: Rollups;
  runningUsage: RunningUsage;
  selfTotal: SelfTotal;
  shape: Shape;
  staticClass: StaticClass;
  streamRead: StreamRead;
  transferableLog: TransferableLog;
  textColumn: TextColumn;
  truncationKind: TruncationKind;
  userInfo: UserInfo;
  variable: Variable;
  variables: Variables;
}

// Both builds must state one surface, so a caller's types hold whichever condition resolves.
node satisfies typeof browser;
browser satisfies typeof node;

describe('the public API', () => {
  it.each([
    ['node', node],
    ['browser', browser],
  ])(
    'the %s build exports parse, the buffer pair, the catalog and the const companions only',
    (_build, entry) => {
      expect(new Set(Object.keys(entry))).toEqual(new Set(PUBLIC_EXPORTS));
    },
  );

  it('every public type is reachable from the entry point', () => {
    const surface: Pick<PublicTypeSurface, 'level'> = { level: browser.LEVEL.Fine };
    expect(surface.level).toBe('FINE');
  });
});
