/**
 * One wording for every benchmark comparison: how many times smaller or larger, and the change in
 * percent. No other imports, so any script can use it.
 */

const WORDS = {
  time: ['faster', 'slower'],
  memory: ['less', 'more'],
} as const;

export type Measure = keyof typeof WORDS;

/** `now` against `before`, e.g. `4.4× faster (-77.6%)`. A dash when either is not positive. */
export function versus(before: number, now: number, measure: Measure): string {
  return before > 0 ? fromRatio(now / before, measure) : '—';
}

/** The same wording from `now / before`. */
export function fromRatio(ratio: number, measure: Measure): string {
  const both = parts(ratio, measure);
  return both ? `${both[0]} (${both[1]})` : '—';
}

/** `now / before` as times and as a change, e.g. `['4.4× faster', '-77.6%']`; null when not positive. */
export function parts(ratio: number, measure: Measure): [times: string, change: string] | null {
  if (!(ratio > 0) || !Number.isFinite(ratio)) return null;
  const [smaller, larger] = WORDS[measure];
  const change = (ratio - 1) * 100;
  return [
    ratio <= 1 ? `${(1 / ratio).toFixed(1)}× ${smaller}` : `${ratio.toFixed(1)}× ${larger}`,
    `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`,
  ];
}
