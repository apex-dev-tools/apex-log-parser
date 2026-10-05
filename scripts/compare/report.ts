/**
 * Renders a harness run as Markdown: parity first, then time and memory per size band.
 */

import type { DiffResult } from './diff.js';
import type { Measurement } from './measure.js';

/** A step that did not finish, and why. */
export interface Failure {
  error: string;
}

export interface FileResult {
  file: string;
  bytes: number;
  /** Keyed by engine name. Empty when the run did not time. */
  runs: Record<string, Measurement | Failure>;
  /** Keyed by `<baseline>→<other>`. Empty when the run did not compare. */
  diffs: Record<string, DiffResult | Failure>;
}

const MB = 1024 * 1024;
// Each log goes in the first band whose ceiling holds it.
const BANDS = [
  { label: '< 1 MB', max: MB - 1 },
  { label: '1–20 MB', max: 20 * MB },
  { label: '> 20 MB', max: Number.POSITIVE_INFINITY },
] as const;

export function isFailure(value: object): value is Failure {
  return 'error' in value;
}

/** Nearest-rank percentile, `p` in 0–100. NaN for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  // rank is between 1 and sorted.length
  return sorted[rank - 1]!;
}

export function renderReport(results: readonly FileResult[], engines: readonly string[]): string {
  const lines = [
    '# Parser comparison',
    '',
    `${results.length} logs, ${formatBytes(sum(results.map((r) => r.bytes)))}. Engines: ${engines.join(', ')}.`,
    '',
    ...renderParity(results),
    ...renderPerformance(results, [...new Set(engines)]),
    ...renderErrors(results),
  ];
  return `${lines.join('\n')}\n`;
}

function renderParity(results: readonly FileResult[]): string[] {
  const pairs = [...new Set(results.flatMap((r) => Object.keys(r.diffs)))];
  if (!pairs.length) return [];
  const out = ['## Parity', ''];
  for (const pair of pairs) {
    const compared = results.flatMap((r) => {
      const d = r.diffs[pair];
      return d ? [{ file: r.file, d }] : [];
    });
    const failed = compared.filter((c) => isFailure(c.d));
    const differing = compared.flatMap(({ file, d }) =>
      !isFailure(d) && d.differing > 0 ? [{ file, d }] : [],
    );
    out.push(
      `**${pair}:** ${compared.length - differing.length - failed.length} of ${compared.length} identical, ${differing.length} differ, ${failed.length} failed to compare.`,
      '',
    );
    for (const { file, d } of differing.slice(0, 20)) {
      out.push(`- \`${file}\`: ${d.differing} of ${d.records} records differ`);
      for (const x of d.differences.slice(0, 3)) {
        out.push(`  - \`${x.key}\` \`${x.path}\`: ${clip(x.left)} → ${clip(x.right)}`);
      }
    }
    for (const { file, d } of failed) out.push(`- \`${file}\`: ${clip((d as Failure).error)}`);
    out.push('');
  }
  return out;
}

function renderPerformance(results: readonly FileResult[], engines: readonly string[]): string[] {
  if (!results.some((r) => Object.keys(r.runs).length)) return [];
  // engines is never empty
  const baseline = engines[0]!;
  const out = [
    '## Time and memory',
    '',
    'Warm is the median of the warm parses, cold the first parse in a fresh process. Retained is heap plus array buffers after a GC. Speed-up and memory are the median per-log ratio against the first engine.',
    '',
  ];
  const warm = (m: Measurement): number => percentile(m.warmRunsMs, 50);
  for (const band of BANDS) {
    const inBand = results.filter((r) => BANDS.find((b) => r.bytes <= b.max) === band);
    if (!inBand.length) continue;
    out.push(
      `### ${band.label} (${inBand.length} logs)`,
      '',
      '| Engine | Warm p50 | Warm p95 | Cold p50 | Cold p95 | Retained p50 | Retained p95 | Speed-up | Memory |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    );
    for (const name of engines) {
      const rows = inBand.flatMap((r) => {
        const m = r.runs[name];
        const base = r.runs[baseline];
        return m && !isFailure(m) ? [{ m, base: base && !isFailure(base) ? base : null }] : [];
      });
      const at = (pick: (m: Measurement) => number, p: number): number =>
        percentile(
          rows.map((r) => pick(r.m)),
          p,
        );
      const vsBase = (pick: (m: Measurement) => number, suffix: string): string => {
        if (name === baseline) return '—';
        const ratios = rows.flatMap((r) =>
          r.base && pick(r.m) > 0 ? [pick(r.base) / pick(r.m)] : [],
        );
        return `${percentile(ratios, 50).toFixed(1)}×${suffix}`;
      };
      const cold = (m: Measurement): number => m.coldMs;
      const kept = (m: Measurement): number => m.retainedBytes;
      out.push(
        `| ${name} | ${formatMs(at(warm, 50))} | ${formatMs(at(warm, 95))} | ${formatMs(at(cold, 50))} | ${formatMs(at(cold, 95))} | ${formatBytes(at(kept, 50))} | ${formatBytes(at(kept, 95))} | ${vsBase(warm, '')} | ${vsBase(kept, ' less')} |`,
      );
    }
    out.push('');
  }
  return out;
}

function renderErrors(results: readonly FileResult[]): string[] {
  const failed = results.flatMap((r) =>
    Object.entries(r.runs).flatMap(([name, run]) =>
      isFailure(run) ? [`- \`${r.file}\` (${name}): ${clip(run.error)}`] : [],
    ),
  );
  return failed.length ? ['## Errors', '', ...failed, ''] : [];
}

function clip(text: string, max = 120): string {
  const one = text.replace(/\s+/g, ' ');
  return one.length > max ? `${one.slice(0, max)}…` : one;
}

function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

function formatMs(ms: number): string {
  return Number.isNaN(ms) ? '—' : ms < 10 ? `${ms.toFixed(2)} ms` : `${Math.round(ms)} ms`;
}

function formatBytes(bytes: number): string {
  if (Number.isNaN(bytes)) return '—';
  if (bytes >= 1024 * MB) return `${(bytes / (1024 * MB)).toFixed(2)} GB`;
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
}
