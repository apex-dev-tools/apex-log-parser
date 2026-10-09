/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '../views/log.js';
import { parse } from './helpers.js';

/** Each event as `text [namespace]`, indented by depth. No namespace, v0's `default`, is null. */
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
    expect(parsed.namespaces).toEqual(['MyNS', 'MyNs']);
    expect(outline(parsed)).toEqual([
      'MyNS.MyTrigger on MyObject trigger event BeforeInsert [MyNS]',
      'EventService:MyNS__MyObject [MyNS]',
      'VF: /apex/MyNs__MyObject [MyNs]',
      'MyNs.VFRemote: MyNs.MyController invoke(save) [MyNs]',
      'apex://MyNs.MyLightningController/ACTION$load [MyNs]',
      'MyNs.MyLightningController.load(MyNs.MyLightningController.Config) [MyNs]',
      'MyNs.MyLightningController [MyNs]',
      'DuplicateDetector [null]',
      'Flow:01I000000000AAA [null]',
      'Workflow:01I000000000AAA [null]',
      'Validation:MyObject:a00000000000AAA [null]',
      'MyTrigger on MyObject trigger event BeforeInsert [null]',
      'EventService:MyObject [null]',
      'VF: /apex/MyObject [null]',
      'apex://MyLightningController/ACTION$load [null]',
      'VFRemote: MyController invoke(save) [null]',
      'MyLightningController.load(MyLightningController.Config) [null]',
      'MyLightningController [null]',
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
      '07:09:40.0 (13)|METHOD_ENTRY|[1]|01p000000000AAA|ns2.StaticOuter.StaticOuter()',
      '07:09:40.0 (14)|METHOD_EXIT|[1]|ns2.StaticOuter',
      '07:09:40.0 (15)|METHOD_ENTRY|[1]|01p000000000AAA|ns2.StaticOuter.staticMethod(ns2.StaticOuter.Config)',
      '07:09:40.0 (16)|METHOD_EXIT|[1]|01p000000000AAA|ns2.StaticOuter.staticMethod(ns2.StaticOuter.Config)',
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
      '07:09:40.0 (31)|CODE_UNIT_FINISHED|execute_anonymous_apex',
      '07:09:40.0 (32)|EXECUTION_FINISHED',
    ].join('\n');
    const parsed = parse(log);
    expect(parsed.namespaces).toEqual(['ns', 'ns2']);
    expect(outline(parsed)).toEqual([
      'null [null]',
      '  execute_anonymous_apex [null]',
      '    ns.OuterClass.InnerClass() [ns]',
      '    ns.OuterClass.InnerClass.innerMethod(ns.OuterClass.Config) [ns]',
      '    ns.OuterClass.OuterClass() [ns]',
      '    ns.OuterClass() [ns]',
      '    ns.OuterClass.myMethod(ns.OuterClass.Config) [ns]',
      '    ns2.StaticOuter.StaticOuter() [ns2]',
      '    ns2.StaticOuter.staticMethod(ns2.StaticOuter.Config) [ns2]',
      '    OuterClass.InnerClass() [null]',
      '    OuterClass.InnerClass.innerMethod(OuterClass.Config) [null]',
      '    OuterClass.OuterClass() [null]',
      '    OuterClass() [null]',
      '    OuterClass.myMethod(OuterClass.Config) [null]',
      '    StaticOuter.StaticOuter() [null]',
      '    StaticOuter.staticMethod(StaticOuter.Config) [null]',
      '    Database.QueryLocatorIterator.hasNext() [null]',
    ]);
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
      'OuterClass.OuterClass() [null]',
      'OuterClass.staticMethod() [null]',
      '  Database.QueryLocatorIterator.hasNext() [null]',
      '  SELECT ID FROM MyObject__c [null]',
      '  ns.OuterClass.OuterClass() [ns]',
      '  ns.OuterClass.staticMethod() [ns]',
      '    DML Op:Insert Type:SObject [null]',
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
});
