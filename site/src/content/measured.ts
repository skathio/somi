// The latest usage-benchmark results (docs/USAGE-BENCHMARK.md, benchmarks/usage-speed/reports/). Update with
// each release that records a new baseline; state only what the sealed rule called.

export interface Comparison {
  label: string;
  cost: string;
  time: string;
  costVerdict: string;
  timeVerdict: string;
  guard: string;
}

export const MEASURED = {
  setup: 'L2, low tier, every agent pinned',
  comparisons: [
    { label: '4.0.0 before the #40 work, against the last pre-4.0.0 commit', cost: '×1.01', costVerdict: 'inconclusive', time: '×1.09', timeVerdict: 'inconclusive', guard: 'clear' },
    { label: 'Issue #40 cost work, scenarios S1–S3', cost: '×0.88', costVerdict: 'inconclusive', time: '×0.79', timeVerdict: 'inconclusive', guard: 'clear' },
  ] satisfies Comparison[],
  highlights: [
    { title: 'Sizing is stable', text: 'A routine 80-line task was sized `full` in **0 of 8** probes, against 3 of 8 before.' },
    { title: 'Cheaper small work', text: 'Median cost of that task through `/ship-loop`: **$0.119 → $0.064**, with all 8 draws fully green.' },
    { title: 'More finished work', text: 'On a security-sensitive task, **6 of 8** draws were fully green, against 3 of 8 before.' },
  ],
  note: 'Cost and time are inconclusive under the rule, so no saving is claimed. Live L2 only resolves changes of about 50% or more.',
};
