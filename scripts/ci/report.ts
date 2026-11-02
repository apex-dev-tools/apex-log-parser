/**
 * Renders one scrape run into the pull request body and the job summary.
 *
 * Reads the run record written by `pnpm scrape -- --report=...`, so the report is
 * built from data rather than from the scraper's stdout.
 *
 * Usage:
 *   pnpm run ci:report -- --report=run.json --out=pr-body.md [--ci-log=ci.log]
 *
 * `--ci-log` is the captured `pnpm run ci` output. When that gate is red, the body
 * quotes the failure from it, so the pull request states the cause.
 *
 * The two gate outcomes arrive as VALIDATE_OUTCOME and VERIFY_OUTCOME. A step
 * cannot observe another step's exit code, so the workflow records each gate with
 * `continue-on-error` and passes its outcome in.
 *
 * Sets two step outputs: `changed`, and `ok` for whether both gates passed. The
 * workflow raises the failure itself, after the pull request exists.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { argv, env } from 'node:process';
import { flag, runIfMain } from '../cli.js';
import type { ScrapeReport } from '../scrape.js';
import { annotate, appendSummary, setOutput } from './actions.js';

/** What each recorded gate reported. `skipped` means the step never ran. */
export interface Gates {
  validate: string;
  verify: string;
}

const GATE_ADVICE: Record<keyof Gates, string> = {
  validate:
    '`pnpm run validate:data` is red, so `data/` does not match its schema. ' +
    'Fix the scraper or `data/salesforce-debug-log-events.schema.json`.',
  verify: '`pnpm run ci` is red. The cause is quoted below. Fix it on this branch.',
};

const CATALOG_ADVICE =
  'Each new event needs a catalog entry — see "Adding an event type" in `src/AGENTS.md`.';

function failed(gates: Gates): (keyof Gates)[] {
  return (Object.keys(gates) as (keyof Gates)[]).filter((k) => gates[k] !== 'success');
}

/** The most lines of `pnpm run ci` output the body quotes; the run log keeps all of it. */
const CI_QUOTE_LINES = 60;

const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g');
// Vitest's run summary, and the workflow commands its GitHub reporter repeats each error in
const NOISE = /^\s*(Test Files|Tests|Start at|Duration)\s|^::|ELIFECYCLE/;

/**
 * The part of the `pnpm run ci` output that names the failure.
 *
 * Vitest prints each failed test after its "Failed Tests" banner. Its summary can
 * interleave with them, as it goes to stdout and the errors to stderr, so the quote
 * runs to the end with the summary filtered out. Biome and tsc end on their errors,
 * so without the banner the tail is the cause.
 */
export function ciFailure(log: string): string {
  const lines = log.replace(ANSI, '').trimEnd().split('\n');
  const banner = lines.findIndex((l) => l.includes('Failed Tests'));
  const picked =
    banner === -1
      ? lines.slice(-CI_QUOTE_LINES)
      : lines.slice(banner).filter((l) => !NOISE.test(l));

  const kept = picked.slice(0, CI_QUOTE_LINES);
  const more = picked.length - kept.length;
  if (more > 0) kept.push(`… ${more} more lines in the run log`);
  return kept.join('\n');
}

function quoteCiFailure(ciLog: string | null): string[] {
  if (ciLog === null || ciLog.trim() === '') {
    return ['## Why `pnpm run ci` failed', '', 'The output was not captured. See the run log.', ''];
  }
  const quote = ciFailure(ciLog);
  // Longer than any backtick run in the quote, so the output cannot end the block
  const longest = Math.max(0, ...(quote.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(3, longest + 1));
  return ['## Why `pnpm run ci` failed', '', `${fence}text`, quote, fence, ''];
}

const SOURCE_NAME = { S1: 'the developer docs', S2: 'the Help article' } as const;

function sourceName(id: string): string {
  return SOURCE_NAME[id as keyof typeof SOURCE_NAME] ?? id;
}

/**
 * Everything a reader has to act on, in the words of the action to take.
 *
 * A scrape never overwrites a curated `category` or `level`, and it cannot know
 * whether an event has left the documentation for good, so both are decisions
 * rather than results.
 */
function decisions(report: ScrapeReport, gates: Gates): string[] {
  const items = failed(gates).map((gate) => GATE_ADVICE[gate]);
  if (gates.verify !== 'success' && report.added.length > 0) items.push(CATALOG_ADVICE);

  for (const event of report.notInS1) {
    items.push(
      `\`${event}\` is recorded against the developer docs but is no longer listed there. ` +
        'Check whether Salesforce removed it, and set `release_deprecated` if so.',
    );
  }

  for (const r of report.restated) {
    items.push(
      `\`${r.event}\` ${r.field}: recorded as ${r.stored} here, but now ${r.scraped} in ` +
        `${sourceName(r.source)}. The scrape left the recorded value alone — decide which is right.`,
    );
  }

  return items;
}

function changes(report: ScrapeReport): string[] {
  const version =
    report.versionBefore === report.versionAfter
      ? `${report.versionBefore} (unchanged)`
      : `${report.versionBefore} → ${report.versionAfter}`;

  const added =
    report.added.length === 0
      ? 'none'
      : `${report.added.length}, tagged for release \`${report.releaseKey}\` — ` +
        report.added.map((e) => `\`${e}\``).join(', ');

  return [
    '## Changes to `data/`',
    '',
    '| | |',
    '| --- | --- |',
    `| Database version | ${version} |`,
    `| New events | ${added} |`,
    `| Events with a changed category or level | ${report.changed.length || 'none'} |`,
    '',
  ];
}

function sources(report: ScrapeReport): string[] {
  return [
    '## Sources read',
    '',
    '| Source | Version | Events listed |',
    '| --- | --- | --- |',
    `| Developer docs | doc ${report.docVersion}, API ${report.apiVersion} | ${report.s1Count} |`,
    report.s2Count === null
      ? '| Help article | not read on this run | — |'
      : `| Help article | ${report.s2Release} | ${report.s2Count} |`,
    '',
  ];
}

/**
 * The standing difference between the two sources, folded away.
 *
 * Salesforce documents a new event in the developer docs first, so a handful of
 * names sit in one list and not the other for a release or two. That is expected
 * and permanent, and left in the open it buries everything worth reading.
 */
function differences(report: ScrapeReport): string[] {
  if (report.s2Count === null) {
    return ['The Help article could not be read, so the two sources were not compared.', ''];
  }
  if (report.disagreements.length === 0) return ['Both sources list the same events.', ''];

  const group = (heading: string, items: string[]): string[] =>
    items.length === 0 ? [] : [`**${heading} (${items.length})**`, '', ...items, ''];

  const onlyIn = (reason: 'only-in-s1' | 'only-in-s2'): string[] =>
    report.disagreements.filter((d) => d.reason === reason).map((d) => `- \`${d.event}\``);

  // flatMap, so the reason narrows to the variant that carries both readings
  const moved = report.disagreements.flatMap((d) =>
    d.reason === 'category' || d.reason === 'level'
      ? [`- \`${d.event}\` ${d.reason}: developer docs ${d.s1}, Help article ${d.s2}`]
      : [],
  );

  return [
    '<details>',
    `<summary>The two sources differ on ${report.disagreements.length} events</summary>`,
    '',
    'Salesforce documents a new event in the developer docs first; the Help article catches',
    'up a release or two later. A difference here is expected and needs no action. It is',
    'listed so that an event genuinely withdrawn, or a level that genuinely moved, is not',
    'missed.',
    '',
    ...group('Only in the developer docs', onlyIn('only-in-s1')),
    ...group('Only in the Help article', onlyIn('only-in-s2')),
    ...group('Different category or level', moved),
    '</details>',
    '',
  ];
}

/**
 * Pure, so the body a run would open can be asserted offline.
 *
 * `ciLog` is the captured `pnpm run ci` output, or null when none was captured.
 */
export function renderReport(
  report: ScrapeReport,
  gates: Gates,
  ciLog: string | null = null,
): string {
  const needed = decisions(report, gates);

  const lines = [
    'Automated refresh of the debug log event database, read from both official Salesforce',
    'sources over plain HTTP. See `scripts/scraper.md`.',
    '',
  ];

  if (needed.length === 0) {
    lines.push('**Nothing here needs a decision** — routine refresh.', '');
  } else {
    lines.push('## Needs a decision', '', ...needed.map((item) => `- ${item}`), '');
  }

  if (gates.verify !== 'success') lines.push(...quoteCiFailure(ciLog));

  lines.push(...changes(report));
  lines.push(...sources(report));
  lines.push(...differences(report));
  lines.push('---', '');
  lines.push(`Checks — tests: \`${gates.verify}\` · schema: \`${gates.validate}\``);

  // Every block ends with one blank line and none is ever pushed empty, so the
  // joined text needs no blank-run cleanup — only the trailing one removed
  return `${lines.join('\n').trimEnd()}\n`;
}

function main(): void {
  const args = argv.slice(2);
  const gates: Gates = {
    validate: env.VALIDATE_OUTCOME ?? 'skipped',
    verify: env.VERIFY_OUTCOME ?? 'skipped',
  };

  const reportPath = flag(args, '--report');
  if (reportPath === null) throw new Error('--report=<path> is required');

  const report = JSON.parse(readFileSync(reportPath, 'utf-8')) as ScrapeReport;
  // Absent when the verify step never ran
  const ciLogPath = flag(args, '--ci-log');
  const ciLog =
    ciLogPath !== null && existsSync(ciLogPath) ? readFileSync(ciLogPath, 'utf-8') : null;
  const body = renderReport(report, gates, ciLog);

  const out = flag(args, '--out');
  if (out !== null) writeFileSync(out, body);

  // Outputs and annotations first: appendSummary throws on an oversized body, and
  // the workflow needs `changed` and `ok` to open the pull request and raise after it
  setOutput('changed', String(report.dataChanged));

  const bad = failed(gates);
  for (const gate of bad) annotate('error', GATE_ADVICE[gate]);
  setOutput('ok', String(bad.length === 0));

  appendSummary(body);
  console.log(`Reported: data changed ${report.dataChanged}, ${report.added.length} new events`);
}

runIfMain(import.meta.url, main);
