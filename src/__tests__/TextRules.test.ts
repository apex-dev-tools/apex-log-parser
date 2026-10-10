/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { parse } from './helpers.js';

describe('FLOW_ELEMENT_ERROR', () => {
  it('keeps the error message only', () => {
    const log = parse(
      '09:18:22.6 (100)|FLOW_ELEMENT_ERROR|Required fields are missing: [Name]|FlowRecordCreate|Create_Account\n',
    );

    expect(log.children[0]?.text).toBe('Required fields are missing: [Name]');
  });

  it('keeps the whole message when it spans lines', () => {
    const log = parse(
      '09:18:22.6 (100)|FLOW_ELEMENT_ERROR|You have reached the limit.\n' +
        'Actions will start again in the next hour.\n' +
        '|FlowActionCall|myRule_1_A1\n' +
        '09:18:22.6 (200)|FLOW_ELEMENT_END|myRule_1_A1|FlowActionCall|myRule_1_A1\n',
    );

    expect(log.children[0]?.text).toBe(
      'You have reached the limit.\nActions will start again in the next hour.',
    );
  });

  it('keeps a | in the message', () => {
    const log = parse(
      '09:18:22.6 (100)|FLOW_ELEMENT_ERROR|Bad value: a|b|FlowDecision|Check_Status\n',
    );

    expect(log.children[0]?.text).toBe('Bad value: a|b');
  });

  it('keeps a message that states no element', () => {
    const log = parse(
      '09:18:22.6 (100)|FLOW_ELEMENT_ERROR|An error occurred.\n' + ' --- An Apex error occurred\n',
    );

    expect(log.children[0]?.text).toBe('An error occurred.\n --- An Apex error occurred');
  });

  it('states no text when the message is empty', () => {
    const log = parse('09:18:22.6 (100)|FLOW_ELEMENT_ERROR||FlowDecision|Check_Status\n');

    expect(log.children[0]?.text).toBeNull();
  });
});

describe('events with fields after a message that spans lines', () => {
  it('reads the values of a WF_FORMULA whose formula spans lines', () => {
    const log = parse(
      '09:18:22.6 (100)|WF_FORMULA|Formula:AND(\nISBLANK(Name))|Values:Name=null\n' +
        '09:18:22.6 (200)|WF_FORMULA|Formula:ISBLANK(Name)|Values:Name=null\n',
    );

    expect([...log.events].map((event) => event.text)).toEqual([
      'Formula:AND(\nISBLANK(Name)) : Values:Name=null',
      'Formula:ISBLANK(Name) : Values:Name=null',
    ]);
  });

  it('keeps a WF_FORMULA "||" operator and a "|" in a value in place', () => {
    const log = parse(
      '09:18:22.6 (100)|WF_FORMULA|Formula:ISBLANK(Name) || ISBLANK(Phone)|Values:Desc=a|b\n',
    );

    expect(log.children[0]?.text).toBe('Formula:ISBLANK(Name) || ISBLANK(Phone) : Values:Desc=a|b');
  });

  it('reads the values of a VALIDATION_FORMULA whose formula spans lines', () => {
    const log = parse(
      '09:18:22.6 (100)|VALIDATION_FORMULA|AND(\nISBLANK(Name))|Name=null\n' +
        '09:18:22.6 (200)|VALIDATION_FORMULA|ISBLANK(Name)|Name=null\n',
    );

    expect([...log.events].map((event) => event.text)).toEqual([
      'AND(\nISBLANK(Name)) Name=null',
      'ISBLANK(Name) Name=null',
    ]);
  });

  it('reads the flow name of a FLOW_START_INTERVIEWS_ERROR whose message spans lines', () => {
    const log = parse(
      '09:18:22.6 (100)|FLOW_START_INTERVIEWS_ERROR|An error occurred.\nTry again.|3b2a1|My_Flow\n',
    );

    expect(log.children[0]?.text).toBe('An error occurred.\nTry again. - My_Flow');
  });

  it('reads the flow name of a single-line FLOW_START_INTERVIEWS_ERROR', () => {
    const log = parse(
      '09:18:22.6 (100)|FLOW_START_INTERVIEWS_ERROR|An error occurred.|3b2a1|My_Flow\n',
    );

    expect(log.children[0]?.text).toBe('An error occurred. - My_Flow');
  });

  it('keeps the raw text when more text follows the trailing fields', () => {
    const log = parse(
      '09:18:22.6 (100)|FLOW_ELEMENT_ERROR|msg\n|FlowActionCall|myRule_1_A1\nmore text\n',
    );

    expect(log.children[0]?.text).toBe('msg\n|FlowActionCall|myRule_1_A1\nmore text');
  });
});

describe('event text without the event name', () => {
  it('shows only the message of WF_FLOW_ACTION_ERROR and its detail', () => {
    const log = parse(
      '09:18:22.6 (100)|WF_FLOW_ACTION_ERROR|09L000000000AAA|300000000000AAA|Error executing flow: My_Flow\n' +
        '09:18:22.6 (200)|WF_FLOW_ACTION_ERROR_DETAIL|The flow tried to update records.\n',
    );

    expect([...log.events].map((event) => event.text)).toEqual([
      'Error executing flow: My_Flow',
      'The flow tried to update records.',
    ]);
  });

  it('shows the evaluation mode and rule of WF_CRITERIA_BEGIN', () => {
    const log = parse(
      '09:18:22.6 (100)|WF_CRITERIA_BEGIN|[Account: Acme 001000000000AAA]|My_Rule|01Q000000000AAA|ON_ALL_CHANGES|0\n' +
        '09:18:22.6 (200)|WF_CRITERIA_END|false\n',
    );

    expect(log.children[0]?.text).toBe('ON_ALL_CHANGES : My_Rule');
  });

  it('states no text for a FLOW_START_INTERVIEWS_BEGIN with no interview', () => {
    const log = parse(
      '09:18:22.6 (100)|FLOW_START_INTERVIEWS_BEGIN|1\n' +
        '09:18:22.6 (200)|FLOW_START_INTERVIEWS_END|1\n',
    );

    expect(log.children[0]?.text).toBeNull();
  });

  it('skips the flow version ID the docs state for WF_FLOW_ACTION_ERROR', () => {
    const log = parse(
      '09:18:22.6 (100)|WF_FLOW_ACTION_ERROR|09L000000000AAA|300000000000AAA|301000000000AAA|Error executing flow\n',
    );

    expect(log.children[0]?.text).toBe('Error executing flow');
  });

  it('keeps a "|" in a WF_FLOW_ACTION_ERROR_DETAIL message', () => {
    const log = parse(
      '09:18:22.6 (100)|WF_FLOW_ACTION_ERROR_DETAIL|Field A | Field B are required\n',
    );

    expect(log.children[0]?.text).toBe('Field A | Field B are required');
  });

  it('shows only the rule of a WF_CRITERIA_BEGIN that states no trigger type', () => {
    const log = parse(
      '09:18:22.6 (100)|WF_CRITERIA_BEGIN|[Account: Acme 001000000000AAA]|My_Rule|01Q000000000AAA\n' +
        '09:18:22.6 (200)|WF_CRITERIA_END|false\n',
    );

    expect(log.children[0]?.text).toBe('My_Rule');
  });
});
