import type { Worker } from 'node:worker_threads';
import type { LogWorker } from '../../src/next/node.js';

// `src` has no node types, so this folder checks that Node's own Worker fits the worker option.
// The check is in the types: `pnpm run ci`'s scripts typecheck fails when the two drift apart.
describe('LogWorker', () => {
  it('takes a Node worker_threads Worker', () => {
    expectTypeOf<Worker>().toMatchTypeOf<LogWorker>();
  });
});
