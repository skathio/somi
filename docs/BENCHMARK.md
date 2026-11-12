# Benchmark and release decision

5.0 ships as the default only if this benchmark says so. **Every paid run needs the maintainer's go-ahead for that specific run, with its budget and worst case.** `bench.mjs run` refuses without `--go`, and the test suite spends nothing.

**Status:** 5.0.0 ships on this result: the candidate recorded on 5.0.0-rc.3 passes `decide`. Three changes came after the recording and were not recorded in a paid run: the security signals no longer fire on a regex's own `exec` or a comment, which can only remove a review; the router reads more ticket phrasings, which changes a route only when the agent asks for one; and the security reviewer's tier is described correctly in what `somi_review` says. On Sonnet, with the low tier on Haiku as shipped (rule 7d7837121fdb, records in [`benchmarks/records/`](../benchmarks/records/)), the A/A interval contains zero, and over 16 tasks and 6 draws each SoMi solved 90 of 96 against bare's 72, a difference of 0.19 (95% 0.04 to 0.33). It passed the quality gate on 96 of 96 against bare's 84 and had 62 strict successes against 46. It cost 1.28 times bare per solved task against the baseline, and 1.44 times (90% 1.22 to 1.70) the bare draws recorded beside it, both under the registered 1.5. Two changes since the last candidate account for the cost: a change gets one reviewer, the security reviewer alone when a security signal fires, and the quality gate runs when the turn ends. The security tasks cost about twice bare's and still carry the review; the others cost about what bare's do. In this recording the main session called `somi_route` in 4 of 96 draws, against 54 of 96 before. The somi agent is told to make a small, clear change itself without routing, and to route tickets, large work and unclear requests, and every task here is a small, clear change: in this recording the model followed that, and before it often routed anyway. Why it changed is not known; the host now lists 8 SoMi commands instead of 32. In the earlier recording, routed and unrouted draws solved at the same rate (46 of 54, 36 of 42), and on these tasks the route is almost always build. The result above measures the digest, the end-of-turn checks and the review, not the routing. Earlier candidates are in the git history: before the gate ran on the default path, 84 solved, 60 strict, 1.68 times bare; with it, 82 solved, 55 strict, 1.74 times bare. The ablation found the digest worth 8 solved draws in 64 at about 5% more cost, and the review 2 at about 73% more, before the review became one reviewer per change. Recordings from before 2026-11-08 ran SoMi's code or conversation on Haiku, which is not what SoMi is built for, and were withdrawn; they are in the git history.

## How SoMi is compared

Bare and SoMi both hold the conversation on the medium tier and do the whole job. SoMi's saving comes from moving cheaper work down to low.

Solving the hidden tests is not all SoMi is for, so each draw is also scored on what it delivers. The tests a draw added or changed are run on the task's reference solution and on each of its recorded mutants, the same mutants task admission uses. A test suite that passes on the reference and fails on a mutant would have caught that defect. Each test case is judged on its own: a case that fails on the reference pins something the reference does differently, often a detail the task leaves open, so it is left out, and the report gives the share of cases that agree. The tests are valid when the agreeing cases kill at least 60% of the mutants. Bare is scored the same way.

`--phase smoke` checks that a change works before anything is recorded for real. It runs one draw per task and arm, on the bare and somi5 arms, on a slice of every segment of the registered set: 2 small tasks, 1 medium and 1 large. `--tasks` still names tasks for a one-off look, and `--arms` can add `somi5-hooks` or `somi5-deliver`. `--phase full` runs every registered task at its segment's number of draws.

## Segments, variants and languages

Every task in the pool and in the registered set carries a `segment`. The criteria are measurable, and the tests hold the medium and large ones to them:

| Segment | The reference change | The starting codebase | A bare run (estimate) | Draws per task and arm in a full recording |
|---|---|---|---|---|
| Small | up to about 60 lines in 1 to 3 files | 150 lines or fewer | under 2 minutes | 6 |
| Medium | about 150 to 600 lines in 4 to 12 files, with real design choices | 1,000 to 5,000 lines | 5 to 20 minutes | 4 |
| Large | 800 lines or more in 15 files or more, over several milestones, with decisions set early | 5,000 lines or more | 30 to 90 minutes | 3 |

The older tasks are all small by these criteria. L1 and L2 start from under 100 lines, so they are small tasks with a larger change. L3 is generated, uniform and under 5,000 lines, so it is retired from the pool, and the `large` and `tight` phases still name it.

**Variants.** Smoke is the stratified slice above. Full is every registered task, 6 draws for a small one, 4 for a medium one and 3 for a large one, on bare and somi5. Both print the worst case first, and both run on a stub with no spend. The report has a section per segment, and the ship rule stays on the small segment. Medium and large each get their own pre-registered guard, cost per solved task plus a quality floor, before their first recording. A pilot probes one segment at a time: `plan` and `record` take `--segment small|medium|large` with `--phase pilot`, and the default is small. `--timeout-min` takes one number, or one per segment as `small=20,medium=90,large=240`.

**Languages.** Small tasks are JavaScript. Medium and large tasks each cover four runners:

| Runner | Language | The draw's own tests | What the draw gets |
|---|---|---|---|
| `node-test` | JavaScript | `node --test` | nothing beyond Node |
| `typescript` | TypeScript | `node --test` on `.ts` files, which Node runs as they are | `tsc` on the PATH, from the pinned `typescript` dev dependency. A hidden test runs `tsc --noEmit` under the project's strict settings |
| `python-unittest` | Python | the standard library's `unittest` | nothing installed |
| `dotnet-test` | C# | `dotnet test` with xunit | a NuGet cache restored once in locked mode from a lockfile in the benchmark repository, mounted read-only, so no draw fetches a package |

A hidden suite is a `node:test` driver in every language. It starts the candidate in a child process, gives it a list of requests for one fresh installation, and reads single values out of the results, so it tests the documented commands and not one solution's shape. For C# the driver compiles the candidate's sources into a console harness once per run, which needs no package. The tests a draw wrote are scored per runner, on the reference and on each mutant, in the draw's sandbox with an empty home.

**The high tier.** Opus is refused as `--model` and as `--worker-model`. It may serve as the high tier only, named with `--high-model`, which `prepareDraw` writes as the `high` tier of the draw's own config. A draw served by a model outside the session, low and high pins is invalid. The report counts, per segment, the draws the high tier's model served, which is how often SoMi moved up. Each draw has its own `HOME` and its own config, so the maintainer's `~/.config/somi` never reaches one. Naming a high model raises the worst case sharply where SoMi moves up, and a small-segment recording with it cannot be compared with the 5.0.0 one.

**The medium and large pool (2026-11-12).** Eight tasks, one per runner and segment: `MD1` to `MD4` add an audit trail with revert to a back office of several kinds of record, and `LG1` to `LG4` add workspaces to one in three milestones: isolation, plan limits and suspension, then export and import. Each passes admission with two reference solutions that differ in design: the audit is recorded by each service in one and by the stores in the other, and workspaces filter one map in one and keep a map per workspace in the other. What they are not yet: the codebases were written from one template per language, so the kinds of record in a codebase resemble each other, and the two features repeat across the four languages. None has been probed, and none has had the independent fairness review. `MD3` and `LG1` sit in `task-set.json` marked `provisional`, so that the smoke slice covers every segment; `prereg.json` does not name that file, so a registered recording refuses until the set is calibrated, selected and bound. The target mix is about 8 small, 6 medium and 4 large tasks, and the pool has 4 medium and 4 large, with no spares.

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

The pool is in the private benchmark repository. A task needs a reference solution that passes, a second one that passes, an empty solution that fails and mutants that fail, all checked at admission. The registered set is 16 tasks: 4 a bare agent solves 1 or 2 times in 3, 4 it always narrowly misses, and 8 it always solves, at the medium tier. A registered task is never edited, only replaced.

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

In the benchmark repository, `bench.mjs power --pilot <dir>` prints these, and they are tested against hand calculations.

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

## Running it

The harness, the task corpus and the pre-registration live in a private repository, `skathio/somi-bench`, so the hidden tests and reference solutions stay out of training data and out of every plugin install. It measures this repository as a submodule pinned to one commit, so a recording names the exact code it measured. Its stub pipeline tests run there and spend nothing. Each published record is copied to [`benchmarks/records/`](../benchmarks/records/) here, with the task set's hash, so a claim can be checked against a fixed corpus without the corpus being public.

`record` prints the worst case first, runs chunks of at most 24 draws one at a time, and writes the record and report skeleton once the plan finishes. A person writes the reading after reading 10 transcripts. Running the same command again resumes after a stop.

**Stops:** `--budget-draw` per draw, `--budget-total` per recording, `--window-tokens` at 60% of the stated window, and a quiet-machine wait, because the hidden suites have time limits and contention would score the machine. Two window exhaustions in a row abandon an arm. Run nothing heavy during a recording.

A recording stops when the host reports either usage window at 85% or more, because the maintainer's own work shares those limits. It prints when that window resets, and running the same command again resumes. `--window-tokens` remains as a second limit on what one run may use.

**Ablations** are find-and-replace edits on the arm's private plugin copy. The shipped plugin has no off switch, so no project config can lower a review. A patch that stops matching stops the recording.

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

The benchmark repository's `prereg.json` is the pre-registration, and `prereg` refuses while any of its `decisions` is empty. The maintainer accepted each recommendation below. Each is cheap to reverse until a main draw exists.

**The ship rule:** dollars per solved task at most 1.5x bare, the lower 95% bound at or above -5 points on hidden tests passed and -20 points on solved rate, the A/A interval containing zero, and every task paired with no arm abandoned. A draw that did not finish scores zero on hidden tests passed. This replaces the earlier rule of -5 points on solved rate, which a lane equal to bare would pass 8% of the time.

| Decision | Options | Recommendation accepted | Reversing it |
|---|---|---|---|
| **Primary claim** | Better than bare on outcome; or cheaper per solved task with quality held | Cost per solved task, with a quality guard. A 10-point outcome gain needs 385 draws per arm | Free before registration, a new recording after |
| **Quality guard** | Keep -5 on solved rate; widen the margin; or add a finer measure | Keep -5, on the share of hidden tests passed. Add a -20 guard on solved rate. -5 on solved rate passes an equal lane 8% of the time | Same |
| **Tier for the paired run** | Medium; low with a small medium check | Medium. Low-tier effects are not shown to transfer, and on bare it was not the cheaper tier in tokens | A recording per change |
| **High tier** | The session model; or opus | Opus is allowed as the high tier only, through `--high-model`, and moves to it are counted (2026-11-12). It is never the session model or the low tier | A recording |
| **Segments** | One pool; or small, medium and large with entry criteria | Three segments, reported apart, 6, 4 and 3 draws. The ship rule stays on small (2026-11-12) | Free before a segment's first recording |
| **Review tier** | All agents at the work tier; or the security reviewer at the review tier, as shipped | As shipped, so it measures what users get | A recording |
| **Tasks and draws** | 20 tasks by 3 draws; 16 by 6 | 16 tasks by 6 draws on bare and 5.0. 4.1 is not recorded: it wrote code on the Haiku low tier (2026-11-08) | A recording, and new tasks need authoring |
| **Ablation set** | Full 3-factor factorial; one-at-a-time; none yet | Review, digest and planning factorial, one draw per task and cell, plus always-on review as the escalation check. Sizing no longer exists | One recording |
| **Minimum effect** | 20%, 25% or 30% on cost | 25% for a release, 30% for a part | Free before registration |
| **Budget per release** | Set per run | A figure per step, from the table below | Any time |


## Large work

The `large` phase asks whether fresh context per milestone pays. Three projects set binding decisions early, and hidden tests check that later milestones honour them. The arms are bare, 5.0 as a plain request, 5.0 asked for a plan first (the milestone lane), and 4.1. It is a pilot, reported apart from the release rule.

**How compaction was forced.** The host accepts a window from 100,000 to 1,000,000 tokens and ignores other values, so an earlier run at 30,000 never compacted. The `tight` phase sets the lowest legal window and lowers the point of compaction with `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`. At 30% the host ended sessions as thrashing, because a session starts at about 20,000 tokens, so those scores measure the host's limit. At 50%, the lane and plain 5.0 each finished L1 and L2 at full score with up to one compaction. Both stopped blocked on L3, where a low-tier worker built the wrong milestone in one draw and overwrote files in the other. Neither report describes a lost decision, though both come from the coordinator's own summary. In these two draws the bench did not yet answer a blocked worker, a bug fixed since, so they may have gone further. A 50,000-token point is also below the 100,000 window the host's settings allow.

## Routing

The registered tasks cannot show whether routing pays: each request opens with "Implement the following", and nearly every task is one clear change, so the right route is build, and the somi agent is told to do a small, clear change without routing. The `routing` phase asks the question on work whose right route is not build. It is exploratory and sits outside the registration.

- **Tasks:** seven from the pool, written and probed before routing was measured. Four are bugs whose ticket blames the wrong cause, where the right route is debug: N03, N23, N33 and N34. Three are refactors that must keep behaviour, where it is refactor: N19, N20 and N21.
- **Request:** the ticket as a user would send it, with the declared scope and without the "Implement the following" opening, the same for both arms.
- **Arms and draws:** bare and SoMi as shipped, 3 draws each, 42 in all.
- **Reported:** solved, strict successes and cost per arm, and for SoMi how often it called `somi_route` and whether the route it got was the right one.

**Before any draw:** the router, run on the seven requests, routes one right outright: refactor for N20. It gives debug for N21, build by default for N19, N03, N23 and N34, and for N33 asks the model to choose between perf and debug. The router's own labelled set scores 99%, but its author wrote it, and these tickets were written for other reasons. So this phase measures SoMi as it ships, router included.

**Result (rule 7d7837121fdb, record `routing-7d7837121fdb`):** both arms solved all 21 draws, so the tasks sit at the ceiling for this model and cannot show routing paying. SoMi had 18 strict successes against bare's 16, both from the quality gate: bare failed it on N19 in 3 draws of 3 and on N20 in 2. SoMi cost 1.36 times bare per draw (90% 1.08 to 1.70), most of it the security reviewer, which ran on every draw of N21, N34 and two of N23. SoMi called `somi_route` in 2 draws of 21, both on bugs, and got build both times where debug was right; both draws were solved. So on this model, at this size of work, the model does not route and does not need to, and when it routes, the router is wrong.

**What followed.** Two of the three security signals in this phase were false: a regex's own `exec` read as a shell call on N34, and the word fetch in a comment on N23. Both are fixed, and so is the same regex case that started a review in 4 of 6 candidate draws of N01. The router was then tuned on the pool's tickets: 59 of 61 right, against 45, and all seven tickets here now get the right route. On 24 fresh tickets written after the tuning it got 11 right against 10, so the gain does not carry over to new wording, and the router's labelled set now scores 85%, not the 99% it reported, once a choice over the whole table is scored as the build SoMi answers it with. Neither change has been recorded in a paid run.
