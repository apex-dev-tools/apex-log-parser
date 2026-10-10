// Prints numbers only, never log text, so its output can be committed as benchmarks/fixtures/profiles.json.
//   node --import tsx benchmarks/scripts/profiles.ts --dir=<folder of .log and .txt files>

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { argv } from 'node:process';
import { flag, runIfMain } from '../../scripts/cli.js';
import { utf8ByteLength } from '../../src/utf8.js';
import type { LogShape, ProfileName } from '../fixtures/measure.js';
import { LogTally, profileBands } from '../fixtures/measure.js';

const bands = Object.entries(profileBands) as [ProfileName, number][];

export function bandOf(bytes: number): ProfileName {
  return bands.filter(([, from]) => bytes >= from).at(-1)?.[0] ?? 'small';
}

/** Each band's shape, from the logs in it. */
export function profile(logs: Iterable<string>): Partial<Record<ProfileName, LogShape>> {
  const tallies = new Map<ProfileName, LogTally>();
  for (const log of logs) {
    const band = bandOf(utf8ByteLength(log));
    const tally = tallies.get(band) ?? new LogTally();
    tally.add(log);
    tallies.set(band, tally);
  }
  return Object.fromEntries(
    bands.flatMap(([band]) => {
      const tally = tallies.get(band);
      return tally ? [[band, tally.shape()]] : [];
    }),
  );
}

function* readLogs(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (entry.isFile() && /\.(log|txt)$/i.test(entry.name)) {
      yield readFileSync(join(entry.parentPath, entry.name), 'utf8');
    }
  }
}

function main(): void {
  const dir = flag(argv.slice(2), '--dir');
  if (!dir) throw new Error('--dir=<folder of .log and .txt files> is required');
  console.log(JSON.stringify(profile(readLogs(dir)), null, 2));
}

runIfMain(import.meta.url, main);
