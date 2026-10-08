/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { codeUnitType, EVENT_TYPES, fieldPosition, idOfType } from '../catalog/catalog.js';
import type { EventType, Fields } from '../catalog/types.js';
import type { LimitUsage, RunningUsage } from '../limits.js';
import { codedUsage, labelledUsage, runningUsage } from '../limits.js';

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
}

/**
 * The values each type's line states beyond its text, by type. A value is null when the line does
 * not state it, or states it malformed; `field()` still gives the raw text.
 */
export interface EventDetails {
  readonly SOQL_EXECUTE_BEGIN: { readonly aggregations: number | null };
  /** Null when the line states no plan, as `No explain plan is available`. */
  readonly SOQL_EXECUTE_EXPLAIN: ExplainPlan | null;
  readonly DML_BEGIN: { readonly operation: string | null; readonly sObjectType: string | null };
  /** The kind of code, as `Flow` or `Validation`, from the unit's name. */
  readonly CODE_UNIT_STARTED: { readonly codeUnitType: string | null };
  /** Bytes, as the line states them: positive for a deallocation. */
  readonly HEAP_ALLOCATE: { readonly bytes: number | null };
  readonly HEAP_DEALLOCATE: { readonly bytes: number | null };
  readonly BULK_HEAP_ALLOCATE: { readonly bytes: number | null };
  readonly LIMIT_USAGE: LimitUsage | null;
  readonly FLOW_START_INTERVIEW_LIMIT_USAGE: LimitUsage | null;
  readonly FLOW_INTERVIEW_FINISHED_LIMIT_USAGE: LimitUsage | null;
  readonly FLOW_ELEMENT_LIMIT_USAGE: RunningUsage | null;
  readonly FLOW_BULK_ELEMENT_LIMIT_USAGE: RunningUsage | null;
}

/** The details of an event of type `T`: null for a type that states none. */
export type DetailsOf<T extends EventType> = T extends keyof EventDetails ? EventDetails[T] : null;

/** The details of any event. */
export type AnyDetails = EventDetails[keyof EventDetails];

type Read<T> = (f: Fields) => T;

/** Field `name`'s position in `typeId`'s line; throws at load for a name the entry does not list. */
function position(typeId: number, name: string): { at: number; last: boolean } {
  const found = fieldPosition(typeId, name);
  if (found.at < 0) throw new Error(`${EVENT_TYPES[typeId]?.type} has no field ${name}`);
  return found;
}

function text(typeId: number, name: string): Read<string | null> {
  const { at, last } = position(typeId, name);
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
  const { at } = position(typeId, name);
  return (f) => {
    const n = f.int(at, prefix);
    return Number.isNaN(n) ? null : n;
  };
}

/** The number after `label` in `part`; null when the label or a finite number is missing. */
function numberAfter(part: string | undefined, label: string): number | null {
  if (part === undefined) return null;
  const at = part.indexOf(label);
  const rest = at < 0 ? '' : part.slice(at + label.length).trim();
  const n = rest === '' ? Number.NaN : Number(rest);
  return Number.isFinite(n) ? n : null;
}

/** A plan as `TableScan on MyObject__c : [Field__c], cardinality: 2, sobjectCardinality: 2, relativeCost 1.3`. */
export function explainPlan(plan: string | null): ExplainPlan | null {
  if (plan === null) return null;
  const split = plan.indexOf('],');
  if (split < 0) return null;
  const head = plan.slice(0, split);
  const [cardinality, sObjectCardinality, cost] = plan.slice(split + 2).split(',');
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
    relativeCost: numberAfter(cost, 'relativeCost '),
  };
}

const READERS: (Read<AnyDetails> | undefined)[] = [];

/** Registers `type`'s reader, built from its own type id so each field resolves at load. */
function reader<T extends keyof EventDetails>(
  type: T,
  make: (typeId: number) => Read<EventDetails[T]>,
): void {
  const typeId = idOfType(type);
  READERS[typeId] = make(typeId);
}

reader('SOQL_EXECUTE_BEGIN', (t) => {
  const aggregations = int(t, 'aggregations', 'Aggregations:');
  return (f) => ({ aggregations: aggregations(f) });
});
reader('SOQL_EXECUTE_EXPLAIN', (t) => {
  // One field, as its text rule and today read it, though it is the line's last.
  const { at } = position(t, 'plan');
  return (f) => explainPlan(f.at(at) || null);
});
reader('DML_BEGIN', (t) => {
  const operation = after(t, 'operation', 'Op:');
  const sObjectType = after(t, 'objectType', 'Type:');
  return (f) => ({ operation: operation(f), sObjectType: sObjectType(f) });
});
reader('CODE_UNIT_STARTED', () => (f) => ({ codeUnitType: codeUnitType(f) }));
for (const type of ['HEAP_ALLOCATE', 'HEAP_DEALLOCATE', 'BULK_HEAP_ALLOCATE'] as const) {
  reader(type, (t) => {
    const bytes = int(t, 'bytes', 'Bytes:');
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

/** The details `typeId`'s line states, or null for a type that has none. Frozen: views share them. */
export function eventDetails(typeId: number, f: () => Fields): AnyDetails | null {
  const read = READERS[typeId];
  const details = read ? read(f()) : null;
  return details && Object.freeze(details);
}
