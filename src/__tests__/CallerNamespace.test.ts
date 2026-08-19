/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { parse } from '../index.js';
import { flatten } from './helpers.js';

const PACKAGE_LOG =
  '09:18:22.6 (100)|EXECUTION_STARTED\n' +
  '09:18:22.6 (150)|ENTERING_MANAGED_PKG|ns\n' +
  '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|01q|MyTrigger on Account trigger event BeforeInsert|__sfdc_trigger/MyTrigger\n' +
  '09:18:22.6 (250)|METHOD_ENTRY|[1]|01p|ns.Outer.inner()\n' +
  '09:18:22.6 (260)|METHOD_ENTRY|[2]|01p|ns.Outer.deeper()\n' +
  '09:18:22.6 (265)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Account\n' +
  '09:18:22.6 (270)|SOQL_EXECUTE_END|[3]|Rows:1\n' +
  '09:18:22.6 (280)|METHOD_EXIT|[2]|01p|ns.Outer.deeper()\n' +
  '09:18:22.6 (300)|METHOD_EXIT|[1]|01p|ns.Outer.inner()\n' +
  '09:18:22.6 (800)|CODE_UNIT_FINISHED|MyTrigger on Account trigger event BeforeInsert\n' +
  '09:18:22.6 (900)|EXECUTION_FINISHED\n';

describe('LogEvent.callerNamespace', () => {
  it('states default on a root child', () => {
    const apexLog = parse(
      '09:18:22.6 (250)|METHOD_ENTRY|[1]|01p|Outer.inner()\n' +
        '09:18:22.6 (300)|METHOD_EXIT|[1]|01p|Outer.inner()\n',
    );

    const method = apexLog.children[0];
    expect(method?.type).toBe('METHOD_ENTRY');
    expect(method?.callerNamespace).toBe('default');
  });

  it('states the namespace of the caller, not of the event', () => {
    const events = flatten(parse(PACKAGE_LOG));

    // Called from the trigger, which is not in the package.
    const inner = events.find((event) => event.type === 'METHOD_ENTRY');
    expect(inner?.namespace).toBe('ns');
    expect(inner?.callerNamespace).toBe('default');
  });

  it('states the namespace of a managed-package frame for its children', () => {
    const events = flatten(parse(PACKAGE_LOG));
    const nested = events.filter((event) => event.type === 'METHOD_ENTRY')[1];
    const soql = events.find((event) => event.type === 'SOQL_EXECUTE_BEGIN');

    expect(nested?.callerNamespace).toBe('ns');
    expect(soql?.callerNamespace).toBe('ns');
  });

  it('states a caller namespace the parser only resolves from an exit line', () => {
    // A first class reference states no namespace on entry, so `MethodEntryLine.onEnd` corrects it
    // after the children are parsed.
    const apexLog = parse(
      '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (150)|ENTERING_MANAGED_PKG|ns\n' +
        '09:18:22.6 (200)|METHOD_ENTRY|[1]|01p|ns.Outer\n' +
        '09:18:22.6 (250)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Account\n' +
        '09:18:22.6 (260)|SOQL_EXECUTE_END|[3]|Rows:1\n' +
        '09:18:22.6 (300)|METHOD_EXIT|[1]|01p|ns.Outer\n' +
        '09:18:22.6 (900)|EXECUTION_FINISHED\n',
    );

    const events = flatten(apexLog);
    const entry = events.find((event) => event.type === 'METHOD_ENTRY');
    const soql = events.find((event) => event.type === 'SOQL_EXECUTE_BEGIN');
    expect(entry?.namespace).toBe('ns');
    expect(soql?.callerNamespace).toBe('ns');
  });
});
