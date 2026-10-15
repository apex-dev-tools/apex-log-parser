/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * The type tag, as `[object Uint8Array]`. It holds across realms, as for an array from a worker or
 * an iframe, where `instanceof` fails.
 */
export const tagOf = (value: unknown): string => Object.prototype.toString.call(value);
