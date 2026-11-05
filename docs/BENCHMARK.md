# Benchmark and release decision

5.0 ships as the default only if this benchmark says so. **Every paid run needs the maintainer's go-ahead for that specific run, with its budget and worst case.** `bench.mjs run` refuses without `--go`, and the test suite spends nothing.

**Status:** neither 5.0 candidate passes the release rule. The second passes both quality checks and misses on cost. See [Results](#results). 5.0 stays a release candidate. An exploratory run with a cheap `/somi` command came in at about 1x bare with quality level, which is not a release pass: see [The light phase](#the-light-phase).

## Results

Sixteen tasks, a Sonnet session, a Haiku low tier, recorded with dollars from billing. Records are in `benchmarks/v2/records/`, each with a written reading.

| Arm | Draws | Solved | Dollars per solved | Minutes per draw |
|---|---|---|---|---|
| Bare | 96 | 73 | $0.118 | 0.5 |
| 4.1 | 96 | 63 | $3.162 | 6.4 |
| 5.0 first candidate | 96 | 70 | $0.211 | 2.3 |
| 5.0 second candidate | 96 | 71 | $0.277 | 1.6 |

**Release rule: neither ships.** The checks, with failures in bold:

| Check | Limit | First candidate | Second candidate |
|---|---|---|---|
| Dollars per solved against bare | at most 1.5x | **1.79x** | **2.35x** |
| Solved rate against bare, lower 95% bound | at least -20 points | **-20.35** (mean -3.1) | -18.3 (mean -2.1) |
| Hidden tests passed against bare, lower 95% bound | at least -5 points | **-15.6** (mean -5.0) | -1.9 (mean -0.4) |
| A/A interval contains zero | yes | yes (-15.2 to 6.8 points) | yes, same recording |

**The second candidate** gives sensitive work a stronger worker and no longer starts a review on three size and shape signals, which it still records. It was designed after reading how the first failed on these tasks, so its two quality passes are weaker evidence than a first look. Its [record](../benchmarks/v2/records/candidate2-44ddb986add1.md) has the full reading. In N10 and N11, 9 of the 10 unsolved draws had a reviewer naming the missed gap and rating it Minor or Nit, which does not re-loop. The coordinator alone uses more tokens per draw than bare uses for the whole task.

**Against 4.1,** per draw, the first candidate: 0.088x the dollars (0.063 to 0.125), 0.227x the tokens (0.168 to 0.307). The second: 0.113x the dollars (0.083 to 0.153), 0.158x the tokens (0.108 to 0.230). Both solved more tasks. 4.1 cost 16.69x bare in dollars (12.55 to 22.21). Bare did not drift between recordings (0.989, 0.928 to 1.054, then 0.976, 0.936 to 1.017). Neither candidate had an inline write in 96 draws.

**Which parts pay,** from the registered ablation on the first candidate, 64 draws a side, one draw per task and cell:

| Part | With: solved, share, dollars per draw | Without: solved, share, dollars per draw |
|---|---|---|
| Review on signals | 44, 0.913, $0.128 | 46, 0.916, $0.076 |
| Digest | 44, 0.911, $0.103 | 46, 0.918, $0.100 |
| Planning step | 43, 0.911, $0.102 | 47, 0.918, $0.102 |

Differences of a few draws are inside the noise floor. Review shows no gain on these tests for 68% more dollars, though reviewers did report real problems that the hidden tests do not check.

**What the worker model does,** from an [exploratory ablation](../benchmarks/v2/records/exploratory/ablation-sonnet-worker-44ddb986add1.md) with the low tier mapped to Sonnet, chosen after seeing the candidate result and outside the release decision. Across 128 draws each, solved stays at 90. Hidden-test share rises from 0.915 to 0.978 (bare 0.983), and dollars per draw from $0.102 to $0.168 (bare $0.090). Failed safety tests fall from 103 to 48, and boundary tests from 41 to 1.

## The light phase

`--phase light` is exploratory and tests each part on its own. Both SoMi arms come in through `/somi` with that command pinned to the cheap model, because that was the first way found to pin the main thread: the same setting on a skill the model loads did not change the model in a live check. A later live check on CLI 2.1.316 found that a `model` on the agent passed to `--agent` keeps the main thread on that model across follow-ups, unless `--model` is also given. This run did not test that. `somi5` also has tested fixes, and `somi5-pin` does not. The pin is applied by the bench for now, and a shipped version needs a way to carry it on Claude alone, since shared files name no models. These draws use the same 16 tasks, so they can stop an idea cheaply but cannot prove one.

**Result.** Recorded on a4312b5, 96 draws an arm, [full reading](../benchmarks/v2/records/exploratory/light-44ddb986add1.md). This is a third look at the same tasks and the pin is not shipped, so it is not a release pass.

| Arm | Solved | Dollars per solved | Against bare | Solved rate against bare | Time against bare |
|---|---|---|---|---|---|
| Bare | 73 | $0.118 | | | |
| `somi5`, cheap command and tested fixes | 75 | $0.131 | 1.11x | +2.1 (-9.6 to +13.7) | 2.97x |
| `somi5-pin`, cheap command only | 77 | $0.114 | 0.97x | +4.2 (-11.2 to +19.5) | 2.91x |

The cheap command takes dollars per solved from 2.35x bare to about 1x, with quality level. Small work on Haiku costs about a fifth of bare on N01 and N18. Review still shows no gain on the hidden tests and is 63% of the dollars. Tested fixes raised N10 and N11 but show no overall gain, and SoMi still loses to bare on both. In 6 of 192 draws a follow-up reply led to code committed on the main thread with no SoMi review, which has to be fixed before this ships.

## The questions

1. **Is SoMi worth it?** Dollars per solved task and quality per task, against a bare agent on the same model, on a mix of tasks a bare agent sometimes fails, narrowly misses and always solves.
2. **Is 5.0 better than 4.1?** The same measurement on the same tasks.
3. **Which parts pay?** Each part measured on and off, not argued.

## What the earlier benchmark got wrong, and what changed

| Earlier | Now | Why |
|---|---|---|
| Every scenario at the ceiling | Tasks are probed and kept only between floor and ceiling | A guard at the ceiling can only say "no worse" |
| Green tests were the only grade | Each draw gets a label, and a stopped loop is never solved | Draws that stopped at a gate scored full marks |
| A verdict per scenario at 8 draws | One ratio blocked by task, pooled across tasks | Per-scenario verdicts could only resolve about 50% effects |
| Medians, split rebuilt by hand | Tokens per solved task, with the per-agent split in each row | Nothing said why a draw cost what it did |
| Adherence invisible | Route, agents, passes, gates and findings in each row | Tool bypasses and wrong scopes went unreported |
| Manual assembly and comparison | `bench.mjs record` runs to the end or a stop and writes the record | A copied script is not a procedure |
| Alias pinned, near matches passed | A full model id, and each served model must match it | One alias change moved the low tier off every calibration |

**Kept:** pre-registration, a hash of the rule, refusal to compare across a different model, rule or host, resumable one-at-a-time draws, the privacy scan on committed records, per-draw budget caps, and the sandboxed draw engine with hidden-test scoring and task admission.

**Replaced:** the statistics, because each task's difference is now the observation, and a mixed model would add a fitting dependency for the same estimate. The driver, because it was built around the old scenarios.

**Dropped:** the size and latency layers, because `tests/surface.test.mjs` fixes the size and latency was bound to one machine. The committed 4.1 record as a baseline, because it is on tasks at the ceiling, so 4.1 runs live as an arm instead. Mediating variables as covariates, because passes and adherence are effects of the arm.

The old driver's debts went with its code. The ones that still apply are now tested: an alias near-match, a timeout scored as an outcome, and a budget too small to start.

## Tasks

The pool is `benchmarks/v2/candidates.json`. A task needs a reference solution that passes, a second one that passes, an empty solution that fails and mutants that fail, all checked at admission. The registered set is 16 tasks: 4 a bare agent solves 1 or 2 times in 3, 4 it always narrowly misses, and 8 it always solves, at the medium tier. A registered task is never edited, only replaced.

The mix follows the claim, which is cost with quality held. Band tasks show change either way, near misses leave room for a review to help, and ceiling tasks show harm with little noise. It says less about whether SoMi improves outcomes than an all-band set would, and an all-band set was not reachable: about 10% of tasks landed in the band.

Six kinds are wanted: multi-file features, bugs with a misleading symptom, security-sensitive changes, ambiguous specs where asking is right, refactors under green tests, and planted traps a reviewer should catch.

**What the first pool showed:** of 15 tasks, none qualified at the medium tier and 2 at the low tier. Only the two tasks with many independent hidden criteria ever failed. The algorithm tasks all reached the ceiling, including ones the previous low-tier model solved about half the time. **A calibration does not outlive a model generation**, so hard-spec tasks are worth more than hard-algorithm tasks, and each new pin needs a fresh probe. Those 15 are marked `retired` for this pin, and each keeps its directory. A task with zero solves is not re-drawn in the hope of landing in the band, because that would bias the selection.

**The second pool** is 30 tasks written for the kinds that were missing, each with a few traps a senior engineer would be expected to catch: a cause elsewhere than the ticket blames, a policy file the ticket does not mention, a helper with a latent bug, or unprompted hardening. Their band is unmeasured until they are probed.

**A fair trap is not the same as admission.** Admission cannot catch a hidden test that demands one valid answer over another, because the reference solutions were written alongside the tests. The first probe of the second pool found several, each failing identically on every draw. So a person or an independent reviewer reads the hidden tests before registration.

A pilot's 1-or-2-of-3 is noisy: a task whose true rate is 50% qualifies 75% of the time, and one at 90% still qualifies 27% of the time. So the bare arm is always re-drawn in the recording, and pilot draws are never reused.

**The registered mix** is 5 tasks in the band, 2 near-miss floor tasks and 9 ceiling tasks. The design wanted 4, 4 and 8. An independent reviewer removed unfair tests, which moved some tasks up, and six more hard tasks were then written and probed. The session model solved nearly all of them, so a fair floor task is now rare at this model. Dropping floor tasks does not favour SoMi, because a bare agent's zero on a floor task is where a workflow would gain most.

## Grading

A draw is solved only if it **finished**, every hidden test is green, no scorer flag is raised, and no existing file changed outside what the task names. A new stray file is reported but does not un-solve the draw.

| Label | Meaning |
|---|---|
| `finished` | The agent ended by itself |
| `stopped-at-gate` | The journal stopped at a named gate, or the budget ran out |
| `asked-user` | It ended on a question with nothing changed |
| `timed-out` | It hit the limit. This is an outcome, and it counts as not solved |
| `invalid` | A leak, a tampered scorer, a wrong model. Reported, never hidden |

A paused draw gets one scripted "continue" on every arm, bare included. It used to go to the workflow arm only, which favoured it.

## The record

Each row of `results.jsonl` holds: draw, task, arm, `label`, `gate`, green and total, `solved`, failing test names, scorer flags, `scope` (touched and added), `adherence` (route, steps, agents and models, opened, closed, passes, gates, signals, security signals, diff facts, findings by severity), `agents` (weighted tokens per agent), `split_coverage`, cost, wall time, turns, tokens, weighted tokens, models and machine load.

Totals come from the result's per-model usage, which includes subagents. The split joins stream ownership to the final per-message usage in the transcripts, because the stream's own per-message figures are placeholders. `split_coverage` says how much of the total the join accounts for.

The diff facts and signals in each row are what the review thresholds can later be fitted from.

## Statistics

- **Cost, tokens, time:** the geometric-mean ratio between arms, blocked by task, with a 90% interval over tasks. Cost-per-solved is reported beside it.
- **Solved rate:** the paired difference by task, with a 95% interval clustered by task, plus pass@1 and pass^k.
- **Noise floor:** A/A, bare against bare, on the same tasks, before any A/B and on every model change.
- **Stopping:** one registered look at half the draws, with a boundary of z 2.8. Anything else runs to the planned count.
- **Parts:** factorial main effects use `logRatio` over arm sets, with Holm across main effects. Interactions are exploratory.

### Power

`node benchmarks/v2/bench.mjs power --pilot <dir>` prints these, and they are tested against hand calculations.

**Cost or tokens, draws per arm** (90% interval, 80% power). Bare's within-task log spread is 0.13 to 0.18 on both pilots, so the workflow arm's spread sets the size. 4.x had a median of 0.41 and reached 1.81 in the worst scenario. 5.0's is unmeasured.

| Workflow arm spread | 50% | 30% | 25% | 20% |
|---|---|---|---|---|
| 0.15 | 3 | 5 | 6 | 8 |
| 0.41 | 5 | 12 | 17 | 26 |
| 0.8 | 11 | 35 | 52 | 85 |
| 1.2 | 21 | 74 | 112 | 184 |

**Pass rate.** +20 points needs 91 draws per arm and +10 needs 385. Pairing saves little here: calibrating tasks into a narrow band removes the between-task variance pairing would cancel, leaving a correlation near 0.06.

**A lane exactly as good as bare, clearing a pass-rate margin.** Each cell is the chance it passes. A simulation of the clustered rule agrees within 3 points.

| Margin | 60 draws per arm | 96 | 128 | Draws per arm for 80% |
|---|---|---|---|---|
| -5 points | 8% | 10% | 12% | 1571 |
| -10 points | 19% | 28% | 36% | 393 |
| -15 points | 38% | 55% | 67% | 175 |
| -20 points | 59% | 79% | 89% | 99 |

**Share of hidden tests passed, -5 point margin:** 41 draws per arm at a per-draw spread of 0.08, 142 at 0.15 and 393 at 0.25. Off-ceiling spread on the current pool is under 0.1, but it has no catastrophic failures yet.

### Time and usage per draw, bare

| Tier | Minutes | Weighted tokens | CLI dollars | On the two hard tasks |
|---|---|---|---|---|
| Medium | 0.7 | 50k | 0.109 | 1.1 min, 71k, 0.151 |
| Low | 1.7 | 190k | 0.022 | 2.0 min, 247k, 0.028 |

The medium tier was faster and used fewer tokens per draw than the low tier, on these tasks and on a bare agent. How each tier counts against the usage window is unmeasured, so a window reading is part of the medium pilot.

## Running it

```bash
# Free: every live task's admission and its mutants. Takes about a minute, so it is not in the fast gate.
node benchmarks/v2/bench.mjs admit
node benchmarks/v2/bench.mjs routes   # scores the router on the labelled set

# Paid. Each needs the maintainer's go-ahead with a budget.
node benchmarks/v2/bench.mjs record --phase pilot --model <id> --out .somi/bench/pilot --budget-total <usd> --go
node benchmarks/v2/bench.mjs select --pilot .somi/bench/pilot
node benchmarks/v2/bench.mjs prereg   # refuses while a decision is open; commit prereg.json and task-set.json after it
node benchmarks/v2/bench.mjs plan --phase aa --pilot .somi/bench/pilot   # prints the draws and the timeout from the pilot
node benchmarks/v2/bench.mjs record --phase aa --model <id> --timeout-min <n> --out .somi/bench/aa --budget-total <usd> --go
node benchmarks/v2/bench.mjs record --phase trial --model <id> --worker-model <id> --plugin-41 <dir> --timeout-min <n> --out .somi/bench/trial --budget-total <usd> --go
node benchmarks/v2/bench.mjs record --phase baseline --model <id> --worker-model <id> --plugin-41 <dir> --timeout-min <n> --out .somi/bench/baseline --budget-total <usd> --go
node benchmarks/v2/bench.mjs record --phase candidate --model <id> --worker-model <id> --timeout-min <n> --out .somi/bench/candidate --budget-total <usd> --go
node benchmarks/v2/bench.mjs record --phase ablation --model <id> --worker-model <id> --timeout-min <n> --out .somi/bench/ablation --budget-total <usd> --go
node benchmarks/v2/bench.mjs record --phase large --model <id> --worker-model <id> --plugin-41 <dir> --timeout-min <n> --out .somi/bench/large --budget-total <usd> --go
node benchmarks/v2/bench.mjs decide --aa .somi/bench/aa --baseline .somi/bench/baseline --candidate .somi/bench/candidate
```

`record` prints the worst case first, runs chunks of at most 24 draws one at a time, and writes the record and report skeleton to `benchmarks/v2/records/` once the plan finishes. A person writes the reading after reading 10 transcripts. Run the same command again to resume after a stop.

**Stops:** `--budget-draw` per draw, `--budget-total` per recording, `--window-tokens` at 60% of the stated window, and a quiet-machine wait, because the hidden suites have time limits and contention would score the machine. Two window exhaustions in a row abandon an arm. Run nothing heavy during a recording.

**Free PR smoke:** `tests/bench.test.mjs` runs the whole pipeline with a stub agent on one small real task, using the real scorer and report. It is part of `npm test`.

**Ablations** are find-and-replace edits on the arm's private plugin copy, listed in `benchmarks/v2/ablations.json`. The shipped plugin has no off switch, so no project config can lower a review. A patch that stops matching stops the recording.

A recording stops when the host reports either usage window at 85% or more, because the maintainer's own work shares those limits. It prints when that window resets, and running the same command again resumes. `--window-tokens` remains as a second limit on what one run may use.

## Host smoke

Before a release, run one small task on each host in a throwaway repository, then compare the two journals. They must have the same event types and fields. This spends a little usage on each host.

```bash
# Claude Code: load the packed plugin, then ask for one small change.
claude -p '/somi:task Add a function double(x) to src/math.js and a test.' --plugin-dir <packed-plugin> --setting-sources project,local --model <work-tier> --max-budget-usd 0.6

# Copilot CLI: allow only what the task needs.
copilot --plugin-dir <packed-plugin> --allow-tool 'shell(node)' --allow-tool 'shell(git:*)' --allow-tool 'shell(npm)' --allow-tool write -p '/somi:task Add a function double(x) to src/math.js and a test.'

# On each host, ask it to write to .somi/state/probe.txt with its file tool. The write must be denied.
cut -c1-200 .somi/state/journal.jsonl
```

## Decisions

`benchmarks/v2/prereg.json` is the pre-registration, and `prereg` refuses while any of its `decisions` is empty. The maintainer accepted each recommendation below. Each is cheap to reverse until a main draw exists.

**The ship rule:** dollars per solved task at most 1.5x bare, the lower 95% bound at or above -5 points on hidden tests passed and -20 points on solved rate, the A/A interval containing zero, and every task paired with no arm abandoned. A draw that did not finish scores zero on hidden tests passed. This replaces the earlier rule of -5 points on solved rate, which a lane equal to bare would pass 8% of the time.

| Decision | Options | Recommendation accepted | Reversing it |
|---|---|---|---|
| **Primary claim** | Better than bare on outcome; or cheaper per solved task with quality held | Cost per solved task, with a quality guard. A 10-point outcome gain needs 385 draws per arm | Free before registration, a new recording after |
| **Quality guard** | Keep -5 on solved rate; widen the margin; or add a finer measure | Keep -5, on the share of hidden tests passed. Add a -20 guard on solved rate. -5 on solved rate passes an equal lane 8% of the time | Same |
| **Tier for the paired run** | Medium; low with a small medium check | Medium. Low-tier effects are not shown to transfer, and on bare it was not the cheaper tier in tokens | A recording per change |
| **Review tier** | All agents at the work tier; or the security reviewer at the review tier, as shipped | As shipped, so it measures what users get | A recording |
| **Tasks and draws** | 20 tasks by 3 draws; 16 by 6 | 16 tasks by 6 draws on bare and 5.0, 3 on 4.1 | A recording, and new tasks need authoring |
| **Ablation set** | Full 3-factor factorial; one-at-a-time; none yet | Review, digest and planning factorial, one draw per task and cell, plus always-on review as the escalation check. Sizing no longer exists | One recording |
| **Minimum effect** | 20%, 25% or 30% on cost | 25% for a release, 30% for a part | Free before registration |
| **Budget per release** | Set per run | A figure per step, from the table below | Any time |


## Large work

The `large` phase asks whether fresh context per milestone pays. Three projects set binding decisions early, and hidden tests check that later milestones honour them. The arms are bare, 5.0 as a plain request, 5.0 asked for a plan first (the milestone lane), and 4.1. It is a pilot, reported apart from the release rule.

First draw per arm, at a 120,000-token window, after the fixes below. These are 12 of the 36 registered draws, so they are a first reading only:

| Task | Bare | 5.0 | Lane | 4.1 |
|---|---|---|---|---|
| L2, task tracker, 23 tests | 23, $0.14, 1 min | 23, $0.14, 3 min | 23, $0.75, 8 min | 2, $3.68, 13 min |
| L1, shop, 21 tests | 21, $0.15, 1 min | 21, $0.57, 7 min | 21, $0.83, 9 min | 2, $1.40, 7 min (not a fair reading) |
| L3, fleet back office, 323 tests | 323, $0.30, 1 min | 323, $1.39, 24 min | 323, $4.20, 52 min | 10, $3.42, 8 min |

The 4.1 L1 draw sat at its plan checkpoint because the bench failed to answer it, a bug fixed since. The other two 4.1 draws stopped at its own limits, such as its 400-line diff cap.

What these draws support, and what they do not:

- **Long tickets start on one worker.** Plain 5.0 scored the same as the lane at about a third of the cost on L3, because the worker splits only what proves too big.
- **The lane has not earned its cost in this measure.** No hidden test failed for a bare agent in these draws. The lane's reviewers did find a real bug that the hidden tests miss (a negative quantity that mints stock), which this score does not reward. Asking for a plan first is the maintainer's choice, not the default.
- **Rot was not demonstrated.** Bare never reached compaction at the natural window, because a model scripts uniform work. Forced to compact, it kept every decision on L1 and L2 through up to four compactions, and on L3 through one. These are tasks we can write offline, not a real project, so this is no proof that rot cannot happen on one.

**How compaction was forced.** The host accepts a window from 100,000 to 1,000,000 tokens and ignores other values, so an earlier run at 30,000 never compacted. The `tight` phase sets the lowest legal window and lowers the point of compaction with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. At 30% the host ended sessions as thrashing, because a session starts at about 20,000 tokens, so those scores measure the host's limit. At 50%, the lane and plain 5.0 each finished L1 and L2 at full score with up to one compaction. Both stopped blocked on L3, where a low-tier worker built the wrong milestone in one draw and overwrote files in the other. Neither report describes a lost decision, though both come from the coordinator's own summary. In these two draws the bench did not yet answer a blocked worker, a bug fixed since, so they may have gone further. A 50,000-token point is also below the 100,000 window the host's settings allow.

**What the large runs found in 5.0 itself,** all fixed:

- The engine cut every request at 8,192 characters without saying so, which lost the late milestones of a long ticket. It now keeps the whole request and refuses one over 64 KiB.
- The coordinator repeated each worker's brief in its context and reworded it. A brief over 2,000 characters now goes to a file. On L3 the lane's peak context fell from 344,000 to 87,000 tokens and its cost from $7.76 to $4.20.
- `somi finish` scanned SoMi's own `.somi/plan.md` for planning ids and blocked on it. The gates now skip that folder, which is never committed.
- A critic's confirmation did not bind when a coordinator dropped a finding's evidence.
