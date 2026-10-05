/**
 * Runs every log in a folder through the parse engines, checks they give the same output, and
 * times them. Writes `results.jsonl` as it goes and `report.md` at the end.
 *
 * It diffs every later engine against the first. Naming one engine twice (`--engines=legacy,legacy`)
 * checks that its output is deterministic. `--runs=0` skips timing.
 *
 * Never commit the output: it names the logs, and the logs come from orgs.
 */

import {
  appendFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { argv, stderr } from 'node:process';
import { fileURLToPath } from 'node:url';
import { runJsonChild } from '../child.js';
import { flag, runIfMain } from '../cli.js';
import type { DiffResult } from './diff.js';
import { diffProjections } from './diff.js';
import { engine } from './engines.js';
import type { Measurement } from './measure.js';
import type { Projection } from './project.js';
import type { Failure, FileResult } from './report.js';
import { renderReport } from './report.js';

const USAGE =
  'Usage: pnpm run compare <dir> --out=<dir> [--engines=legacy,next] [--runs=5] [--match=<text>] [--limit=<n>]';
const LOG_FILE = /\.(log|txt)$/i;
const measureScript = fileURLToPath(new URL('./measure.ts', import.meta.url));

/** Every log under `dir`, sorted by path. Skips dot folders and dot files. */
export function findLogs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith('.'))
    .flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return findLogs(path);
      return entry.isFile() && LOG_FILE.test(entry.name) ? [path] : [];
    })
    .sort();
}

function time(engineName: string, file: string, runs: number): Measurement | Failure {
  try {
    return runJsonChild(
      measureScript,
      [`--engine=${engineName}`, `--file=${file}`, `--runs=${runs}`],
      ['--expose-gc', '--max-old-space-size=8192'],
    ) as Measurement;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

async function project(engineName: string, bytes: Uint8Array): Promise<Projection> {
  const subject = engine(engineName);
  return subject.project(await subject.parse(bytes));
}

async function diff(left: string, right: string, file: string): Promise<DiffResult | Failure> {
  try {
    const bytes = readFileSync(file);
    return diffProjections(await project(left, bytes), await project(right, bytes));
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

runIfMain(import.meta.url, async () => {
  const args = argv.slice(2);
  const dir = args.find((a) => !a.startsWith('--'));
  const out = flag(args, '--out');
  if (!dir || !out) throw new Error(USAGE);

  const engines = (flag(args, '--engines') ?? 'legacy').split(',');
  engines.forEach(engine);
  const runs = Number(flag(args, '--runs') ?? 5);
  const match = flag(args, '--match');
  const limit = Number(flag(args, '--limit') ?? Number.POSITIVE_INFINITY);

  const files = findLogs(dir)
    .filter((f) => !match || f.includes(match))
    .slice(0, limit);
  mkdirSync(out, { recursive: true });
  const jsonl = join(out, 'results.jsonl');
  writeFileSync(jsonl, '');

  // split always yields at least one name
  const baseline = engines[0]!;
  const timed = [...new Set(engines)];
  const results: FileResult[] = [];
  for (const [i, file] of files.entries()) {
    const name = relative(dir, file);
    const result: FileResult = { file: name, bytes: statSync(file).size, runs: {}, diffs: {} };
    for (const other of engines.slice(1)) {
      result.diffs[`${baseline}→${other}`] = await diff(baseline, other, file);
    }
    if (runs > 0) for (const e of timed) result.runs[e] = time(e, file, runs);
    results.push(result);
    appendFileSync(jsonl, `${JSON.stringify(result)}\n`);
    stderr.write(`[${i + 1}/${files.length}] ${name}\n`);
  }

  writeFileSync(join(out, 'report.md'), renderReport(results, engines));
  stderr.write(`Wrote ${join(out, 'report.md')}\n`);
});
