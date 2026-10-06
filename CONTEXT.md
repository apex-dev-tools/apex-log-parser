# Apex log parsing

The parser reads a Salesforce Apex debug log and gives a tree of the events it states, with times,
counts and governor limits. These are the words for what it gives.

## The log

**Log**:
One debug log: a header, then timestamped lines. The parsed log is also the root of the event tree.
_Avoid_: root node, LOG_ROOT

**Header**:
The text before the first timestamped line. It states the API version and the debug levels.
_Avoid_: preamble

**Line**:
One timestamped line of the log, with any untimestamped lines that continue its text.
_Avoid_: row, record

**Execution**:
The span from one `EXECUTION_STARTED` line to its `EXECUTION_FINISHED` line. A log can hold more
than one.

**Entry point**:
A code unit directly under the log or directly under an execution: where work starts.

## Events

**Event**:
What one line becomes in the tree. An exit line that closes an event is not an event of its own.
_Avoid_: node, log line, row

**Frame**:
An event that spans time, from its line to the line that closes it, and can contain other events.
_Avoid_: parent, scope, method (a frame is not always a method)

**Leaf**:
An event at one point in time, with no children.
_Avoid_: point event

**Exit line**:
The line that closes a frame, such as `METHOD_EXIT` for a `METHOD_ENTRY`.
_Avoid_: end event, exit event

**Fold**:
To merge a matched exit line into the frame it closes. What the exit line states becomes the
frame's exit details.

**Exit details**:
The facts a folded exit line stated, such as the row count of `SOQL_EXECUTE_END`. Null when the
frame never closed.

**Unterminated frame**:
A frame that the log does not close, because the log ends or the platform dropped its exit line.
_Avoid_: truncated event (truncation is a different thing, see below)

**Id**:
An event's position in log order. Unique and the same for the same log text, but valid only within
one parse.
_Avoid_: eventIndex, index

## Event types

**Event type**:
The name a line states, such as `SOQL_EXECUTE_BEGIN`.

**Type id**:
An event type's number, the same in every parse and every release. Not an event's id.
_Avoid_: id (alone), type index

**Type info**:
What is true of every event of one type: its category, debug category, level, kind and exit types.
It belongs to the type, never to one event.
_Avoid_: event metadata

**Field**:
One `|`-separated part of a line after its timestamp and event type, such as the row count of
`SOQL_EXECUTE_END`. Each event type names its fields, in line order. A field the line does not state
is null.
_Avoid_: column (a different thing, see below), part

**Layout**:
An event type's fields, in order. A layout is either seen in real logs or only taken from the
Salesforce documentation.

**Shape**:
How an event type sits in the tree: a frame, a leaf, or an exit line.
_Avoid_: kind (a different thing, see below)

**Kind**:
What an event type means for analysis: a method frame, an execution, a package boundary, a SOQL
query, a SOSL search, a DML operation, and so on.
_Avoid_: classification

**Category**:
The timeline group an event type belongs to, such as Apex, SOQL or Automation. Not the Salesforce
debug category.

**Debug category**:
The Salesforce debug log category an event type belongs to, such as `apexCode` or `database`.

## Figures

**Rollup**:
A figure stated for an event (self) and for the event with all its descendants (total): duration,
SOQL, SOSL and DML counts and rows, exceptions thrown, and heap.

**Self**:
The part of a rollup that is the event's own, not its children's.
_Avoid_: net, exclusive

**Total**:
The part of a rollup that includes every descendant.
_Avoid_: inclusive, cumulative

**Heap peak**:
The highest live heap reached inside an event, in bytes. It is a maximum, not a sum.

**Governor limits**:
The platform's limits and what the log states was used against them, per namespace and combined.
_Avoid_: limits usage

**Columns**:
The log's events as parallel arrays indexed by id, for callers that read every event, such as a
timeline.

## Problems in a log

**Issue**:
Something wrong or missing in the log that the caller should know, such as a dropped block or an
unmatched exit line.
_Avoid_: log issue, warning

**Parsing error**:
A line the parser could not read.

**Truncation**:
Content the platform did not write: a skipped block (`*** Skipped N bytes`) or the end of a log that
hit the maximum size. Not an unterminated frame.
