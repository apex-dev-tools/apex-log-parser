/**
 * Runs a TypeScript script in a fresh Node process and reads its last line of output as JSON. The
 * harnesses use it so each measurement starts with a clean heap and no JIT state.
 */

import { spawnSync } from 'node:child_process';
import { execPath } from 'node:process';

/**
 * `nodeFlags` go before the script, `args` after it. Throws with the end of the child's stderr when
 * it exits non-zero.
 */
export function runJsonChild(
  script: string,
  args: readonly string[],
  nodeFlags: readonly string[] = [],
): unknown {
  const child = spawnSync(execPath, [...nodeFlags, '--import', 'tsx', script, ...args], {
    encoding: 'utf-8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (child.status !== 0) {
    throw new Error(child.stderr.trim().split('\n').slice(-3).join(' ') || `exit ${child.status}`);
  }
  return JSON.parse(child.stdout.trim().split('\n').at(-1) ?? 'null');
}
