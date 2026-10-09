/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { readFileSync } from 'node:fs';
import eventDatabase from '../../data/salesforce-debug-log-events.json' with { type: 'json' };
import { EVENT_TYPES } from '../../src/catalog/catalog.js';

// The docs are TSDoc on a type, which no runtime value holds, so this reads the source.
const source = readFileSync(new URL('../../src/catalog/fields.ts', import.meta.url), 'utf8');

const NO_DESCRIPTION = 'Salesforce does not describe this type.';
const database = eventDatabase as { events: { event: string; description: string }[] };

interface DocumentedType {
  doc: string;
  fields: { name: string; doc: string }[];
}

/** Each `EventFields` member: its doc's first paragraph, and its fields with their docs. */
function documentedTypes(text: string): Map<string, DocumentedType> {
  const types = new Map<string, DocumentedType>();
  const body = text.slice(text.indexOf('export interface EventFields {'));
  const member =
    /^ {2}\/\*\*([\s\S]*?)\*\/\n {2}([A-Z_]+): (?:Record<never, never>;|\{\n([\s\S]*?)^ {2}\};)/gm;
  for (const [, doc, type, fields] of body.matchAll(member)) {
    const paragraph = (doc ?? '')
      .replace(/^\s*\* ?/gm, '')
      .trim()
      .split('\n\n')[0]!
      .replaceAll('\n', ' ');
    const field = /^ {4}\/\*\* (.*) \*\/\n {4}readonly (\w+): string \| null;$/gm;
    types.set(type!, {
      doc: paragraph,
      fields: [...(fields ?? '').matchAll(field)].map(([, fieldDoc, name]) => ({
        name: name!,
        doc: fieldDoc!,
      })),
    });
  }
  return types;
}

const documented = documentedTypes(source);

describe('the EventFields docs', () => {
  it('document every event type, and no other', () => {
    expect([...documented.keys()].sort()).toEqual(EVENT_TYPES.map((info) => info.type).sort());
  });

  it('list each type the fields its catalog entry names, in the same order', () => {
    const drift = EVENT_TYPES.flatMap((info) => {
      const names = documented.get(info.type)?.fields.map((field) => field.name) ?? [];
      return names.join() === info.fields.join()
        ? []
        : [`${info.type}: ${names} != ${info.fields}`];
    });
    expect(drift).toEqual([]);
  });

  it('state the Salesforce description of every type', () => {
    const drift = database.events.flatMap(({ event, description }) => {
      // The database writes 'None' where Salesforce gives no description.
      const expected = description && description !== 'None' ? description : NO_DESCRIPTION;
      return documented.get(event)?.doc === expected ? [] : [event];
    });
    expect(drift).toEqual([]);
  });

  it('state the format of every field', () => {
    const bad = [...documented].flatMap(([type, { fields }]) =>
      fields
        .filter((field) => !/ Format: (`.+`|empty)\.$/.test(field.doc))
        .map((field) => `${type}: ${field.name}`),
    );
    expect(bad).toEqual([]);
  });
});
