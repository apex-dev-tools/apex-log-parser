/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * What each event type's line holds, field by field, and what Salesforce says the type logs.
 *
 * Every line is `<time>|<TYPE>|<field 2>|<field 3>|…`, split on `|`. `fields` describes field 2
 * on; `FieldInfo` in `types.ts` defines each key. `observed` is true when real logs confirmed the
 * layout; otherwise it follows the Salesforce documentation. `description` is the documentation's
 * own text, which `Catalog.test.ts` keeps in step with the event database.
 */
export const EVENT_LINES = {
  ADD_SCREEN_POP_ACTION: {
    description: null,
    observed: false,
    fields: [],
  },
  ADD_SKILL_REQUIREMENT_ACTION: {
    description: null,
    observed: false,
    fields: [],
  },
  AE_PERSIST_VALIDATION: {
    description: null,
    observed: false,
    fields: [],
  },
  APP_ANALYTICS_ERROR: {
    description: null,
    observed: false,
    fields: [],
  },
  APP_ANALYTICS_FINE: {
    description: null,
    observed: false,
    fields: [],
  },
  APP_ANALYTICS_WARN: {
    description: null,
    observed: false,
    fields: [],
  },
  APP_CONTAINER_INITIATED: {
    description: null,
    observed: false,
    fields: [],
  },
  ASSET_DIFF_DETAIL: {
    description: null,
    observed: false,
    fields: [{ name: 'diffDetail', format: '<text>', description: 'Diff detail.' }],
  },
  ASSET_DIFF_SUMMARY: {
    description: null,
    observed: false,
    fields: [{ name: 'diffSummary', format: '<text>', description: 'Diff summary.' }],
  },
  BULK_COUNTABLE_STATEMENT_EXECUTE: {
    description: null,
    observed: false,
    fields: [
      {
        name: 'bulkStatementExecution',
        format: '<text>',
        description: 'Bulk statement execution count.',
      },
    ],
  },
  BULK_DML_RETRY: {
    description: null,
    observed: false,
    fields: [],
  },
  BULK_HEAP_ALLOCATE: {
    description: 'Number of bytes allocated',
    observed: false,
    fields: [{ name: 'bytes', format: 'Bytes:<n>', description: 'Bytes allocated.' }],
  },
  CALLOUT_REQUEST: {
    description: 'Line number and request headers',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'request',
        format: '<text>',
        description: 'The request: endpoint, method and headers.',
      },
    ],
  },
  CALLOUT_REQUEST_FINALIZE: {
    description: null,
    observed: false,
    fields: [
      { name: 'finalizationDetails', format: '<text>', description: 'Finalization details.' },
    ],
  },
  CALLOUT_REQUEST_PREPARE: {
    description: null,
    observed: false,
    fields: [{ name: 'preparationDetails', format: '<text>', description: 'Preparation details.' }],
  },
  CALLOUT_RESPONSE: {
    description: 'Line number and response body',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'response', format: '<text>', description: 'The response status and body.' },
    ],
  },
  CODE_UNIT_FINISHED: {
    description:
      'Line number, code unit name, such as MyTrigger on Account trigger event BeforeInsert for [new], and: For Apex methods, the namespace (if applicable), class name, and method name; for example, YourNamespace.YourClass.yourMethod() or YourClass.yourMethod() For Apex triggers, a typeRef; for example, __sfdc_trigger/YourNamespace.YourTrigger or __sfdc_trigger/YourTrigger',
    observed: true,
    fields: [
      {
        name: 'name',
        format: '<text>',
        description: 'The code unit, as its CODE_UNIT_STARTED line names it.',
      },
      {
        name: 'typeRef',
        format: '<typeRef>',
        description: 'The type reference. On some lines only.',
      },
    ],
  },
  CODE_UNIT_STARTED: {
    description:
      'Line number, code unit name, such as MyTrigger on Account trigger event BeforeInsert for [new], and: For Apex methods, the namespace (if applicable), class name, and method name; for example, YourNamespace.YourClass.yourMethod() or YourClass.yourMethod() For Apex triggers, a typeRef; for example, __sfdc_trigger/YourTrigger',
    observed: true,
    fields: [
      { name: 'line', format: '[EXTERNAL]', description: 'Always [EXTERNAL].' },
      {
        name: 'unit',
        format: '<type>:<name> or <id>',
        description:
          'The code unit type and name, such as Validation:Account:<id>, or the id of a trigger or class.',
      },
      {
        name: 'name',
        format: '<text>',
        description:
          'The code unit name, such as a trigger name or method signature. On some lines only.',
      },
      {
        name: 'typeRef',
        format: '<typeRef>',
        description: 'The type reference, such as __sfdc_trigger/MyTrigger. On some lines only.',
      },
    ],
  },
  CONSTRUCTOR_ENTRY: {
    description:
      'Line number, Apex class ID, the string &lt;init&gt;() with the types of parameters (if any) between the parentheses, and a typeRef; for example, YourClass or YourClass.YourInnerClass',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'classId', format: '<id>', description: 'The Apex class id.' },
      {
        name: 'signature',
        format: '<init>(<types>)',
        description: 'The constructor, with its parameter types.',
      },
      {
        name: 'className',
        format: '<typeRef>',
        description: 'The class, such as MyClass or ns.MyClass.MyInner.',
      },
    ],
  },
  CONSTRUCTOR_EXIT: {
    description:
      'Line number, the string &lt;init&gt;() with the types of parameters (if any) between the parentheses, and a typeRef; for example, YourClass or YourClass.YourInnerClass',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'classId', format: '<id>', description: 'The Apex class id.' },
      {
        name: 'signature',
        format: '<init>(<types>)',
        description: 'The constructor, with its parameter types.',
      },
      {
        name: 'className',
        format: '<typeRef>',
        description: 'The class, such as MyClass or ns.MyClass.MyInner.',
      },
    ],
  },
  CUMULATIVE_LIMIT_USAGE: {
    description: null,
    observed: true,
    fields: [],
  },
  CUMULATIVE_LIMIT_USAGE_END: {
    description: null,
    observed: true,
    fields: [],
  },
  CUMULATIVE_PROFILING: {
    description: null,
    observed: true,
    fields: [
      { name: 'section', format: '<text>', description: 'The profiling section.' },
      {
        name: 'detail',
        format: '<text>',
        description: 'More detail, often empty. The figures follow as continuation lines.',
      },
    ],
  },
  CUMULATIVE_PROFILING_BEGIN: {
    description: null,
    observed: true,
    fields: [],
  },
  CUMULATIVE_PROFILING_END: {
    description: null,
    observed: true,
    fields: [],
  },
  CURSOR_CREATE_BEGIN: {
    description:
      'Line number and SOQL query This event occurs when you call Database.getCursor() or Database.getPaginationCursor().',
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'soqlQuery', format: '<text>', description: 'SOQL query.' },
    ],
  },
  CURSOR_CREATE_END: {
    description:
      'Line number, query ID, and number of rows in the result set This event occurs when a cursor or pagination cursor is created.',
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'queryId', format: '<text>', description: 'Query ID.' },
      { name: 'numberRowsResult', format: '<text>', description: 'Number of rows in result set.' },
    ],
  },
  CURSOR_FETCH: {
    description:
      'Line number, query ID, cursor offset position, and number of rows fetched This event occurs when you call Cursor.fetch().',
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'queryId', format: '<text>', description: 'Query ID.' },
      { name: 'cursorOffsetPosition', format: '<text>', description: 'Cursor offset position.' },
      { name: 'numberRowsFetched', format: '<text>', description: 'Number of rows fetched.' },
    ],
  },
  CURSOR_FETCH_PAGE: {
    description:
      'Line number, query ID, cursor offset position, and number of rows on the current page This event occurs when you call PaginationCursor.fetchPage().',
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'queryId', format: '<text>', description: 'Query ID.' },
      { name: 'cursorOffsetPosition', format: '<text>', description: 'Cursor offset position.' },
      {
        name: 'numberRowsCurrent',
        format: '<text>',
        description: 'Number of rows on current page.',
      },
    ],
  },
  DATA_ACCESS_EVALUATION: {
    description:
      'Request and Response for the data access request. Used regardless of the data space or policy being accessed.',
    observed: false,
    fields: [
      { name: 'request', format: '<text>', description: 'Request.' },
      {
        name: 'responseDataAccess',
        format: '<text>',
        description:
          'Response for the data access request. Used regardless of the data space or policy being accessed.',
      },
    ],
  },
  DATAWEAVE_USER_DEBUG: {
    description: null,
    observed: false,
    fields: [{ name: 'debugOutput', format: '<text>', description: 'Debug output.' }],
  },
  DML_BEGIN: {
    description:
      'Line number, operation (such as Insert or Update), record name or type, and number of rows passed into DML operation',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'operation',
        format: 'Op:<operation>',
        description: 'The DML operation, such as Insert or Update.',
      },
      { name: 'objectType', format: 'Type:<sObject>', description: 'The sObject type.' },
      { name: 'rows', format: 'Rows:<n>', description: 'The rows passed to the operation.' },
    ],
  },
  DML_END: {
    description: 'Line number',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
    ],
  },
  DUPLICATE_DETECTION_BEGIN: {
    description: null,
    observed: true,
    fields: [],
  },
  DUPLICATE_DETECTION_END: {
    description: null,
    observed: true,
    fields: [],
  },
  DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS: {
    description: null,
    observed: true,
    fields: [
      {
        name: 'entityType',
        format: 'EntityType:<sObject>',
        description: 'The sObject type checked.',
      },
      {
        name: 'actionTaken',
        format: 'ActionTaken:<action>',
        description: 'What the rule did, such as Allow.',
      },
      {
        name: 'duplicateRecordIds',
        format: 'DuplicateRecordIds:<ids>',
        description: 'The ids of the duplicates found.',
      },
    ],
  },
  DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY: {
    description: null,
    observed: true,
    fields: [
      {
        name: 'entityType',
        format: 'EntityType:<sObject>',
        description: 'The sObject type checked.',
      },
      {
        name: 'recordsToBeSaved',
        format: 'NumRecordsToBeSaved:<n>',
        description: 'The records about to be saved.',
      },
      { name: 'detail', format: '<text>', description: 'Not documented.' },
      {
        name: 'duplicatesFound',
        format: 'NumDuplicateRecordsFound:<n>',
        description: 'The duplicates found.',
      },
    ],
  },
  DUPLICATE_DETECTION_RULE_INVOCATION: {
    description: null,
    observed: true,
    fields: [
      { name: 'ruleId', format: 'DuplicateRuleId:<id>', description: 'The duplicate rule id.' },
      {
        name: 'ruleName',
        format: 'DuplicateRuleName:<name>',
        description: 'The duplicate rule name.',
      },
      {
        name: 'dmlType',
        format: 'DmlType:<operation>',
        description: 'The DML operation that ran the rule.',
      },
    ],
  },
  DUPLICATE_RULE_FILTER: {
    description: null,
    observed: false,
    fields: [{ name: 'filterCriteria', format: '<text>', description: 'Filter criteria.' }],
  },
  DUPLICATE_RULE_FILTER_INVOCATION: {
    description: null,
    observed: false,
    fields: [],
  },
  DUPLICATE_RULE_FILTER_RESULT: {
    description: null,
    observed: false,
    fields: [{ name: 'filterResult', format: '<text>', description: 'Filter result.' }],
  },
  DUPLICATE_RULE_FILTER_VALUE: {
    description: null,
    observed: false,
    fields: [{ name: 'filterValue', format: '<text>', description: 'Filter value.' }],
  },
  EMAIL_QUEUE: {
    description: 'Line number',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'email',
        format: 'replyTo:<…>',
        description: 'The queued email: reply-to, subject and recipients.',
      },
    ],
  },
  END_CALL: {
    description: null,
    observed: false,
    fields: [],
  },
  ENTERING_MANAGED_PKG: {
    description: 'Package namespace',
    observed: true,
    fields: [
      {
        name: 'namespace',
        format: '<namespace>',
        description: 'The managed package namespace. The text after the last dot is the namespace.',
      },
    ],
  },
  EVENT_SERVICE_PUB_BEGIN: {
    description: 'Event Type',
    observed: false,
    fields: [{ name: 'eventType', format: '<text>', description: 'Event Type.' }],
  },
  EVENT_SERVICE_PUB_DETAIL: {
    description: 'Subscription IDs, ID of the user who published the event, and event message data',
    observed: false,
    fields: [
      { name: 'subscriptionIds', format: '<text>', description: 'Subscription IDs.' },
      { name: 'userId', format: '<id>', description: 'ID of the user who published the event.' },
      { name: 'eventMessageData', format: '<text>', description: 'Event message data.' },
    ],
  },
  EVENT_SERVICE_PUB_END: {
    description: 'Event Type',
    observed: false,
    fields: [{ name: 'eventType', format: '<text>', description: 'Event Type.' }],
  },
  EVENT_SERVICE_SUB_BEGIN: {
    description: 'Event type and action (subscribe or unsubscribe)',
    observed: false,
    fields: [
      { name: 'eventType', format: '<text>', description: 'Event type.' },
      { name: 'action', format: '<text>', description: 'Action (subscribe or unsubscribe).' },
    ],
  },
  EVENT_SERVICE_SUB_DETAIL: {
    description:
      'ID of the subscription, ID of the subscription instance, reference data (such as process API name), ID of the user who activated or deactivated the subscription, and event message data',
    observed: false,
    fields: [
      { name: 'subscriptionId', format: '<id>', description: 'ID of the subscription.' },
      {
        name: 'subscriptionInstanceId',
        format: '<id>',
        description: 'ID of the subscription instance.',
      },
      {
        name: 'referenceData',
        format: '<text>',
        description: 'Reference data (such as process API name).',
      },
      {
        name: 'userId',
        format: '<id>',
        description: 'ID of the user who activated or deactivated the subscription.',
      },
      { name: 'eventMessageData', format: '<text>', description: 'Event message data.' },
    ],
  },
  EVENT_SERVICE_SUB_END: {
    description: 'Event type and action (subscribe or unsubscribe)',
    observed: false,
    fields: [
      { name: 'eventType', format: '<text>', description: 'Event type.' },
      { name: 'action', format: '<text>', description: 'Action (subscribe or unsubscribe).' },
    ],
  },
  EXCEPTION_THROWN: {
    description: 'Line number, exception type, and message',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'exception',
        format: '<type>: <message>',
        description: 'The exception type and message. Continuation lines carry the rest.',
      },
    ],
  },
  EXECUTION_FINISHED: {
    description: null,
    observed: true,
    fields: [],
  },
  EXECUTION_STARTED: {
    description: null,
    observed: true,
    fields: [],
  },
  EXTERNAL_SERVICE_CALLBACK: {
    description: null,
    observed: false,
    fields: [],
  },
  EXTERNAL_SERVICE_REQUEST: {
    description: null,
    observed: false,
    fields: [{ name: 'requestDetails', format: '<text>', description: 'Request details.' }],
  },
  EXTERNAL_SERVICE_RESPONSE: {
    description: null,
    observed: false,
    fields: [{ name: 'responseDetails', format: '<text>', description: 'Response details.' }],
  },
  FATAL_ERROR: {
    description: 'Exception type, message, and stack trace',
    observed: true,
    fields: [
      {
        name: 'exception',
        format: '<type>: <message>',
        description:
          'The exception type and message. The stack trace follows as continuation lines.',
      },
    ],
  },
  FLOW_ACTIONCALL_DETAIL: {
    description:
      'Interview ID, element name, action type, action enum or ID, whether the action call succeeded, and error message',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'elementName', format: '<text>', description: 'The action call element.' },
      { name: 'actionType', format: '<text>', description: 'The action type.' },
      { name: 'action', format: '<text>', description: 'The action enum or id.' },
      {
        name: 'succeeded',
        format: 'true|false',
        description: 'Whether the action call succeeded.',
      },
      { name: 'error', format: '<text>', description: 'The error message, if any.' },
    ],
  },
  FLOW_ASSIGNMENT_DETAIL: {
    description: 'Interview ID, reference, operator, and value',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'reference', format: '<text>', description: 'The variable assigned.' },
      {
        name: 'operator',
        format: '<OPERATOR>',
        description: 'The operator, such as ASSIGN or ADD.',
      },
      { name: 'value', format: '<text>', description: 'The value.' },
    ],
  },
  FLOW_BULK_ELEMENT_BEGIN: {
    description: 'Interview ID and element type',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'elementType', format: '<text>', description: 'The element type.' },
    ],
  },
  FLOW_BULK_ELEMENT_DETAIL: {
    description: 'Interview ID, element type, element name, number of records',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      {
        name: 'element',
        format: '<text>',
        description: 'The element. Salesforce documents four fields; real lines state three.',
      },
      { name: 'records', format: '<n>', description: 'The number of records.' },
    ],
  },
  FLOW_BULK_ELEMENT_END: {
    description: 'Interview ID, element type, element name, number of records, and execution time',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      {
        name: 'element',
        format: '<text>',
        description: 'The element. Salesforce documents five fields; real lines state four.',
      },
      { name: 'records', format: '<n>', description: 'The number of records.' },
      { name: 'executionTime', format: '<n>', description: 'The execution time.' },
    ],
  },
  FLOW_BULK_ELEMENT_LIMIT_USAGE: {
    description:
      'Incremented usage toward a limit for this bulk element. Each event displays the usage for one of these limits.SOQL queries SOQL query rows SOSL queries DML statements DML rows CPU time in ms Heap size in bytes Callouts Email invocations Future calls Jobs in queue Push notifications',
    observed: true,
    fields: [
      {
        name: 'usage',
        format: '<n> <limit>, <used> out of <max>',
        description: 'The usage this element added toward a limit.',
      },
    ],
  },
  FLOW_BULK_ELEMENT_NOT_SUPPORTED: {
    description: 'Operation, element name, and entity name that doesn’t support bulk operations',
    observed: false,
    fields: [
      { name: 'operation', format: '<text>', description: 'Operation.' },
      { name: 'elementName', format: '<text>', description: 'Element name.' },
      {
        name: 'entityNameDoesn',
        format: '<text>',
        description: 'Entity name that doesn’t support bulk operations.',
      },
    ],
  },
  FLOW_COLLECTION_PROCESSOR_DETAIL: {
    description: null,
    observed: false,
    fields: [{ name: 'processorDetails', format: '<text>', description: 'Processor details.' }],
  },
  FLOW_CREATE_INTERVIEW_BEGIN: {
    description: 'Organization ID, definition ID, and version ID',
    observed: true,
    fields: [
      { name: 'orgId', format: '<id>', description: 'The organization id.' },
      { name: 'definitionId', format: '<id>', description: 'The flow definition id.' },
      {
        name: 'versionId',
        format: '<id>',
        description: 'The flow version id. Empty on some lines.',
      },
    ],
  },
  FLOW_CREATE_INTERVIEW_END: {
    description: 'Interview ID and flow name',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'flowName', format: '<text>', description: 'The flow name.' },
    ],
  },
  FLOW_CREATE_INTERVIEW_ERROR: {
    description: 'Message, organization ID, definition ID, and version ID',
    observed: false,
    fields: [
      { name: 'message', format: '<text>', description: 'Message.' },
      { name: 'organizationId', format: '<text>', description: 'Organization ID.' },
      { name: 'definitionId', format: '<text>', description: 'Definition ID.' },
      { name: 'versionId', format: '<text>', description: 'Version ID.' },
    ],
  },
  FLOW_ELEMENT_BEGIN: {
    description: 'Interview ID, element type, and element name',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'elementType', format: '<text>', description: 'The element type.' },
      { name: 'elementName', format: '<text>', description: 'The element name.' },
    ],
  },
  FLOW_ELEMENT_DEFERRED: {
    description: 'Element type and element name',
    observed: true,
    fields: [
      { name: 'elementType', format: '<text>', description: 'The element type.' },
      { name: 'elementName', format: '<text>', description: 'The element name.' },
    ],
  },
  FLOW_ELEMENT_END: {
    description: 'Interview ID, element type, and element name',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'elementType', format: '<text>', description: 'The element type.' },
      { name: 'elementName', format: '<text>', description: 'The element name.' },
    ],
  },
  FLOW_ELEMENT_ERROR: {
    description: 'Message, element type, and element name (flow runtime exception)',
    observed: true,
    fields: [
      { name: 'message', format: '<text>', description: 'The error message.' },
      {
        name: 'elementType',
        format: '<text>',
        description: 'The element type. On some lines only.',
      },
      {
        name: 'elementName',
        format: '<text>',
        description: 'The element name. On some lines only.',
      },
    ],
  },
  FLOW_ELEMENT_FAULT: {
    description: 'Message, element type, and element name (fault path taken)',
    observed: false,
    fields: [
      { name: 'message', format: '<text>', description: 'Message.' },
      { name: 'elementType', format: '<text>', description: 'Element type.' },
      { name: 'elementName', format: '<text>', description: 'Element name (fault path taken).' },
    ],
  },
  FLOW_ELEMENT_LIMIT_USAGE: {
    description:
      'Incremented usage toward a limit for this element. Each event displays the usage for one of these limits. SOQL queries SOQL query rows SOSL queries DML statements DML rows CPU time in ms Heap size in bytes Callouts Email invocations Future calls Jobs in queue Push notifications',
    observed: true,
    fields: [
      {
        name: 'usage',
        format: '<n> <limit>, <used> out of <max>',
        description: 'The usage this element added toward a limit.',
      },
    ],
  },
  FLOW_INTERVIEW_FINISHED: {
    description: null,
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'flowName', format: '<text>', description: 'The flow name.' },
    ],
  },
  FLOW_INTERVIEW_FINISHED_LIMIT_USAGE: {
    description:
      'Usage toward a limit when the interview finishes. Each event displays the usage for one of these limits.SOQL queries SOQL query rows SOSL queries DML statements DML rows CPU time in ms Heap size in bytes Callouts Email invocations Future calls Jobs in queue Push notifications',
    observed: true,
    fields: [
      {
        name: 'usage',
        format: '<limit>: <used> out of <max>',
        description: 'The usage toward one limit.',
      },
    ],
  },
  FLOW_INTERVIEW_PAUSED: {
    description: 'Interview ID, flow name, and why the user paused',
    observed: false,
    fields: [
      { name: 'interviewId', format: '<text>', description: 'Interview ID.' },
      { name: 'flowName', format: '<text>', description: 'Flow name.' },
      { name: 'userPaused', format: '<text>', description: 'Why the user paused.' },
    ],
  },
  FLOW_INTERVIEW_RESUMED: {
    description: 'Interview ID and flow name',
    observed: false,
    fields: [
      { name: 'interviewId', format: '<text>', description: 'Interview ID.' },
      { name: 'flowName', format: '<text>', description: 'Flow name.' },
    ],
  },
  FLOW_LOOP_DETAIL: {
    description:
      'Interview ID, index, and value The index is the position in the collection variable for the item that the loop is operating on.',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'index', format: '<n>', description: 'The loop index.' },
      { name: 'value', format: '<text>', description: 'The current item.' },
    ],
  },
  FLOW_RULE_DETAIL: {
    description: 'Interview ID, rule name, and result',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'ruleName', format: '<text>', description: 'The rule name.' },
      {
        name: 'result',
        format: '<text>',
        description: 'The rule result. Salesforce documents three fields; real lines state four.',
      },
      { name: 'detail', format: '<text>', description: 'Not documented.' },
    ],
  },
  FLOW_SCHEDULED_PATH_QUEUED: {
    description: null,
    observed: false,
    fields: [],
  },
  FLOW_SCREEN_DETAIL: {
    description: 'Logs flow screen element details',
    observed: false,
    fields: [{ name: 'screenDetails', format: '<text>', description: 'Screen details.' }],
  },
  FLOW_START_INTERVIEW_BEGIN: {
    description: 'Interview ID and flow name',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'flowName', format: '<text>', description: 'The flow name.' },
    ],
  },
  FLOW_START_INTERVIEW_END: {
    description: 'Interview ID and flow name',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'flowName', format: '<text>', description: 'The flow name.' },
    ],
  },
  FLOW_START_INTERVIEW_LIMIT_USAGE: {
    description:
      'Usage toward a limit at the interview’s start time. Each event displays the usage for one of these limits.SOQL queries SOQL query rows SOSL queries DML statements DML rows CPU time in ms Heap size in bytes Callouts Email invocations Future calls Jobs in queue Push notifications',
    observed: true,
    fields: [
      {
        name: 'usage',
        format: '<limit>: <used> out of <max>',
        description: 'The usage toward one limit.',
      },
    ],
  },
  FLOW_START_INTERVIEWS_BEGIN: {
    description: 'Requests',
    observed: true,
    fields: [
      { name: 'requests', format: '<n>', description: 'The number of interviews requested.' },
    ],
  },
  FLOW_START_INTERVIEWS_END: {
    description: 'Requests',
    observed: true,
    fields: [
      { name: 'requests', format: '<n>', description: 'The number of interviews requested.' },
    ],
  },
  FLOW_START_INTERVIEWS_ERROR: {
    description: 'Message, interview ID, and flow name',
    observed: true,
    fields: [
      { name: 'message', format: '<text>', description: 'The error message.' },
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'flowName', format: '<text>', description: 'The flow name.' },
    ],
  },
  FLOW_START_SCHEDULED_RECORDS: {
    description: 'Message and number of records that the flow runs for',
    observed: false,
    fields: [
      { name: 'message', format: '<text>', description: 'Message.' },
      {
        name: 'numberRecordsFlow',
        format: '<text>',
        description: 'Number of records that the flow runs for.',
      },
    ],
  },
  FLOW_SUBFLOW_DETAIL: {
    description: 'Interview ID, name, definition ID, and version ID',
    observed: false,
    fields: [
      { name: 'interviewId', format: '<text>', description: 'Interview ID.' },
      { name: 'name', format: '<text>', description: 'Name.' },
      { name: 'definitionId', format: '<text>', description: 'Definition ID.' },
      { name: 'versionId', format: '<text>', description: 'Version ID.' },
    ],
  },
  FLOW_VALUE_ASSIGNMENT: {
    description: 'Interview ID, key, and value',
    observed: true,
    fields: [
      { name: 'interviewId', format: '<id>', description: 'The flow interview id.' },
      { name: 'key', format: '<text>', description: 'The variable assigned.' },
      { name: 'value', format: '<text>', description: 'The value.' },
    ],
  },
  FLOW_WAIT_EVENT_RESUMING_DETAIL: {
    description: 'Interview ID, element name, event name, and event type',
    observed: false,
    fields: [
      { name: 'interviewId', format: '<text>', description: 'Interview ID.' },
      { name: 'elementName', format: '<text>', description: 'Element name.' },
      { name: 'eventName', format: '<text>', description: 'Event name.' },
      { name: 'eventType', format: '<text>', description: 'Event type.' },
    ],
  },
  FLOW_WAIT_EVENT_WAITING_DETAIL: {
    description:
      'Interview ID, element name, event name, event type, and whether conditions were met',
    observed: false,
    fields: [
      { name: 'interviewId', format: '<text>', description: 'Interview ID.' },
      { name: 'elementName', format: '<text>', description: 'Element name.' },
      { name: 'eventName', format: '<text>', description: 'Event name.' },
      { name: 'eventType', format: '<text>', description: 'Event type.' },
      { name: 'conditionsMet', format: '<text>', description: 'Whether conditions were met.' },
    ],
  },
  FLOW_WAIT_RESUMING_DETAIL: {
    description: 'Interview ID, element name, and persisted interview ID',
    observed: false,
    fields: [
      { name: 'interviewId', format: '<text>', description: 'Interview ID.' },
      { name: 'elementName', format: '<text>', description: 'Element name.' },
      { name: 'persistedInterviewId', format: '<text>', description: 'Persisted interview ID.' },
    ],
  },
  FLOW_WAIT_WAITING_DETAIL: {
    description:
      'Interview ID, element name, number of events that the element is waiting for, and persisted interview ID',
    observed: false,
    fields: [
      { name: 'interviewId', format: '<text>', description: 'Interview ID.' },
      { name: 'elementName', format: '<text>', description: 'Element name.' },
      {
        name: 'numberEventsElement',
        format: '<text>',
        description: 'Number of events that the element is waiting for.',
      },
      { name: 'persistedInterviewId', format: '<text>', description: 'Persisted interview ID.' },
    ],
  },
  FOR_UPDATE_LOCKS_RELEASE: {
    description: null,
    observed: false,
    fields: [],
  },
  FORMULA_BUILD: {
    description: null,
    observed: false,
    fields: [],
  },
  FORMULA_EVALUATE_BEGIN: {
    description: null,
    observed: false,
    fields: [],
  },
  FORMULA_EVALUATE_END: {
    description: null,
    observed: false,
    fields: [],
  },
  FUNCTION_INVOCATION_REQUEST: {
    description: null,
    observed: false,
    fields: [
      {
        name: 'invocationRequestDetails',
        format: '<text>',
        description: 'Invocation request details.',
      },
    ],
  },
  FUNCTION_INVOCATION_RESPONSE: {
    description: null,
    observed: false,
    fields: [
      {
        name: 'invocationResponseDetails',
        format: '<text>',
        description: 'Invocation response details.',
      },
    ],
  },
  HEAP_ALLOCATE: {
    description: 'Line number and number of bytes',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'bytes', format: 'Bytes:<n>', description: 'Bytes allocated.' },
    ],
  },
  HEAP_DEALLOCATE: {
    description: 'Line number and number of bytes deallocated',
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'bytes', format: 'Bytes:<n>', description: 'Bytes freed.' },
    ],
  },
  HEAP_DUMP: {
    description: null,
    observed: false,
    fields: [{ name: 'heapDumpData', format: '<text>', description: 'Heap dump data.' }],
  },
  IDEAS_QUERY_EXECUTE: {
    description: 'Line number',
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
    ],
  },
  INVOCABLE_ACTION_DETAIL: {
    description: null,
    observed: false,
    fields: [{ name: 'actionDetails', format: '<text>', description: 'Action details.' }],
  },
  INVOCABLE_ACTION_ERROR: {
    description: null,
    observed: false,
    fields: [{ name: 'errorDetails', format: '<text>', description: 'Error details.' }],
  },
  JSON_DIFF_DETAIL: {
    description: null,
    observed: false,
    fields: [{ name: 'diffDetail', format: '<text>', description: 'Diff detail.' }],
  },
  JSON_DIFF_SUMMARY: {
    description: null,
    observed: false,
    fields: [{ name: 'diffSummary', format: '<text>', description: 'Diff summary.' }],
  },
  LIMIT_USAGE: {
    description:
      'Per-operation governor limit usage. Tracks incremental usage per statement. Limit names include: DML, DML_ROWS, SOQL, SOQL_ROWS, AGGS, FIELDS_DESCRIBES, APEX_CURSOR_SOQL_ROWS, APEX_CURSORS, and others.',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'limit', format: '<LIMIT>', description: 'The limit, such as SOQL or DML_ROWS.' },
      { name: 'used', format: '<n>', description: 'The usage so far.' },
      { name: 'max', format: '<n>', description: 'The limit.' },
    ],
  },
  LIMIT_USAGE_FOR_NS: {
    description:
      'Namespace and these limits:Number of SOQL queries Number of query rows Number of SOSL queries Number of DML statements Number of DML rows Number of code statements Maximum heap size Number of callouts Number of Email Invocations Number of fields describes Number of record type describes Number of child relationships describes Number of picklist describes Number of future calls Number of find similar calls Number of System.runAs() invocations',
    observed: true,
    fields: [
      {
        name: 'namespace',
        format: '(<namespace>)',
        description: 'The namespace, such as (default).',
      },
      { name: 'usage', format: '', description: 'Empty. The limits follow as continuation lines.' },
    ],
  },
  MATCH_ENGINE_BEGIN: {
    description: null,
    observed: false,
    fields: [],
  },
  MATCH_ENGINE_END: {
    description: null,
    observed: false,
    fields: [],
  },
  MATCH_ENGINE_INVOCATION: {
    description: null,
    observed: false,
    fields: [{ name: 'invocationDetails', format: '<text>', description: 'Invocation details.' }],
  },
  METHOD_ENTRY: {
    description:
      'Line number, the Lightning Platform ID of the class, and method signature (with namespace, if applicable)',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'classId',
        format: '<id>',
        description: 'The Apex class id. Empty for some system classes.',
      },
      {
        name: 'signature',
        format: '<name>(<types>)',
        description: 'The method signature, with its parameter types.',
      },
    ],
  },
  METHOD_EXIT: {
    description:
      'Line number, the Lightning Platform ID of the class, and method signature (with namespace, if applicable)For constructors, this information is logged: line number and class name.',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'classId',
        format: '<id>',
        description:
          'The Apex class id. Empty for some system classes; absent on older lines, where this field is the signature.',
      },
      {
        name: 'signature',
        format: '<name>(<types>)',
        description: 'The method signature, with its parameter types.',
      },
    ],
  },
  NAMED_CREDENTIAL_REQUEST: {
    description:
      'Named Credential Id, Named Credential Name, Endpoint, Method, External Credential Type, Http Header Authorization, Request Size bytes, and Retry on 401.If using an outbound network connection, these fields are also logged: Outbound Network Connection Id, Outbound Network Connection Name, Outbound Network Connection Status, Host Type, Host Region, and Private Connect Outbound Hourly Data Usage Percent.',
    observed: false,
    fields: [
      { name: 'credentialId', format: '<id>', description: 'The named credential id.' },
      { name: 'credentialName', format: '<text>', description: 'The named credential name.' },
      { name: 'endpoint', format: '<url>', description: 'The endpoint.' },
      { name: 'method', format: '<METHOD>', description: 'The HTTP method.' },
      { name: 'credentialType', format: '<text>', description: 'The external credential type.' },
      { name: 'authorization', format: '<text>', description: 'The Authorization header.' },
      { name: 'requestSize', format: '<n>', description: 'The request size, in bytes.' },
      { name: 'retryOn401', format: 'true|false', description: 'Whether a 401 retries.' },
      {
        name: 'connectionId',
        format: '<id>',
        description:
          'The outbound network connection id. Only when the request uses an outbound network connection.',
      },
      {
        name: 'connectionName',
        format: '<text>',
        description:
          'The outbound network connection name. Only when the request uses an outbound network connection.',
      },
      {
        name: 'connectionStatus',
        format: '<text>',
        description:
          'The outbound network connection status. Only when the request uses an outbound network connection.',
      },
      {
        name: 'hostType',
        format: '<text>',
        description: 'The host type. Only when the request uses an outbound network connection.',
      },
      {
        name: 'hostRegion',
        format: '<text>',
        description: 'The host region. Only when the request uses an outbound network connection.',
      },
      {
        name: 'hourlyDataUsage',
        format: '<n>',
        description:
          'The Private Connect outbound hourly data usage, as a percentage. Only when the request uses an outbound network connection.',
      },
    ],
  },
  NAMED_CREDENTIAL_RESPONSE: {
    description:
      'Truncated section of the response body that’s returned from the NamedCredential callout.',
    observed: false,
    fields: [
      { name: 'body', format: '<text>', description: 'A truncated section of the response body.' },
    ],
  },
  NAMED_CREDENTIAL_RESPONSE_DETAIL: {
    description:
      'Named Credential Id, Named Credential Name, Status Code, Response Size bytes, Overall Callout Time ms, and Connect Time ms.If using an outbound network connection, these fields are also logged: Outbound Network Connection Id, Outbound Network Connection Name, and Private Connect Outbound Hourly Data Usage Percent.',
    observed: false,
    fields: [
      { name: 'credentialId', format: '<id>', description: 'The named credential id.' },
      { name: 'credentialName', format: '<text>', description: 'The named credential name.' },
      { name: 'statusCode', format: '<n>', description: 'The HTTP status code.' },
      { name: 'responseSize', format: '<n>', description: 'The response size, in bytes.' },
      {
        name: 'calloutTime',
        format: '<n>',
        description: 'The overall callout time, in milliseconds.',
      },
      { name: 'connectTime', format: '<n>', description: 'The connect time, in milliseconds.' },
      {
        name: 'connectionId',
        format: '<id>',
        description:
          'The outbound network connection id. Only when the request uses an outbound network connection.',
      },
      {
        name: 'connectionName',
        format: '<text>',
        description:
          'The outbound network connection name. Only when the request uses an outbound network connection.',
      },
      {
        name: 'hourlyDataUsage',
        format: '<n>',
        description:
          'The Private Connect outbound hourly data usage, as a percentage. Only when the request uses an outbound network connection.',
      },
    ],
  },
  NBA_NODE_BEGIN: {
    description: 'Element name, element type',
    observed: false,
    fields: [
      { name: 'elementName', format: '<text>', description: 'Element name.' },
      { name: 'elementType', format: '<text>', description: 'Element type.' },
    ],
  },
  NBA_NODE_DETAIL: {
    description: 'Element name, element type, message',
    observed: false,
    fields: [
      { name: 'elementName', format: '<text>', description: 'Element name.' },
      { name: 'elementType', format: '<text>', description: 'Element type.' },
      { name: 'message', format: '<text>', description: 'Message.' },
    ],
  },
  NBA_NODE_END: {
    description: 'Element name, element type, message',
    observed: false,
    fields: [
      { name: 'elementName', format: '<text>', description: 'Element name.' },
      { name: 'elementType', format: '<text>', description: 'Element type.' },
      { name: 'message', format: '<text>', description: 'Message.' },
    ],
  },
  NBA_NODE_ERROR: {
    description: 'Element name, element type, error message',
    observed: false,
    fields: [
      { name: 'elementName', format: '<text>', description: 'Element name.' },
      { name: 'elementType', format: '<text>', description: 'Element type.' },
      { name: 'errorMessage', format: '<text>', description: 'Error message.' },
    ],
  },
  NBA_OFFER_INVALID: {
    description: 'Name, ID, reason',
    observed: false,
    fields: [
      { name: 'name', format: '<text>', description: 'Name.' },
      { name: 'id', format: '<id>', description: 'ID.' },
      { name: 'reason', format: '<text>', description: 'Reason.' },
    ],
  },
  NBA_STRATEGY_BEGIN: {
    description: 'Strategy name',
    observed: false,
    fields: [{ name: 'strategyName', format: '<text>', description: 'Strategy name.' }],
  },
  NBA_STRATEGY_END: {
    description: 'Strategy name, count of outputs',
    observed: false,
    fields: [
      { name: 'strategyName', format: '<text>', description: 'Strategy name.' },
      { name: 'countOutputs', format: '<text>', description: 'Count of outputs.' },
    ],
  },
  NBA_STRATEGY_ERROR: {
    description: 'Strategy name, error message',
    observed: false,
    fields: [
      { name: 'strategyName', format: '<text>', description: 'Strategy name.' },
      { name: 'errorMessage', format: '<text>', description: 'Error message.' },
    ],
  },
  ORG_CACHE_CONTAINS: {
    description: null,
    observed: false,
    fields: [],
  },
  ORG_CACHE_GET: {
    description: null,
    observed: false,
    fields: [],
  },
  ORG_CACHE_GET_BEGIN: {
    description: null,
    observed: false,
    fields: [{ name: 'key', format: '<text>', description: 'Key.' }],
  },
  ORG_CACHE_GET_CAPACITY: {
    description: null,
    observed: false,
    fields: [],
  },
  ORG_CACHE_GET_END: {
    description: null,
    observed: false,
    fields: [{ name: 'hitMiss', format: '<text>', description: 'Hit/miss.' }],
  },
  ORG_CACHE_GET_PARTITION: {
    description: null,
    observed: false,
    fields: [],
  },
  ORG_CACHE_MEMORY_USAGE: {
    description: null,
    observed: false,
    fields: [{ name: 'memoryUsage', format: '<text>', description: 'Memory usage.' }],
  },
  ORG_CACHE_PUT: {
    description: null,
    observed: false,
    fields: [],
  },
  ORG_CACHE_PUT_BEGIN: {
    description: null,
    observed: false,
    fields: [{ name: 'key', format: '<text>', description: 'Key.' }],
  },
  ORG_CACHE_PUT_END: {
    description: null,
    observed: false,
    fields: [],
  },
  ORG_CACHE_REMOVE: {
    description: null,
    observed: false,
    fields: [],
  },
  ORG_CACHE_REMOVE_BEGIN: {
    description: null,
    observed: false,
    fields: [{ name: 'key', format: '<text>', description: 'Key.' }],
  },
  ORG_CACHE_REMOVE_END: {
    description: null,
    observed: false,
    fields: [],
  },
  PLAY_PROMPT: {
    description: null,
    observed: false,
    fields: [],
  },
  POLICY_RULE_DEFINITION_CONDITION_EVALUATION_RESPONSE: {
    description:
      'Condition evaluation response for a policy. Used for identifying conditions that match the policy.',
    observed: false,
    fields: [
      { name: 'response', format: '<text>', description: 'The condition evaluation response.' },
    ],
  },
  POLICY_RULE_EVALUATION_REQUEST: {
    description: 'Request received for the evaluation of access via the policy.',
    observed: false,
    fields: [{ name: 'request', format: '<text>', description: 'The evaluation request.' }],
  },
  POLICY_RULE_EVALUATION_RESPONSE: {
    description:
      'Response for the evaluation of access via the policy, including why access is granted or denied.',
    observed: false,
    fields: [
      {
        name: 'response',
        format: '<text>',
        description: 'The evaluation response, with why access is granted or denied.',
      },
    ],
  },
  POLICY_RULE_EVALUATION_SKIPPED: {
    description:
      'Object for which the policy evaluation is skipped. If the policy evaluation is skipped, the user is allowed access to the object.',
    observed: false,
    fields: [
      { name: 'object', format: '<text>', description: 'The object whose evaluation is skipped.' },
    ],
  },
  POLICY_RULE_EVALUATION_START: {
    description: 'Rule being evaluated.',
    observed: false,
    fields: [{ name: 'rule', format: '<text>', description: 'The rule evaluated.' }],
  },
  POP_TRACE_FLAGS: {
    description:
      'Line number, the Lightning Platform ID of the class or trigger that has its log levels set and that is going into scope, the name of this class or trigger, and the log level settings that are in effect after leaving this scope',
    observed: true,
    fields: [
      { name: 'line', format: '[EXTERNAL]', description: 'Always [EXTERNAL].' },
      {
        name: 'classId',
        format: '<id>',
        description: 'The class or trigger whose log levels change.',
      },
      { name: 'className', format: '<text>', description: 'Its name.' },
      {
        name: 'traceFlags',
        format: '<text>',
        description: 'The log levels in effect after leaving its scope.',
      },
    ],
  },
  PUSH_NOTIFICATION_INVALID_APP: {
    description:
      "App namespace, app name This event occurs when Apex code is trying to send a notification to an app that doesn't exist in the org, or isn’t push-enabled.",
    observed: false,
    fields: [
      { name: 'appNamespace', format: '<namespace>', description: 'The app namespace.' },
      { name: 'appName', format: '<text>', description: 'The app name.' },
    ],
  },
  PUSH_NOTIFICATION_INVALID_CERTIFICATE: {
    description:
      'App namespace, app name This event indicates that the certificate is invalid. For example, it’s expired.',
    observed: false,
    fields: [
      { name: 'appNamespace', format: '<namespace>', description: 'The app namespace.' },
      { name: 'appName', format: '<text>', description: 'The app name.' },
    ],
  },
  PUSH_NOTIFICATION_INVALID_CONFIGURATION: {
    description: null,
    observed: false,
    fields: [],
  },
  PUSH_NOTIFICATION_INVALID_NOTIFICATION: {
    description:
      'App namespace, app name, service type (Apple or Android GCM), user ID, device, payload (substring), payload length. This event occurs when a notification payload is too long.',
    observed: false,
    fields: [
      { name: 'appNamespace', format: '<namespace>', description: 'The app namespace.' },
      { name: 'appName', format: '<text>', description: 'The app name.' },
      { name: 'serviceType', format: '<text>', description: 'Apple or Android GCM.' },
      { name: 'userId', format: '<id>', description: 'The user id.' },
      { name: 'device', format: '<text>', description: 'The device.' },
      { name: 'payload', format: '<text>', description: 'A substring of the payload.' },
      { name: 'payloadLength', format: '<n>', description: 'The payload length.' },
    ],
  },
  PUSH_NOTIFICATION_INVALID_PAYLOAD: {
    description: null,
    observed: false,
    fields: [],
  },
  PUSH_NOTIFICATION_NO_DEVICES: {
    description:
      'App namespace, app name This event occurs when none of the users we’re trying to send notifications to have devices registered.',
    observed: false,
    fields: [
      { name: 'appNamespace', format: '<namespace>', description: 'The app namespace.' },
      { name: 'appName', format: '<text>', description: 'The app name.' },
    ],
  },
  PUSH_NOTIFICATION_NOT_ENABLED: {
    description: 'This event occurs when push notifications aren’t enabled in your org.',
    observed: false,
    fields: [],
  },
  PUSH_NOTIFICATION_SENT: {
    description:
      'App namespace, app name, service type (Apple or Android GCM), user ID, device, payload (substring) This event records that a notification was accepted for sending. We don’t guarantee delivery of the notification.',
    observed: false,
    fields: [
      { name: 'appNamespace', format: '<namespace>', description: 'The app namespace.' },
      { name: 'appName', format: '<text>', description: 'The app name.' },
      { name: 'serviceType', format: '<text>', description: 'Apple or Android GCM.' },
      { name: 'userId', format: '<id>', description: 'The user id.' },
      { name: 'device', format: '<text>', description: 'The device.' },
      { name: 'payload', format: '<text>', description: 'A substring of the payload.' },
    ],
  },
  PUSH_TRACE_FLAGS: {
    description:
      'Line number, the Salesforce ID of the class or trigger that has its log levels set and that is going out of scope, the name of this class or trigger, and the log level settings that are in effect after entering this scope',
    observed: true,
    fields: [
      { name: 'line', format: '[EXTERNAL]', description: 'Always [EXTERNAL].' },
      {
        name: 'classId',
        format: '<id>',
        description: 'The class or trigger whose log levels change.',
      },
      { name: 'className', format: '<text>', description: 'Its name.' },
      {
        name: 'traceFlags',
        format: '<text>',
        description: 'The log levels in effect after entering its scope.',
      },
    ],
  },
  QUERY_MORE_BEGIN: {
    description: 'Start of a queryMore operation.',
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
    ],
  },
  QUERY_MORE_END: {
    description: 'End of a queryMore operation.',
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
    ],
  },
  QUERY_MORE_ITERATIONS: {
    description: 'Line number and the number of queryMore iterations',
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'iterations', format: '<n>', description: 'The number of queryMore iterations.' },
    ],
  },
  QUERY_SQL_LOG: {
    description: null,
    observed: false,
    fields: [],
  },
  REFERENCED_OBJECT_LIST: {
    description: null,
    observed: false,
    fields: [{ name: 'referencedObjects', format: '<text>', description: 'Referenced objects.' }],
  },
  RLM_CONFIGURATOR_BEGIN: {
    description: null,
    observed: false,
    fields: [],
  },
  RLM_CONFIGURATOR_DEPLOY: {
    description: null,
    observed: false,
    fields: [],
  },
  RLM_CONFIGURATOR_END: {
    description: null,
    observed: false,
    fields: [],
  },
  RLM_CONFIGURATOR_STATS: {
    description: null,
    observed: false,
    fields: [],
  },
  RLM_PRICING_BEGIN: {
    description: null,
    observed: false,
    fields: [],
  },
  RLM_PRICING_END: {
    description: null,
    observed: false,
    fields: [],
  },
  ROUTE_WORK_ACTION: {
    description: null,
    observed: false,
    fields: [],
  },
  RULES_EXECUTION_DETAIL: {
    description: null,
    observed: false,
    fields: [{ name: 'executionDetail', format: '<text>', description: 'Execution detail.' }],
  },
  RULES_EXECUTION_SUMMARY: {
    description: null,
    observed: false,
    fields: [{ name: 'summaryData', format: '<text>', description: 'Summary data.' }],
  },
  SAVEPOINT_RELEASE: {
    description: null,
    observed: false,
    fields: [],
  },
  SAVEPOINT_RESET: {
    description: null,
    observed: false,
    fields: [],
  },
  SAVEPOINT_ROLLBACK: {
    description: 'Line number and Savepoint name',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'savepoint', format: '<id>', description: 'The savepoint.' },
    ],
  },
  SAVEPOINT_SET: {
    description: 'Line number and Savepoint name',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'savepoint', format: '<id>', description: 'The savepoint.' },
    ],
  },
  SCHEDULED_FLOW_DETAIL: {
    description: null,
    observed: false,
    fields: [],
  },
  SCRIPT_EXECUTION: {
    description: null,
    observed: false,
    fields: [],
  },
  SESSION_CACHE_CONTAINS: {
    description: null,
    observed: false,
    fields: [],
  },
  SESSION_CACHE_GET: {
    description: null,
    observed: false,
    fields: [],
  },
  SESSION_CACHE_GET_BEGIN: {
    description: null,
    observed: false,
    fields: [{ name: 'key', format: '<text>', description: 'Key.' }],
  },
  SESSION_CACHE_GET_CAPACITY: {
    description: null,
    observed: false,
    fields: [],
  },
  SESSION_CACHE_GET_END: {
    description: null,
    observed: false,
    fields: [{ name: 'hitMiss', format: '<text>', description: 'Hit/miss.' }],
  },
  SESSION_CACHE_GET_PARTITION: {
    description: null,
    observed: false,
    fields: [],
  },
  SESSION_CACHE_MEMORY_USAGE: {
    description: null,
    observed: false,
    fields: [{ name: 'memoryUsage', format: '<text>', description: 'Memory usage.' }],
  },
  SESSION_CACHE_PUT: {
    description: null,
    observed: false,
    fields: [],
  },
  SESSION_CACHE_PUT_BEGIN: {
    description: null,
    observed: false,
    fields: [{ name: 'key', format: '<text>', description: 'Key.' }],
  },
  SESSION_CACHE_PUT_END: {
    description: null,
    observed: false,
    fields: [],
  },
  SESSION_CACHE_REMOVE: {
    description: null,
    observed: false,
    fields: [],
  },
  SESSION_CACHE_REMOVE_BEGIN: {
    description: null,
    observed: false,
    fields: [{ name: 'key', format: '<text>', description: 'Key.' }],
  },
  SESSION_CACHE_REMOVE_END: {
    description: null,
    observed: false,
    fields: [],
  },
  SLA_CASE_MILESTONE: {
    description: null,
    observed: false,
    fields: [],
  },
  SLA_END: {
    description:
      'Number of cases, load time, processing time, number of case milestones to insert, update, or delete, and new trigger',
    observed: false,
    fields: [
      { name: 'cases', format: '<n>', description: 'The number of cases.' },
      { name: 'loadTime', format: '<n>', description: 'The load time.' },
      { name: 'processingTime', format: '<n>', description: 'The processing time.' },
      {
        name: 'milestones',
        format: '<n>',
        description: 'The case milestones to insert, update or delete.',
      },
      { name: 'newTrigger', format: '<text>', description: 'The new trigger.' },
    ],
  },
  SLA_EVAL_MILESTONE: {
    description: 'Milestone ID',
    observed: false,
    fields: [{ name: 'milestoneId', format: '<text>', description: 'Milestone ID.' }],
  },
  SLA_NULL_START_DATE: {
    description: null,
    observed: false,
    fields: [],
  },
  SLA_PROCESS_CASE: {
    description: 'Case ID',
    observed: false,
    fields: [{ name: 'caseId', format: '<text>', description: 'Case ID.' }],
  },
  SOQL_EXECUTE_BEGIN: {
    description: 'Line number, number of aggregations, and query source',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'aggregations',
        format: 'Aggregations:<n>',
        description: 'The number of aggregations.',
      },
      { name: 'query', format: '<SOQL>', description: 'The query.' },
    ],
  },
  SOQL_EXECUTE_END: {
    description: 'Line number, number of rows, and duration in milliseconds',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'rows', format: 'Rows:<n>', description: 'The rows returned.' },
    ],
  },
  SOQL_EXECUTE_EXPLAIN: {
    description:
      'Query Plan details for the executed SOQL query. To get feedback on query performance, see Get Feedback on Query Performance.',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'plan',
        format: '<text>',
        description:
          'The query plan, such as: Index on Account : [Id], cardinality: 1, sobjectCardinality: 2, relativeCost 0.1.',
      },
    ],
  },
  SOSL_EXECUTE_BEGIN: {
    description: 'Line number and query source',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'query', format: '<SOSL>', description: 'The search.' },
    ],
  },
  SOSL_EXECUTE_END: {
    description: 'Line number, number of rows, and duration in milliseconds',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'rows', format: 'Rows:<n>', description: 'The rows returned.' },
    ],
  },
  STACK_FRAME_VARIABLE_LIST: {
    description:
      "Frame number and variable list of the form: Variable number | Value. For example:var1:50 var2:'Hello World'",
    observed: false,
    fields: [
      {
        name: 'frame',
        format: '<text>',
        description: 'The frame number. The variables follow as continuation lines.',
      },
    ],
  },
  STATEMENT_EXECUTE: {
    description: 'Line number',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
    ],
  },
  STATIC_VARIABLE_LIST: {
    description:
      "Variable list of the form: Variable number | Value. For example:var1:50 var2:'Hello World'",
    observed: true,
    fields: [
      {
        name: 'variables',
        format: '',
        description: 'Empty. The variables follow as continuation lines.',
      },
    ],
  },
  SYSTEM_CONSTRUCTOR_ENTRY: {
    description:
      'Line number and the string &lt;init&gt;() with the types of parameters, if any, between the parentheses',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'signature',
        format: '<init>(<types>)',
        description: 'The constructor, with its parameter types.',
      },
    ],
  },
  SYSTEM_CONSTRUCTOR_EXIT: {
    description:
      'Line number and the string &lt;init&gt;() with the types of parameters, if any, between the parentheses',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'signature',
        format: '<init>(<types>)',
        description: 'The constructor, with its parameter types.',
      },
    ],
  },
  SYSTEM_METHOD_ENTRY: {
    description: 'Line number and method signature',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'signature',
        format: '<name>(<types>)',
        description: 'The method signature, with its parameter types.',
      },
    ],
  },
  SYSTEM_METHOD_EXIT: {
    description: 'Line number and method signature',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'signature',
        format: '<name>(<types>)',
        description: 'The method signature, with its parameter types.',
      },
    ],
  },
  SYSTEM_MODE_ENTER: {
    description: 'Mode name',
    observed: true,
    fields: [{ name: 'mode', format: '<text>', description: 'The mode entered.' }],
  },
  SYSTEM_MODE_EXIT: {
    description: 'Mode name',
    observed: true,
    fields: [{ name: 'mode', format: '<text>', description: 'The mode left.' }],
  },
  TEMPLATE_PROCESSING_ERROR: {
    description: null,
    observed: false,
    fields: [{ name: 'errorDetails', format: '<text>', description: 'Error details.' }],
  },
  TEMPLATED_ASSET: {
    description: null,
    observed: false,
    fields: [{ name: 'assetDetails', format: '<text>', description: 'Asset details.' }],
  },
  TESTING_LIMITS: {
    description: null,
    observed: true,
    fields: [],
  },
  TOTAL_EMAIL_RECIPIENTS_QUEUED: {
    description: 'Number of emails sent',
    observed: true,
    fields: [{ name: 'recipients', format: '<n>', description: 'The number of emails sent.' }],
  },
  TRANSFORMATION_SUMMARY: {
    description: null,
    observed: false,
    fields: [{ name: 'summaryData', format: '<text>', description: 'Summary data.' }],
  },
  USER_DEBUG: {
    description: 'Line number, logging level, and user-supplied string',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      {
        name: 'level',
        format: '<LEVEL>',
        description: 'The level passed to System.debug, such as DEBUG.',
      },
      {
        name: 'message',
        format: '<text>',
        description: 'The message. Continuation lines carry the rest.',
      },
    ],
  },
  USER_DEBUG_DEBUG: {
    description: null,
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'debugMessage', format: '<text>', description: 'Debug message.' },
    ],
  },
  USER_DEBUG_ERROR: {
    description: null,
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'debugMessage', format: '<text>', description: 'Debug message.' },
    ],
  },
  USER_DEBUG_FINE: {
    description: null,
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'debugMessage', format: '<text>', description: 'Debug message.' },
    ],
  },
  USER_DEBUG_FINER: {
    description: null,
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'debugMessage', format: '<text>', description: 'Debug message.' },
    ],
  },
  USER_DEBUG_FINEST: {
    description: null,
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'debugMessage', format: '<text>', description: 'Debug message.' },
    ],
  },
  USER_DEBUG_INFO: {
    description: null,
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'debugMessage', format: '<text>', description: 'Debug message.' },
    ],
  },
  USER_DEBUG_WARN: {
    description: null,
    observed: false,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'debugMessage', format: '<text>', description: 'Debug message.' },
    ],
  },
  USER_INFO: {
    description: 'Line number, user ID, username, user timezone, and user timezone in GMT',
    observed: true,
    fields: [
      { name: 'line', format: '[EXTERNAL]', description: 'Always [EXTERNAL].' },
      { name: 'userId', format: '<id>', description: 'The user id.' },
      { name: 'username', format: '<text>', description: 'The username.' },
      { name: 'timezone', format: '<text>', description: 'The user timezone.' },
      { name: 'timezoneGmt', format: '<text>', description: 'The user timezone in GMT.' },
    ],
  },
  USER_MODE_PERMSET_APPLIED: {
    description: null,
    observed: false,
    fields: [],
  },
  VALIDATION_ERROR: {
    description: 'Error message',
    observed: false,
    fields: [{ name: 'errorMessage', format: '<text>', description: 'Error message.' }],
  },
  VALIDATION_FAIL: {
    description: null,
    observed: true,
    fields: [],
  },
  VALIDATION_FORMULA: {
    description: 'Formula source and values',
    observed: true,
    fields: [
      { name: 'formula', format: '<text>', description: 'The formula source.' },
      { name: 'values', format: '<text>', description: 'The values it read. On some lines only.' },
    ],
  },
  VALIDATION_PASS: {
    description: null,
    observed: true,
    fields: [],
  },
  VALIDATION_RULE: {
    description: 'Rule name',
    observed: true,
    fields: [
      { name: 'ruleId', format: '<id>', description: 'The validation rule id.' },
      { name: 'ruleName', format: '<text>', description: 'The validation rule name.' },
    ],
  },
  VARIABLE_ASSIGNMENT: {
    description:
      'Line number, variable name (including the variable’s namespace, if applicable), a string representation of the variable’s value, and the variable’s address',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'name', format: '<text>', description: 'The variable, with its namespace if any.' },
      { name: 'value', format: '<text>', description: 'The value, as text.' },
      {
        name: 'address',
        format: '<text>',
        description: 'The address of the value. On some lines only.',
      },
    ],
  },
  VARIABLE_SCOPE_BEGIN: {
    description:
      'Line number, variable name (including the variable’s namespace, if applicable), type, a value that indicates whether the variable can be referenced, and a value that indicates whether the variable is static',
    observed: true,
    fields: [
      {
        name: 'line',
        format: '[<n>]',
        description: 'The line number in the Apex source, or [EXTERNAL] when there is none.',
      },
      { name: 'name', format: '<text>', description: 'The variable, with its namespace if any.' },
      { name: 'type', format: '<text>', description: 'The type.' },
      {
        name: 'isReference',
        format: 'true|false',
        description: 'Whether the variable can be referenced.',
      },
      { name: 'isStatic', format: 'true|false', description: 'Whether the variable is static.' },
    ],
  },
  VARIABLE_SCOPE_END: {
    description: null,
    observed: false,
    fields: [],
  },
  VF_APEX_CALL: {
    description: null,
    observed: false,
    fields: [],
  },
  VF_APEX_CALL_END: {
    description:
      'Element name, method name, return type, and the typeRef for the Visualforce controller (for example, YourApexClass)',
    observed: true,
    fields: [
      {
        name: 'element',
        format: '<text>',
        description: 'The element or controller, as on VF_APEX_CALL_START.',
      },
      { name: 'method', format: '<text>', description: 'The method. On some lines only.' },
    ],
  },
  VF_APEX_CALL_START: {
    description:
      'Element name, method name, return type, and the typeRef for the Visualforce controller (for example, YourApexClass)',
    observed: true,
    fields: [
      { name: 'line', format: '[EXTERNAL]', description: 'Always [EXTERNAL].' },
      {
        name: 'element',
        format: '<id> or <name>',
        description: 'The page element id, or the controller name.',
      },
      {
        name: 'method',
        format: '<text>',
        description: 'The method called, such as a getter or <init>. On some lines only.',
      },
      {
        name: 'controller',
        format: '<typeRef>',
        description: 'The controller class. On some lines only.',
      },
    ],
  },
  VF_DESERIALIZE_CONTINUATION_STATE_BEGIN: {
    description: null,
    observed: false,
    fields: [],
  },
  VF_DESERIALIZE_CONTINUATION_STATE_END: {
    description: null,
    observed: false,
    fields: [],
  },
  VF_DESERIALIZE_VIEWSTATE_BEGIN: {
    description: 'View state ID',
    observed: true,
    fields: [{ name: 'viewStateId', format: '<id>', description: 'The view state id.' }],
  },
  VF_DESERIALIZE_VIEWSTATE_END: {
    description: null,
    observed: true,
    fields: [],
  },
  VF_EVALUATE_FORMULA_BEGIN: {
    description: 'View state ID and formula',
    observed: true,
    fields: [
      { name: 'viewStateId', format: '<id>', description: 'The view state id.' },
      { name: 'formula', format: '<text>', description: 'The formula.' },
    ],
  },
  VF_EVALUATE_FORMULA_END: {
    description: null,
    observed: true,
    fields: [],
  },
  VF_PAGE_MESSAGE: {
    description: 'Message text',
    observed: true,
    fields: [{ name: 'message', format: '<text>', description: 'The message.' }],
  },
  VF_SERIALIZE_CONTINUATION_STATE_BEGIN: {
    description: null,
    observed: false,
    fields: [],
  },
  VF_SERIALIZE_CONTINUATION_STATE_END: {
    description: null,
    observed: false,
    fields: [],
  },
  VF_SERIALIZE_VIEWSTATE_BEGIN: {
    description: 'View state ID',
    observed: true,
    fields: [{ name: 'viewStateId', format: '<id>', description: 'The view state id.' }],
  },
  VF_SERIALIZE_VIEWSTATE_END: {
    description: null,
    observed: true,
    fields: [],
  },
  WAVE_APP_LIFECYCLE: {
    description: null,
    observed: false,
    fields: [{ name: 'lifecycleEvent', format: '<text>', description: 'Lifecycle event.' }],
  },
  WF_ACTION: {
    description: 'Action description',
    observed: true,
    fields: [{ name: 'actionDescription', format: '<text>', description: 'Action description.' }],
  },
  WF_ACTION_TASK: {
    description: 'Task subject, action ID, rule name, rule ID, owner, and due date',
    observed: false,
    fields: [
      { name: 'taskSubject', format: '<text>', description: 'Task subject.' },
      { name: 'actionId', format: '<text>', description: 'Action ID.' },
      { name: 'ruleName', format: '<text>', description: 'Rule name.' },
      { name: 'ruleId', format: '<text>', description: 'Rule ID.' },
      { name: 'owner', format: '<text>', description: 'Owner.' },
      { name: 'dueDate', format: '<text>', description: 'Due date.' },
    ],
  },
  WF_ACTIONS_END: {
    description: 'Summary of actions performed',
    observed: true,
    fields: [
      {
        name: 'summaryActionsPerformed',
        format: '<text>',
        description: 'Summary of actions performed.',
      },
    ],
  },
  WF_APEX_ACTION: {
    description: null,
    observed: false,
    fields: [],
  },
  WF_APPROVAL: {
    description: 'Transition type, EntityName: NameField Id, and process node name',
    observed: true,
    fields: [
      { name: 'transitionType', format: '<text>', description: 'The transition type.' },
      { name: 'record', format: '<sObject>: <name> <id>', description: 'The record.' },
      { name: 'nodeName', format: '<text>', description: 'The process node name.' },
    ],
  },
  WF_APPROVAL_REMOVE: {
    description: 'Logs an approval removal',
    observed: false,
    fields: [
      {
        name: 'record',
        format: '<sObject>: <name> <id>',
        description: 'The record the rule ran on.',
      },
    ],
  },
  WF_APPROVAL_SUBMIT: {
    description: 'Logs an approval submission',
    observed: true,
    fields: [{ name: 'submissionDetails', format: '<text>', description: 'Submission details.' }],
  },
  WF_APPROVAL_SUBMITTER: {
    description: 'Submitter ID, submitter full name, and error message',
    observed: true,
    fields: [
      { name: 'submitterName', format: '<text>', description: 'The submitter.' },
      { name: 'submitterId', format: '<id>', description: 'The submitter id.' },
    ],
  },
  WF_ASSIGN: {
    description: 'Owner and assignee template ID',
    observed: false,
    fields: [
      { name: 'owner', format: '<text>', description: 'Owner.' },
      { name: 'assigneeTemplateId', format: '<text>', description: 'Assignee template ID.' },
    ],
  },
  WF_CHATTER_POST: {
    description: null,
    observed: false,
    fields: [
      { name: 'chatterPostDetails', format: '<text>', description: 'Chatter post details.' },
    ],
  },
  WF_CRITERIA_BEGIN: {
    description:
      'EntityName: NameField Id, rule name, rule ID, and (if rule respects trigger types) trigger type and recursive count',
    observed: true,
    fields: [
      {
        name: 'record',
        format: '<sObject>: <name> <id>',
        description: 'The record the rule ran on.',
      },
      { name: 'ruleName', format: '<text>', description: 'The rule name.' },
      { name: 'ruleId', format: '<id>', description: 'The rule id.' },
      {
        name: 'triggerType',
        format: '<TRIGGER_TYPE>',
        description: 'When the rule runs, such as ON_ALL_CHANGES.',
      },
      { name: 'recursiveCount', format: '<n>', description: 'The recursive count.' },
    ],
  },
  WF_CRITERIA_END: {
    description: 'Boolean value indicating success (true or false)',
    observed: true,
    fields: [
      { name: 'result', format: 'true|false', description: 'Whether the criteria were met.' },
    ],
  },
  WF_EMAIL_ALERT: {
    description: 'Action ID, rule name, and rule ID',
    observed: true,
    fields: [
      {
        name: 'alert',
        format: '<text>',
        description: 'The alert: action id, rule name and rule id.',
      },
    ],
  },
  WF_EMAIL_SENT: {
    description: 'Email template ID, recipients, and CC emails',
    observed: true,
    fields: [
      { name: 'template', format: 'Template:<id>', description: 'The email template.' },
      { name: 'recipients', format: 'Recipients:<…>', description: 'The recipients.' },
      { name: 'ccEmails', format: 'CcEmails:<…>', description: 'The CC emails.' },
    ],
  },
  WF_ENQUEUE_ACTIONS: {
    description: 'Summary of actions enqueued',
    observed: false,
    fields: [
      {
        name: 'summaryActionsEnqueued',
        format: '<text>',
        description: 'Summary of actions enqueued.',
      },
    ],
  },
  WF_ESCALATION_ACTION: {
    description: 'Case ID and escalation date',
    observed: false,
    fields: [
      { name: 'caseId', format: '<text>', description: 'Case ID.' },
      { name: 'escalationDate', format: '<text>', description: 'Escalation date.' },
    ],
  },
  WF_ESCALATION_RULE: {
    description: null,
    observed: false,
    fields: [],
  },
  WF_EVAL_ENTRY_CRITERIA: {
    description:
      'Process name, email template ID, and Boolean value indicating result (true or false)',
    observed: true,
    fields: [
      { name: 'processName', format: '<text>', description: 'The process name.' },
      {
        name: 'emailTemplateId',
        format: '<id>',
        description: 'The email template id. Often empty.',
      },
      { name: 'result', format: 'true|false', description: 'The result.' },
    ],
  },
  WF_FIELD_UPDATE: {
    description: 'EntityName: NameField Id and the object or field name',
    observed: true,
    fields: [
      {
        name: 'record',
        format: '<sObject>: <name> <id>',
        description: 'The record the rule ran on.',
      },
      { name: 'field', format: 'Field:<…>', description: 'The field updated.' },
      { name: 'value', format: 'Value:<…>', description: 'The new value.' },
      { name: 'detail', format: '<text>', description: 'Not documented.' },
      {
        name: 'currentRule',
        format: 'CurrentRule:<…>',
        description: 'The rule that made the update. On some lines only.',
      },
    ],
  },
  WF_FLOW_ACTION_BEGIN: {
    description: 'ID of flow trigger',
    observed: true,
    fields: [{ name: 'flowTriggerId', format: '<id>', description: 'The flow trigger id.' }],
  },
  WF_FLOW_ACTION_DETAIL: {
    description:
      'ID of flow trigger, object type and ID of record whose creation or update caused the workflow rule to fire, name and ID of workflow rule, and the names and values of flow variables',
    observed: true,
    fields: [
      {
        name: 'first',
        format: '<id> or Param Name:<…>',
        description: 'The flow trigger id, or the first parameter.',
      },
      {
        name: 'second',
        format: '<text>',
        description: 'The object type, or the second parameter.',
      },
      { name: 'third', format: '<text>', description: 'Not documented. On some lines only.' },
      {
        name: 'currentRule',
        format: 'CurrentRule:<…>',
        description: 'The rule. On some lines only.',
      },
    ],
  },
  WF_FLOW_ACTION_END: {
    description: 'ID of flow trigger',
    observed: true,
    fields: [{ name: 'flowTriggerId', format: '<id>', description: 'The flow trigger id.' }],
  },
  WF_FLOW_ACTION_ERROR: {
    description:
      'ID of flow trigger, ID of flow definition, ID of flow version, and flow error message',
    observed: true,
    fields: [
      { name: 'flowTriggerId', format: '<id>', description: 'The flow trigger id.' },
      { name: 'flowDefinitionId', format: '<id>', description: 'The flow definition id.' },
      { name: 'message', format: 'Error executing flow: <…>', description: 'The error message.' },
    ],
  },
  WF_FLOW_ACTION_ERROR_DETAIL: {
    description: 'Detailed flow error message',
    observed: true,
    fields: [{ name: 'message', format: '<text>', description: 'The detailed error message.' }],
  },
  WF_FORMULA: {
    description: 'Formula source and values',
    observed: true,
    fields: [
      { name: 'formula', format: 'Formula:<…>', description: 'The formula source.' },
      {
        name: 'values',
        format: 'Values:<…>',
        description: 'The values it read. On some lines only.',
      },
    ],
  },
  WF_HARD_REJECT: {
    description: null,
    observed: false,
    fields: [],
  },
  WF_KNOWLEDGE_ACTION: {
    description: 'Logs a workflow knowledge action',
    observed: false,
    fields: [{ name: 'actionDetails', format: '<text>', description: 'Action details.' }],
  },
  WF_NEXT_APPROVER: {
    description: 'Owner, next owner type, and field',
    observed: true,
    fields: [
      { name: 'owner', format: '<text>', description: 'The owner.' },
      { name: 'nextOwnerType', format: '<text>', description: 'The next owner type.' },
      { name: 'field', format: '<text>', description: 'The field. Often empty.' },
    ],
  },
  WF_NO_PROCESS_FOUND: {
    description: null,
    observed: false,
    fields: [],
  },
  WF_OUTBOUND_MSG: {
    description: 'EntityName: NameField Id, action ID, rule name, and rule ID',
    observed: false,
    fields: [
      {
        name: 'record',
        format: '<sObject>: <name> <id>',
        description: 'The record the rule ran on.',
      },
      { name: 'actionId', format: '<id>', description: 'The action id.' },
      { name: 'ruleName', format: '<text>', description: 'The rule name.' },
      { name: 'ruleId', format: '<id>', description: 'The rule id.' },
    ],
  },
  WF_PROCESS_FOUND: {
    description: 'Process definition ID and process label',
    observed: true,
    fields: [
      {
        name: 'process',
        format: 'ProcessDefinitionNameOrId:<…>',
        description: 'The process definition.',
      },
      { name: 'label', format: '<text>', description: 'The process label.' },
    ],
  },
  WF_PROCESS_NODE: {
    description: 'Process name',
    observed: true,
    fields: [{ name: 'processName', format: '<text>', description: 'Process name.' }],
  },
  WF_QUICK_CREATE: {
    description: 'Logs a workflow quick create action',
    observed: false,
    fields: [],
  },
  WF_REASSIGN_RECORD: {
    description: 'EntityName: NameField Id and owner',
    observed: false,
    fields: [
      {
        name: 'record',
        format: '<sObject>: <name> <id>',
        description: 'The record the rule ran on.',
      },
      { name: 'owner', format: '<text>', description: 'The new owner.' },
    ],
  },
  WF_RESPONSE_NOTIFY: {
    description: 'Notifier name, notifier email, notifier template ID, and reply-to email',
    observed: false,
    fields: [
      { name: 'notifierName', format: '<text>', description: 'Notifier name.' },
      { name: 'notifierEmail', format: '<text>', description: 'Notifier email.' },
      { name: 'notifierTemplateId', format: '<text>', description: 'Notifier template ID.' },
      { name: 'replyEmail', format: '<text>', description: 'Reply-to email.' },
    ],
  },
  WF_RULE_ENTRY_ORDER: {
    description: 'Integer indicating order',
    observed: false,
    fields: [
      {
        name: 'integerIndicatingOrder',
        format: '<text>',
        description: 'Integer indicating order.',
      },
    ],
  },
  WF_RULE_EVAL_BEGIN: {
    description: 'Rule type',
    observed: true,
    fields: [{ name: 'ruleType', format: '<text>', description: 'Rule type.' }],
  },
  WF_RULE_EVAL_END: {
    description: null,
    observed: true,
    fields: [],
  },
  WF_RULE_EVAL_VALUE: {
    description: 'Value',
    observed: true,
    fields: [{ name: 'value', format: '<text>', description: 'Value.' }],
  },
  WF_RULE_FILTER: {
    description: 'Filter criteria',
    observed: true,
    fields: [{ name: 'filterCriteria', format: '<text>', description: 'Filter criteria.' }],
  },
  WF_RULE_INVOCATION: {
    description: 'Logs a workflow rule invocation',
    observed: true,
    fields: [{ name: 'rule', format: '<text>', description: 'The rule name and object type.' }],
  },
  WF_RULE_NOT_EVALUATED: {
    description: null,
    observed: true,
    fields: [],
  },
  WF_SEND_ACTION: {
    description: 'Logs a workflow send action',
    observed: false,
    fields: [],
  },
  WF_SOFT_REJECT: {
    description: 'Process name',
    observed: false,
    fields: [{ name: 'processName', format: '<text>', description: 'Process name.' }],
  },
  WF_SPOOL_ACTION_BEGIN: {
    description: 'Node type',
    observed: true,
    fields: [{ name: 'nodeType', format: '<text>', description: 'Node type.' }],
  },
  WF_TIME_TRIGGER: {
    description:
      'EntityName: NameField Id, time action, time action container, and evaluation Datetime',
    observed: true,
    fields: [
      { name: 'record', format: '<sObject>: <name> <id>', description: 'The record.' },
      { name: 'timeAction', format: '<text>', description: 'The time action.' },
      { name: 'timeActionContainer', format: '<text>', description: 'The time action container.' },
      {
        name: 'evaluationTime',
        format: '<datetime>',
        description: 'The evaluation date and time.',
      },
    ],
  },
  WF_TIME_TRIGGERS_BEGIN: {
    description: null,
    observed: true,
    fields: [],
  },
  XDS_DETAIL: {
    description:
      'For OData adapters, the POST body and the name and evaluated formula for custom HTTP headers',
    observed: false,
    fields: [
      {
        name: 'detail',
        format: '<text>',
        description:
          'For OData adapters, the POST body, and the name and evaluated formula of each custom HTTP header.',
      },
    ],
  },
  XDS_REQUEST_DETAIL: {
    description: null,
    observed: false,
    fields: [{ name: 'requestDetail', format: '<text>', description: 'Request detail.' }],
  },
  XDS_RESPONSE: {
    description:
      'External data source, external object, request details, number of returned records, and system usage',
    observed: false,
    fields: [
      { name: 'externalDataSource', format: '<text>', description: 'External data source.' },
      { name: 'externalObject', format: '<text>', description: 'External object.' },
      { name: 'requestDetails', format: '<text>', description: 'Request details.' },
      {
        name: 'numberReturnedRecords',
        format: '<text>',
        description: 'Number of returned records.',
      },
      { name: 'systemUsage', format: '<text>', description: 'System usage.' },
    ],
  },
  XDS_RESPONSE_DETAIL: {
    description: 'Truncated response from the external system, including returned records',
    observed: false,
    fields: [
      {
        name: 'response',
        format: '<text>',
        description: 'The truncated response from the external system, with the returned records.',
      },
    ],
  },
  XDS_RESPONSE_ERROR: {
    description: 'Error message',
    observed: false,
    fields: [{ name: 'errorMessage', format: '<text>', description: 'Error message.' }],
  },
} as const;
