/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { parse } from '../index.js';
import { utf8ByteLength } from '../utf8.js';

/** 2 code units, 4 UTF-8 bytes. Built from the code point so an editor cannot mangle the pair. */
const emoji = String.fromCodePoint(0x1f642);
const loneSurrogate = String.fromCharCode(0xd800);

describe('utf8ByteLength', () => {
  it.each([
    ['an empty string', '', 0],
    ['ascii', 'plain ascii', 11],
    ['a two-byte character', '£', 2],
    ['a three-byte character', '€', 3],
    ['a surrogate pair', emoji, 4],
    ['a lone surrogate, as one replacement character', loneSurrogate, 3],
    ['a mixture', `£100 naïve ${emoji}`, 17],
  ])('counts %s', (_name, text, expected) => {
    expect(utf8ByteLength(text)).toBe(expected);
  });

  it('counts a surrogate pair wherever it falls in a long string', () => {
    // The helper encodes in passes through a fixed buffer. A pair split across two passes would
    // encode as two replacement characters, 6 bytes rather than 4. Each block is 101 bytes, which
    // is coprime with any power-of-two buffer, so the pairs land on a different offset each pass.
    const block = `${'a'.repeat(97)}${emoji}`;

    expect(utf8ByteLength(block.repeat(300))).toBe(300 * 101);
  });

  it('counts a surrogate pair at every offset either side of a pass boundary', () => {
    // Sweep the pair across every buffer size the helper might plausibly use, so this keeps
    // testing a real boundary if that size changes.
    for (const boundary of [4096, 8192, 16384, 32768, 65536]) {
      for (let pad = boundary - 10; pad <= boundary + 10; pad++) {
        expect(utf8ByteLength('a'.repeat(pad) + emoji)).toBe(pad + 4);
      }
    }
  });
});

function logWith(debugText: string): string {
  return (
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    `15:20:52.222 (300)|USER_DEBUG|[2]|DEBUG|${debugText}\n` +
    '09:19:13.82 (2000)|EXECUTION_FINISHED\n'
  );
}

describe('ApexLog.size', () => {
  it('equals the string length for an ASCII log', () => {
    const log = logWith('plain ascii');

    expect(parse(log).size).toBe(log.length);
  });

  it('exceeds the string length once the log holds non-ASCII', () => {
    // The pound and the diaeresis cost one extra byte each, the emoji two.
    const log = logWith(`£100 naïve ${emoji}`);

    expect(parse(log).size).toBe(log.length + 4);
  });
});
