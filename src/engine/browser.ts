/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { BrowserSource } from '../bytes/browser.js';
import type { LogEngine } from './engine.js';
import { SourceEngine } from './engine.js';

/** The browser build's engine. */
export const browserEngine: LogEngine = new SourceEngine((bytes) => new BrowserSource(bytes));
