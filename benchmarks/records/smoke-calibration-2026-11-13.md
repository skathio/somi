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

## On the tasks a bare agent fails (runs 9 to 16)

The smoke slice now takes the registered tasks a bare agent solved least: N17 and H4, each 0/6 for bare in the baseline. Both turn on a safety requirement the ticket does not spell out. These are the last five rounds on both, from the same day and pin, plus three rounds of somi5 without the rules digest at session start, using the existing `digest-off` patch:

| Arm | H4 | N17 | Both | Dollars per solved |
|---|---|---|---|---|
| bare | 0/5 | 3/5 | 3/10 | about $0.40 |
| somi5 | 4/5 | 4/5 | 8/10 | about $0.33 |
| somi5, rules digest off | 1/3 | 1/3 | 2/6 | about $0.27 |
| somi5-deliver, after its stages read the rules | 2/2 | 1/2 (1/1 with the workflow) | 3/4 | about $0.83 |

- **somi5 catches the traps bare misses, and costs less per solved task here.** On H4, bare missed the unprompted requirement on all five draws.
- **The rules digest is what makes the difference.** Without it, somi5 falls to bare's rate. The catch came from the first implementation, not from a review: on N17 no review ran, and on H4 the security reviewer raised only Minors. That is the security floor at work.
- **The staged workflow missed N17's trap on every draw until its stages read the rules.** A stage gets no session-start hook, and neither does a worker. Both now name the rules file and read it first.
- **Not significant yet:** 8/10 against 3/10 gives p ≈ 0.07 on these draws. The rules were not tuned to these tasks: nothing in the digest names either trap, and adding the traps to it would teach to the test.

**Correction.** One of those N17 draws, the one that failed, never started the workflow. The session called `somi_route` with no arguments, got plain steps and built inline. With the workflow, the staged arm solved both draws it ran on N17. A typed `/somi-deliver` now always starts the workflow, and the bench records `workflow_ran` on every draw.

## `/somi-deliver` on hard medium and large tasks (2026-11-14)

Four new tasks, each decided by safety requirements the ticket does not state: two medium (one in JavaScript, one in strict TypeScript) and two large (the same split). They share a domain, so the two medium results are correlated, and so are the two large ones. Three draws per arm, Sonnet as the session, Haiku as the low tier, Opus as the high tier only. The first round on the medium JavaScript task found a gap: the staged builders never saw the project's documented conventions, and two of three draws answered a missing field against the README. With that fixed (the scout quotes the conventions and every stage gets them), the rounds below ran on one pin:

| Segment | bare | somi5 | somi5-deliver | Deliver dollars per draw, against somi5 |
|---|---|---|---|---|
| Medium (two tasks) | 0/5 | 0/6 | 6/6 | $1.76 against $0.52 (3.4x) |
| Large (two tasks) | 0/6 | 0/6 | 4/6 | $4.19 against $1.31 (3.2x) |
| of which the TypeScript task | 0/3 | 0/3 | 1/3 | $4.19 against $1.34 (3.1x) |
| Small (two tasks, before the fix) | 2/6 | 4/6 | 6/6 | $0.99 against $0.31 (3.2x) |

- **The workflow ran on every staged draw.** Every unsolved draw of bare and somi5 missed the same unstated requirements: a download must tell the browser not to guess its type, including through a share link. On the medium tasks and the JavaScript large task, the staged hardening pass found and fixed them each time.
- **On the large TypeScript task, two of three staged draws failed.** One fixed everything but the same two type-guessing requirements, so hardening missed them there. The other failed one functional check on share links, with 43 of 44 tests passing. The bench keeps no workspace, so which assertion it failed is not known.
- **The rule was amended before these verdicts:** where somi5 solved none, it compares dollars per draw and requires the staged arm to solve at least one. Margin 0 and the 4x cost limit are still proposed, pending the maintainer.
- **Verdicts at those settings:** medium **pays** (gain 1.0 on both tasks, 3.4x per draw). Large **does not pay**: the gain is 1.0 and 0.33 on its two tasks, and with two paired tasks the interval runs from -3.6 to 4.9. The cost passes at 3.2x. What fails is the evidence for a gain: two tasks cannot show one unless they agree exactly.
- **Not shown yet:** whether the gap holds on medium and large tasks where somi5 sometimes succeeds, and on a third large task, which large needs for a bound that can clear.
