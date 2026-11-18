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
| Large (three tasks) | 0/9 | 0/9 | 5/9 | $4.09 against $1.29 (3.2x) |
| of which the TypeScript task | 0/3 | 0/3 | 1/3 | $4.19 against $1.34 (3.1x) |
| of which the Python task (another domain) | 0/3 | 0/3 | 1/3 | $3.89 against $1.24 (3.1x) |
| Small (two tasks, before the fix) | 2/6 | 4/6 | 6/6 | $0.99 against $0.31 (3.2x) |

- **The workflow ran on every staged draw.** Every unsolved draw of bare and somi5 missed the same unstated requirements: a download must tell the browser not to guess its type, including through a share link. On the medium tasks and the JavaScript large task, the staged hardening pass found and fixed them each time.
- **On the large TypeScript task, two of three staged draws failed.** One fixed everything but the same two type-guessing requirements, so hardening missed them there. The other failed one functional check on share links, with 43 of 44 tests passing. The bench keeps no workspace, so which assertion it failed is not known.
- **The rule was amended before these verdicts:** where somi5 solved none, it compares dollars per draw and requires the staged arm to solve at least one. Margin 0 and the 4x cost limit are still proposed, pending the maintainer.
- **The third large task is deliberately different:** Python rather than JavaScript or TypeScript, and a different domain: API keys with scopes, signed webhooks with retries, a CSV export, and idempotent creates. The unstated requirements are different too: webhooks must not reach internal addresses, secrets are never shown again, exported cells must not start a spreadsheet formula, and a key matches only in full. It still uses the same back-office design as the other large tasks.
- **On that task, every bare and somi5 draw missed both the internal-address and the formula requirements. Every staged draw met all the unstated requirements.** Two of three staged draws failed functional checks instead:
  - one exported nothing at all for a kind with no records, where the ticket asks for a header row;
  - the other also failed the due-deliveries check.
- **A wording slip in that task:** two non-staged draws read the idempotency key from the payload. The ticket says it sits next to the command. Neither outcome changes, because both draws also missed the safety requirements. The wording is left as it is, because changing it would void the measurement.
- **Verdicts at those settings:**
  - Medium **pays**: a gain of 1.0 on both tasks, at 3.4x the cost per draw.
  - Large **does not pay**. The gain is 1.0, 0.33 and 0.33 on its three tasks; the mean is 0.56 and the interval runs from -0.40 to 1.51. The cost passes at 3.2x. The evidence fails because, on the two harder tasks, the staged workflow solved only one draw in three.
- **What would change the large verdict:** a higher solve rate on the staged arm. The gap is in finishing the functional work, not in the unstated requirements, so more tasks at the current rate would not be enough.
- **Not shown yet:** whether the gap holds on medium and large tasks where somi5 sometimes succeeds.

## Raising the staged solve rate on large tasks (2026-11-15)

The failed staged draws above were traced to their causes, and the workflow was changed four times. Each change is stated in general terms, and none names a task. The changes were:
- a pass that reads the finished code against every line of the request;
- rule tests that hold limits at their ends;
- a hardening pass that lists every sink before it works through them, and checks lookups keyed by a name the caller sends;
- a trace that tries every input left out and wrong-typed first, takes the reading the words support best, and sends a wrong rule test back to the rules stage.

The version that has all of these except the last fix was measured on the three large tasks, three draws each. Plain SoMi and bare are compared from the earlier rounds, because nothing they run changed between the pins.

| Large task | bare | somi5 | somi5-deliver, before | somi5-deliver, this version |
|---|---|---|---|---|
| LG5 (JavaScript) | 0/3 | 0/3 | 3/3 | 2/3 |
| LG6 (TypeScript) | 0/3 | 0/3 | 1/3 | 1/3 |
| LG7 (Python, another domain) | 0/3 | 0/3 | 1/3 | 1/3 |
| **All three** | **0/9** | **0/9** | **5/9** | **4/9** |

- **The verdict is still that large does not pay.** The gain is 0.44, with an interval from -0.03 to 0.92, just short of the margin. Dollars per draw are $5.10 against $1.29, which is 3.96x, just inside the 4x limit. The trace pass added about $1 a draw.
- **The solve rate did not rise, and every failure has a known cause in the workflow. None is a capability limit.**
  - Three failures came from the hardening pass: it named the risk, then left it to another layer, a trusted caller or a browser. The risks were internal webhook addresses, a missing safety header, and spreadsheet formulas.
  - One came from a rule test that pinned an id form the request never gave. The trace named it, but the repair never ran, because one stage gave a full path and the other a path from the repository root.
  - One came from the trace, which left an import of unknown kinds in place as a deliberate reading.
- **Fixed since, and not measured:** the repair now matches files by folder and name. The hardening pass now closes a risk it can show and close with a defence that only adds, even when another layer could also close it. A hardening pass that returns nothing is not a clean one. These address four of the five failures above, and their effect is unmeasured.
- **Tooling:** an unsolved draw now keeps the source it ended with. Every cause above was found from that source. Before it, two failures could not be traced.


## Replaying the hardening on failed draws (2026-11-15)

The hardening pass was then split into steps:
1. a cheap step lists the surface;
2. a high-tier step decides each item as safe, defended or needing a decision, and cites a line of the request;
3. a medium step sees only that line and the excuse, and overrules an excuse the line does not back;
4. a builder applies the defences.

A new bench tool, `replay`, measures one stage at a time. It starts from the source a failed draw kept, answers every earlier stage from that draw's recorded transcripts, and runs the hardening live. Four failed draws were replayed twice under each version: the single hardening pass (8203c0e) and the split one (24a2bcb). The replay starts from code that was already hardened once, so it measures a second pass, not a fresh run.

| Failed draw | single pass | split |
|---|---|---|
| LG7, draw 1 | 2/2 | 2/2 |
| LG7, draw 3 | 0/2 | 1/2 |
| LG5, draw 3 | 0/2 | 0/2 |
| LG6, draw 1 | 0/2 | 0/2 |
| **Solved** | **2/8** | **3/8** |
| Dollars per replay | $0.66 | $0.82 |

- **The comparison is not valid as run.** The replay passed the draw's recorded check commands through unchanged. Those commands changed into the draw's own workspace, which no longer existed, so every check after hardening failed in all sixteen replays, for a reason that was not in the code. The single pass stops at a failed check. The split version sent each one to its repair step, so it got one more build pass than the single pass did. Its extra solve and its higher cost may both come from that pass. The replay tool now rewrites every path into the old workspace to one relative to the root, and the comparison has to be run again.
- **A second pass alone fixed LG7 draw 1 under both versions.** That failure was the pass's own variance, not its design.
- **The LG5 and LG6 miss is a "safe" verdict that nothing checks.** In all eight replays, the deciding step looked at a snapshot key named like a built-in object property, and called it safe because unknown keys were ignored. The request says a snapshot not shaped like an export is refused. The checking step reviews only excuses for leaving an item open. It never sees a "safe" verdict, so this one went unchallenged.
- **Next change, unmeasured:** send "safe" verdicts that rest on ignoring or accepting input through the same check against the cited line.
- **Spend:** $11.83 for sixteen replays. The finding on unchecked "safe" verdicts stands: the deciding step ran before any check, so the fault does not touch it.

### The replay run again, with a third version (2026-11-15)

The replay now runs each recorded check from the new workspace. It was run again on the same four failed draws, two runs each, with a third version: the split hardening, plus a check of "safe" verdicts (f735b20). In that check, a "safe" verdict that rests on the code ignoring, accepting or defaulting what a caller sends goes to a fresh agent. That agent reads the request's lines, and the verdict becomes a defence only where a line's words call for another answer.

| Failed draw | single pass | split | split, with the safe-verdict check |
|---|---|---|---|
| LG7, draw 1 | 2/2 | 2/2 | 2/2 |
| LG7, draw 3 | 0/2 | 1/2 | 0/2 |
| LG5, draw 3 | 0/2 | 0/2 | 0/2 |
| LG6, draw 1 | 0/2 | 0/2 | 1/2 |
| **Solved** | **2/8** | **3/8** | **3/8** |
| Dollars per replay | $0.70 | $0.79 | $0.82 |

- **No version is shown to be better than another.** Each differs by one solve in eight, on different draws.
- **With the checks running, the repair step ran in 2 of 16 split replays, not every one.** Its earlier rate came from the replay fault.
- **The safe-verdict check works as built, and the open question is how the request is read.**
  - In three of four runs, the deciding step marked the snapshot item as resting on ignored input, and the checker saw it. In the fourth, it marked the item "other", so the checker never saw it.
  - Of the three it saw, the checker overturned one, and that draw was solved. In the other two, it held that the line saying a snapshot not shaped like an export is refused says nothing about extra keys.
  - Pushing the checker toward refusing would add refusals that requests never ask for, so it was left as it is.
- **The single pass broke two tests that passed before it, in one replay.**
- **What this means for the verdict:** changes to one stage now move the result by about one solve in eight, which these replays cannot tell apart from noise. Settling whether large tasks pay needs more large tasks, not more changes to the hardening.
- **Spend:** $18.48 for 24 replays.
