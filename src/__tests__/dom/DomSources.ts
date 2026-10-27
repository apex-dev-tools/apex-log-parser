/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
// Type test, run by `tsc -p tsconfig.dom.json`: the platform's own DOM objects are a `LogSource`
// with no cast. It fails when `LogSource` drifts from `lib.dom.d.ts`, which a hand-written mock
// cannot catch.
import type { LogAbortSignal, LogSource } from '../../api/sources.js';

declare const response: Response;
declare const stream: ReadableStream<Uint8Array>;
declare const blob: Blob;
declare const signal: AbortSignal;

response satisfies LogSource;
stream satisfies LogSource;
blob satisfies LogSource;
signal satisfies LogAbortSignal;
