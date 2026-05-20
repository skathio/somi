# Usage

Hands-on guide to running the three workflows. For each command, this doc shows: when to use it,
what to type, what to expect, and where the artifacts go.

## The fundamental loop

```
/plan <problem>     →  PLAN.md      →   user reviews + approves
   ↓
/code <iteration>   →  diff + tests →   user inspects
   ↓
/review             →  REVIEW.md    →   findings addressed or accepted
   ↓
(loop iteration → next; or merge if done)
```

`/ship <problem>` runs the whole loop with hard gates between stages — same workflow, fewer keystrokes.

---

## `/plan`

**When**: non-trivial change, multi-module work, anything touching security/auth/contracts, or any
request you can't restate in one sentence with confidence.

**Skip**: trivial single-file bug fix, doc-only changes, renames.

**Type**:
```text
/plan Add per-team rate limiting to the public webhook ingestion endpoint with audit logging and an
      emergency kill switch.
```

**Expect**:
- SOMI reads the relevant code (Read/Grep/Glob).
- Produces `PLAN.md` at the repo root using [`templates/PLAN.md.tmpl`](../templates/PLAN.md.tmpl).
- Summarises back: problem framing, phase count, top 3 risks, top 3 open questions.
- **Stops.** Does not start coding.

**Then**:
- Read the plan. Edit it directly if needed.
- Run `/plan-review` for a skeptical pass on the plan itself.
- When happy: `/code phase 1, iteration 1` (or just `/code` — it'll default to the first unfinished
  iteration).

See [`examples/feature-plan-example.md`](../examples/feature-plan-example.md) for a worked output.

---

## `/code`

**When**: you have an approved plan; or, for trivial work, a self-contained task description.

**Type**:
```text
/code phase 1, iteration 1
```
or
```text
/code Implement the in-memory RateLimiter described in PLAN.md phase 1 iteration 1.
```

**Expect**:
- SOMI reads the plan iteration, reads relevant files, edits or writes code, adds tests, runs them.
- Summarises back: files changed, tests added, anything **not done**, tradeoffs taken, what to look at.
- **Does not** widen scope beyond the iteration. If the plan turns out wrong-shaped mid-coding, SOMI
  stops and re-plans rather than absorbing the divergence silently.

**Hook guardrails fire during this stage**: dangerous shell commands, secret writes, protected paths
are blocked deterministically. See [HOOKS.md](./HOOKS.md).

---

## `/review`

**When**: before merge; after each iteration; whenever you want a skeptical second opinion.

**Type**:
```text
/review                    # reviews the working-tree diff vs default branch
/review main..feature-x    # reviews a revision range
/review #1234              # reviews a GitHub PR (if gh available)
/review PLAN.md            # reviews a plan instead of code (alias for /plan-review)
```

**Expect**:
- Severity-graded findings: Blocker / Major / Minor / Nit, each with High / Medium / Low confidence.
- Written to `REVIEW.md`.
- Summary: verdict, counts, top 3 findings.

If the diff touches auth/crypto/input-validation, the reviewer additionally consults the
`security-reviewer` agent. If it touches a new module/contract, it consults `architecture-reviewer`.

See [`examples/code-review-example.md`](../examples/code-review-example.md) for a worked review.

---

## `/ship`

End-to-end pipeline: plan → code → review, with **hard human-in-the-loop gates** between stages.

**Type**:
```text
/ship Add a --dry-run flag to the migrate CLI that prints the SQL it would execute without applying.
```

**Expect**:
- Stage 1 (Plan): produces `PLAN.md`, stops, asks `approve` / `revise` / `abort`.
- Stage 2 (Code, first iteration): produces diff + tests, stops, asks `review` / `next` / `stop`.
- Stage 3 (Review): produces `REVIEW.md`, stops, asks based on verdict.
- Loops back to Stage 2 for the next iteration until done.

`/ship` does **not** skip review or rubber-stamp anything — it just removes the boilerplate of typing
each command separately.

See [`examples/full-pipeline-example.md`](../examples/full-pipeline-example.md) for a transcript.

---

## Specialised commands

### `/plan-review`

Reviews a plan before coding starts. Catches scoping errors, missing risks, and bad architectural
choices cheaply. Use it after `/plan` and before `/code`.

```text
/plan-review               # reviews PLAN.md
/plan-review docs/adr/0042-event-bus.md
```

### `/security-review`

Targeted security review. Walks trust boundaries to sinks and produces attack-path-grounded findings.

```text
/security-review                  # current working tree
/security-review main..feature-x  # range
```

Use this in addition to `/review` whenever the change touches auth / crypto / input / file uploads /
deserialization / outbound HTTP from user input.

### `/refactor`

Surgical, behavior-preserving refactor of a named smell. Tests stay green; no feature work mixed in.

```text
/refactor OrderService mixes pricing logic and persistence. Split pricing into a pure module and keep
          persistence behind a repository interface. Files: src/order/service.ts, src/order/repo.ts.
```

---

## What happens to the artifacts

| Artifact      | Lives at                  | Lifetime                                          |
|---------------|---------------------------|---------------------------------------------------|
| `PLAN.md`     | repo root                 | persists until you delete it                     |
| `REVIEW.md`   | repo root                 | persists until you delete it                     |
| `SECURITY-REVIEW.md` | repo root          | persists until you delete it                     |
| `audit.log`   | `.claude/audit.log`       | append-only across sessions                       |
| Diff          | git                       | as long as the branch / history is kept           |

You can (and should) commit `PLAN.md` / `REVIEW.md` if they help future readers understand the change.

## Multiple plans concurrently

If `PLAN.md` already exists for a different problem, SOMI writes a new plan to
`PLAN-<short-slug>.md` and tells you. Same for `REVIEW.md`. You can pass an explicit path to `/code`
or `/review` to disambiguate:

```text
/code Implement phase 1 iteration 1 of PLAN-ratelimit.md
/review Use PLAN-ratelimit.md as the plan reference
```

## Tips

- **Edit `PLAN.md` directly** between `/plan` and `/code`. It's your plan, not Claude's.
- **Use `/plan-review`** for anything you'd send to a human staff engineer for an architecture
  preview.
- **Re-run `/review`** after addressing findings. Verdicts can change — a Blocker fix sometimes
  reveals a new Major.
- **Commit `PLAN.md` and `REVIEW.md`** with the feature branch when they're useful artifacts for
  future readers.
- **Inspect `audit.log`** if you're curious what tools SOMI touched during a session.
