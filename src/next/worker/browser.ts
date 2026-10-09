/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { yieldToBrowser } from '../api/hosts.js';
import type { LogWorker } from '../api/worker.js';
import { browserEngine } from '../engine/browser.js';
import { serve } from './serve.js';

// The worker's global scope, which posts to and listens to the thread that started it.
declare const self: LogWorker;

serve(self, browserEngine, yieldToBrowser);
