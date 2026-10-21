# Usage and speed evidence report: <candidate short sha> against <baseline short sha>

Copy this file to `<candidate-short-sha>-vs-<baseline-short-sha>.md` and replace every `<...>`. The procedure is
[`docs/USAGE-BENCHMARK.md`](../../../docs/USAGE-BENCHMARK.md). Every field under "Required fields" must be filled;
write `not measured` for a layer that was not run, never a value copied from another run.

## Required fields

- Report date: <YYYY-MM-DD>
- Candidate SHA: <40 hex characters>
- Baseline SHA: <40 hex characters>
- Candidate plugin version: <version>
- Baseline plugin version: <version>
- Rule version: <integer>
- Rule hash: <64 hex characters, as printed by the compare tool>
- Model alias: <alias recorded in both baselines>
- Model tier: <tier recorded in both baselines>
- Host fingerprint: <cpu model, cores, memory GB, os release, node version; the six keys of the baseline host block, no hostname>
- Primary metric: <one of bytes, ms, time, cost, tokens, turns, per change>
- Primary metric chosen on: <YYYY-MM-DD, before the candidate was measured>
- Guard status: <clear, TRIPPED, or not evaluated (no L2 rows), with the per-scenario figures when evaluated>
- Distribution-only scenarios: <scenario ids from the rule scope, with draw counts and green medians, or none>

## Changes claimed

| Change | Primary metric | Expected direction |
|---|---|---|
| <what the release changed> | <metric> | <smaller / faster / fewer> |

## Verdict table

One row per layer. Layers not run say `not measured`. The headline is the row for the primary metric; other
rows are reported but cannot be a headline.

| Layer | Metric | Ratio (candidate / baseline) | 90% interval | Minimum effect | Status |
|---|---|---|---|---|---|
| L0 | bytes | <ratio> | <lower, upper> | 0.01 | <better / worse / inconclusive / not measured> |
| L1 | ms | <ratio> | <lower, upper> | 0.10 | <status> |
| L2 | time | <ratio> | <lower, upper> | 0.30 | <status> |
| L2 | cost | <ratio> | <lower, upper> | 0.20 | <status> |
| L2 | tokens | <ratio> | <lower, upper> | 0.20 | <status> |
| L2 | turns | <ratio> | <lower, upper> | 0.20 | <status> |

Overall verdict (from the primary metric): <better / worse / inconclusive / inconclusive-guarded / inconclusive-drift>

## Commands run

```text
<each command, with its exit code, in the order run>
```

## Limits

- Per release, not per commit: the result covers every change in the release together.
- The verdict is for the recorded model tier only; context-size effects transfer in direction, sizing and
  other behaviour effects do not.
- L0 is exact bytes injected, not tokens billed. L1 is one host fingerprint. Live L2 resolves only large
  changes (about 50% or more); smaller changes read inconclusive by design.
- Quality is a coarse non-inferiority flag only; no quality win or loss is declared.
- <anything specific to this run: layers not measured, scenarios excluded, halted draws, host differences>
