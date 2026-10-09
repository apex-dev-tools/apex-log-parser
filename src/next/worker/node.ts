/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { yieldToNode } from '../api/hosts.js';
import type { LogWorker } from '../api/worker.js';
import { nodeEngine } from '../engine/node.js';
import { serve } from './serve.js';

// `src` imports no `node:*`, so the port comes through the global `process`, as on Node 20.16+.
declare const process: {
  getBuiltinModule?(id: 'node:worker_threads'): { parentPort: LogWorker | null };
};

const port = process.getBuiltinModule?.('node:worker_threads').parentPort;
if (!port) throw new Error('Start this file as a worker_threads Worker, on Node 20.16 or later');
serve(port, nodeEngine, yieldToNode);
