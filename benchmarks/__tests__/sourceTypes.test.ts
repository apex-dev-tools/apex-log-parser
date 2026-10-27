import type { Blob } from 'node:buffer';
import type { Readable } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import type { LogAbortSignal, LogSource } from '../../src/node.js';

// `src` has no node types, so this folder checks that Node's own sources fit `parse`, as
// `src/__tests__/dom/` does for the DOM. `@types/node` drifts apart from lib.dom.
describe('LogSource', () => {
  it('takes the objects Node gives a caller, with no cast', () => {
    expectTypeOf<Response>().toMatchTypeOf<LogSource>();
    expectTypeOf<ReadableStream<Uint8Array>>().toMatchTypeOf<LogSource>();
    expectTypeOf<Blob>().toMatchTypeOf<LogSource>();
    expectTypeOf<Buffer>().toMatchTypeOf<LogSource>();
    expectTypeOf<Readable>().toMatchTypeOf<LogSource>();
    expectTypeOf<AbortSignal>().toMatchTypeOf<LogAbortSignal>();
  });
});
