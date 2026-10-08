/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { NodeSource } from './bytes/node.js';
import type { LogEngine } from './engine/engine.js';
import { SourceEngine } from './engine/engine.js';

/** The node build's engine. */
export const nodeEngine: LogEngine = new SourceEngine((bytes) => new NodeSource(bytes));
