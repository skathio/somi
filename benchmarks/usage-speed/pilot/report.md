# Calibration pilot report (draft rule, low tier)

Phase `calibration` and `sizing` rows only; none of them enter a baseline. Model alias `haiku` (the host's low tier), ceiling low, every agent pinned,
one draw at a time, 2026-10-20. Raw terminal rows: `results.jsonl` (rows only; halted attempts and their cost are not in it).

## Spend

$12.05 of the $25 approved: $6.40 on 12 scored calibration draws, $2.14 on 8 sizing probes, and $3.50 sunk on one SoMi draw (S2) that hit the
account limit before it finished (it was re-run from scratch). The account limit halted the run twice; resuming skipped finished draws as designed.

## Measured per-cell results (2 draws per scenario and arm)

| Scenario | Arm | Cost ($) | Time (s) | Turns | Hidden suite passed |
|---|---|---|---|---|---|
| S1 code-loop | somi | 0.29, 0.40 | 225, 365 | 26, 32 | 9/9, 9/9 |
| S1 code-loop | bare | 0.08, 0.10 | 52, 69 | 10, 14 | 9/9, 9/9 |
| S2 T1 ship-loop | somi | 1.90, 0.22 | 1055, 214 | 82, 10 | 27/31, **0/31** |
| S2 T1 ship-loop | bare | 0.16, 0.24 | 133, 215 | 8, 12 | 28/31, 28/31 |
| S3 M01 bracket | somi | 1.11, 1.29 | 644, 880 | 15, 23 | 50/103, 49/103 |
| S3 M01 bracket | bare | 0.39, 0.23 | 404, 183 | 13, 11 | 51/103, 51/103 |

## Spread (log scale sigma, from two draws per cell, so rough)

| Metric | SoMi arm, all scenarios | SoMi arm without S2 | Bare arm |
|---|---|---|---|
| cost | 0.89 | about 0.18 | 0.30 |
| time | 0.69 | about 0.29 | 0.39 |
| turns | 0.88 | about 0.24 | 0.23 |
| tokens | 1.12 | about 0.55 | 0.32 |

S2 on the SoMi arm is bimodal: one draw ran the full flow ($1.90, 82 turns), the other stopped after 10 turns at $0.22 with 0 of 31 hidden tests
passing. That is a degenerate run, not noise around one mean. The quality guard (green share) flags it; the cost and time ratios cannot absorb it.

## Sizing and exclusion

- Calibration draws excluded or paused: 0 of 12. Halted by the account limit and re-run: 3 attempts, none counted.
- Sizing probes (low tier, SoMi arm only): M01 full once, small once; M03, M05 and M08 sized full in every probe whose tier was read. Three of 8
  probes (M08 twice, M03 once) ended at the $0.50 or 5 minute cap before a tier was recorded. The tier-flip rate is therefore high, and a stratum is
  needed for any scenario that sizes inconsistently. S3 sized small in both calibration draws; S2 sized full in both.
- Recorded `tierSource`: S2 and S3 SoMi draws carry a tier; S1 (code-loop) never sizes and records `unknown`.

## Do 8 repeats suffice?

No, not for the minimum effects in the draft rule (20% cost, tokens, turns; 30% time). With the spread above and 8 draws per arm, the 90% interval
of the overhead ratio is about +/-0.26 on the log scale for cost without S2 (and several times wider with it). An interval that wide clears a
20% minimum effect only when the true effect is roughly 55% or more. To bring the half-width down to about 0.09 (so a true effect near twice the
minimum is called) takes on the order of 65 draws per arm per scenario, which at today's cost is out of budget (roughly $200 across three scenarios at the pilot's average of about $1 per pair).

Conclusions for the rule (the user decides, step 2.3):

1. L2 can call only large cost or time changes (about 50% or more) and only on the stable scenarios (S1, S3). It cannot resolve 20%.
2. S2 SoMi should be reported as a distribution (full run versus early stop) and judged by the quality guard, not by a ratio of medians.
3. Small effects must be shown by L0 (exact bytes) and L1 (local latency, 6% run to run), which are free; an optimisation whose claim is smaller
   than the L2 detectable effect is measured at L0/L1 only, and the report says L2 could not see it.
4. A probe cap of $0.50 and 5 minutes is too tight for M08 (two of two ended at the cap with no tier read); the driver defaults are now $1.00 and 8 minutes.
5. Whether `--pinned-ids` is needed is answered: no unpinned-model row appeared in 20 rows.

Limits: two draws per cell give rough sigma estimates (plus or minus a factor of two); the pilot is one account, one host, one day.
