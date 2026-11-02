# Benchmark and release decision

5.0 ships as the default only if this benchmark says so. A paid run needs the maintainer's go-ahead with a budget, and `bench.mjs run` refuses without `--go`. Nothing here runs in `npm test`.

## The rule

Registered in [`benchmarks/v2/prereg.json`](../benchmarks/v2/prereg.json) before any paid main draw.

- **Primary metric:** the paired per-task difference in success rate, 5.0 default lane minus bare. Success means the hidden acceptance tests pass. Each rate is over 3 draws. The standard error is clustered by task.
- **Ships as default if:** the lower 95% bound is at or above -5 points, **and** weighted tokens per solved task are at most 1.5x bare, **and** the A/A interval contains zero, **and** all 20 tasks paired with no arm abandoned.
- **An escalated-lane claim:** needs a positive lower bound on the hard subset.
- **Secondary, reported but not deciding:** pass^3, pass@1, wall time and turns, and 4.1 against 5.0 the same way.

Weighted tokens count input at 1, cache writes at 1.25, cache reads at 0.1 and output at 5.

## The routine

```bash
# 1. Pilot: bare, 3 draws per candidate task, to find tasks off the ceiling.
node benchmarks/v2/bench.mjs run --phase pilot --model <work-tier> --out .somi/bench/pilot --budget-total <usd> --go

# 2. Keep tasks where bare solves 1 or 2 of 3, then bind and commit the set.
node benchmarks/v2/bench.mjs select --pilot .somi/bench/pilot
node benchmarks/v2/bench.mjs prereg
git add benchmarks/v2/task-set.json benchmarks/v2/prereg.json && git commit -m "bench: register the task set"

# 3. A/A noise floor. Re-run whenever the model pin changes.
node benchmarks/v2/bench.mjs run --phase aa --model <work-tier> --out .somi/bench/aa --budget-total <usd> --go

# 4. Main sweep. It refuses until step 2 is committed.
node benchmarks/v2/bench.mjs run --phase main --model <work-tier> --plugin-41 <packed-4.1-dir> --out .somi/bench/main --budget-total <usd> --go

# 5. Top-tier bare on the 6 hardest tasks, to see whether it simply dominates.
node benchmarks/v2/bench.mjs run --phase confirm --model <top-tier> --out .somi/bench/confirm --budget-total <usd> --go

# 6. The decision, mechanical. Exit 0 only when it ships.
node benchmarks/v2/bench.mjs decide --aa .somi/bench/aa --main .somi/bench/main
```

Run the same `run` command again to continue. Each call does at most one chunk of 24 draws, one draw at a time, and finished draws are skipped.

Run nothing else heavy during a chunk. The hidden suites have per-family time limits, so contention would score the machine instead of the agent. Before each draw the harness waits, up to 90 minutes by default, for the one-minute load to fall to half the cores. Each row records the load it started under.

## Budget and stops

| Phase | Draws | Projected wall time |
|---|---|---|
| A/A | 60 | about 3.1 h |
| Main | 180 | about 9.3 h |
| Confirmatory | 18 | about 1 h |

These figures project from 4.1's recording at about 3.1 minutes per draw, and they exclude the pilot. No published per-window quota exists for Claude Max, so measure weighted tokens per draw in the pilot and size each chunk to at most half a window.

- **Per-draw cap:** `--budget-draw`, 3 dollars by default.
- **Window stop:** `--window-tokens` stops a chunk at 60% of the window you state.
- **Abandoning an arm:** two window exhaustions in a row abandon the arm, recorded as no valid score rather than a pass.

## What the benchmark can detect

With an assumed paired-difference standard deviation of 0.3 over 20 tasks, the standard error is about 0.067 and the minimum detectable effect at 80% power is about 19 points. Only large effects are detectable, and the A/A floor says what counts as noise.

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

## Candidate pool

[`benchmarks/v2/candidates.json`](../benchmarks/v2/candidates.json) holds the tasks written so far. The pilot target is about 40 candidates, so that 20 survive with at least 4 on a real trust boundary. The pool is smaller than that today. `select` names the shortfall and refuses unless you pass `--allow-short`, which records the shortfall in the task set and leaves the release rule unable to pass with fewer than 20 tasks.

Prefer tasks written for SoMi over public issues, to avoid contamination.
