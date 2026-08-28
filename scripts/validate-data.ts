/**
 * Validates data/salesforce-debug-log-events.json against its own $schema.
 *
 * Usage: pnpm run validate:data
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { exit } from 'node:process';
import { fileURLToPath } from 'node:url';
// The schema declares draft 2020-12, which is not ajv's default dialect
import { Ajv2020 } from 'ajv/dist/2020.js';
import ajvFormats from 'ajv-formats';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../data');
const dataPath = join(dataDir, 'salesforce-debug-log-events.json');
const schemaPath = join(dataDir, 'salesforce-debug-log-events.schema.json');

const data = JSON.parse(readFileSync(dataPath, 'utf-8')) as unknown;
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as object;

// ajv-formats sets `module.exports` to the plugin function, but its .d.ts declares
// an ESM default export, which NodeNext resolves to the module namespace. The cast
// states the real shape; tsx already applies the same interop at runtime.
const addFormats = ajvFormats as unknown as (ajv: Ajv2020) => void;

const ajv = new Ajv2020({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

if (validate(data)) {
  console.log(`${dataPath} is valid`);
  exit(0);
}

console.error(`${dataPath} does not match its schema:`);
for (const error of validate.errors ?? []) {
  console.error(`  ${error.instancePath || '/'} ${error.message ?? ''}`);
}
exit(1);
