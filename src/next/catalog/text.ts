/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Fields } from './types.js';

/** Builds an event's text from its line. Null when the line states no text. */
export type TextRule = (f: Fields) => string | null;

/** Rewrites the text once the continuation lines are appended. */
export type AfterRule = (text: string) => string;

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

/** The code unit type: the text before the first `:` or `/` of the most specific field. */
function codeUnitType(f: Fields): string {
  const typeString = f.at(5) || f.at(4) || f.at(3);
  let sep = typeString.indexOf(':');
  if (sep === -1) sep = typeString.indexOf('/');
  return sep === -1 ? '' : typeString.slice(0, sep);
}

export const codeUnitText: TextRule = (f) => f.at(4) || f.at(3) || codeUnitType(f) || null;

export const constructorText: TextRule = (f) => {
  const args = f.at(4);
  return f.at(5) + (args ? args.substring(args.lastIndexOf('(')) : '');
};

export const methodExitText: TextRule = (f) =>
  f.count > 4 ? f.at(4) : f.count > 3 ? f.at(3) : null;

export const managedPackageText: TextRule = (f) => {
  const raw = f.at(2);
  return raw.substring(raw.lastIndexOf('.') + 1);
};

export const vfApexCallText: TextRule = (f) => {
  const classText = f.at(5) || f.at(3);
  let method = f.at(4);
  if (method) {
    const paren = method.indexOf('(');
    const init = method.indexOf('<init>');
    if (paren > -1) method = `.${method.substring(paren).slice(1, -1)}()`;
    else if (init > -1) method = `${method.substring(init + 6)}()`;
    else method = `.${method}`;
  }
  return classText + method;
};

export const flowActionErrorText: TextRule = (f) => {
  let m = 2;
  while (m < f.count - 1 && SALESFORCE_ID.test(f.at(m))) m++;
  return f.from(m, '|') || null;
};

export const flowActionDetailText: TextRule = (f) =>
  `${f.at(2)} : ${f.at(3)}${f.at(4) ? ` : ${f.at(4)} : ${f.at(5)}` : ''}`;

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
