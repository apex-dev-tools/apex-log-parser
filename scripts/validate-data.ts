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
import addFormats from 'ajv-formats';

const dataDir = join(dirname(fileURLToPath(import.meta.url)), '../data');
const dataPath = join(dataDir, 'salesforce-debug-log-events.json');
const schemaPath = join(dataDir, 'salesforce-debug-log-events.schema.json');

const data = JSON.parse(readFileSync(dataPath, 'utf-8')) as unknown;
const schema = JSON.parse(readFileSync(schemaPath, 'utf-8')) as object;

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
