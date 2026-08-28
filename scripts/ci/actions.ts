/**
 * What `report.ts` needs from GitHub Actions: step outputs, the job summary and
 * annotations.
 *
 * Each function is a no-op with a warning when its environment variable is
 * absent, so every script here runs and can be tested off a runner.
 *
 * Only the environment-file forms are used. The `set-output` and `set-env`
 * workflow commands are deprecated.
 */

import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { env } from 'node:process';

/** GitHub renders at most 1 MiB of summary per step and drops the rest. */
const SUMMARY_LIMIT_BYTES = 1024 * 1024;

function append(variable: string, content: string): boolean {
  const path = env[variable];
  if (path === undefined || path === '') {
    console.warn(`  ${variable} is not set, so this is a no-op outside Actions`);
    return false;
  }
  appendFileSync(path, content);
  return true;
}

/**
 * Sets a step output.
 *
 * Always uses the heredoc form, because a single-line `name=value` would corrupt
 * the file for any value containing a newline. The delimiter is random per call,
 * so no two calls can collide and no state outlives one.
 */
export function setOutput(name: string, value: string): boolean {
  const delimiter = `EOF_${randomUUID()}`;
  if (value.includes(delimiter)) {
    throw new Error(`Cannot write output ${name}: its value contains the delimiter`);
  }
  return append('GITHUB_OUTPUT', `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

/**
 * Appends markdown to the job summary.
 *
 * Refuses oversized content rather than letting GitHub truncate it, because a
 * silently cut report is worse than a named failure.
 */
export function appendSummary(markdown: string): boolean {
  const bytes = Buffer.byteLength(markdown, 'utf-8');
  if (bytes > SUMMARY_LIMIT_BYTES) {
    throw new Error(`Job summary is ${bytes} bytes, over the ${SUMMARY_LIMIT_BYTES} byte limit`);
  }
  return append('GITHUB_STEP_SUMMARY', markdown.endsWith('\n') ? markdown : `${markdown}\n`);
}

/** Emits a workflow annotation, which shows against the run rather than in the log only. */
export function annotate(level: 'error' | 'warning', message: string): void {
  // A newline would end the command, so fold the message onto one line
  console.log(`::${level}::${message.replace(/\r?\n/g, ' ')}`);
}
