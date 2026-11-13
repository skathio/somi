# Smoke calibration before release (2026-11-13)

Eight smoke runs of the private benchmark on `release/next`, each one draw per task and arm, used to find and fix defects before any recording. This is a working record, not a measurement: one draw per cell, and the tasks are not yet probed.

- **Session model:** sonnet. **Low tier:** haiku. **High tier:** opus, through `--high-model` only.
- **Tasks:** the smoke slice, two small (N22, H1), one medium in Python (MD3) and one large in JavaScript (LG1).
- **Arms:** `bare`, `somi5`, and `somi5-deliver`, which sends each message as `/somi:somi-deliver`.
- **Spend:** $44.0 of an approved $80, over 96 draws. 69 of them are valid.

## What was fixed between runs

Each fix has a test that fails without it, and the plugin was pinned again before the next run.

| Run | Found | Fix |
|---|---|---|
| 1 | `/somi-deliver` stopped after its first milestone. Builders listed the later milestones as unfinished work. The plan cut a 60-line task into four milestones. | Later milestones and deferred parts get their own field. The plan keeps most work to one milestone. |
| 2 | A rules file over a quality limit failed every build of one milestone. The builder may not change that file. | The rules stage meets the quality limits before any build starts. |
| 3 | A rule test that no implementation could pass blocked a milestone. | A builder names the rule tests it thinks are wrong. They go back once to the rules stage, which fixes or keeps each. |
| 3 | The quality gate charged a one-line edit to 24 copies of a service as 72 new copies. | An exact copy counts only when most of its seeds are new. Recalibrated: false failures on copies fell from 10 to 6 of 212, and the planted copies caught are unchanged. |
| 1–3 | On H1, `/somi-deliver` failed the spreadsheet-formula safety requirement in all three runs. The plan's paraphrase of an ambiguous line became the rule. | Milestones quote the request and decide nothing. An open line carries no hint, and the builder settles it instead of deferring it. |
| 4 | The API refused nine draws with a Cloudflare 403. They were scored as finished draws that solved nothing. | A draw whose result is an API error is invalid, and the run halts. |
| 6 | Large requests lost their last feature on most draws, on every arm. | Large code work ends with a check of each requirement against the request. |
| 7 | All three arms failed LG1's import tests the same way. A strict import, as the spec asks, scored 13/16 against them. | The task's snapshots now list every kind, as an export does, in all four LG tasks. LG import results from before this are not comparable. |

## Results over the valid draws

LG1 counts only run 8, after its tests were fixed.

| Task | bare | somi5 | somi5-deliver |
|---|---|---|---|
| N22 (small) | 6/8, $0.07 | 8/8, $0.24 | 8/8, $0.51 |
| H1 (small) | 5/7, $0.16 | 6/7, $0.15 | 2/7, $0.37 |
| MD3 (medium) | 7/7, $0.20 | 7/7, $0.26 | 6/7, $0.80 |
| LG1 (large) | 1/1, $0.42 | 1/1, $1.31 | 1/1, $2.50 |

| Arm | Solved | Dollars per solved | Small tasks: solved, dollars per solved |
|---|---|---|---|
| bare | 19/23 | $0.189 | 11/15, $0.158 |
| somi5 | 22/23 | $0.278 (1.47x bare) | 14/15, $0.212 (1.34x bare) |
| somi5-deliver | 17/23 | $0.868 | 10/15, $0.668 |

`somi5-deliver` is pooled over every run, most of them before its fixes. In run 8, after all of them, it solved all four tasks.

## What it says, and what it does not

- **somi5 never solved fewer draws than bare on any task.** Its edge is the draws where bare misses a stated requirement (N22, H1). The difference, 22/23 against 19/23, is not significant at these counts.
- **Cost is inside the ship rule on small work, at 1.34x.** Most of the overhead on N22 is the security review on the high tier, which this path triggers. It found only Minors in every run.
- **The slice is at the ceiling.** With its tests fixed, LG1 is solved by bare in about two minutes. It is not a large task by the segment's own criteria, so these runs say nothing yet about SoMi on large work. Telling the arms apart needs harder medium and large tasks, probed into the band.
- **`/somi-deliver` costs three to four times somi5 on this slice.** It is not worth it on small work. Its value on real large work is unmeasured.
