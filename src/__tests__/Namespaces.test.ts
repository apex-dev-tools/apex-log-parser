/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import { DEFAULT_NAMESPACE } from '../node.js';
import type { ApexLog } from '../views/log.js';
import { parse } from './helpers.js';

/**
 * Each event as `text [namespace]`, indented by depth. Code in no package is `default`.
 */
const outline = (log: ApexLog): string[] =>
  [...log.events].map((e) => `${'  '.repeat(e.depth - 1)}${e.text} [${e.namespace}]`);

describe('namespaces', () => {
  it('reads a code unit namespace from each form of unit', () => {
    const log =
      '01:01:01.000 (1)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000AAA|MyNS.MyTrigger on MyObject trigger event BeforeInsert|__sfdc_trigger/MyNS/MyTrigger\n' +
      '01:01:01.000 (2)|CODE_UNIT_FINISHED|MyNS.MyTrigger on MyObject trigger event BeforeInsert|__sfdc_trigger/MyNS/MyTrigger\n' +
      '01:01:01.000 (3)|CODE_UNIT_STARTED|[EXTERNAL]|EventService:MyNS__MyObject\n' +
      '01:01:01.000 (4)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (5)|CODE_UNIT_STARTED|[EXTERNAL]|066000000000AAA|VF: /apex/MyNs__MyObject\n' +
      '01:01:01.000 (6)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (7)|CODE_UNIT_STARTED|[EXTERNAL]|066000000000AAB|MyNs.VFRemote: MyNs.MyController invoke(save)\n' +
      '01:01:01.000 (8)|CODE_UNIT_FINISHED|MyNs.VFRemote: MyNs.MyController invoke(save)\n' +
      '01:01:01.000 (9)|CODE_UNIT_STARTED|[EXTERNAL]|apex://MyNs.MyLightningController/ACTION$load\n' +
      '01:01:01.000 (10)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (11)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000AAB|MyNs.MyLightningController.load(MyNs.MyLightningController.Config)\n' +
      '01:01:01.000 (12)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (13)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000AAB|MyNs.MyLightningController\n' +
      '01:01:01.000 (14)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (15)|CODE_UNIT_STARTED|[EXTERNAL]|DuplicateDetector\n' +
      '01:01:01.000 (16)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (17)|CODE_UNIT_STARTED|[EXTERNAL]|Flow:01I000000000AAA\n' +
      '01:01:01.000 (18)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (19)|CODE_UNIT_STARTED|[EXTERNAL]|Workflow:01I000000000AAA\n' +
      '01:01:01.000 (20)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (21)|CODE_UNIT_STARTED|[EXTERNAL]|Validation:MyObject:a00000000000AAA\n' +
      '01:01:01.000 (22)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (23)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000AAA|MyTrigger on MyObject trigger event BeforeInsert|__sfdc_trigger/MyTrigger\n' +
      '01:01:01.000 (24)|CODE_UNIT_FINISHED|MyTrigger on MyObject trigger event BeforeInsert|__sfdc_trigger/MyTrigger\n' +
      '01:01:01.000 (23)|CODE_UNIT_STARTED|[EXTERNAL]|EventService:MyObject\n' +
      '01:01:01.000 (24)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (25)|CODE_UNIT_STARTED|[EXTERNAL]|066000000000AAA|VF: /apex/MyObject\n' +
      '01:01:01.000 (26)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (27)|CODE_UNIT_STARTED|[EXTERNAL]|apex://MyLightningController/ACTION$load\n' +
      '01:01:01.000 (28)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (29)|CODE_UNIT_STARTED|[EXTERNAL]|066000000000AAB|VFRemote: MyController invoke(save)\n' +
      '01:01:01.000 (30)|CODE_UNIT_FINISHED|VFRemote: MyController invoke(save)\n' +
      '01:01:01.000 (31)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000AAB|MyLightningController.load(MyLightningController.Config)\n' +
      '01:01:01.000 (32)|CODE_UNIT_FINISHED\n' +
      '01:01:01.000 (33)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000AAB|MyLightningController\n' +
      '01:01:01.000 (34)|CODE_UNIT_FINISHED\n';
    const parsed = parse(log);
    expect(parsed.namespaces).toEqual(['MyNS', 'MyNs', 'default']);
    expect(outline(parsed)).toEqual([
      'MyNS.MyTrigger on MyObject trigger event BeforeInsert [MyNS]',
      'EventService:MyNS__MyObject [MyNS]',
      'VF: /apex/MyNs__MyObject [MyNs]',
      'MyNs.VFRemote: MyNs.MyController invoke(save) [MyNs]',
      'apex://MyNs.MyLightningController/ACTION$load [MyNs]',
      'MyNs.MyLightningController.load(MyNs.MyLightningController.Config) [MyNs]',
      'MyNs.MyLightningController [MyNs]',
      'DuplicateDetector [default]',
      'Flow:01I000000000AAA [default]',
      'Workflow:01I000000000AAA [default]',
      'Validation:MyObject:a00000000000AAA [default]',
      'MyTrigger on MyObject trigger event BeforeInsert [default]',
      'EventService:MyObject [default]',
      'VF: /apex/MyObject [default]',
      'apex://MyLightningController/ACTION$load [default]',
      'VFRemote: MyController invoke(save) [default]',
      'MyLightningController.load(MyLightningController.Config) [default]',
      'MyLightningController [default]',
    ]);
  });

  it('reads method and constructor namespaces, and a class first used through its exit', () => {
    const log = [
      '07:09:40.0 (1)|EXECUTION_STARTED',
      '07:09:40.0 (2)|CODE_UNIT_STARTED|[EXTERNAL]|execute_anonymous_apex',
      '07:09:40.0 (3)|CONSTRUCTOR_ENTRY|[1]|01p000000000AAA|<init>()|ns.OuterClass.InnerClass',
      '07:09:40.0 (4)|CONSTRUCTOR_EXIT|[1]|01p000000000AAA|<init>()|ns.OuterClass.InnerClass',
      '07:09:40.0 (5)|METHOD_ENTRY|[1]|01p000000000AAA|ns.OuterClass.InnerClass.innerMethod(ns.OuterClass.Config)',
      '07:09:40.0 (6)|METHOD_EXIT|[1]|01p000000000AAA|ns.OuterClass.InnerClass.innerMethod(ns.OuterClass.Config)',
      '07:09:40.0 (7)|METHOD_ENTRY|[1]|01p000000000AAA|ns.OuterClass.OuterClass()',
      '07:09:40.0 (8)|METHOD_EXIT|[1]|ns.OuterClass',
      '07:09:40.0 (9)|CONSTRUCTOR_ENTRY|[1]|01p000000000AAA|<init>()|ns.OuterClass',
      '07:09:40.0 (10)|CONSTRUCTOR_EXIT|[1]|01p000000000AAA|<init>()|ns.OuterClass',
      '07:09:40.0 (11)|METHOD_ENTRY|[1]|01p000000000AAA|ns.OuterClass.myMethod(ns.OuterClass.Config)',
      '07:09:40.0 (12)|METHOD_EXIT|[1]|01p000000000AAA|ns.OuterClass.myMethod(ns.OuterClass.Config)',
      '07:09:40.0 (12)|METHOD_ENTRY|[1]|01p000000000AAA|ns3.Other.Other()',
      '07:09:40.0 (12)|METHOD_EXIT|[1]|ns3.Other',
      '07:09:40.0 (13)|METHOD_ENTRY|[1]|01p000000000AAA|ns2.StaticOuter.StaticOuter()',
      '07:09:40.0 (14)|METHOD_EXIT|[1]|ns2.StaticOuter',
      '07:09:40.0 (15)|METHOD_ENTRY|[1]|01p000000000AAA|ns2.StaticOuter.staticMethod(ns2.StaticOuter.Config)',
      '07:09:40.0 (16)|METHOD_EXIT|[1]|01p000000000AAA|ns2.StaticOuter.staticMethod(ns2.StaticOuter.Config)',
      // The same length as ns2, which the line before left as the last stated prefix.
      '07:09:40.0 (16)|METHOD_ENTRY|[1]|01p000000000AAA|ns3.Other.run()',
      '07:09:40.0 (16)|METHOD_EXIT|[1]|01p000000000AAA|ns3.Other.run()',
      '07:09:40.0 (17)|CONSTRUCTOR_ENTRY|[1]|01p000000000AAA|<init>()|OuterClass.InnerClass',
      '07:09:40.0 (18)|CONSTRUCTOR_EXIT|[1]|01p000000000AAA|<init>()|OuterClass.InnerClass',
      '07:09:40.0 (19)|METHOD_ENTRY|[1]|01p000000000AAA|OuterClass.InnerClass.innerMethod(OuterClass.Config)',
      '07:09:40.0 (20)|METHOD_EXIT|[1]|01p000000000AAA|OuterClass.InnerClass.innerMethod(OuterClass.Config)',
      '07:09:40.0 (21)|METHOD_ENTRY|[1]|01p000000000AAA|OuterClass.OuterClass()',
      '07:09:40.0 (22)|METHOD_EXIT|[1]|OuterClass',
      '07:09:40.0 (23)|CONSTRUCTOR_ENTRY|[1]|01p000000000AAA|<init>()|OuterClass',
      '07:09:40.0 (24)|CONSTRUCTOR_EXIT|[1]|01p000000000AAA|<init>()|OuterClass',
      '07:09:40.0 (25)|METHOD_ENTRY|[1]|01p000000000AAA|OuterClass.myMethod(OuterClass.Config)',
      '07:09:40.0 (26)|METHOD_EXIT|[1]|01p000000000AAA|OuterClass.myMethod(OuterClass.Config)',
      '07:09:40.0 (27)|METHOD_ENTRY|[1]|01p000000000AAA|StaticOuter.StaticOuter()',
      '07:09:40.0 (28)|METHOD_EXIT|[1]|StaticOuter',
      '07:09:40.0 (29)|METHOD_ENTRY|[1]|01p000000000AAA|StaticOuter.staticMethod(StaticOuter.Config)',
      '07:09:40.0 (30)|METHOD_EXIT|[1]|01p000000000AAA|StaticOuter.staticMethod(StaticOuter.Config)',
      '07:09:40.0 (30)|METHOD_ENTRY|[169]||Database.QueryLocatorIterator.hasNext()',
      '07:09:40.0 (31)|METHOD_EXIT|[169]||Database.QueryLocatorIterator.hasNext()',
      // The '(' is in the next field, so the signature states no namespace.
      '07:09:40.0 (31)|METHOD_ENTRY|[1]|01p000000000AAA|ns.OuterClass|run()',
      '07:09:40.0 (31)|CODE_UNIT_FINISHED|execute_anonymous_apex',
      '07:09:40.0 (32)|EXECUTION_FINISHED',
    ].join('\n');
    const parsed = parse(log);
    expect(parsed.namespaces).toEqual(['default', 'ns', 'ns3', 'ns2']);
    expect(outline(parsed)).toEqual([
      'null [default]',
      '  execute_anonymous_apex [default]',
      '    ns.OuterClass.InnerClass() [ns]',
      '    ns.OuterClass.InnerClass.innerMethod(ns.OuterClass.Config) [ns]',
      '    ns.OuterClass.OuterClass() [ns]',
      '    ns.OuterClass() [ns]',
      '    ns.OuterClass.myMethod(ns.OuterClass.Config) [ns]',
      '    ns3.Other.Other() [ns3]',
      '    ns2.StaticOuter.StaticOuter() [ns2]',
      '    ns2.StaticOuter.staticMethod(ns2.StaticOuter.Config) [ns2]',
      '    ns3.Other.run() [ns3]',
      '    OuterClass.InnerClass() [default]',
      '    OuterClass.InnerClass.innerMethod(OuterClass.Config) [default]',
      '    OuterClass.OuterClass() [default]',
      '    OuterClass() [default]',
      '    OuterClass.myMethod(OuterClass.Config) [default]',
      '    StaticOuter.StaticOuter() [default]',
      '    StaticOuter.staticMethod(StaticOuter.Config) [default]',
      '    Database.QueryLocatorIterator.hasNext() [default]',
      '    ns.OuterClass [default]',
    ]);
  });

  // Each pad starts the signature in another byte of a 4-byte word. `nsF`, the
  // frame's namespace, is a signature that states none.
  it.each([
    ['nsA.C.D.m(x.y)', 'nsA'],
    ['C.m(x.y)', 'default'],
    ['C.D.m(x.y)', 'nsF'],
    ['nsB.C|m()', 'nsF'],
    ['m(nsC.X)', 'nsF'],
    ['a(b', 'nsF'],
    ['a.(', 'default'],
  ])('reads %j as %j, from each byte of a word', (signature, namespace) => {
    const namespaces = ['1', '12', '123', '1234'].map((pad) => {
      const log = parse(
        [
          '07:09:40.0 (1)|EXECUTION_STARTED',
          '07:09:40.0 (2)|METHOD_ENTRY|[1]|01p000000000AAA|nsF.Outer.Inner.run()',
          `07:09:40.0 (3)|METHOD_ENTRY|[${pad}]|01p000000000AAA|${signature}`,
        ].join('\n'),
      );
      return [...log.events].at(-1)?.namespace;
    });
    expect(namespaces).toEqual(Array(4).fill(namespace));
  });

  it('passes a frame its namespace down, through a DML and the trigger it starts', () => {
    const log1 = [
      '16:09:42.2 (0)|METHOD_ENTRY|[1]|01p000000000AAA|OuterClass.OuterClass()',
      '16:09:42.2 (1)|METHOD_EXIT|[1]|OuterClass',
      '16:09:42.2 (1)|METHOD_ENTRY|[5]|01p000000000AAC|OuterClass.staticMethod()',
      '16:09:42.2 (1)|METHOD_ENTRY|[169]||Database.QueryLocatorIterator.hasNext()',
      '16:09:42.2 (1)|METHOD_EXIT|[169]||Database.QueryLocatorIterator.hasNext()',
      '16:09:42.2 (1)|SOQL_EXECUTE_BEGIN|[64]|Aggregations:0|SELECT ID FROM MyObject__c',
      '16:09:42.2 (1)|SOQL_EXECUTE_END|[64]|Rows:1',
      '16:09:42.2 (1)|METHOD_ENTRY|[1]|01p000000000AAA|ns.OuterClass.OuterClass()',
      '16:09:42.2 (1)|METHOD_EXIT|[1]|ns.OuterClass',
      '16:09:42.2 (2)|METHOD_ENTRY|[5]|01p000000000AAC|ns.OuterClass.staticMethod()',
      '16:09:42.2 (3)|DML_BEGIN|[180]|Op:Insert|Type:SObject|Rows:2',
      '16:09:42.2 (4)|CODE_UNIT_STARTED|[EXTERNAL]|01q000000000AAB|ns.MyObjectTrigger on MyObject trigger event BeforeUpdate|__sfdc_trigger/ns/MyObjectTrigger',
      '16:09:42.2 (5)|METHOD_ENTRY|[5]|01p000000000AAC|ns.OuterClass.OuterClass()',
      '16:09:42.2 (6)|CONSTRUCTOR_ENTRY|[14]|01p000000000AAC|<init>()|ns.OuterClass',
      '16:09:42.2 (7)|CONSTRUCTOR_EXIT|[14]|01p000000000AAC|<init>()|ns.OuterClass',
      '16:09:42.2 (8)|METHOD_EXIT|[5]|ns.OuterClass',
      '16:09:42.2 (9)|METHOD_ENTRY|[288]||System.Type.forName(String)',
      '16:09:42.2 (10)|METHOD_EXIT|[288]||System.Type.forName(String)',
      '16:09:42.2 (11)|METHOD_ENTRY|[288]|1|ns.Class1.method1()',
      '16:09:42.2 (12)|METHOD_ENTRY|[288]|1|ns.Class1.method2()',
      '16:09:42.2 (12)|METHOD_ENTRY|[169]||Database.QueryLocatorIterator.hasNext()',
      '16:09:42.2 (13)|METHOD_EXIT|[169]||Database.QueryLocatorIterator.hasNext()',
      '16:09:42.2 (13)|SOQL_EXECUTE_BEGIN|[64]|Aggregations:0|SELECT ID FROM MyObject__c',
      '16:09:42.2 (14)|SOQL_EXECUTE_END|[64]|Rows:1',
      '16:09:42.2 (15)|METHOD_EXIT|[288]|1|ns.Class1.method2()',
      '16:09:42.2 (16)|METHOD_EXIT|[288]|1|ns.Class1.method1()',
      '16:09:42.2 (17)|CODE_UNIT_FINISHED|ns.MyObjectTrigger on MyObject trigger event BeforeUpdate|__sfdc_trigger/ns/MyObjectTrigger',
      '16:09:42.2 (18)|DML_END|[180]',
      '16:09:42.2 (19)|METHOD_EXIT|[5]|01p000000000AAC|ns.OuterClass.staticMethod()',
      '16:09:42.2 (20)|METHOD_EXIT|[5]|01p000000000AAC|OuterClass.staticMethod()',
    ].join('\n');
    expect(outline(parse(log1))).toEqual([
      'OuterClass.OuterClass() [default]',
      'OuterClass.staticMethod() [default]',
      '  Database.QueryLocatorIterator.hasNext() [default]',
      '  SELECT ID FROM MyObject__c [default]',
      '  ns.OuterClass.OuterClass() [ns]',
      '  ns.OuterClass.staticMethod() [ns]',
      '    DML Op:Insert Type:SObject [default]',
      '      ns.MyObjectTrigger on MyObject trigger event BeforeUpdate [ns]',
      '        ns.OuterClass.OuterClass() [ns]',
      '          ns.OuterClass() [ns]',
      '        System.Type.forName(String) [ns]',
      '        ns.Class1.method1() [ns]',
      '          ns.Class1.method2() [ns]',
      '            Database.QueryLocatorIterator.hasNext() [ns]',
      '            SELECT ID FROM MyObject__c [ns]',
    ]);
  });

  // Catches the list missing 'default' when no event states it, as in a log cut before its start.
  it('lists the default namespace when only a top-level event that states none is in it', () => {
    const log = parse(
      [
        '09:00:00.0 (1)|STATEMENT_EXECUTE|[1]',
        '09:00:00.0 (2)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000AAA|ns.MyClass.run()',
        '09:00:00.0 (3)|CODE_UNIT_FINISHED|ns.MyClass.run()',
      ].join('\n'),
    );
    expect(log.namespaces).toEqual([DEFAULT_NAMESPACE, 'ns']);
  });

  // Catches listing the default making a `default.` prefix read as stated, which only a line can do.
  it('reads a default. prefix by its frame after a top-level event lists the default', () => {
    const log = parse(
      [
        '09:00:00.0 (1)|STATEMENT_EXECUTE|[1]',
        '09:00:00.0 (2)|METHOD_ENTRY|[2]|01p000000000AAA|nsF.Outer.Inner.run()',
        '09:00:00.0 (3)|METHOD_ENTRY|[3]|01p000000000AAA|default.C.m()',
      ].join('\n'),
    );
    expect([...log.events].at(-1)?.namespace).toBe('nsF');
  });

  // Catches the children keeping the caller's namespace after the exit line corrects the frame's.
  it('passes a namespace the exit line states down to the rows that took the frame its', () => {
    const log = [
      '07:09:40.0 (1)|EXECUTION_STARTED',
      '07:09:40.0 (2)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000AAA|ns.MyClass.run()',
      // A class's first use: the entry states no namespace, the exit states ns2.
      '07:09:40.0 (3)|METHOD_ENTRY|[1]|01p000000000AAA|ns2.Other.Other()',
      '07:09:40.0 (4)|SOQL_EXECUTE_BEGIN|[5]|Aggregations:0|SELECT Id FROM Account',
      '07:09:40.0 (5)|SOQL_EXECUTE_END|[5]|Rows:1',
      '07:09:40.0 (6)|METHOD_ENTRY|[7]|01p000000000AAA|Outer.Inner.m()',
      '07:09:40.0 (7)|SOQL_EXECUTE_BEGIN|[8]|Aggregations:0|SELECT Id FROM Contact',
      '07:09:40.0 (8)|SOQL_EXECUTE_END|[8]|Rows:1',
      '07:09:40.0 (9)|METHOD_EXIT|[7]|01p000000000AAA|Outer.Inner.m()',
      '07:09:40.0 (10)|METHOD_ENTRY|[9]|01p000000000AAA|ns.MyClass.helper()',
      '07:09:40.0 (11)|METHOD_EXIT|[9]|01p000000000AAA|ns.MyClass.helper()',
      '07:09:40.0 (12)|METHOD_EXIT|[1]|ns2.Other',
      '07:09:40.0 (13)|CODE_UNIT_FINISHED|ns.MyClass.run()',
      '07:09:40.0 (14)|EXECUTION_FINISHED',
    ].join('\n');
    expect(outline(parse(log))).toEqual([
      'null [default]',
      '  ns.MyClass.run() [ns]',
      '    ns2.Other.Other() [ns2]',
      '      SELECT Id FROM Account [ns2]',
      '      Outer.Inner.m() [ns2]',
      '        SELECT Id FROM Contact [ns2]',
      // States its own namespace, so the exit leaves it.
      '      ns.MyClass.helper() [ns]',
    ]);
  });

  // Catches an exit that unwinds frames giving its namespace to them and the rows under them.
  it('gives the namespace an exit line states only to the frame it closes, not the frames it unwinds', () => {
    const log = [
      '09:00:00.0 (1)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000AAA|ns.MyClass.run()',
      '09:00:00.0 (2)|METHOD_ENTRY|[5]|01p000000000AAA|C.D.p()',
      '09:00:00.0 (3)|METHOD_ENTRY|[8]|01p000000000AAA|nsq.C.D.q()',
      '09:00:00.0 (4)|STATEMENT_EXECUTE|[9]',
      // Closes C.D.p(), and unwinds nsq.C.D.q(), which lost its own exit.
      '09:00:00.0 (5)|METHOD_EXIT|[5]|other.Thing',
    ].join('\n');
    expect(outline(parse(log))).toEqual([
      'ns.MyClass.run() [ns]',
      '  C.D.p() [other]',
      '    nsq.C.D.q() [nsq]',
      '      null [nsq]',
    ]);
  });

  // Catches an outer correction overwriting an inner frame its own exit line corrected.
  it('keeps the namespace a nested first use states when the frame around it is corrected', () => {
    const log = [
      '09:00:00.0 (1)|CODE_UNIT_STARTED|[EXTERNAL]|01p000000000AAA|ns.MyClass.run()',
      // pk1's static init is the first use of pk2: neither entry states its namespace.
      '09:00:00.0 (2)|METHOD_ENTRY|[1]|01p000000000AAA|pk1.Init.Init()',
      '09:00:00.0 (3)|METHOD_ENTRY|[2]|01p000000000AAA|pk2.Init.Init()',
      '09:00:00.0 (4)|SOQL_EXECUTE_BEGIN|[3]|Aggregations:0|SELECT Id FROM Account',
      '09:00:00.0 (5)|SOQL_EXECUTE_END|[3]|Rows:1',
      '09:00:00.0 (6)|METHOD_EXIT|[2]|pk2.Init',
      '09:00:00.0 (7)|METHOD_EXIT|[1]|pk1.Init',
      '09:00:00.0 (8)|CODE_UNIT_FINISHED|ns.MyClass.run()',
    ].join('\n');
    expect(outline(parse(log))).toEqual([
      'ns.MyClass.run() [ns]',
      '  pk1.Init.Init() [pk1]',
      '    pk2.Init.Init() [pk2]',
      '      SELECT Id FROM Account [pk2]',
    ]);
  });
});
