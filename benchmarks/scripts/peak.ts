// The child `bench:large --peak` runs once per parse:
//   node --import tsx benchmarks/scripts/peak.ts <log file> <node|browser> <sources|bundle>
// A fresh process, so its high-water RSS is this one cold parse's, garbage not yet collected included.

import { readFileSync } from 'node:fs';
import { argv, memoryUsage, resourceUsage } from 'node:process';
import { runIfMain } from '../../scripts/cli.js';
import { engineNamed } from './engines.js';

/** What one child reports, as the last line of its output. */
export interface PeakResult {
  /** The process's most resident memory during the parse, less what it held before, in bytes. */
  peakBytes: number;
}

async function main(): Promise<void> {
  const [path, name, code] = argv.slice(2);
  if (!path || !name || (code !== 'sources' && code !== 'bundle'))
    throw new Error('usage: peak.ts <log file> <node|browser> <sources|bundle>');
  const engine = await engineNamed(name, code);
  // A Buffer is a Uint8Array, so the parse reads the file's bytes with no copy.
  const bytes = readFileSync(path);
  const highBefore = resourceUsage().maxRSS * 1024;
  const before = memoryUsage.rss();
  engine.build(bytes);
  const highAfter = resourceUsage().maxRSS * 1024;
  // If the parse stays below the mark the file read set, its own peak is not known.
  if (highAfter <= highBefore)
    throw new Error(
      `the parse did not raise the high-water mark: ${path}. The log is too small; use a log of some MB.`,
    );
  const result: PeakResult = { peakBytes: highAfter - before };
  console.log(JSON.stringify(result));
}

runIfMain(import.meta.url, main);
