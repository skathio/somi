---
description: Fan out provably-independent iterations into isolated git worktrees, run each under /code-loop concurrently, then integrate them one at a time behind a gate (re-test + review per merge). Conservative by construction — only iterations the plan marks Parallelizable with disjoint file sets are eligible.
argument-hint: <slug> [phase N]
allowed-tools: Task, Read, Grep, Glob, Bash, Write, Edit, WebFetch
model: sonnet
---

# /code-parallel — Independent iterations in parallel, integrated sequentially

You are running the **parallel coding fan-out** of somi. It runs **only the iterations the plan
has proven independent**, each in its own git worktree, then merges them back **one at a time behind
a gate**. The parallelism is in the *building*; the *integration* is always sequential and reviewed.

The user's target: **$ARGUMENTS** (a work-item slug, optionally a specific `phase N`).

This is an **ECO-tier** fan-out: the orchestrator (this command) is `sonnet`, and each `/code-loop`
it Tasks runs its `coder` on `sonnet` (executing against the work item's `brief.md` + plan) and its
`reviewer` on `opus` (fresh-eyes MAX judgment).

> **Why this exists, and why it's conservative.** Smaller diffs from focused agents are higher
> quality — *if* they don't collide. Letting several coders edit the same tree at once produces merge
> conflicts, inconsistent assumptions, and broken builds, which destroys the quality you were after.
> So this command parallelizes **only** what the planner marked `Parallelizable` with **provably
> disjoint file sets**, isolates each in a worktree so there is no shared working tree, and
> **integrates sequentially** with tests + review at every merge. When eligibility is unclear, it
> falls back to plain sequential [`/code-loop`](./code-loop.md). The default posture is "sequential
> unless proven safe," not "parallel unless proven dangerous."

## Gates (hard, configurable via env)

| Gate | Default | Env override |
|---|---|---|
| `MAX_PARALLEL` — worktrees built concurrently | `3` | `SOMI_PARALLEL_MAX` |
| `ELIGIBILITY` — an iteration is eligible only if `Parallelizable: yes` **and** its `Files (approx)` set is disjoint from every other eligible iteration's | strict, **non-overridable** | (n/a) |
| Per-iteration caps | inherits [`/code-loop`](./code-loop.md) defaults (max passes, severity floor, diff cap, circuit breaker) | their env vars |
| `INTEGRATION` — merges are applied **one at a time**, each followed by full test run + review | always sequential, **non-overridable** | (n/a) |
| `HOST_FALLBACK` — if worktrees or concurrent sub-agents are unavailable, run eligible iterations sequentially via `/code-loop` | always on | (n/a) |

Record effective values in the first diary entry of the run.

## What to do

### 1. Resolve work item + candidate set

Read `.somi/plans/<slug>/progress.md`, then `spec.md` and the phase file(s) in scope (default: the
phase with the most not-started iterations, or the `phase N` the user named). Collect the
**not-started** iterations.

### 2. Compute the eligible set (this is the safety core)

An iteration is **eligible for parallel build** only if **all** hold:

1. Its `Parallelizable` field is `yes` (the planner asserted independence).
2. Its `Files (approx)` set is **disjoint** from every other candidate's — compute the pairwise
   intersection; any shared path (or a shared directory where both create files) ⇒ **not** disjoint.
3. It does not depend on another candidate's output (check the phase "Dependencies" and each
   iteration's scope).
4. No candidate touches a globally-shared surface that the disjoint-files check can't see — a
   migration sequence, a shared lockfile, a generated/codegen file, a central DI/registry file, a
   shared config. If one does, treat it as overlapping ⇒ **not** eligible.

Iterations that fail any check are **ineligible** and run sequentially afterward.

- If **0–1** iterations are eligible: there is nothing to parallelize — tell the user and run them via
  plain [`/code-loop`](./code-loop.md) sequentially. Exit.
- If **≥2** are eligible: proceed. Cap concurrency at `MAX_PARALLEL`; queue the rest.
- Append a diary entry (category `note`): the eligible set, the ineligible set **with the reason each
  was excluded**, the effective gate values, and the integration order you'll use.

### 3. Build each eligible iteration in its own worktree

For each eligible iteration, in parallel up to `MAX_PARALLEL`:

```text
git worktree add ../.somi-wt/<slug>-<phase>.<iter> -b somi/<slug>/<phase>.<iter> <BASELINE_SHA>
Task /code-loop  "<slug> phase <N>, iteration <M>"   # cwd = that worktree
```

- Capture `BASELINE_SHA = git rev-parse HEAD` **once**, before creating any worktree; every worktree
  branches from the same baseline so the diffs are independent and comparable.
- Issue the worktree Tasks as **multiple `Task` calls in a single turn** so they build concurrently.
- Each `/code-loop` keeps its own caps; a worktree that trips a gate (max-passes, diff-cap,
  circuit-breaker) is marked **not mergeable** and carried to the integration step as a blocked item
  — it does **not** stop the others.

> **Host fallback.** If the host can't create git worktrees or can't run sub-agents concurrently
> (e.g. the GitHub Copilot extension), **do not fake it**: run the eligible iterations sequentially
> via `/code-loop` on the main tree, integrating each before starting the next. Same gates, same
> result, no parallelism. Say so in the summary.

### 4. Integrate sequentially, behind a gate (never a bulk merge)

Pick a deterministic order (declared in §2's diary entry — usually plan order). Then, **one worktree
at a time**:

1. Merge the worktree branch into the integration branch (`git merge --no-ff somi/<slug>/<phase>.<iter>`).
2. **If the merge reports a conflict** — eligibility was wrong (the file sets weren't actually
   disjoint, or a hidden shared surface was touched). Abort the merge, **stop integrating**, append a
   diary entry (category `blocker`) naming the colliding paths, and hand to the human. Do not
   auto-resolve. A conflict here is a planning signal, not a merge chore.
3. **Run the full test suite** on the integrated tree (not just the iteration's tests — integration
   is where independent-but-incompatible assumptions surface). Red ⇒ stop, diary `blocker`, hand
   back.
4. **Review the integrated delta** — Task [`/review`](./review.md) (or [`/review-panel`](./review-panel.md)
   for high-stakes phases) on the cumulative integration diff. A Blocker/Major ⇒ stop and surface.
5. Mark the iteration `done` in `progress.md`; append a diary `note` (merged at integration step K,
   tests green, verdict V).
6. Proceed to the next worktree **only after** the current one is green and reviewed.

### 5. Clean up

- Remove merged worktrees: `git worktree remove ../.somi-wt/<slug>-<phase>.<iter>` and delete the
  temporary branch.
- Leave worktrees for **blocked / unmerged** iterations in place (the human may want the partial
  work) and name their paths in the summary.

### 6. Run the ineligible / queued iterations

Run the iterations that were ineligible (or queued past `MAX_PARALLEL`) sequentially via
[`/code-loop`](./code-loop.md), in plan order, after the parallel set is integrated.

### 7. Summarise back

- Status: `done` | `partial (blocked at integration step K)` | `eligibility-empty (ran sequential)`
  | `host-fallback-sequential` | `user-stop`.
- **Eligible vs ineligible** sets, with the exclusion reason for each ineligible iteration.
- Per-iteration `/code-loop` outcome (passes used, verdict) and integration result (merged / blocked
  + why).
- Any worktrees left in place for blocked work, with paths.
- Pointer to `.somi/plans/<slug>/` and `.somi/reviews/<slug>/`. Next step.

## Guardrails

- **Eligibility is non-overridable.** No env var forces a `Parallelizable: no` or file-overlapping
  iteration into the parallel set. The planner's disjoint-files contract is the gate; widen it by
  re-planning, not by flag.
- **Integration is always sequential and gated.** No bulk "merge all worktrees" step exists. Tests +
  review run at every merge; the first conflict or red suite stops the train.
- **A merge conflict is a planning bug, not a merge chore.** Don't auto-resolve — surface that the
  "independent" iterations weren't, and hand back.
- **Worktree isolation is mandatory for parallel builds.** Never run two coders against the same
  working tree. If you can't get worktrees, fall back to sequential — don't simulate parallelism on a
  shared tree.
- **One work item per run.** Like `/code-loop`, this command does not march across work items.
- **Plan-change protocol still applies** inside each `/code-loop`; a worktree that triggers it pauses
  that branch and surfaces, it does not silently re-plan for the others.

## Why this command exists

The planner already marks iterations `Parallelizable` and slices to disjoint file sets, but nothing
consumed that signal — every iteration ran sequentially even when provably independent.
`/code-parallel` consumes it **safely**: parallel only where proven, isolated in worktrees, integrated
one-at-a-time with tests and review at each step. It trades some orchestration overhead for smaller,
more focused per-iteration diffs without paying the merge-hell tax that naive parallel coding incurs.
For the common case (dependent iterations, or you just want the simple path), use
[`/code-loop`](./code-loop.md) or [`/ship`](./ship.md).
