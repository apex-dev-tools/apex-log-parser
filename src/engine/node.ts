/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { NodeSource } from '../bytes/node.js';
import { LogEngine } from './engine.js';

/** The node build's engine. */
export const nodeEngine: LogEngine = new LogEngine((bytes) => new NodeSource(bytes));
