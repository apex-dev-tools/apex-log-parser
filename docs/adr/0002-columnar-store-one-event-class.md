# Events live in typed-array columns, read through one event class

The new parser keeps each event as a row of typed-array columns, in log order. Matched exit lines
fold into the frame they close and take no row.

Event objects are read-only views, made on first read and cached by id. Every event type uses
**one** runtime class. The per-type fields and narrowing exist only in TypeScript.

Why: today's cost is allocation. Each event has 13 or more objects and a `split` array, and every
access site sees 177 classes. Measured on synthetic logs:

- a prototype per type is 2× slower than today;
- one class is 2.2× faster than today;
- columns are 8× faster than today.

Columns also transfer to a worker at no cost. Today's object tree costs more to clone than to
parse.

Consequences:

- Events are not mutable, and `instanceof` on event classes goes away. No consumer mutates events
  today.
- Ids differ from today's `eventIndex`, because exit lines no longer take one.
