/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  codeUnitType,
  eventBody,
  eventText,
  fieldPosition,
  HEAP_PREFIX,
  idOfType,
  splitTrailingFields,
} from '../catalog/catalog.js';
import type { EventType, Fields } from '../catalog/types.js';
import type { Limits, LimitUsage, RunningUsage } from '../limits.js';
import { codedUsage, labelledUsage, limitsOfBlock, runningUsage } from '../limits.js';
import type { ProfilingDetails } from './profiling.js';
import { profilingDetails } from './profiling.js';

/** The query optimizer's plan for one query. Each value is null when the plan does not state it. */
export interface ExplainPlan {
  /** The operation the optimizer leads with, as `TableScan` or `Index`. */
  readonly leadingOperationType: string | null;
  /** The queried SObject. */
  readonly sObjectType: string | null;
  /** The indexed fields the optimizer uses; empty when it states the brackets with none inside. */
  readonly fields: readonly string[] | null;
  /** Rows the leading operation is estimated to return. */
  readonly cardinality: number | null;
  /** The approximate record count of the queried SObject. */
  readonly sObjectCardinality: number | null;
  /** The cost against the selectivity threshold: above 1, the query is not selective. */
  readonly relativeCost: number | null;
  /** Any text the plan states after the cost's number, as `(with skinny table)`; null when it states none. */
  readonly relativeCostNote: string | null;
}

/** What started a flow interviews frame. */
export const FLOW_TYPE = {
  Flow: 'flow',
  ProcessBuilder: 'process-builder',
} as const;

/** What started a flow interviews frame: `details.flowType`. */
export type FlowType = (typeof FLOW_TYPE)[keyof typeof FLOW_TYPE];

const FLOW_OF_UNIT = new Map<string, FlowType>([
  ['Flow', 'flow'],
  ['Workflow', 'process-builder'],
]);

/** The flow type a code unit of `unit` type starts; null for any other unit, or none. */
export const flowTypeOfUnit = (unit: string | null): FlowType | null =>
  FLOW_OF_UNIT.get(unit ?? '') ?? null;

/**
 * The values each type's line states beyond its text, or derives from the rows after it, by type. A
 * value is null when the log does not state it, or states it malformed; `field()` still gives the
 * raw text.
 */
export interface EventDetails {
  readonly SOQL_EXECUTE_BEGIN: {
    readonly aggregations: number | null;
    /** The plan from the query's `SOQL_EXECUTE_EXPLAIN` child; null when the log states none. */
    readonly explain: ExplainPlan | null;
  };
  /** Null when the line states no plan, as `No explain plan is available`. */
  readonly SOQL_EXECUTE_EXPLAIN: ExplainPlan | null;
  readonly DML_BEGIN: { readonly operation: string | null; readonly sObjectType: string | null };
  /** The kind of code, as `Flow` or `Validation`, from the unit's name. */
  readonly CODE_UNIT_STARTED: { readonly codeUnitType: string | null };
  /** What started the interviews, from the code unit above them: `Flow` or nested is `flow`, `Workflow` is `process-builder`. Null for any other unit. */
  readonly FLOW_START_INTERVIEWS_BEGIN: { readonly flowType: FlowType | null };
  /** Bytes, as the line states them: positive for a deallocation. */
  readonly HEAP_ALLOCATE: { readonly bytes: number | null };
  readonly HEAP_DEALLOCATE: { readonly bytes: number | null };
  readonly BULK_HEAP_ALLOCATE: { readonly bytes: number | null };
  readonly LIMIT_USAGE: LimitUsage | null;
  readonly FLOW_START_INTERVIEW_LIMIT_USAGE: LimitUsage | null;
  readonly FLOW_INTERVIEW_FINISHED_LIMIT_USAGE: LimitUsage | null;
  readonly FLOW_ELEMENT_LIMIT_USAGE: RunningUsage | null;
  readonly FLOW_BULK_ELEMENT_LIMIT_USAGE: RunningUsage | null;
  /**
   * The usage the block states. A metric it leaves out reads `used: 0, limit: null`, as `log.limits`
   * does. A block states heap as 0, so `heapSize.used` is 0.
   */
  readonly LIMIT_USAGE_FOR_NS: { readonly limits: Limits };
  readonly CUMULATIVE_PROFILING: ProfilingDetails;
  /** The element that failed. Its text holds the message only. */
  readonly FLOW_ELEMENT_ERROR: {
    readonly elementType: string | null;
    readonly elementName: string | null;
  };
  readonly EXCEPTION_THROWN: {
    /**
     * The parser's reading of the row after the throw; the log does not state it. False when a
     * `FATAL_ERROR` follows, true when any other row does, so a `finally` block that logs before a
     * `FATAL_ERROR` reads true. Throws with only exit lines between them share one answer, so a
     * throw that a catch block wraps and throws again is false too. Null when the log cannot tell:
     * it ends, a limit block starts, or it drops lines before the next event. A merged
     * `ENTERING_MANAGED_PKG` has no row, so the code it ran is not seen.
     */
    readonly isCaught: boolean | null;
  };
}

/** The details of an event of type `T`: null for a type that states none. */
export type DetailsOf<T extends EventType> = T extends keyof EventDetails ? EventDetails[T] : null;

/** The details of any event. */
export type AnyDetails = EventDetails[keyof EventDetails];

type Read<T> = (f: Fields) => T;
/**
 * Reads a line's details; `explain` gives a query's explain line, or null when it has none,
 * `isCaught` the reading of a throw, and `flowType` what started an interviews frame. `explain`
 * and `flowType` move the shared cursor, so read `f` first.
 */
type Reader<T> = (
  f: Fields,
  explain: () => Fields | null,
  isCaught: () => boolean | null,
  flowType: () => FlowType | null,
) => T;

function text(typeId: number, name: string): Read<string | null> {
  const { at, last } = fieldPosition(typeId, name);
  return last ? (f) => f.from(at, '|') || null : (f) => f.at(at) || null;
}

/** The field after `prefix`, or null when the field does not start with it. */
function after(typeId: number, name: string, prefix: string): Read<string | null> {
  const read = text(typeId, name);
  return (f) => {
    const value = read(f);
    return value?.startsWith(prefix) ? value.slice(prefix.length) || null : null;
  };
}

function int(typeId: number, name: string, prefix = ''): Read<number | null> {
  const { at } = fieldPosition(typeId, name);
  return (f) => {
    const n = f.int(at, prefix);
    return Number.isNaN(n) ? null : n;
  };
}

/** `text` as a finite number; null when it is not one. */
function finite(text: string): number | null {
  const n = text === '' ? Number.NaN : Number(text);
  return Number.isFinite(n) ? n : null;
}

/** The text after `label` in `part`, trimmed; empty when the label is missing. */
function restAfter(part: string | undefined, label: string): string {
  if (part === undefined) return '';
  const at = part.indexOf(label);
  return at < 0 ? '' : part.slice(at + label.length).trim();
}

/** The number after `label` in `part`; null when the label or a finite number is missing. */
function numberAfter(part: string | undefined, label: string): number | null {
  return finite(restAfter(part, label));
}

/**
 * The cost and the text after its number, as `relativeCost 0 (with skinny table)`. Found by its
 * label, not after a comma, as the note can hold one.
 */
function costOf(tail: string): Pick<ExplainPlan, 'relativeCost' | 'relativeCostNote'> {
  const rest = restAfter(tail, 'relativeCost ');
  const space = rest.search(/\s/);
  return {
    relativeCost: finite(space < 0 ? rest : rest.slice(0, space)),
    relativeCostNote: space < 0 ? null : rest.slice(space + 1).trim() || null,
  };
}

/** A plan as `TableScan on MyObject__c : [Field__c], cardinality: 2, sobjectCardinality: 2, relativeCost 1.3`. */
export function explainPlan(plan: string | null): ExplainPlan | null {
  if (plan === null) return null;
  const split = plan.indexOf('],');
  if (split < 0) return null;
  const head = plan.slice(0, split);
  const tail = plan.slice(split + 2);
  const [cardinality, sObjectCardinality] = tail.split(',', 2);
  const on = head.indexOf(' on ');
  const colon = head.indexOf(' :');
  const bracket = head.indexOf('[');
  const fields = bracket < 0 ? null : head.slice(bracket + 1).replace(/\s+/g, '');
  return {
    leadingOperationType: on < 0 ? null : head.slice(0, on) || null,
    sObjectType: on < 0 || colon < on ? null : head.slice(on + 4, colon) || null,
    fields: fields === null ? null : Object.freeze(fields === '' ? [] : fields.split(',')),
    cardinality: numberAfter(cardinality, 'cardinality: '),
    sObjectCardinality: numberAfter(sObjectCardinality, 'sobjectCardinality: '),
    ...costOf(tail),
  };
}

const READERS: (Reader<AnyDetails> | undefined)[] = [];

/** Registers `type`'s reader, built from its own type id so each field resolves at load. */
function reader<T extends keyof EventDetails>(
  type: T,
  make: (typeId: number) => Reader<EventDetails[T]>,
): void {
  const typeId = idOfType(type);
  READERS[typeId] = make(typeId);
}

// One field, as its text rule reads it, though it is the line's last.
const PLAN = fieldPosition(idOfType('SOQL_EXECUTE_EXPLAIN'), 'plan').at;
const planOf = (f: Fields): ExplainPlan | null => explainPlan(f.at(PLAN) || null);

reader('SOQL_EXECUTE_BEGIN', (t) => {
  const aggregations = int(t, 'aggregations', 'Aggregations:');
  return (f, explain) => {
    // Read before explain(), which can move a shared cursor to the child's line.
    const stated = aggregations(f);
    const line = explain();
    return { aggregations: stated, explain: line && planOf(line) };
  };
});
reader('SOQL_EXECUTE_EXPLAIN', () => planOf);
reader('DML_BEGIN', (t) => {
  const operation = after(t, 'operation', 'Op:');
  const sObjectType = after(t, 'objectType', 'Type:');
  return (f) => ({ operation: operation(f), sObjectType: sObjectType(f) });
});
reader('CODE_UNIT_STARTED', () => (f) => ({ codeUnitType: codeUnitType(f) }));
reader('FLOW_START_INTERVIEWS_BEGIN', () => (_f, _explain, _isCaught, flowType) => ({
  flowType: flowType(),
}));
for (const type of ['HEAP_ALLOCATE', 'HEAP_DEALLOCATE', 'BULK_HEAP_ALLOCATE'] as const) {
  reader(type, (t) => {
    const bytes = int(t, 'bytes', HEAP_PREFIX);
    return (f) => ({ bytes: bytes(f) });
  });
}
reader('LIMIT_USAGE', (t) => {
  const [code, used, limit] = [text(t, 'limit'), int(t, 'used'), int(t, 'max')];
  return (f) => codedUsage(code(f), used(f), limit(f));
});
const FLOW_USAGE = [
  ['FLOW_START_INTERVIEW_LIMIT_USAGE', labelledUsage],
  ['FLOW_INTERVIEW_FINISHED_LIMIT_USAGE', labelledUsage],
  ['FLOW_ELEMENT_LIMIT_USAGE', runningUsage],
  ['FLOW_BULK_ELEMENT_LIMIT_USAGE', runningUsage],
] as const;
for (const [type, parse] of FLOW_USAGE) {
  reader(type, (t) => {
    const usage = text(t, 'usage');
    return (f) => {
      const stated = usage(f);
      return stated === null ? null : parse(stated);
    };
  });
}

// The text the scan's limit hook reads, so these figures match `log.limits.snapshots`.
reader('LIMIT_USAGE_FOR_NS', (t) => (f) => ({ limits: limitsOfBlock(eventText(t, f) ?? '') }));
reader('CUMULATIVE_PROFILING', (t) => {
  const section = text(t, 'section');
  return (f) => profilingDetails(section(f), f.continuation());
});

reader('FLOW_ELEMENT_ERROR', (t) => (f) => {
  // A message can span lines; then the element follows it on the last line.
  const body = eventBody(t, f);
  const split = body === null ? null : splitTrailingFields(body, 2);
  return { elementType: split?.[1] || null, elementName: split?.[2] || null };
});

reader('EXCEPTION_THROWN', () => (_f, _explain, isCaught) => ({ isCaught: isCaught() }));

/** The details `typeId`'s line states, or null for a type that has none. Frozen: views share them. */
export function eventDetails(
  typeId: number,
  f: () => Fields,
  explain: () => Fields | null,
  isCaught: () => boolean | null,
  flowType: () => FlowType | null,
): AnyDetails | null {
  const read = READERS[typeId];
  const details = read ? read(f(), explain, isCaught, flowType) : null;
  return details && Object.freeze(details);
}
