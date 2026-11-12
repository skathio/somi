// quality/findings.mjs: where a finding goes. A rule that has been calibrated on known-good code fails a change. A rule that has not
// yet, or whose false alarms on that code were too many to fail on, is advice: it is reported with the warnings and fails nothing.
// Which is which is fixed here and is not configuration, so a project cannot turn a failing rule into advice.

export const ADVISORY = Object.freeze(new Set([
  'options', 'unanalyzed',
  'empty-catch', 'log-only-catch', 'rethrow-catch', 'skipped-test', 'test-without-assertion', 'console', 'unused-binding', 'pass-through',
  'unused-export', 'import-fan-out', 'cycle-grown', 'file-lines', 'file-functions', 'file-added-lines',
]));

/** A finding as a violation or a warning, by its rule. In a benchmark, code the parser cannot follow fails. */
export function report(ctx, finding) {
  const advice = ADVISORY.has(finding.rule) && !(finding.rule === 'unanalyzed' && ctx.mode === 'benchmark');
  (advice ? ctx.warnings : ctx.violations).push(finding);
}

export const inAdded = (added, line) => added.some(([a, b]) => line >= a && line <= b);
export const overlaps = (added, first, last) => added.some(([a, b]) => a <= last && b >= first);
