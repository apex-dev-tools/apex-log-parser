/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { BrowserSource } from '../bytes/browser.js';
import { LogEngine } from './engine.js';

/** The browser build's engine. */
export const browserEngine: LogEngine = new LogEngine((bytes) => new BrowserSource(bytes));
