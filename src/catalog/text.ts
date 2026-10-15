/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { CpuType, LineFields } from './types.js';

/** Builds an event's text from its line. Null when the line states no text. */
export type TextRule = (f: LineFields) => string | null;

/** Reads an event's cpuType from its line, for a type whose events differ. */
export type CpuRule = (f: LineFields) => CpuType;

/** Rewrites the text once the continuation lines are appended. */
export type AfterRule = (text: string) => string;

/** A field's position on the line, by its name. Throws when the type has no such field. */
export type FieldPosition<K extends string = string> = (name: K) => number;

/** A text rule that reads the fields `K`; the catalog resolves the names once, at load. */
export type TextSpec<K extends string = string> = (position: FieldPosition<K>) => TextRule;

/** A cpu rule that reads the fields `K`, resolved as a text rule is. */
export type CpuSpec<K extends string = string> = (position: FieldPosition<K>) => CpuRule;

/** A line rule built from the positions of the named fields, in order. */
export function rule<const K extends string, R extends TextRule | CpuRule = TextRule>(
  names: readonly K[],
  build: (...positions: number[]) => R,
): (position: FieldPosition<K>) => R {
  return (position) => build(...names.map(position));
}

const SALESFORCE_ID = /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/;

/** A line-number field as text: `[12]` gives `12`, `[EXTERNAL]` gives `EXTERNAL`. */
export function lineText(field: string): string {
  return field === '[EXTERNAL]' ? 'EXTERNAL' : field.slice(1, -1);
}

/** Splits the last `count` `|` fields off text, or null when a field spans lines. */
function splitTrailingFields(text: string, count: number): string[] | null {
  const parts = text.split('|');
  if (parts.length <= count) return null;
  const fields = parts.splice(-count);
  if (fields.some((field) => field.includes('\n'))) return null;
  return [parts.join('|').trimEnd(), ...fields];
}

/** The code unit type: the text before the first `:` or `/`. */
function codeUnitType(typeString: string): string {
  let sep = typeString.indexOf(':');
  if (sep === -1) sep = typeString.indexOf('/');
  return sep === -1 ? '' : typeString.slice(0, sep);
}

/** A code unit's type, as `Flow` in `Flow:01I000000000AAA`; null when the line states none. */
export const codeUnitTypeText: TextSpec<'unit' | 'name' | 'typeRef'> = rule(
  ['unit', 'name', 'typeRef'],
  (unit, name, typeRef) => (f) => codeUnitType(f.at(typeRef) || f.at(name) || f.at(unit)) || null,
);

export const codeUnitText: TextSpec<'unit' | 'name' | 'typeRef'> = (position) => {
  const typeOf = codeUnitTypeText(position);
  const name = position('name');
  const unit = position('unit');
  return (f) => f.at(name) || f.at(unit) || typeOf(f);
};

const CUSTOM_UNITS = new Set(['Validation', 'Workflow', 'Flow']);

export const codeUnitCpu: CpuSpec<'unit' | 'name' | 'typeRef'> = (position) => {
  const typeOf = codeUnitTypeText(position);
  return (f) => (CUSTOM_UNITS.has(typeOf(f) ?? '') ? 'custom' : 'method');
};

// Class loading, which v0 assumed costs the org no CPU.
export const methodEntryCpu: CpuSpec<'signature'> = rule(
  ['signature'],
  (signature): CpuRule =>
    (f) =>
      f.at(signature).startsWith('System.Type.forName(') ? 'loading' : 'method',
);

export const constructorText: TextSpec<'signature' | 'className'> = rule(
  ['signature', 'className'],
  (signature, className) => (f) => {
    const args = f.at(signature);
    return f.at(className) + (args ? args.substring(args.lastIndexOf('(')) : '');
  },
);

// Older lines state no class id, so the signature sits where the class id would be.
export const methodExitText: TextSpec<'classId' | 'signature'> = rule(
  ['classId', 'signature'],
  (classId, signature) => (f) =>
    f.count > signature ? f.at(signature) : f.count > classId ? f.at(classId) : null,
);

export const managedPackageText: TextSpec<'namespace'> = rule(['namespace'], (namespace) => (f) => {
  const raw = f.at(namespace);
  return raw.substring(raw.lastIndexOf('.') + 1);
});

export const vfApexCallText: TextSpec<'element' | 'method' | 'controller'> = rule(
  ['element', 'method', 'controller'],
  (element, methodAt, controller) => (f) => {
    const classText = f.at(controller) || f.at(element);
    let method = f.at(methodAt);
    if (method) {
      const paren = method.indexOf('(');
      const init = method.indexOf('<init>');
      if (paren > -1) method = `.${method.substring(paren).slice(1, -1)}()`;
      else if (init > -1) method = `${method.substring(init + 6)}()`;
      else method = `.${method}`;
    }
    return classText + method;
  },
);

// The message follows however many ids the line states.
export const flowActionErrorText: TextSpec<'flowTriggerId'> = rule(
  ['flowTriggerId'],
  (first) => (f) => {
    let m = first;
    while (m < f.count - 1 && SALESFORCE_ID.test(f.at(m))) m++;
    return f.from(m, '|') || null;
  },
);

export const flowActionDetailText: TextSpec<'first' | 'second' | 'third' | 'currentRule'> = rule(
  ['first', 'second', 'third', 'currentRule'],
  (first, second, third, currentRule) => (f) =>
    `${f.at(first)} : ${f.at(second)}${f.at(third) ? ` : ${f.at(third)} : ${f.at(currentRule)}` : ''}`,
);

export const limitsForNamespaceAfter: AfterRule = (text) =>
  text.replace(/^\s+/gm, '').replaceAll('******* CLOSE TO LIMIT', '').replaceAll(' out of ', '/');

export const wfFormulaAfter: AfterRule = (text) => {
  const i = text.indexOf('|Values:');
  return i < 0 ? text : `${text.slice(0, i).trimEnd()} : ${text.slice(i + 1)}`;
};

export const flowInterviewsErrorAfter: AfterRule = (text) => {
  const split = splitTrailingFields(text, 2);
  return split ? `${split[0]} - ${split[2]}` : text;
};

export const flowElementErrorAfter: AfterRule = (text) =>
  splitTrailingFields(text, 2)?.filter(Boolean).join(' ') ?? text;

export const validationFormulaAfter: AfterRule = (text) => {
  const split = splitTrailingFields(text, 1);
  return split ? `${split[0]} ${split[1]}` : text;
};
