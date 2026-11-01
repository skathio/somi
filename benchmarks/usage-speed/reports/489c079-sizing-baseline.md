# Sizing baseline: 489c079 against the labelled set

The sizing probe over every entry of the labelled set ([`tests/evals/sizing-set/set.json`](../../../tests/evals/sizing-set/set.json)),
on the plugin before any fact-backed sizing lands, scored by
[`sizing-score.mjs`](../../../tests/evals/lib/sizing-score.mjs). The bar was fixed before any draw: per task, an
entry passes when its modal tier is its label with a share of at least four of five draws, and a floor case
(`sensitive: true`) only on five of five.

- Plugin: `489c0796b15f16214df727c921aa9d4d1121ed72`, exported with `git archive`, tests and benchmarks excluded.
- Labels: `label_sha256` `42f21ab231c80ec5962f11f581404c82fb5701c2e9ca1067fc6bbae0c8a273c2` (checked by the scorer).
- Draws: 5 per entry, 80 in all: five one-repeat chunks (seeds 1-5), 2026-10-31, SoMi arm only, model alias `haiku`,
  tier `low`, every agent pinned, 8-minute probe timeout.
- Budget approved: $0.50 per draw, $40 in all (worst case: every draw at its cap). Each chunk was capped at the sum of
  its per-draw caps, $8. Booked: $10.20 over 4.1 draw-hours, no halt. $8.50 of that is the 17 timed-out draws, which
  end without a result event and are booked at their $0.50 cap; the 63 draws that stopped at a gate cost $1.70.
- Record: [`baseline-489c079-sizing.json`](../baseline-489c079-sizing.json).

**Result: baseline disagrees on M02, M03, M05, M06, M07, A1, A2.** 9 of 16 entries pass; 27 of 80 draws are
off-label (the pooled reading allows 8). Every floor case passes. Scorer line (per task; the pooled line names the
same entries):

```
sizing bar missed (per-task): disagrees on M02, M03, M05, M06, M07, A1, A2; 9/16 entries pass; 27/80 draws off-label (allowed 8); arm somi; plugin 489c0796b15f16214df727c921aa9d4d1121ed72; labels 42f21ab231c8
```

The baseline does not already meet the bar, so fact-backed sizing is measured against these misses.

## Per entry

| Entry | Label | Draws (tier: count) | Modal, share | Pass | Reason the CLI gave for `full` |
|---|---|---|---|---|---|
| M01 | small | small 5 | small 5/5 | yes | - |
| M02 | small | full 5 | full 5/5 | no | `est_diff_lines` (forecasts 120-150) |
| M03 | small | full 3, small 2 | full 3/5 | no | `est_diff_lines` (110; the small draws 70-90) |
| M04 | small | small 5 | small 5/5 | yes | - |
| M05 | small | full 4, small 1 | full 4/5 | no | `existing_work_item` and `brief_exists` unknown 2, `est_diff_lines` (120) 1, `T4` 1 |
| M06 | small | full 5 | full 5/5 | no | `est_diff_lines` (160-220) |
| M07 | small | full 3, small 2 | full 3/5 | no | `est_diff_lines` (120-150; the small draws 80-90) |
| M08 | small | small 5 | small 5/5 | yes | - |
| T1 | small | small 4, full 1 | small 4/5 | yes | `est_diff_lines` (110) |
| H1 | full | full 5 | full 5/5 | yes | `sensitive_core` |
| H2 | full | full 5 | full 5/5 | yes | `hard_surface` (with `T4`, `design_open`) |
| H4 (floor) | full | full 5 | full 5/5 | yes | `hard_surface`; once `sensitive_core` |
| A1 | trivial | trivial 2, full 2, small 1 | none (tie) | no | `hard_surface` |
| A2 | small | full 3, small 2 | full 3/5 | no | `hard_surface` |
| A3 (floor) | full | full 5 | full 5/5 | yes | `sensitive_core` |
| A4 (floor) | full | full 5 | full 5/5 | yes | `sensitive_core` |

The reasons and line forecasts are read from each draw's own `somi-tier.mjs --record` result in its stream. The
forecasts are the `est_diff_lines` values the model passed, read by pattern, so treat them as approximate.

## What the misses are

- **Four of the seven misses are the line forecast alone.** Every `full` on M02, M03, M06 and M07, and T1's one
  `full`, fired on `est_diff_lines` above the 100-line threshold and on nothing else. M05 is mixed: two `full` draws
  left `existing_work_item` and `brief_exists` unknown (each reads as its worst case), one forecast 120 lines, one
  fired `T4`. The forecasts
  overshoot the reference solutions: the micro tasks' oracles are 25-62 lines (M02 52, M06 62), and the model forecast
  M02 at 120-150 and M06 at 160-220. How many test lines a real change adds is not measured here.
- **A1 and A2 are `hard_surface`**, asserted by the model on a one-file change in `task01-plan`.
- No floor case dropped below `full`.

## Timed-out draws

17 draws hit the 8-minute probe timeout: 4 on M02, 3 on H4, 2 each on M03, M06, M07 and A4, 1 each on H1 and T1. Every
one sized `full`. `full` has no Stage -1 stop, so a `full` draw that does not pause later runs on into the design work
until the probe kills it. The scorer takes such a draw as an answer only when its tier came from the record file and is
`full`, and says how many it took (17 here). Each of the 17 streams holds exactly one `--record` call, whose effective
tier equals the recorded one; three draws that stopped at a gate recorded twice, with the same tier both times.

These rows were recorded before the harness checked a timed-out draw's model pin, so their rows carry no model list.
The 17 streams were checked by hand instead: every assistant event names the pinned model, and no line fails to parse.
Later runs check this per draw, as they do for a draw that stopped at a gate.

## Limits

- Five draws per entry on one model alias at the low tier; a share of 3/5 against 4/5 is within draw noise for a
  single entry.
- The SoMi arm only: there is no bare-arm sizing to compare against.
- The booked spend is an upper bound: a timed-out draw is booked at its cap.
