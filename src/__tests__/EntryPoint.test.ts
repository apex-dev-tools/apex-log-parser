/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { parse } from '../index.js';

const CODE_UNIT =
  '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|01p|MyClass.myTrigger\n' +
  '09:18:22.6 (800)|CODE_UNIT_FINISHED|MyClass.myTrigger\n';

describe('ApexLog.entryPoint', () => {
  it('finds the first code unit under EXECUTION_STARTED', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        CODE_UNIT +
        '09:18:22.6 (810)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Second.unit\n' +
        '09:18:22.6 (820)|CODE_UNIT_FINISHED|Second.unit\n' +
        '09:18:22.6 (900)|EXECUTION_FINISHED\n',
    );
    expect(apexLog.entryPoint?.text).toBe('MyClass.myTrigger');
  });

  it('finds a code unit that sits directly on the root', () => {
    const apexLog = parse('09:18:22.6 (100)|DUMMY\n' + CODE_UNIT);
    expect(apexLog.entryPoint?.text).toBe('MyClass.myTrigger');
  });

  it('is null when the log states no code unit', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|HEAP_ALLOCATE|[84]|Bytes:152\n' +
        '09:18:22.6 (900)|EXECUTION_FINISHED\n',
    );
    expect(apexLog.entryPoint).toBeNull();
  });
});
