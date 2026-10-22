import type { LogEngine } from '../../src/engine/engine.js';

/**
 * The engine of the build `name` states: `node`, the default, or `browser`. Imported on demand, so
 * a process holds one build, as in production: each engine keeps an idle builder over its source.
 */
export async function engineNamed(name: string | null): Promise<LogEngine> {
  if (name === null || name === 'node')
    return (await import('../../src/engine/node.js')).nodeEngine;
  if (name === 'browser') return (await import('../../src/engine/browser.js')).browserEngine;
  throw new Error(`No engine is named ${name}. Use node or browser.`);
}
