# The new engine scans a string, not bytes

Superseded by 0005 for the input core. The column findings below still hold.

The research proposed a byte scanner. We scan a string instead.

`parse` still accepts bytes, a `Blob` and streams. It decodes them once with `TextDecoder`. Field
text is then a slice of that string.

Measured with `pnpm run bench:micro`, Node 22.23 and headless Chromium. Each time is Node, then
Chromium, from a 95 MB corpus log:

| Task | Bytes core | String core |
| --- | ---: | ---: |
| Decode the whole log once | — | 10, 18 ms |
| Find every line end | 8.7 ms (Node `Buffer`); 28 ms (browser SWAR) | 8.6, 9.4 ms (`String.indexOf`) |
| Full scan, as the engine does it | 51, 41 ms | 64, 40 ms |
| Read one field from every line | 57, 75 ms (`TextDecoder`) | 2.1, 2.2 ms (`slice`; pins the source) |
| Intern those fields | 80, 77 ms (hash and verify) | 76, 29 ms (`slice` and `Map`) |

On a 19 MB log with non-ASCII text, the string scan was the fastest in both runtimes: 8.0 and
5.7 ms, against 6.5 to 11 ms for the byte scans.

V8's `String.indexOf` is memchr-fast in both runtimes. So one scan path serves Node and the browser,
and lazy text costs almost nothing.

Costs:

- **Memory.** A string with any non-ASCII character takes 2 bytes per character. 31 of the 437
  corpus logs (about 10% of the bytes) have one.
- **Pinning.** A slice of 13 or more characters keeps the whole source alive. A consumer that keeps
  one field keeps the whole log text.
- **Workers.** A worker clones the source string, where bytes would transfer. The columns still
  transfer.
- **Size.** A source longer than V8's string limit (about 512 MB) must be held as several chunks.

Also settled by the same benchmarks:

- **Columns are fixed-length typed arrays, allocated once.** Presizing to the row count took 4.9 and
  6.9 ms, against 8.0 and 11 ms for doubling and 11 and 10 ms for a resizable `ArrayBuffer`. Views
  that track a resizable buffer read about 50% slower than fixed ones. The engine cannot know the
  row count in advance, so it estimates it from the input length and grows by copying when the
  estimate is short.
