/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { Source } from '../bytes/source.js';
import type { BuiltData } from './buffers.js';
import { restoreBuilt } from './buffers.js';
import type { Built } from './builder.js';
import { LogBuilder } from './builder.js';

/** One build's way in: node or browser. Each build holds one for the process. */
export interface LogEngine {
  /** The event tree of one log's bytes. */
  build(bytes: Uint8Array): Built;
  /** A builder over one log's bytes, for a caller that scans it in slices. */
  builder(bytes: Uint8Array): LogBuilder;
  /** The build `data` states, over this engine's source, as from another thread. */
  restore(data: BuiltData): Built;
}

/** The engine over one `Source` class. */
export class SourceEngine implements LogEngine {
  /**
   * Never built. V8 drops a class's object layout once no instance of it is alive, and with it the
   * code it optimised for that layout; this builder keeps every engine class alive between parses.
   * A field, so no bundler can drop it as unused.
   */
  // biome-ignore lint/correctness/noUnusedPrivateClassMembers: held, never read, as the doc says.
  private readonly idle: LogBuilder;
  private readonly sourceOf: (bytes: Uint8Array) => Source;

  constructor(sourceOf: (bytes: Uint8Array) => Source) {
    this.sourceOf = sourceOf;
    this.idle = new LogBuilder(sourceOf(new Uint8Array(0)));
  }

  build(bytes: Uint8Array): Built {
    return this.builder(bytes).build();
  }

  builder(bytes: Uint8Array): LogBuilder {
    return new LogBuilder(this.sourceOf(bytes));
  }

  restore(data: BuiltData): Built {
    return restoreBuilt(data, this.sourceOf);
  }
}
