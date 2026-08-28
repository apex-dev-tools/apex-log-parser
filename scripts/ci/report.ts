/**
 * Renders one scrape run into the pull request body and the job summary.
 *
 * Reads the run record written by `pnpm scrape -- --report=...`, so the report is
 * built from data rather than from the scraper's stdout.
 *
 * Usage:
 *   pnpm run ci:report -- --report=run.json --out=pr-body.md
 *
 * The two gate outcomes arrive as VALIDATE_OUTCOME and VERIFY_OUTCOME. A step
 * cannot observe another step's exit code, so the workflow records each gate with
 * `continue-on-error` and passes its outcome in.
 *
 * Sets two step outputs: `changed`, and `ok` for whether both gates passed. The
 * workflow raises the failure itself, after the pull request exists.
 */

import { readFileSync, writeFileSync } from 'node:fs';
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
  verify:
    '`pnpm run ci` is red. A newly documented event needs a class in `src/` — ' +
    'see "Adding an event type" in `AGENTS.md`. Fix that on this branch.',
};

function failed(gates: Gates): (keyof Gates)[] {
  return (Object.keys(gates) as (keyof Gates)[]).filter((k) => gates[k] !== 'success');
}

function list(heading: string, items: string[]): string[] {
  if (items.length === 0) return [];
  return [`**${heading}** (${items.length})`, '', ...items.map((i) => `- ${i}`), ''];
}

function describeDisagreements(report: ScrapeReport): string[] {
  if (report.s2Count === null)
    return ['The Help site could not be read, so nothing was compared.', ''];
  if (report.disagreements.length === 0) return ['Both sources state the same events.', ''];

  const lines = [`**Source disagreement** (${report.disagreements.length})`, ''];
  for (const d of report.disagreements) {
    switch (d.reason) {
      case 'only-in-s1':
        lines.push(`- only in the developer docs: \`${d.event}\``);
        break;
      case 'only-in-s2':
        lines.push(`- only on the Help site: \`${d.event}\``);
        break;
      default:
        lines.push(`- \`${d.event}\` ${d.reason}: docs say ${d.s1}, Help says ${d.s2}`);
    }
  }
  lines.push('');
  lines.push('The developer docs lead the Help site, so names only in the docs are expected.');
  lines.push('');
  return lines;
}

/** Pure, so the body a run would open can be asserted offline. */
export function renderReport(report: ScrapeReport, gates: Gates): string {
  const lines = [
    'Automated update of the debug log event database from the two official Salesforce',
    'sources, both read over plain HTTP. See `scripts/scraper.md`.',
    '',
    `Data changed: \`${report.dataChanged}\` · \`pnpm run ci\`: \`${gates.verify}\`` +
      ` · schema: \`${gates.validate}\``,
    '',
  ];

  for (const gate of failed(gates)) {
    lines.push(`> ${GATE_ADVICE[gate]}`, '');
  }

  lines.push('## Sources', '');
  lines.push(
    `- Developer docs: doc version ${report.docVersion}, API ${report.apiVersion},` +
      ` ${report.s1Count} events`,
  );
  lines.push(
    report.s2Count === null
      ? '- Help site: not read on this run'
      : `- Help site: release ${report.s2Release}, ${report.s2Count} events`,
  );
  lines.push('');

  lines.push('## Result', '');
  lines.push(`- Database version: ${report.versionBefore} → ${report.versionAfter}`);
  lines.push(`- Release for a new event: \`${report.releaseKey}\``);
  lines.push(`- Events with a changed fact: ${report.changed.length}`);
  lines.push('');

  lines.push(
    ...list(
      'New events',
      report.added.map((e) => `\`${e}\``),
    ),
  );
  lines.push(
    ...list(
      'Recorded against the developer docs but no longer listed there',
      report.notInS1.map((e) => `\`${e}\``),
    ),
  );
  lines.push(
    ...list(
      'A source moved against a curated category or level',
      report.restated.map(
        (r) => `\`${r.event}\` ${r.field}: recorded ${r.stored}, ${r.source} now says ${r.scraped}`,
      ),
    ),
  );
  if (report.restated.length > 0) {
    lines.push('Those two fields are not overwritten by a scrape. Decide each one by hand.', '');
  }

  lines.push(...describeDisagreements(report));

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
  const body = renderReport(report, gates);

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
