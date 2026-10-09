# The new engine scans bytes, not a string

This supersedes the input decision in 0004. The column findings in 0004 still hold.

The engine scans a `Uint8Array`. Callers that read a local file pass the `Buffer`. A string input
is encoded once with `TextEncoder`. Field text is decoded only when a caller reads it.

The package has two builds, chosen by the `node` and `browser` export conditions:

- **Node.** Line ends by `Buffer.indexOf`. Text by `buf.toString('utf8', start, end)` per field.
- **Browser.** Line ends by a SWAR search. Text by `TextDecoder` per field at first. After many
  reads, it decodes the whole log once; when the log is ASCII (the decoded length equals the byte
  length), byte offsets are character offsets, so later text is a `slice`. `TextDecoder` is slow on
  short input in Chromium, which is why the switch exists.

0004 measured a simple line loop, and there a string scan was as fast as bytes. A loop shaped like
the engine reads every character of each field: it hashes labels, interns them and matches exits.
In that loop, `charCodeAt` costs much more than a typed-array read.

## Evidence

Measured with the research brief's `scan-v5` scanners (appendix B). The byte and string scanners
are the same code, and only the character read differs. Both built the same tree on every log.
Each run starts from bytes; the string core's time includes its decode. Each time is a median of 9
warm runs in a fresh process, on arm64, Node 22.23 and headless Chromium.

Node, all 437 corpus logs, p50 by size band:

| Logs | Bytes parse | String parse | Bytes, all text | String, all text | Retained, either |
| --- | ---: | ---: | ---: | ---: | ---: |
| < 1 MB (167) | 0.25 ms | 0.27 ms | 0.03 ms | 0.01 ms | 0.5 MB |
| 1–20 MB (251) | 6.5 ms | 11 ms | 3.9 ms | 1.3 ms | 14 MB |
| > 20 MB (19) | 38 ms | 76 ms | 19 ms | 7.1 ms | 85 MB |

- Parse plus all text is still faster on bytes: 57 against 83 ms over 20 MB.
- On 16 non-ASCII logs, the string kept 1.5 to 2 times the memory: for example, 29 against 47 MB
  for an 18 MB log. On the rest, retained memory was equal.

Chromium, 100 MB corpus log:

| Build | Parse | Then all text | Then 1% of text |
| --- | ---: | ---: | ---: |
| Bytes, `TextDecoder` per field | 89 ms | 124 ms | 0.9 ms |
| Bytes, whole decode then `slice` | 90 ms | 49 ms | 19 ms |
| String | 165 ms | 9 ms | 0.1 ms |

The adaptive text read takes the better of the first two rows. Bytes then beat the string both for
a caller that reads all text (search) and for one that reads little (a tree view).

On x86-64 the brief measured bytes faster too, and decoding slower (91 to 120 ms per 100 MB).

## Costs

- **Two builds.** Two newline searches and two text readers, each tested.
- **String input.** A caller that has only a string pays the encode: 6 ms per 100 MB in Node, 63 to
  92 ms in Chromium.
- **Text after the switch.** The browser build then holds the decoded string beside the columns.
  It drops its own reference to the bytes, so memory equals the string core's.
- **The prototype.** The scanners omit some of the engine's rules. The step 4 and step 5 gates
  measure the real engine against these numbers.

## Gains

- **Memory.** One byte per byte, also for non-ASCII logs. Decoded text is a copy, so it does not
  pin the source.
- **Workers.** The source bytes and the columns transfer, without a copy.
- **Size.** No string length limit applies to the source.
