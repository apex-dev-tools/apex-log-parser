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
    expect(apexLog.entryPoints).toEqual([]);
  });
});

describe('ApexLog.entryPoints', () => {
  it('lists the first code unit of each execution, in log order', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (110)|CODE_UNIT_STARTED|[EXTERNAL]|FutureHandler - state load\n' +
        '09:18:22.6 (150)|CODE_UNIT_FINISHED|FutureHandler - state load\n' +
        '09:18:22.6 (160)|EXECUTION_FINISHED\n' +
        '09:18:22.6 (200)|EXECUTION_STARTED\n' +
        CODE_UNIT +
        '09:18:22.6 (810)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Second.unit\n' +
        '09:18:22.6 (820)|CODE_UNIT_FINISHED|Second.unit\n' +
        '09:18:22.6 (900)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.entryPoints.map((unit) => unit.text)).toEqual([
      'FutureHandler - state load',
      'MyClass.myTrigger',
    ]);
    expect(apexLog.entryPoints.map((unit) => unit.duration.total)).toEqual([40, 600]);
    expect(apexLog.entryPoint).toBe(apexLog.entryPoints[0]);
  });

  it('finds an execution that follows one the log never finished', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        CODE_UNIT +
        '09:18:22.6 (810)|EXECUTION_STARTED\n' +
        '09:18:22.6 (820)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Second.unit\n' +
        '09:18:22.6 (830)|CODE_UNIT_FINISHED|Second.unit\n' +
        '09:18:22.6 (900)|EXECUTION_FINISHED\n',
    );

    expect(apexLog.entryPoints.map((unit) => unit.text)).toEqual([
      'MyClass.myTrigger',
      'Second.unit',
    ]);
  });

  it('lists every code unit that sits directly on the root', () => {
    const apexLog = parse(
      '09:18:22.6 (100)|DUMMY\n' +
        CODE_UNIT +
        '09:18:22.6 (900)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Second.unit\n' +
        '09:18:22.6 (950)|CODE_UNIT_FINISHED|Second.unit\n',
    );

    expect(apexLog.entryPoints.map((unit) => unit.text)).toEqual([
      'MyClass.myTrigger',
      'Second.unit',
    ]);
  });
});
