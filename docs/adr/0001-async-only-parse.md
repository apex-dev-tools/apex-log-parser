# The new parser's public parse is async only

The new parser has one public entry, `parse(source, options): Promise<ApexLog>`. It takes a
string, bytes, a `Blob` or a stream. It yields between time slices, and it stops when the caller's
`AbortSignal` fires. A sync incremental engine does the work inside it, but it is not exported.

Comparable libraries (esbuild, oxc, swc, lightningcss) ship a sync parse beside the async one. We
do not, because every consumer we know of needs the async one:

- the analyzer webview, which must not freeze;
- the extension host, which must not freeze;
- the MCP server, which reads files.

A sync parse costs a second entry to document and pin. Adding `parseSync` later does not break
callers, but removing one after v1 does.

The cost: tests and scripts must `await`.
