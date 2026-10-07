/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describeFieldsContract } from './fieldsContract.js';
import { fieldsOf } from './helpers.js';

describeFieldsContract('fieldsOf', (line, continuation = '', onContinuation) =>
  fieldsOf(line, () => {
    onContinuation?.();
    return continuation;
  }),
);
