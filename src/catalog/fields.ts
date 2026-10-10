/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * What each event type's line holds, field by field, for editors and readers. Type only: none of
 * this text reaches a bundle.
 *
 * Every line is `<time>|<TYPE>|<field 2>|<field 3>|…`, split on `|`. Each type's members are its
 * fields from field 2 on, in line order, the order its `ENTRIES` entry lists them. A `Format`
 * shows the raw shape: `<n>` a number, `<id>` a Salesforce id, `<text>` free text, and a prefix
 * such as `Rows:` is literal. A field is null when the line does not state it. The type's own doc
 * is the Salesforce description; `scripts/__tests__/CatalogDocs.test.ts` keeps it in step.
 */
export interface EventFields {
  /** Salesforce does not describe this type. */
  ADD_SCREEN_POP_ACTION: Record<never, never>;
  /** Salesforce does not describe this type. */
  ADD_SKILL_REQUIREMENT_ACTION: Record<never, never>;
  /** Salesforce does not describe this type. */
  AE_PERSIST_VALIDATION: Record<never, never>;
  /** Salesforce does not describe this type. */
  APP_ANALYTICS_ERROR: Record<never, never>;
  /** Salesforce does not describe this type. */
  APP_ANALYTICS_FINE: Record<never, never>;
  /** Salesforce does not describe this type. */
  APP_ANALYTICS_WARN: Record<never, never>;
  /** Salesforce does not describe this type. */
  APP_CONTAINER_INITIATED: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  ASSET_DIFF_DETAIL: {
    /** Diff detail. Format: `<text>`. */
    readonly diffDetail: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  ASSET_DIFF_SUMMARY: {
    /** Diff summary. Format: `<text>`. */
    readonly diffSummary: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  BULK_COUNTABLE_STATEMENT_EXECUTE: {
    /** Bulk statement execution count. Format: `<text>`. */
    readonly bulkStatementExecution: string | null;
  };
  /** Salesforce does not describe this type. */
  BULK_DML_RETRY: Record<never, never>;
  /**
   * Number of bytes allocated
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  BULK_HEAP_ALLOCATE: {
    /** Bytes allocated. Format: `Bytes:<n>`. */
    readonly bytes: string | null;
  };
  /** Line number and request headers */
  CALLOUT_REQUEST: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The request: endpoint, method and headers. Format: `<text>`. */
    readonly request: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  CALLOUT_REQUEST_FINALIZE: {
    /** Finalization details. Format: `<text>`. */
    readonly finalizationDetails: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  CALLOUT_REQUEST_PREPARE: {
    /** Preparation details. Format: `<text>`. */
    readonly preparationDetails: string | null;
  };
  /** Line number and response body */
  CALLOUT_RESPONSE: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The response status and body. Format: `<text>`. */
    readonly response: string | null;
  };
  /**
   * Line number, code unit name, such as MyTrigger on Account trigger event BeforeInsert for [new], and: For Apex methods, the namespace (if applicable), class name, and method name; for example, YourNamespace.YourClass.yourMethod() or YourClass.yourMethod() For Apex triggers, a typeRef; for example, __sfdc_trigger/YourNamespace.YourTrigger or __sfdc_trigger/YourTrigger
   */
  CODE_UNIT_FINISHED: {
    /** The code unit, as its CODE_UNIT_STARTED line names it. Format: `<text>`. */
    readonly name: string | null;
    /** The type reference. On some lines only. Format: `<typeRef>`. */
    readonly typeRef: string | null;
  };
  /**
   * Line number, code unit name, such as MyTrigger on Account trigger event BeforeInsert for [new], and: For Apex methods, the namespace (if applicable), class name, and method name; for example, YourNamespace.YourClass.yourMethod() or YourClass.yourMethod() For Apex triggers, a typeRef; for example, __sfdc_trigger/YourTrigger
   */
  CODE_UNIT_STARTED: {
    /** Always [EXTERNAL]. Format: `[EXTERNAL]`. */
    readonly line: string | null;
    /** The code unit type and name, such as Validation:Account:<id>, or the id of a trigger or class. Format: `<type>:<name> or <id>`. */
    readonly unit: string | null;
    /** The code unit name, such as a trigger name or method signature. On some lines only. Format: `<text>`. */
    readonly name: string | null;
    /** The type reference, such as __sfdc_trigger/MyTrigger. On some lines only. Format: `<typeRef>`. */
    readonly typeRef: string | null;
  };
  /**
   * Line number, Apex class ID, the string &lt;init&gt;() with the types of parameters (if any) between the parentheses, and a typeRef; for example, YourClass or YourClass.YourInnerClass
   */
  CONSTRUCTOR_ENTRY: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The Apex class id. Format: `<id>`. */
    readonly classId: string | null;
    /** The constructor, with its parameter types. Format: `<init>(<types>)`. */
    readonly signature: string | null;
    /** The class, such as MyClass or ns.MyClass.MyInner. Format: `<typeRef>`. */
    readonly className: string | null;
  };
  /**
   * Line number, the string &lt;init&gt;() with the types of parameters (if any) between the parentheses, and a typeRef; for example, YourClass or YourClass.YourInnerClass
   */
  CONSTRUCTOR_EXIT: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The Apex class id. Format: `<id>`. */
    readonly classId: string | null;
    /** The constructor, with its parameter types. Format: `<init>(<types>)`. */
    readonly signature: string | null;
    /** The class, such as MyClass or ns.MyClass.MyInner. Format: `<typeRef>`. */
    readonly className: string | null;
  };
  /** Salesforce does not describe this type. */
  CUMULATIVE_LIMIT_USAGE: Record<never, never>;
  /** Salesforce does not describe this type. */
  CUMULATIVE_LIMIT_USAGE_END: Record<never, never>;
  /** Salesforce does not describe this type. */
  CUMULATIVE_PROFILING: {
    /** The profiling section. Format: `<text>`. */
    readonly section: string | null;
    /** More detail, often empty. The figures follow as continuation lines. Format: `<text>`. */
    readonly detail: string | null;
  };
  /** Salesforce does not describe this type. */
  CUMULATIVE_PROFILING_BEGIN: Record<never, never>;
  /** Salesforce does not describe this type. */
  CUMULATIVE_PROFILING_END: Record<never, never>;
  /**
   * Line number and SOQL query This event occurs when you call Database.getCursor() or Database.getPaginationCursor().
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  CURSOR_CREATE_BEGIN: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** SOQL query. Format: `<text>`. */
    readonly soqlQuery: string | null;
  };
  /**
   * Line number, query ID, and number of rows in the result set This event occurs when a cursor or pagination cursor is created.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  CURSOR_CREATE_END: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Query ID. Format: `<text>`. */
    readonly queryId: string | null;
    /** Number of rows in result set. Format: `<text>`. */
    readonly numberRowsResult: string | null;
  };
  /**
   * Line number, query ID, cursor offset position, and number of rows fetched This event occurs when you call Cursor.fetch().
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  CURSOR_FETCH: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Query ID. Format: `<text>`. */
    readonly queryId: string | null;
    /** Cursor offset position. Format: `<text>`. */
    readonly cursorOffsetPosition: string | null;
    /** Number of rows fetched. Format: `<text>`. */
    readonly numberRowsFetched: string | null;
  };
  /**
   * Line number, query ID, cursor offset position, and number of rows on the current page This event occurs when you call PaginationCursor.fetchPage().
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  CURSOR_FETCH_PAGE: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Query ID. Format: `<text>`. */
    readonly queryId: string | null;
    /** Cursor offset position. Format: `<text>`. */
    readonly cursorOffsetPosition: string | null;
    /** Number of rows on current page. Format: `<text>`. */
    readonly numberRowsCurrent: string | null;
  };
  /**
   * Request and Response for the data access request. Used regardless of the data space or policy being accessed.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  DATA_ACCESS_EVALUATION: {
    /** Request. Format: `<text>`. */
    readonly request: string | null;
    /** Response for the data access request. Used regardless of the data space or policy being accessed. Format: `<text>`. */
    readonly responseDataAccess: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  DATAWEAVE_USER_DEBUG: {
    /** Debug output. Format: `<text>`. */
    readonly debugOutput: string | null;
  };
  /**
   * Line number, operation (such as Insert or Update), record name or type, and number of rows passed into DML operation
   */
  DML_BEGIN: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The DML operation, such as Insert or Update. Format: `Op:<operation>`. */
    readonly operation: string | null;
    /** The sObject type. Format: `Type:<sObject>`. */
    readonly objectType: string | null;
    /** The rows passed to the operation. Format: `Rows:<n>`. */
    readonly rows: string | null;
  };
  /** Line number */
  DML_END: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
  };
  /** Salesforce does not describe this type. */
  DUPLICATE_DETECTION_BEGIN: Record<never, never>;
  /** Salesforce does not describe this type. */
  DUPLICATE_DETECTION_END: Record<never, never>;
  /** Salesforce does not describe this type. */
  DUPLICATE_DETECTION_MATCH_INVOCATION_DETAILS: {
    /** The sObject type checked. Format: `EntityType:<sObject>`. */
    readonly entityType: string | null;
    /** What the rule did, such as Allow. Format: `ActionTaken:<action>`. */
    readonly actionTaken: string | null;
    /** The ids of the duplicates found. Format: `DuplicateRecordIds:<ids>`. */
    readonly duplicateRecordIds: string | null;
  };
  /** Salesforce does not describe this type. */
  DUPLICATE_DETECTION_MATCH_INVOCATION_SUMMARY: {
    /** The sObject type checked. Format: `EntityType:<sObject>`. */
    readonly entityType: string | null;
    /** The records about to be saved. Format: `NumRecordsToBeSaved:<n>`. */
    readonly recordsToBeSaved: string | null;
    /** Not documented. Format: `<text>`. */
    readonly detail: string | null;
    /** The duplicates found. Format: `NumDuplicateRecordsFound:<n>`. */
    readonly duplicatesFound: string | null;
  };
  /** Salesforce does not describe this type. */
  DUPLICATE_DETECTION_RULE_INVOCATION: {
    /** The duplicate rule id. Format: `DuplicateRuleId:<id>`. */
    readonly ruleId: string | null;
    /** The duplicate rule name. Format: `DuplicateRuleName:<name>`. */
    readonly ruleName: string | null;
    /** The DML operation that ran the rule. Format: `DmlType:<operation>`. */
    readonly dmlType: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  DUPLICATE_RULE_FILTER: {
    /** Filter criteria. Format: `<text>`. */
    readonly filterCriteria: string | null;
  };
  /** Salesforce does not describe this type. */
  DUPLICATE_RULE_FILTER_INVOCATION: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  DUPLICATE_RULE_FILTER_RESULT: {
    /** Filter result. Format: `<text>`. */
    readonly filterResult: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  DUPLICATE_RULE_FILTER_VALUE: {
    /** Filter value. Format: `<text>`. */
    readonly filterValue: string | null;
  };
  /** Line number */
  EMAIL_QUEUE: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The queued email: reply-to, subject and recipients. Format: `replyTo:<…>`. */
    readonly email: string | null;
  };
  /** Salesforce does not describe this type. */
  END_CALL: Record<never, never>;
  /** Package namespace */
  ENTERING_MANAGED_PKG: {
    /** The managed package namespace. The text after the last dot is the namespace. Format: `<namespace>`. */
    readonly namespace: string | null;
  };
  /**
   * Event Type
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  EVENT_SERVICE_PUB_BEGIN: {
    /** Event Type. Format: `<text>`. */
    readonly eventType: string | null;
  };
  /**
   * Subscription IDs, ID of the user who published the event, and event message data
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  EVENT_SERVICE_PUB_DETAIL: {
    /** Subscription IDs. Format: `<text>`. */
    readonly subscriptionIds: string | null;
    /** ID of the user who published the event. Format: `<id>`. */
    readonly userId: string | null;
    /** Event message data. Format: `<text>`. */
    readonly eventMessageData: string | null;
  };
  /**
   * Event Type
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  EVENT_SERVICE_PUB_END: {
    /** Event Type. Format: `<text>`. */
    readonly eventType: string | null;
  };
  /**
   * Event type and action (subscribe or unsubscribe)
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  EVENT_SERVICE_SUB_BEGIN: {
    /** Event type. Format: `<text>`. */
    readonly eventType: string | null;
    /** Action (subscribe or unsubscribe). Format: `<text>`. */
    readonly action: string | null;
  };
  /**
   * ID of the subscription, ID of the subscription instance, reference data (such as process API name), ID of the user who activated or deactivated the subscription, and event message data
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  EVENT_SERVICE_SUB_DETAIL: {
    /** ID of the subscription. Format: `<id>`. */
    readonly subscriptionId: string | null;
    /** ID of the subscription instance. Format: `<id>`. */
    readonly subscriptionInstanceId: string | null;
    /** Reference data (such as process API name). Format: `<text>`. */
    readonly referenceData: string | null;
    /** ID of the user who activated or deactivated the subscription. Format: `<id>`. */
    readonly userId: string | null;
    /** Event message data. Format: `<text>`. */
    readonly eventMessageData: string | null;
  };
  /**
   * Event type and action (subscribe or unsubscribe)
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  EVENT_SERVICE_SUB_END: {
    /** Event type. Format: `<text>`. */
    readonly eventType: string | null;
    /** Action (subscribe or unsubscribe). Format: `<text>`. */
    readonly action: string | null;
  };
  /** Line number, exception type, and message */
  EXCEPTION_THROWN: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The exception type and message. Continuation lines carry the rest. Format: `<type>: <message>`. */
    readonly exception: string | null;
  };
  /** Salesforce does not describe this type. */
  EXECUTION_FINISHED: Record<never, never>;
  /** Salesforce does not describe this type. */
  EXECUTION_STARTED: Record<never, never>;
  /** Salesforce does not describe this type. */
  EXTERNAL_SERVICE_CALLBACK: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  EXTERNAL_SERVICE_REQUEST: {
    /** Request details. Format: `<text>`. */
    readonly requestDetails: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  EXTERNAL_SERVICE_RESPONSE: {
    /** Response details. Format: `<text>`. */
    readonly responseDetails: string | null;
  };
  /** Exception type, message, and stack trace */
  FATAL_ERROR: {
    /** The exception type and message. The stack trace follows as continuation lines. Format: `<type>: <message>`. */
    readonly exception: string | null;
  };
  /**
   * Interview ID, element name, action type, action enum or ID, whether the action call succeeded, and error message
   */
  FLOW_ACTIONCALL_DETAIL: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The action call element. Format: `<text>`. */
    readonly elementName: string | null;
    /** The action type. Format: `<text>`. */
    readonly actionType: string | null;
    /** The action enum or id. Format: `<text>`. */
    readonly action: string | null;
    /** Whether the action call succeeded. Format: `true|false`. */
    readonly succeeded: string | null;
    /** The error message, if any. Format: `<text>`. */
    readonly error: string | null;
  };
  /** Interview ID, reference, operator, and value */
  FLOW_ASSIGNMENT_DETAIL: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The variable assigned. Format: `<text>`. */
    readonly reference: string | null;
    /** The operator, such as ASSIGN or ADD. Format: `<OPERATOR>`. */
    readonly operator: string | null;
    /** The value. Format: `<text>`. */
    readonly value: string | null;
  };
  /** Interview ID and element type */
  FLOW_BULK_ELEMENT_BEGIN: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The element type. Format: `<text>`. */
    readonly elementType: string | null;
  };
  /** Interview ID, element type, element name, number of records */
  FLOW_BULK_ELEMENT_DETAIL: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The element. Salesforce documents four fields; real lines state three. Format: `<text>`. */
    readonly element: string | null;
    /** The number of records. Format: `<n>`. */
    readonly records: string | null;
  };
  /** Interview ID, element type, element name, number of records, and execution time */
  FLOW_BULK_ELEMENT_END: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The element. Salesforce documents five fields; real lines state four. Format: `<text>`. */
    readonly element: string | null;
    /** The number of records. Format: `<n>`. */
    readonly records: string | null;
    /** The execution time. Format: `<n>`. */
    readonly executionTime: string | null;
  };
  /**
   * Incremented usage toward a limit for this bulk element. Each event displays the usage for one of these limits.SOQL queries SOQL query rows SOSL queries DML statements DML rows CPU time in ms Heap size in bytes Callouts Email invocations Future calls Jobs in queue Push notifications
   */
  FLOW_BULK_ELEMENT_LIMIT_USAGE: {
    /** The usage this element added toward a limit. Format: `<n> <limit>, <used> out of <max>`. */
    readonly usage: string | null;
  };
  /**
   * Operation, element name, and entity name that doesn’t support bulk operations
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_BULK_ELEMENT_NOT_SUPPORTED: {
    /** Operation. Format: `<text>`. */
    readonly operation: string | null;
    /** Element name. Format: `<text>`. */
    readonly elementName: string | null;
    /** Entity name that doesn’t support bulk operations. Format: `<text>`. */
    readonly entityNameDoesn: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_COLLECTION_PROCESSOR_DETAIL: {
    /** Processor details. Format: `<text>`. */
    readonly processorDetails: string | null;
  };
  /** Organization ID, definition ID, and version ID */
  FLOW_CREATE_INTERVIEW_BEGIN: {
    /** The organization id. Format: `<id>`. */
    readonly orgId: string | null;
    /** The flow definition id. Format: `<id>`. */
    readonly definitionId: string | null;
    /** The flow version id. Empty on some lines. Format: `<id>`. */
    readonly versionId: string | null;
  };
  /** Interview ID and flow name */
  FLOW_CREATE_INTERVIEW_END: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The flow name. Format: `<text>`. */
    readonly flowName: string | null;
  };
  /**
   * Message, organization ID, definition ID, and version ID
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_CREATE_INTERVIEW_ERROR: {
    /** Message. Format: `<text>`. */
    readonly message: string | null;
    /** Organization ID. Format: `<text>`. */
    readonly organizationId: string | null;
    /** Definition ID. Format: `<text>`. */
    readonly definitionId: string | null;
    /** Version ID. Format: `<text>`. */
    readonly versionId: string | null;
  };
  /** Interview ID, element type, and element name */
  FLOW_ELEMENT_BEGIN: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The element type. Format: `<text>`. */
    readonly elementType: string | null;
    /** The element name. Format: `<text>`. */
    readonly elementName: string | null;
  };
  /** Element type and element name */
  FLOW_ELEMENT_DEFERRED: {
    /** The element type. Format: `<text>`. */
    readonly elementType: string | null;
    /** The element name. Format: `<text>`. */
    readonly elementName: string | null;
  };
  /** Interview ID, element type, and element name */
  FLOW_ELEMENT_END: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The element type. Format: `<text>`. */
    readonly elementType: string | null;
    /** The element name. Format: `<text>`. */
    readonly elementName: string | null;
  };
  /** Message, element type, and element name (flow runtime exception) */
  FLOW_ELEMENT_ERROR: {
    /** The error message. Format: `<text>`. */
    readonly message: string | null;
    /** The element type. On some lines only. Format: `<text>`. */
    readonly elementType: string | null;
    /** The element name. On some lines only. Format: `<text>`. */
    readonly elementName: string | null;
  };
  /**
   * Message, element type, and element name (fault path taken)
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_ELEMENT_FAULT: {
    /** Message. Format: `<text>`. */
    readonly message: string | null;
    /** Element type. Format: `<text>`. */
    readonly elementType: string | null;
    /** Element name (fault path taken). Format: `<text>`. */
    readonly elementName: string | null;
  };
  /**
   * Incremented usage toward a limit for this element. Each event displays the usage for one of these limits. SOQL queries SOQL query rows SOSL queries DML statements DML rows CPU time in ms Heap size in bytes Callouts Email invocations Future calls Jobs in queue Push notifications
   */
  FLOW_ELEMENT_LIMIT_USAGE: {
    /** The usage this element added toward a limit. Format: `<n> <limit>, <used> out of <max>`. */
    readonly usage: string | null;
  };
  /** Salesforce does not describe this type. */
  FLOW_INTERVIEW_FINISHED: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The flow name. Format: `<text>`. */
    readonly flowName: string | null;
  };
  /**
   * Usage toward a limit when the interview finishes. Each event displays the usage for one of these limits.SOQL queries SOQL query rows SOSL queries DML statements DML rows CPU time in ms Heap size in bytes Callouts Email invocations Future calls Jobs in queue Push notifications
   */
  FLOW_INTERVIEW_FINISHED_LIMIT_USAGE: {
    /** The usage toward one limit. Format: `<limit>: <used> out of <max>`. */
    readonly usage: string | null;
  };
  /**
   * Interview ID, flow name, and why the user paused
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_INTERVIEW_PAUSED: {
    /** Interview ID. Format: `<text>`. */
    readonly interviewId: string | null;
    /** Flow name. Format: `<text>`. */
    readonly flowName: string | null;
    /** Why the user paused. Format: `<text>`. */
    readonly userPaused: string | null;
  };
  /**
   * Interview ID and flow name
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_INTERVIEW_RESUMED: {
    /** Interview ID. Format: `<text>`. */
    readonly interviewId: string | null;
    /** Flow name. Format: `<text>`. */
    readonly flowName: string | null;
  };
  /**
   * Interview ID, index, and value The index is the position in the collection variable for the item that the loop is operating on.
   */
  FLOW_LOOP_DETAIL: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The loop index. Format: `<n>`. */
    readonly index: string | null;
    /** The current item. Format: `<text>`. */
    readonly value: string | null;
  };
  /** Interview ID, rule name, and result */
  FLOW_RULE_DETAIL: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The rule name. Format: `<text>`. */
    readonly ruleName: string | null;
    /** The rule result. Salesforce documents three fields; real lines state four. Format: `<text>`. */
    readonly result: string | null;
    /** Not documented. Format: `<text>`. */
    readonly detail: string | null;
  };
  /** Salesforce does not describe this type. */
  FLOW_SCHEDULED_PATH_QUEUED: Record<never, never>;
  /**
   * Logs flow screen element details
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_SCREEN_DETAIL: {
    /** Screen details. Format: `<text>`. */
    readonly screenDetails: string | null;
  };
  /** Interview ID and flow name */
  FLOW_START_INTERVIEW_BEGIN: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The flow name. Format: `<text>`. */
    readonly flowName: string | null;
  };
  /** Interview ID and flow name */
  FLOW_START_INTERVIEW_END: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The flow name. Format: `<text>`. */
    readonly flowName: string | null;
  };
  /**
   * Usage toward a limit at the interview’s start time. Each event displays the usage for one of these limits.SOQL queries SOQL query rows SOSL queries DML statements DML rows CPU time in ms Heap size in bytes Callouts Email invocations Future calls Jobs in queue Push notifications
   */
  FLOW_START_INTERVIEW_LIMIT_USAGE: {
    /** The usage toward one limit. Format: `<limit>: <used> out of <max>`. */
    readonly usage: string | null;
  };
  /** Requests */
  FLOW_START_INTERVIEWS_BEGIN: {
    /** The number of interviews requested. Format: `<n>`. */
    readonly requests: string | null;
  };
  /** Requests */
  FLOW_START_INTERVIEWS_END: {
    /** The number of interviews requested. Format: `<n>`. */
    readonly requests: string | null;
  };
  /** Message, interview ID, and flow name */
  FLOW_START_INTERVIEWS_ERROR: {
    /** The error message. Format: `<text>`. */
    readonly message: string | null;
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The flow name. Format: `<text>`. */
    readonly flowName: string | null;
  };
  /**
   * Message and number of records that the flow runs for
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_START_SCHEDULED_RECORDS: {
    /** Message. Format: `<text>`. */
    readonly message: string | null;
    /** Number of records that the flow runs for. Format: `<text>`. */
    readonly numberRecordsFlow: string | null;
  };
  /**
   * Interview ID, name, definition ID, and version ID
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_SUBFLOW_DETAIL: {
    /** Interview ID. Format: `<text>`. */
    readonly interviewId: string | null;
    /** Name. Format: `<text>`. */
    readonly name: string | null;
    /** Definition ID. Format: `<text>`. */
    readonly definitionId: string | null;
    /** Version ID. Format: `<text>`. */
    readonly versionId: string | null;
  };
  /** Interview ID, key, and value */
  FLOW_VALUE_ASSIGNMENT: {
    /** The flow interview id. Format: `<id>`. */
    readonly interviewId: string | null;
    /** The variable assigned. Format: `<text>`. */
    readonly key: string | null;
    /** The value. Format: `<text>`. */
    readonly value: string | null;
  };
  /**
   * Interview ID, element name, event name, and event type
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_WAIT_EVENT_RESUMING_DETAIL: {
    /** Interview ID. Format: `<text>`. */
    readonly interviewId: string | null;
    /** Element name. Format: `<text>`. */
    readonly elementName: string | null;
    /** Event name. Format: `<text>`. */
    readonly eventName: string | null;
    /** Event type. Format: `<text>`. */
    readonly eventType: string | null;
  };
  /**
   * Interview ID, element name, event name, event type, and whether conditions were met
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_WAIT_EVENT_WAITING_DETAIL: {
    /** Interview ID. Format: `<text>`. */
    readonly interviewId: string | null;
    /** Element name. Format: `<text>`. */
    readonly elementName: string | null;
    /** Event name. Format: `<text>`. */
    readonly eventName: string | null;
    /** Event type. Format: `<text>`. */
    readonly eventType: string | null;
    /** Whether conditions were met. Format: `<text>`. */
    readonly conditionsMet: string | null;
  };
  /**
   * Interview ID, element name, and persisted interview ID
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_WAIT_RESUMING_DETAIL: {
    /** Interview ID. Format: `<text>`. */
    readonly interviewId: string | null;
    /** Element name. Format: `<text>`. */
    readonly elementName: string | null;
    /** Persisted interview ID. Format: `<text>`. */
    readonly persistedInterviewId: string | null;
  };
  /**
   * Interview ID, element name, number of events that the element is waiting for, and persisted interview ID
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FLOW_WAIT_WAITING_DETAIL: {
    /** Interview ID. Format: `<text>`. */
    readonly interviewId: string | null;
    /** Element name. Format: `<text>`. */
    readonly elementName: string | null;
    /** Number of events that the element is waiting for. Format: `<text>`. */
    readonly numberEventsElement: string | null;
    /** Persisted interview ID. Format: `<text>`. */
    readonly persistedInterviewId: string | null;
  };
  /** Salesforce does not describe this type. */
  FOR_UPDATE_LOCKS_RELEASE: Record<never, never>;
  /** Salesforce does not describe this type. */
  FORMULA_BUILD: Record<never, never>;
  /** Salesforce does not describe this type. */
  FORMULA_EVALUATE_BEGIN: Record<never, never>;
  /** Salesforce does not describe this type. */
  FORMULA_EVALUATE_END: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FUNCTION_INVOCATION_REQUEST: {
    /** Invocation request details. Format: `<text>`. */
    readonly invocationRequestDetails: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  FUNCTION_INVOCATION_RESPONSE: {
    /** Invocation response details. Format: `<text>`. */
    readonly invocationResponseDetails: string | null;
  };
  /** Line number and number of bytes */
  HEAP_ALLOCATE: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Bytes allocated. Format: `Bytes:<n>`. */
    readonly bytes: string | null;
  };
  /**
   * Line number and number of bytes deallocated
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  HEAP_DEALLOCATE: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Bytes freed. Format: `Bytes:<n>`. */
    readonly bytes: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  HEAP_DUMP: {
    /** Heap dump data. Format: `<text>`. */
    readonly heapDumpData: string | null;
  };
  /**
   * Line number
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  IDEAS_QUERY_EXECUTE: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  INVOCABLE_ACTION_DETAIL: {
    /** Action details. Format: `<text>`. */
    readonly actionDetails: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  INVOCABLE_ACTION_ERROR: {
    /** Error details. Format: `<text>`. */
    readonly errorDetails: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  JSON_DIFF_DETAIL: {
    /** Diff detail. Format: `<text>`. */
    readonly diffDetail: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  JSON_DIFF_SUMMARY: {
    /** Diff summary. Format: `<text>`. */
    readonly diffSummary: string | null;
  };
  /**
   * Per-operation governor limit usage. Tracks incremental usage per statement. Limit names include: DML, DML_ROWS, SOQL, SOQL_ROWS, AGGS, FIELDS_DESCRIBES, APEX_CURSOR_SOQL_ROWS, APEX_CURSORS, and others.
   */
  LIMIT_USAGE: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The limit, such as SOQL or DML_ROWS. Format: `<LIMIT>`. */
    readonly limit: string | null;
    /** The usage so far. Format: `<n>`. */
    readonly used: string | null;
    /** The limit. Format: `<n>`. */
    readonly max: string | null;
  };
  /**
   * Namespace and these limits:Number of SOQL queries Number of query rows Number of SOSL queries Number of DML statements Number of DML rows Number of code statements Maximum heap size Number of callouts Number of Email Invocations Number of fields describes Number of record type describes Number of child relationships describes Number of picklist describes Number of future calls Number of find similar calls Number of System.runAs() invocations
   */
  LIMIT_USAGE_FOR_NS: {
    /** The namespace, such as (default). Format: `(<namespace>)`. */
    readonly namespace: string | null;
    /** The limits follow as continuation lines. Format: empty. */
    readonly usage: string | null;
  };
  /** Salesforce does not describe this type. */
  MATCH_ENGINE_BEGIN: Record<never, never>;
  /** Salesforce does not describe this type. */
  MATCH_ENGINE_END: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  MATCH_ENGINE_INVOCATION: {
    /** Invocation details. Format: `<text>`. */
    readonly invocationDetails: string | null;
  };
  /**
   * Line number, the Lightning Platform ID of the class, and method signature (with namespace, if applicable)
   */
  METHOD_ENTRY: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The Apex class id. Empty for some system classes. Format: `<id>`. */
    readonly classId: string | null;
    /** The method signature, with its parameter types. Format: `<name>(<types>)`. */
    readonly signature: string | null;
  };
  /**
   * Line number, the Lightning Platform ID of the class, and method signature (with namespace, if applicable)For constructors, this information is logged: line number and class name.
   */
  METHOD_EXIT: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The Apex class id. Empty for some system classes; absent on older lines, where this field is the signature. Format: `<id>`. */
    readonly classId: string | null;
    /** The method signature, with its parameter types. Format: `<name>(<types>)`. */
    readonly signature: string | null;
  };
  /**
   * Named Credential Id, Named Credential Name, Endpoint, Method, External Credential Type, Http Header Authorization, Request Size bytes, and Retry on 401.If using an outbound network connection, these fields are also logged: Outbound Network Connection Id, Outbound Network Connection Name, Outbound Network Connection Status, Host Type, Host Region, and Private Connect Outbound Hourly Data Usage Percent.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NAMED_CREDENTIAL_REQUEST: {
    /** The named credential id. Format: `<id>`. */
    readonly credentialId: string | null;
    /** The named credential name. Format: `<text>`. */
    readonly credentialName: string | null;
    /** The endpoint. Format: `<url>`. */
    readonly endpoint: string | null;
    /** The HTTP method. Format: `<METHOD>`. */
    readonly method: string | null;
    /** The external credential type. Format: `<text>`. */
    readonly credentialType: string | null;
    /** The Authorization header. Format: `<text>`. */
    readonly authorization: string | null;
    /** The request size, in bytes. Format: `<n>`. */
    readonly requestSize: string | null;
    /** Whether a 401 retries. Format: `true|false`. */
    readonly retryOn401: string | null;
    /** The outbound network connection id. Only when the request uses an outbound network connection. Format: `<id>`. */
    readonly connectionId: string | null;
    /** The outbound network connection name. Only when the request uses an outbound network connection. Format: `<text>`. */
    readonly connectionName: string | null;
    /** The outbound network connection status. Only when the request uses an outbound network connection. Format: `<text>`. */
    readonly connectionStatus: string | null;
    /** The host type. Only when the request uses an outbound network connection. Format: `<text>`. */
    readonly hostType: string | null;
    /** The host region. Only when the request uses an outbound network connection. Format: `<text>`. */
    readonly hostRegion: string | null;
    /** The Private Connect outbound hourly data usage, as a percentage. Only when the request uses an outbound network connection. Format: `<n>`. */
    readonly hourlyDataUsage: string | null;
  };
  /**
   * Truncated section of the response body that’s returned from the NamedCredential callout.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NAMED_CREDENTIAL_RESPONSE: {
    /** A truncated section of the response body. Format: `<text>`. */
    readonly body: string | null;
  };
  /**
   * Named Credential Id, Named Credential Name, Status Code, Response Size bytes, Overall Callout Time ms, and Connect Time ms.If using an outbound network connection, these fields are also logged: Outbound Network Connection Id, Outbound Network Connection Name, and Private Connect Outbound Hourly Data Usage Percent.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NAMED_CREDENTIAL_RESPONSE_DETAIL: {
    /** The named credential id. Format: `<id>`. */
    readonly credentialId: string | null;
    /** The named credential name. Format: `<text>`. */
    readonly credentialName: string | null;
    /** The HTTP status code. Format: `<n>`. */
    readonly statusCode: string | null;
    /** The response size, in bytes. Format: `<n>`. */
    readonly responseSize: string | null;
    /** The overall callout time, in milliseconds. Format: `<n>`. */
    readonly calloutTime: string | null;
    /** The connect time, in milliseconds. Format: `<n>`. */
    readonly connectTime: string | null;
    /** The outbound network connection id. Only when the request uses an outbound network connection. Format: `<id>`. */
    readonly connectionId: string | null;
    /** The outbound network connection name. Only when the request uses an outbound network connection. Format: `<text>`. */
    readonly connectionName: string | null;
    /** The Private Connect outbound hourly data usage, as a percentage. Only when the request uses an outbound network connection. Format: `<n>`. */
    readonly hourlyDataUsage: string | null;
  };
  /**
   * Element name, element type
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NBA_NODE_BEGIN: {
    /** Element name. Format: `<text>`. */
    readonly elementName: string | null;
    /** Element type. Format: `<text>`. */
    readonly elementType: string | null;
  };
  /**
   * Element name, element type, message
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NBA_NODE_DETAIL: {
    /** Element name. Format: `<text>`. */
    readonly elementName: string | null;
    /** Element type. Format: `<text>`. */
    readonly elementType: string | null;
    /** Message. Format: `<text>`. */
    readonly message: string | null;
  };
  /**
   * Element name, element type, message
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NBA_NODE_END: {
    /** Element name. Format: `<text>`. */
    readonly elementName: string | null;
    /** Element type. Format: `<text>`. */
    readonly elementType: string | null;
    /** Message. Format: `<text>`. */
    readonly message: string | null;
  };
  /**
   * Element name, element type, error message
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NBA_NODE_ERROR: {
    /** Element name. Format: `<text>`. */
    readonly elementName: string | null;
    /** Element type. Format: `<text>`. */
    readonly elementType: string | null;
    /** Error message. Format: `<text>`. */
    readonly errorMessage: string | null;
  };
  /**
   * Name, ID, reason
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NBA_OFFER_INVALID: {
    /** Name. Format: `<text>`. */
    readonly name: string | null;
    /** ID. Format: `<id>`. */
    readonly id: string | null;
    /** Reason. Format: `<text>`. */
    readonly reason: string | null;
  };
  /**
   * Strategy name
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NBA_STRATEGY_BEGIN: {
    /** Strategy name. Format: `<text>`. */
    readonly strategyName: string | null;
  };
  /**
   * Strategy name, count of outputs
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NBA_STRATEGY_END: {
    /** Strategy name. Format: `<text>`. */
    readonly strategyName: string | null;
    /** Count of outputs. Format: `<text>`. */
    readonly countOutputs: string | null;
  };
  /**
   * Strategy name, error message
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  NBA_STRATEGY_ERROR: {
    /** Strategy name. Format: `<text>`. */
    readonly strategyName: string | null;
    /** Error message. Format: `<text>`. */
    readonly errorMessage: string | null;
  };
  /** Salesforce does not describe this type. */
  ORG_CACHE_CONTAINS: Record<never, never>;
  /** Salesforce does not describe this type. */
  ORG_CACHE_GET: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  ORG_CACHE_GET_BEGIN: {
    /** Key. Format: `<text>`. */
    readonly key: string | null;
  };
  /** Salesforce does not describe this type. */
  ORG_CACHE_GET_CAPACITY: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  ORG_CACHE_GET_END: {
    /** Hit/miss. Format: `<text>`. */
    readonly hitMiss: string | null;
  };
  /** Salesforce does not describe this type. */
  ORG_CACHE_GET_PARTITION: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  ORG_CACHE_MEMORY_USAGE: {
    /** Memory usage. Format: `<text>`. */
    readonly memoryUsage: string | null;
  };
  /** Salesforce does not describe this type. */
  ORG_CACHE_PUT: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  ORG_CACHE_PUT_BEGIN: {
    /** Key. Format: `<text>`. */
    readonly key: string | null;
  };
  /** Salesforce does not describe this type. */
  ORG_CACHE_PUT_END: Record<never, never>;
  /** Salesforce does not describe this type. */
  ORG_CACHE_REMOVE: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  ORG_CACHE_REMOVE_BEGIN: {
    /** Key. Format: `<text>`. */
    readonly key: string | null;
  };
  /** Salesforce does not describe this type. */
  ORG_CACHE_REMOVE_END: Record<never, never>;
  /** Salesforce does not describe this type. */
  PLAY_PROMPT: Record<never, never>;
  /**
   * Condition evaluation response for a policy. Used for identifying conditions that match the policy.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  POLICY_RULE_DEFINITION_CONDITION_EVALUATION_RESPONSE: {
    /** The condition evaluation response. Format: `<text>`. */
    readonly response: string | null;
  };
  /**
   * Request received for the evaluation of access via the policy.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  POLICY_RULE_EVALUATION_REQUEST: {
    /** The evaluation request. Format: `<text>`. */
    readonly request: string | null;
  };
  /**
   * Response for the evaluation of access via the policy, including why access is granted or denied.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  POLICY_RULE_EVALUATION_RESPONSE: {
    /** The evaluation response, with why access is granted or denied. Format: `<text>`. */
    readonly response: string | null;
  };
  /**
   * Object for which the policy evaluation is skipped. If the policy evaluation is skipped, the user is allowed access to the object.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  POLICY_RULE_EVALUATION_SKIPPED: {
    /** The object whose evaluation is skipped. Format: `<text>`. */
    readonly object: string | null;
  };
  /**
   * Rule being evaluated.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  POLICY_RULE_EVALUATION_START: {
    /** The rule evaluated. Format: `<text>`. */
    readonly rule: string | null;
  };
  /**
   * Line number, the Lightning Platform ID of the class or trigger that has its log levels set and that is going into scope, the name of this class or trigger, and the log level settings that are in effect after leaving this scope
   */
  POP_TRACE_FLAGS: {
    /** Always [EXTERNAL]. Format: `[EXTERNAL]`. */
    readonly line: string | null;
    /** The class or trigger whose log levels change. Format: `<id>`. */
    readonly classId: string | null;
    /** Its name. Format: `<text>`. */
    readonly className: string | null;
    /** The log levels in effect after leaving its scope. Format: `<text>`. */
    readonly traceFlags: string | null;
  };
  /**
   * App namespace, app name This event occurs when Apex code is trying to send a notification to an app that doesn't exist in the org, or isn’t push-enabled.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  PUSH_NOTIFICATION_INVALID_APP: {
    /** The app namespace. Format: `<namespace>`. */
    readonly appNamespace: string | null;
    /** The app name. Format: `<text>`. */
    readonly appName: string | null;
  };
  /**
   * App namespace, app name This event indicates that the certificate is invalid. For example, it’s expired.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  PUSH_NOTIFICATION_INVALID_CERTIFICATE: {
    /** The app namespace. Format: `<namespace>`. */
    readonly appNamespace: string | null;
    /** The app name. Format: `<text>`. */
    readonly appName: string | null;
  };
  /** Salesforce does not describe this type. */
  PUSH_NOTIFICATION_INVALID_CONFIGURATION: Record<never, never>;
  /**
   * App namespace, app name, service type (Apple or Android GCM), user ID, device, payload (substring), payload length. This event occurs when a notification payload is too long.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  PUSH_NOTIFICATION_INVALID_NOTIFICATION: {
    /** The app namespace. Format: `<namespace>`. */
    readonly appNamespace: string | null;
    /** The app name. Format: `<text>`. */
    readonly appName: string | null;
    /** Apple or Android GCM. Format: `<text>`. */
    readonly serviceType: string | null;
    /** The user id. Format: `<id>`. */
    readonly userId: string | null;
    /** The device. Format: `<text>`. */
    readonly device: string | null;
    /** A substring of the payload. Format: `<text>`. */
    readonly payload: string | null;
    /** The payload length. Format: `<n>`. */
    readonly payloadLength: string | null;
  };
  /** Salesforce does not describe this type. */
  PUSH_NOTIFICATION_INVALID_PAYLOAD: Record<never, never>;
  /**
   * App namespace, app name This event occurs when none of the users we’re trying to send notifications to have devices registered.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  PUSH_NOTIFICATION_NO_DEVICES: {
    /** The app namespace. Format: `<namespace>`. */
    readonly appNamespace: string | null;
    /** The app name. Format: `<text>`. */
    readonly appName: string | null;
  };
  /** This event occurs when push notifications aren’t enabled in your org. */
  PUSH_NOTIFICATION_NOT_ENABLED: Record<never, never>;
  /**
   * App namespace, app name, service type (Apple or Android GCM), user ID, device, payload (substring) This event records that a notification was accepted for sending. We don’t guarantee delivery of the notification.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  PUSH_NOTIFICATION_SENT: {
    /** The app namespace. Format: `<namespace>`. */
    readonly appNamespace: string | null;
    /** The app name. Format: `<text>`. */
    readonly appName: string | null;
    /** Apple or Android GCM. Format: `<text>`. */
    readonly serviceType: string | null;
    /** The user id. Format: `<id>`. */
    readonly userId: string | null;
    /** The device. Format: `<text>`. */
    readonly device: string | null;
    /** A substring of the payload. Format: `<text>`. */
    readonly payload: string | null;
  };
  /**
   * Line number, the Salesforce ID of the class or trigger that has its log levels set and that is going out of scope, the name of this class or trigger, and the log level settings that are in effect after entering this scope
   */
  PUSH_TRACE_FLAGS: {
    /** Always [EXTERNAL]. Format: `[EXTERNAL]`. */
    readonly line: string | null;
    /** The class or trigger whose log levels change. Format: `<id>`. */
    readonly classId: string | null;
    /** Its name. Format: `<text>`. */
    readonly className: string | null;
    /** The log levels in effect after entering its scope. Format: `<text>`. */
    readonly traceFlags: string | null;
  };
  /**
   * Start of a queryMore operation.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  QUERY_MORE_BEGIN: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
  };
  /**
   * End of a queryMore operation.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  QUERY_MORE_END: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
  };
  /**
   * Line number and the number of queryMore iterations
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  QUERY_MORE_ITERATIONS: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The number of queryMore iterations. Format: `<n>`. */
    readonly iterations: string | null;
  };
  /** Salesforce does not describe this type. */
  QUERY_SQL_LOG: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  REFERENCED_OBJECT_LIST: {
    /** Referenced objects. Format: `<text>`. */
    readonly referencedObjects: string | null;
  };
  /** Salesforce does not describe this type. */
  RLM_CONFIGURATOR_BEGIN: Record<never, never>;
  /** Salesforce does not describe this type. */
  RLM_CONFIGURATOR_DEPLOY: Record<never, never>;
  /** Salesforce does not describe this type. */
  RLM_CONFIGURATOR_END: Record<never, never>;
  /** Salesforce does not describe this type. */
  RLM_CONFIGURATOR_STATS: Record<never, never>;
  /** Salesforce does not describe this type. */
  RLM_PRICING_BEGIN: Record<never, never>;
  /** Salesforce does not describe this type. */
  RLM_PRICING_END: Record<never, never>;
  /** Salesforce does not describe this type. */
  ROUTE_WORK_ACTION: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  RULES_EXECUTION_DETAIL: {
    /** Execution detail. Format: `<text>`. */
    readonly executionDetail: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  RULES_EXECUTION_SUMMARY: {
    /** Summary data. Format: `<text>`. */
    readonly summaryData: string | null;
  };
  /** Salesforce does not describe this type. */
  SAVEPOINT_RELEASE: Record<never, never>;
  /** Salesforce does not describe this type. */
  SAVEPOINT_RESET: Record<never, never>;
  /** Line number and Savepoint name */
  SAVEPOINT_ROLLBACK: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The savepoint. Format: `<id>`. */
    readonly savepoint: string | null;
  };
  /** Line number and Savepoint name */
  SAVEPOINT_SET: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The savepoint. Format: `<id>`. */
    readonly savepoint: string | null;
  };
  /** Salesforce does not describe this type. */
  SCHEDULED_FLOW_DETAIL: Record<never, never>;
  /** Salesforce does not describe this type. */
  SCRIPT_EXECUTION: Record<never, never>;
  /** Salesforce does not describe this type. */
  SESSION_CACHE_CONTAINS: Record<never, never>;
  /** Salesforce does not describe this type. */
  SESSION_CACHE_GET: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  SESSION_CACHE_GET_BEGIN: {
    /** Key. Format: `<text>`. */
    readonly key: string | null;
  };
  /** Salesforce does not describe this type. */
  SESSION_CACHE_GET_CAPACITY: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  SESSION_CACHE_GET_END: {
    /** Hit/miss. Format: `<text>`. */
    readonly hitMiss: string | null;
  };
  /** Salesforce does not describe this type. */
  SESSION_CACHE_GET_PARTITION: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  SESSION_CACHE_MEMORY_USAGE: {
    /** Memory usage. Format: `<text>`. */
    readonly memoryUsage: string | null;
  };
  /** Salesforce does not describe this type. */
  SESSION_CACHE_PUT: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  SESSION_CACHE_PUT_BEGIN: {
    /** Key. Format: `<text>`. */
    readonly key: string | null;
  };
  /** Salesforce does not describe this type. */
  SESSION_CACHE_PUT_END: Record<never, never>;
  /** Salesforce does not describe this type. */
  SESSION_CACHE_REMOVE: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  SESSION_CACHE_REMOVE_BEGIN: {
    /** Key. Format: `<text>`. */
    readonly key: string | null;
  };
  /** Salesforce does not describe this type. */
  SESSION_CACHE_REMOVE_END: Record<never, never>;
  /** Salesforce does not describe this type. */
  SLA_CASE_MILESTONE: Record<never, never>;
  /**
   * Number of cases, load time, processing time, number of case milestones to insert, update, or delete, and new trigger
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  SLA_END: {
    /** The number of cases. Format: `<n>`. */
    readonly cases: string | null;
    /** The load time. Format: `<n>`. */
    readonly loadTime: string | null;
    /** The processing time. Format: `<n>`. */
    readonly processingTime: string | null;
    /** The case milestones to insert, update or delete. Format: `<n>`. */
    readonly milestones: string | null;
    /** The new trigger. Format: `<text>`. */
    readonly newTrigger: string | null;
  };
  /**
   * Milestone ID
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  SLA_EVAL_MILESTONE: {
    /** Milestone ID. Format: `<text>`. */
    readonly milestoneId: string | null;
  };
  /** Salesforce does not describe this type. */
  SLA_NULL_START_DATE: Record<never, never>;
  /**
   * Case ID
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  SLA_PROCESS_CASE: {
    /** Case ID. Format: `<text>`. */
    readonly caseId: string | null;
  };
  /** Line number, number of aggregations, and query source */
  SOQL_EXECUTE_BEGIN: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The number of aggregations. Format: `Aggregations:<n>`. */
    readonly aggregations: string | null;
    /** The query. Format: `<SOQL>`. */
    readonly query: string | null;
  };
  /** Line number, number of rows, and duration in milliseconds */
  SOQL_EXECUTE_END: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The rows returned. Format: `Rows:<n>`. */
    readonly rows: string | null;
  };
  /**
   * Query Plan details for the executed SOQL query. To get feedback on query performance, see Get Feedback on Query Performance.
   */
  SOQL_EXECUTE_EXPLAIN: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The query plan, such as: Index on Account : [Id], cardinality: 1, sobjectCardinality: 2, relativeCost 0.1. Format: `<text>`. */
    readonly plan: string | null;
  };
  /** Line number and query source */
  SOSL_EXECUTE_BEGIN: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The search. Format: `<SOSL>`. */
    readonly query: string | null;
  };
  /** Line number, number of rows, and duration in milliseconds */
  SOSL_EXECUTE_END: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The rows returned. Format: `Rows:<n>`. */
    readonly rows: string | null;
  };
  /**
   * Frame number and variable list of the form: Variable number | Value. For example:var1:50 var2:'Hello World'
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  STACK_FRAME_VARIABLE_LIST: {
    /** The frame number. The variables follow as continuation lines. Format: `<text>`. */
    readonly frame: string | null;
  };
  /** Line number */
  STATEMENT_EXECUTE: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
  };
  /**
   * Variable list of the form: Variable number | Value. For example:var1:50 var2:'Hello World'
   */
  STATIC_VARIABLE_LIST: {
    /** The variables follow as continuation lines. Format: empty. */
    readonly variables: string | null;
  };
  /**
   * Line number and the string &lt;init&gt;() with the types of parameters, if any, between the parentheses
   */
  SYSTEM_CONSTRUCTOR_ENTRY: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The constructor, with its parameter types. Format: `<init>(<types>)`. */
    readonly signature: string | null;
  };
  /**
   * Line number and the string &lt;init&gt;() with the types of parameters, if any, between the parentheses
   */
  SYSTEM_CONSTRUCTOR_EXIT: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The constructor, with its parameter types. Format: `<init>(<types>)`. */
    readonly signature: string | null;
  };
  /** Line number and method signature */
  SYSTEM_METHOD_ENTRY: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The method signature, with its parameter types. Format: `<name>(<types>)`. */
    readonly signature: string | null;
  };
  /** Line number and method signature */
  SYSTEM_METHOD_EXIT: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The method signature, with its parameter types. Format: `<name>(<types>)`. */
    readonly signature: string | null;
  };
  /** Mode name */
  SYSTEM_MODE_ENTER: {
    /** The mode entered. Format: `<text>`. */
    readonly mode: string | null;
  };
  /** Mode name */
  SYSTEM_MODE_EXIT: {
    /** The mode left. Format: `<text>`. */
    readonly mode: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  TEMPLATE_PROCESSING_ERROR: {
    /** Error details. Format: `<text>`. */
    readonly errorDetails: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  TEMPLATED_ASSET: {
    /** Asset details. Format: `<text>`. */
    readonly assetDetails: string | null;
  };
  /** Salesforce does not describe this type. */
  TESTING_LIMITS: Record<never, never>;
  /** Number of emails sent */
  TOTAL_EMAIL_RECIPIENTS_QUEUED: {
    /** The number of emails sent. Format: `<n>`. */
    readonly recipients: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  TRANSFORMATION_SUMMARY: {
    /** Summary data. Format: `<text>`. */
    readonly summaryData: string | null;
  };
  /** Line number, logging level, and user-supplied string */
  USER_DEBUG: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The level passed to System.debug, such as DEBUG. Format: `<LEVEL>`. */
    readonly level: string | null;
    /** The message. Continuation lines carry the rest. Format: `<text>`. */
    readonly message: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  USER_DEBUG_DEBUG: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Debug message. Format: `<text>`. */
    readonly debugMessage: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  USER_DEBUG_ERROR: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Debug message. Format: `<text>`. */
    readonly debugMessage: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  USER_DEBUG_FINE: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Debug message. Format: `<text>`. */
    readonly debugMessage: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  USER_DEBUG_FINER: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Debug message. Format: `<text>`. */
    readonly debugMessage: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  USER_DEBUG_FINEST: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Debug message. Format: `<text>`. */
    readonly debugMessage: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  USER_DEBUG_INFO: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Debug message. Format: `<text>`. */
    readonly debugMessage: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  USER_DEBUG_WARN: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** Debug message. Format: `<text>`. */
    readonly debugMessage: string | null;
  };
  /** Line number, user ID, username, user timezone, and user timezone in GMT */
  USER_INFO: {
    /** Always [EXTERNAL]. Format: `[EXTERNAL]`. */
    readonly line: string | null;
    /** The user id. Format: `<id>`. */
    readonly userId: string | null;
    /** The username. Format: `<text>`. */
    readonly username: string | null;
    /** The user timezone. Format: `<text>`. */
    readonly timezone: string | null;
    /** The user timezone in GMT. Format: `<text>`. */
    readonly timezoneGmt: string | null;
  };
  /** Salesforce does not describe this type. */
  USER_MODE_PERMSET_APPLIED: Record<never, never>;
  /**
   * Error message
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  VALIDATION_ERROR: {
    /** Error message. Format: `<text>`. */
    readonly errorMessage: string | null;
  };
  /** Salesforce does not describe this type. */
  VALIDATION_FAIL: Record<never, never>;
  /** Formula source and values */
  VALIDATION_FORMULA: {
    /** The formula source. Format: `<text>`. */
    readonly formula: string | null;
    /** The values it read. On some lines only. Format: `<text>`. */
    readonly values: string | null;
  };
  /** Salesforce does not describe this type. */
  VALIDATION_PASS: Record<never, never>;
  /** Rule name */
  VALIDATION_RULE: {
    /** The validation rule id. Format: `<id>`. */
    readonly ruleId: string | null;
    /** The validation rule name. Format: `<text>`. */
    readonly ruleName: string | null;
  };
  /**
   * Line number, variable name (including the variable’s namespace, if applicable), a string representation of the variable’s value, and the variable’s address
   */
  VARIABLE_ASSIGNMENT: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The variable, with its namespace if any. Format: `<text>`. */
    readonly name: string | null;
    /** The value, as text. Format: `<text>`. */
    readonly value: string | null;
    /** An object's address: on a `this.<field>` line the field's owner, not the value; else the value. On some lines only. Format: `<text>`. */
    readonly address: string | null;
  };
  /**
   * Line number, variable name (including the variable’s namespace, if applicable), type, a value that indicates whether the variable can be referenced, and a value that indicates whether the variable is static
   */
  VARIABLE_SCOPE_BEGIN: {
    /** The line number in the Apex source, or [EXTERNAL] when there is none. Format: `[<n>]`. */
    readonly line: string | null;
    /** The variable, with its namespace if any. Format: `<text>`. */
    readonly name: string | null;
    /** The type. Format: `<text>`. */
    readonly type: string | null;
    /** Whether the variable can be referenced. Format: `true|false`. */
    readonly isReference: string | null;
    /** Whether the variable is static. Format: `true|false`. */
    readonly isStatic: string | null;
  };
  /** Salesforce does not describe this type. */
  VARIABLE_SCOPE_END: Record<never, never>;
  /** Salesforce does not describe this type. */
  VF_APEX_CALL: Record<never, never>;
  /**
   * Element name, method name, return type, and the typeRef for the Visualforce controller (for example, YourApexClass)
   */
  VF_APEX_CALL_END: {
    /** The element or controller, as on VF_APEX_CALL_START. Format: `<text>`. */
    readonly element: string | null;
    /** The method. On some lines only. Format: `<text>`. */
    readonly method: string | null;
  };
  /**
   * Element name, method name, return type, and the typeRef for the Visualforce controller (for example, YourApexClass)
   */
  VF_APEX_CALL_START: {
    /** Always [EXTERNAL]. Format: `[EXTERNAL]`. */
    readonly line: string | null;
    /** The page element id, or the controller name. Format: `<id> or <name>`. */
    readonly element: string | null;
    /** The method called, such as a getter or <init>. On some lines only. Format: `<text>`. */
    readonly method: string | null;
    /** The controller class. On some lines only. Format: `<typeRef>`. */
    readonly controller: string | null;
  };
  /** Salesforce does not describe this type. */
  VF_DESERIALIZE_CONTINUATION_STATE_BEGIN: Record<never, never>;
  /** Salesforce does not describe this type. */
  VF_DESERIALIZE_CONTINUATION_STATE_END: Record<never, never>;
  /** View state ID */
  VF_DESERIALIZE_VIEWSTATE_BEGIN: {
    /** The view state id. Format: `<id>`. */
    readonly viewStateId: string | null;
  };
  /** Salesforce does not describe this type. */
  VF_DESERIALIZE_VIEWSTATE_END: Record<never, never>;
  /** View state ID and formula */
  VF_EVALUATE_FORMULA_BEGIN: {
    /** The view state id. Format: `<id>`. */
    readonly viewStateId: string | null;
    /** The formula. Format: `<text>`. */
    readonly formula: string | null;
  };
  /** Salesforce does not describe this type. */
  VF_EVALUATE_FORMULA_END: Record<never, never>;
  /** Message text */
  VF_PAGE_MESSAGE: {
    /** The message. Format: `<text>`. */
    readonly message: string | null;
  };
  /** Salesforce does not describe this type. */
  VF_SERIALIZE_CONTINUATION_STATE_BEGIN: Record<never, never>;
  /** Salesforce does not describe this type. */
  VF_SERIALIZE_CONTINUATION_STATE_END: Record<never, never>;
  /** View state ID */
  VF_SERIALIZE_VIEWSTATE_BEGIN: {
    /** The view state id. Format: `<id>`. */
    readonly viewStateId: string | null;
  };
  /** Salesforce does not describe this type. */
  VF_SERIALIZE_VIEWSTATE_END: Record<never, never>;
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WAVE_APP_LIFECYCLE: {
    /** Lifecycle event. Format: `<text>`. */
    readonly lifecycleEvent: string | null;
  };
  /** Action description */
  WF_ACTION: {
    /** Action description. Format: `<text>`. */
    readonly actionDescription: string | null;
  };
  /**
   * Task subject, action ID, rule name, rule ID, owner, and due date
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_ACTION_TASK: {
    /** Task subject. Format: `<text>`. */
    readonly taskSubject: string | null;
    /** Action ID. Format: `<text>`. */
    readonly actionId: string | null;
    /** Rule name. Format: `<text>`. */
    readonly ruleName: string | null;
    /** Rule ID. Format: `<text>`. */
    readonly ruleId: string | null;
    /** Owner. Format: `<text>`. */
    readonly owner: string | null;
    /** Due date. Format: `<text>`. */
    readonly dueDate: string | null;
  };
  /** Summary of actions performed */
  WF_ACTIONS_END: {
    /** Summary of actions performed. Format: `<text>`. */
    readonly summaryActionsPerformed: string | null;
  };
  /** Salesforce does not describe this type. */
  WF_APEX_ACTION: Record<never, never>;
  /** Transition type, EntityName: NameField Id, and process node name */
  WF_APPROVAL: {
    /** The transition type. Format: `<text>`. */
    readonly transitionType: string | null;
    /** The record. Format: `<sObject>: <name> <id>`. */
    readonly record: string | null;
    /** The process node name. Format: `<text>`. */
    readonly nodeName: string | null;
  };
  /**
   * Logs an approval removal
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_APPROVAL_REMOVE: {
    /** The record the rule ran on. Format: `<sObject>: <name> <id>`. */
    readonly record: string | null;
  };
  /** Logs an approval submission */
  WF_APPROVAL_SUBMIT: {
    /** Submission details. Format: `<text>`. */
    readonly submissionDetails: string | null;
  };
  /** Submitter ID, submitter full name, and error message */
  WF_APPROVAL_SUBMITTER: {
    /** The submitter. Format: `<text>`. */
    readonly submitterName: string | null;
    /** The submitter id. Format: `<id>`. */
    readonly submitterId: string | null;
  };
  /**
   * Owner and assignee template ID
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_ASSIGN: {
    /** Owner. Format: `<text>`. */
    readonly owner: string | null;
    /** Assignee template ID. Format: `<text>`. */
    readonly assigneeTemplateId: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_CHATTER_POST: {
    /** Chatter post details. Format: `<text>`. */
    readonly chatterPostDetails: string | null;
  };
  /**
   * EntityName: NameField Id, rule name, rule ID, and (if rule respects trigger types) trigger type and recursive count
   */
  WF_CRITERIA_BEGIN: {
    /** The record the rule ran on. Format: `<sObject>: <name> <id>`. */
    readonly record: string | null;
    /** The rule name. Format: `<text>`. */
    readonly ruleName: string | null;
    /** The rule id. Format: `<id>`. */
    readonly ruleId: string | null;
    /** When the rule runs, such as ON_ALL_CHANGES. Format: `<TRIGGER_TYPE>`. */
    readonly triggerType: string | null;
    /** The recursive count. Format: `<n>`. */
    readonly recursiveCount: string | null;
  };
  /** Boolean value indicating success (true or false) */
  WF_CRITERIA_END: {
    /** Whether the criteria were met. Format: `true|false`. */
    readonly result: string | null;
  };
  /** Action ID, rule name, and rule ID */
  WF_EMAIL_ALERT: {
    /** The alert: action id, rule name and rule id. Format: `<text>`. */
    readonly alert: string | null;
  };
  /** Email template ID, recipients, and CC emails */
  WF_EMAIL_SENT: {
    /** The email template. Format: `Template:<id>`. */
    readonly template: string | null;
    /** The recipients. Format: `Recipients:<…>`. */
    readonly recipients: string | null;
    /** The CC emails. Format: `CcEmails:<…>`. */
    readonly ccEmails: string | null;
  };
  /**
   * Summary of actions enqueued
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_ENQUEUE_ACTIONS: {
    /** Summary of actions enqueued. Format: `<text>`. */
    readonly summaryActionsEnqueued: string | null;
  };
  /**
   * Case ID and escalation date
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_ESCALATION_ACTION: {
    /** Case ID. Format: `<text>`. */
    readonly caseId: string | null;
    /** Escalation date. Format: `<text>`. */
    readonly escalationDate: string | null;
  };
  /** Salesforce does not describe this type. */
  WF_ESCALATION_RULE: Record<never, never>;
  /** Process name, email template ID, and Boolean value indicating result (true or false) */
  WF_EVAL_ENTRY_CRITERIA: {
    /** The process name. Format: `<text>`. */
    readonly processName: string | null;
    /** The email template id. Often empty. Format: `<id>`. */
    readonly emailTemplateId: string | null;
    /** The result. Format: `true|false`. */
    readonly result: string | null;
  };
  /** EntityName: NameField Id and the object or field name */
  WF_FIELD_UPDATE: {
    /** The record the rule ran on. Format: `<sObject>: <name> <id>`. */
    readonly record: string | null;
    /** The field updated. Format: `Field:<…>`. */
    readonly field: string | null;
    /** The new value. Format: `Value:<…>`. */
    readonly value: string | null;
    /** Not documented. Format: `<text>`. */
    readonly detail: string | null;
    /** The rule that made the update. On some lines only. Format: `CurrentRule:<…>`. */
    readonly currentRule: string | null;
  };
  /** ID of flow trigger */
  WF_FLOW_ACTION_BEGIN: {
    /** The flow trigger id. Format: `<id>`. */
    readonly flowTriggerId: string | null;
  };
  /**
   * ID of flow trigger, object type and ID of record whose creation or update caused the workflow rule to fire, name and ID of workflow rule, and the names and values of flow variables
   */
  WF_FLOW_ACTION_DETAIL: {
    /** The flow trigger id, or the first parameter. Format: `<id> or Param Name:<…>`. */
    readonly first: string | null;
    /** The object type, or the second parameter. Format: `<text>`. */
    readonly second: string | null;
    /** Not documented. On some lines only. Format: `<text>`. */
    readonly third: string | null;
    /** The rule. On some lines only. Format: `CurrentRule:<…>`. */
    readonly currentRule: string | null;
  };
  /** ID of flow trigger */
  WF_FLOW_ACTION_END: {
    /** The flow trigger id. Format: `<id>`. */
    readonly flowTriggerId: string | null;
  };
  /** ID of flow trigger, ID of flow definition, ID of flow version, and flow error message */
  WF_FLOW_ACTION_ERROR: {
    /** The flow trigger id. Format: `<id>`. */
    readonly flowTriggerId: string | null;
    /** The flow definition id. Format: `<id>`. */
    readonly flowDefinitionId: string | null;
    /** The error message. It follows however many ids the line states, not always field 4. Format: `Error executing flow: <…>`. */
    readonly message: string | null;
  };
  /** Detailed flow error message */
  WF_FLOW_ACTION_ERROR_DETAIL: {
    /** The detailed error message. Format: `<text>`. */
    readonly message: string | null;
  };
  /** Formula source and values */
  WF_FORMULA: {
    /** The formula source. Format: `Formula:<…>`. */
    readonly formula: string | null;
    /** The values it read. On some lines only. Format: `Values:<…>`. */
    readonly values: string | null;
  };
  /** Salesforce does not describe this type. */
  WF_HARD_REJECT: Record<never, never>;
  /**
   * Logs a workflow knowledge action
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_KNOWLEDGE_ACTION: {
    /** Action details. Format: `<text>`. */
    readonly actionDetails: string | null;
  };
  /** Owner, next owner type, and field */
  WF_NEXT_APPROVER: {
    /** The owner. Format: `<text>`. */
    readonly owner: string | null;
    /** The next owner type. Format: `<text>`. */
    readonly nextOwnerType: string | null;
    /** The field. Often empty. Format: `<text>`. */
    readonly field: string | null;
  };
  /** Salesforce does not describe this type. */
  WF_NO_PROCESS_FOUND: Record<never, never>;
  /**
   * EntityName: NameField Id, action ID, rule name, and rule ID
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_OUTBOUND_MSG: {
    /** The record the rule ran on. Format: `<sObject>: <name> <id>`. */
    readonly record: string | null;
    /** The action id. Format: `<id>`. */
    readonly actionId: string | null;
    /** The rule name. Format: `<text>`. */
    readonly ruleName: string | null;
    /** The rule id. Format: `<id>`. */
    readonly ruleId: string | null;
  };
  /** Process definition ID and process label */
  WF_PROCESS_FOUND: {
    /** The process definition. Format: `ProcessDefinitionNameOrId:<…>`. */
    readonly process: string | null;
    /** The process label. Format: `<text>`. */
    readonly label: string | null;
  };
  /** Process name */
  WF_PROCESS_NODE: {
    /** Process name. Format: `<text>`. */
    readonly processName: string | null;
  };
  /** Logs a workflow quick create action */
  WF_QUICK_CREATE: Record<never, never>;
  /**
   * EntityName: NameField Id and owner
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_REASSIGN_RECORD: {
    /** The record the rule ran on. Format: `<sObject>: <name> <id>`. */
    readonly record: string | null;
    /** The new owner. Format: `<text>`. */
    readonly owner: string | null;
  };
  /**
   * Notifier name, notifier email, notifier template ID, and reply-to email
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_RESPONSE_NOTIFY: {
    /** Notifier name. Format: `<text>`. */
    readonly notifierName: string | null;
    /** Notifier email. Format: `<text>`. */
    readonly notifierEmail: string | null;
    /** Notifier template ID. Format: `<text>`. */
    readonly notifierTemplateId: string | null;
    /** Reply-to email. Format: `<text>`. */
    readonly replyEmail: string | null;
  };
  /**
   * Integer indicating order
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_RULE_ENTRY_ORDER: {
    /** Integer indicating order. Format: `<text>`. */
    readonly integerIndicatingOrder: string | null;
  };
  /** Rule type */
  WF_RULE_EVAL_BEGIN: {
    /** Rule type. Format: `<text>`. */
    readonly ruleType: string | null;
  };
  /** Salesforce does not describe this type. */
  WF_RULE_EVAL_END: Record<never, never>;
  /** Value */
  WF_RULE_EVAL_VALUE: {
    /** Value. Format: `<text>`. */
    readonly value: string | null;
  };
  /** Filter criteria */
  WF_RULE_FILTER: {
    /** Filter criteria. Format: `<text>`. */
    readonly filterCriteria: string | null;
  };
  /** Logs a workflow rule invocation */
  WF_RULE_INVOCATION: {
    /** The rule name and object type. Format: `<text>`. */
    readonly rule: string | null;
  };
  /** Salesforce does not describe this type. */
  WF_RULE_NOT_EVALUATED: Record<never, never>;
  /** Logs a workflow send action */
  WF_SEND_ACTION: Record<never, never>;
  /**
   * Process name
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  WF_SOFT_REJECT: {
    /** Process name. Format: `<text>`. */
    readonly processName: string | null;
  };
  /** Node type */
  WF_SPOOL_ACTION_BEGIN: {
    /** Node type. Format: `<text>`. */
    readonly nodeType: string | null;
  };
  /** EntityName: NameField Id, time action, time action container, and evaluation Datetime */
  WF_TIME_TRIGGER: {
    /** The record. Format: `<sObject>: <name> <id>`. */
    readonly record: string | null;
    /** The time action. Format: `<text>`. */
    readonly timeAction: string | null;
    /** The time action container. Format: `<text>`. */
    readonly timeActionContainer: string | null;
    /** The evaluation date and time. Format: `<datetime>`. */
    readonly evaluationTime: string | null;
  };
  /** Salesforce does not describe this type. */
  WF_TIME_TRIGGERS_BEGIN: Record<never, never>;
  /**
   * For OData adapters, the POST body and the name and evaluated formula for custom HTTP headers
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  XDS_DETAIL: {
    /** For OData adapters, the POST body, and the name and evaluated formula of each custom HTTP header. Format: `<text>`. */
    readonly detail: string | null;
  };
  /**
   * Salesforce does not describe this type.
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  XDS_REQUEST_DETAIL: {
    /** Request detail. Format: `<text>`. */
    readonly requestDetail: string | null;
  };
  /**
   * External data source, external object, request details, number of returned records, and system usage
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  XDS_RESPONSE: {
    /** External data source. Format: `<text>`. */
    readonly externalDataSource: string | null;
    /** External object. Format: `<text>`. */
    readonly externalObject: string | null;
    /** Request details. Format: `<text>`. */
    readonly requestDetails: string | null;
    /** Number of returned records. Format: `<text>`. */
    readonly numberReturnedRecords: string | null;
    /** System usage. Format: `<text>`. */
    readonly systemUsage: string | null;
  };
  /**
   * Truncated response from the external system, including returned records
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  XDS_RESPONSE_DETAIL: {
    /** The truncated response from the external system, with the returned records. Format: `<text>`. */
    readonly response: string | null;
  };
  /**
   * Error message
   *
   * @remarks No real log confirms this layout. It follows the Salesforce documentation.
   */
  XDS_RESPONSE_ERROR: {
    /** Error message. Format: `<text>`. */
    readonly errorMessage: string | null;
  };
}
