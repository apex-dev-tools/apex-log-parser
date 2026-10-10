/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { parse } from './helpers.js';

const CODE_UNIT =
  '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|01p|MyClass.myTrigger\n' +
  '09:18:22.6 (800)|CODE_UNIT_FINISHED|MyClass.myTrigger\n';

const texts = (text: string): (string | null)[] => parse(text).entryPoints.map((unit) => unit.text);

describe('ApexLog.entryPoints', () => {
  it('is empty when the log states no code unit', () => {
    const log = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|HEAP_ALLOCATE|[84]|Bytes:152\n' +
        '09:18:22.6 (900)|EXECUTION_FINISHED\n',
    );
    expect(log.entryPoints).toEqual([]);
  });

  it('lists every code unit directly under each execution, in log order', () => {
    const log = parse(
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
    // Typed as code units, so their details need no narrowing.
    expect(log.entryPoints.map((unit) => unit.details.codeUnitType)).toEqual([null, null, null]);
    expect(log.entryPoints.map((unit) => [unit.text, unit.duration.total])).toEqual([
      ['FutureHandler - state load', 40],
      ['MyClass.myTrigger', 600],
      ['Second.unit', 10],
    ]);
  });

  it('finds an execution that follows one the log never finished', () => {
    expect(
      texts(
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
          CODE_UNIT +
          '09:18:22.6 (810)|EXECUTION_STARTED\n' +
          '09:18:22.6 (820)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Second.unit\n' +
          '09:18:22.6 (830)|CODE_UNIT_FINISHED|Second.unit\n' +
          '09:18:22.6 (900)|EXECUTION_FINISHED\n',
      ),
    ).toEqual(['MyClass.myTrigger', 'Second.unit']);
  });

  it('lists every code unit that sits directly on the log', () => {
    expect(
      texts(
        '09:18:22.6 (100)|DUMMY\n' +
          CODE_UNIT +
          '09:18:22.6 (900)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Second.unit\n' +
          '09:18:22.6 (950)|CODE_UNIT_FINISHED|Second.unit\n',
      ),
    ).toEqual(['MyClass.myTrigger', 'Second.unit']);
  });

  it('finds an execution nested under a method the log never finished', () => {
    expect(
      texts(
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
          '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|01p|First.unit\n' +
          '09:18:22.6 (300)|METHOD_ENTRY|[1]|01p000000000AAA|MyClass.run()\n' +
          '*** Skipped 1000 bytes of detailed log\n' +
          '09:18:22.6 (400)|EXECUTION_STARTED\n' +
          '09:18:22.6 (410)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Second.unit\n' +
          '09:18:22.6 (420)|CODE_UNIT_FINISHED|Second.unit\n' +
          '09:18:22.6 (430)|EXECUTION_FINISHED\n',
      ),
    ).toEqual(['First.unit', 'Second.unit']);
  });

  it('finds an execution nested under a top-level code unit the log never finished', () => {
    expect(
      texts(
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
          CODE_UNIT +
          '09:18:22.6 (810)|EXECUTION_FINISHED\n' +
          '09:18:22.6 (820)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Orphan.unit\n' +
          '09:18:22.6 (830)|EXECUTION_STARTED\n' +
          '09:18:22.6 (840)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Third.unit\n' +
          '09:18:22.6 (850)|CODE_UNIT_FINISHED|Third.unit\n' +
          '09:18:22.6 (860)|EXECUTION_FINISHED\n',
      ),
    ).toEqual(['MyClass.myTrigger', 'Orphan.unit', 'Third.unit']);
  });

  it('keeps log order when a nested execution starts before the outer code unit', () => {
    expect(
      texts(
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
          '09:18:22.6 (300)|EXECUTION_STARTED\n' +
          '09:18:22.6 (320)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Second.unit\n' +
          '09:18:22.6 (330)|CODE_UNIT_FINISHED|Second.unit\n' +
          '09:18:22.6 (340)|EXECUTION_FINISHED\n' +
          '09:18:22.6 (400)|CODE_UNIT_STARTED|[EXTERNAL]|01p|Third.unit\n' +
          '09:18:22.6 (410)|CODE_UNIT_FINISHED|Third.unit\n',
      ),
    ).toEqual(['Second.unit', 'Third.unit']);
  });
});
