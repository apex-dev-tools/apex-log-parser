/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

// What both builds export beside their own `parse` and `fromBuffers`. `__tests__/PublicApi.test.ts`
// pins it.

export { EVENT_TYPES, eventType } from '../catalog/catalog.js';
export type { EventFields } from '../catalog/fields.js';
export type {
  Category,
  CpuType,
  DebugCategory,
  DebugCategoryToken,
  EventType,
  EventTypeInfo,
  Kind,
  Level,
  Shape,
} from '../catalog/types.js';
export {
  CATEGORY,
  CPU_TYPE,
  DEBUG_CATEGORY,
  DEBUG_CATEGORY_TOKEN,
  EVENT_TYPE_NAMES,
  KIND,
  LEVEL,
  SHAPE,
} from '../catalog/types.js';
export type { DebugLevelSetting, LogTimezone, UserInfo } from '../engine/header.js';
export type { IssueType, TruncationKind } from '../engine/issues.js';
export { ISSUE_TYPE, TRUNCATION_KIND } from '../engine/issues.js';
export type {
  GovernorLimits,
  LimitMetric,
  LimitSnapshot,
  Limits,
  LimitUnit,
  LimitUsage,
  LimitValue,
  NamespaceLimits,
  RunningUsage,
} from '../limits.js';
export { LIMIT_METRICS, LIMIT_UNIT } from '../limits.js';
export type { AnyDetails, DetailsOf, EventDetails, ExplainPlan } from '../views/details.js';
export type {
  ApexEvent,
  EventOf,
  FrameEvent,
  LeafEvent,
  Rollups,
  SelfTotal,
} from '../views/events.js';
export type {
  ApexLog,
  Columns,
  LogIssue,
  LogPlace,
  LogTruncation,
  LogTruncationRegion,
} from '../views/log.js';
export type { LogBuffers, TransferableLog } from './buffers.js';
export { toBuffers } from './buffers.js';
export type { ParseOptions } from './parse.js';
export type {
  LogAbortSignal,
  LogBlob,
  LogResponse,
  LogSource,
  LogStream,
  ParsePhase,
  ParseProgress,
  StreamRead,
} from './sources.js';
export { PARSE_PHASE } from './sources.js';
export type { LogWorker } from './worker.js';
