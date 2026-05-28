# Usage

Hands-on guide to running the workflows. For each command, this doc shows: when to use it, what
to type, what to expect, and where the artifacts go.

## The fundamental loop

```
/plan <problem>            →  .somi/plans/<slug>/ created    →  user reviews + approves
   ↓                          (6 docs + phases/)
/code-loop <slug>           →  diff + tests + review files;  →  user inspects
       phase N, iteration M    bounded by caps (max passes,
                               severity floor, diff cap)
   ↓
(next iteration; or merge if done)
```

`/code <slug>` runs a single coder pass without the review loop. `/code-loop` is the bounded
code↔review cycle for a single iteration. `/ship` runs the whole pipeline with hard gates;
`/ship-loop` is the both-layers-bounded composition.

---

## `/plan`

**When**: non-trivial change, multi-module work, anything touching security/auth/contracts, or any
request you can't restate in one sentence with confidence.

**Skip**: trivial single-file bug fix, doc-only changes, renames.

**Type**:
```text
/plan Add per-team rate limiting to the public webhook ingestion endpoint with audit logging and
      an emergency kill switch.
```

**Expect**:
- SoMi AI proposes a slug (e.g., `rate-limiting-webhooks`) and confirms with you.
- Reads the relevant code (Read/Grep/Glob).
- Drafts `context.md` (background, surroundings, constraints — the **verbatim** user problem
  statement lands here, fenced as untrusted data) and the spec skeleton.
- **Pauses on each architectural decision** — presents 2–4 concrete options with explicit pros and
  cons, recommends one, and offers `Other` (you describe a different option) or `Discover` (the
  agent asks narrowing questions to help you choose).
- Records each verified decision in `decisions.md` with the chosen option, rejected alternatives,
  rationale, and (if you used discovery mode) the narrowing Q&A.
- Writes phases under `phases/<NN>-<slug>.md`, sets `progress.md` to `awaiting-approval`, and
  appends the first `diary.md` entry (which points back to `context.md` for the verbatim — no
  duplication).
- Summarises back: problem framing, phase count, top 3 risks, top 3 open questions, pointer to
  `.somi/plans/<slug>/`.
- **Stops.** Does not start coding.

**Then**:
- Read `.somi/plans/<slug>/spec.md` and `phases/01-*.md`.
- Edit any file directly if you want — they're your artifacts.
- Run `/review plan <slug>` for a skeptical pass on the plan itself (or `/plan-loop` for an
  automated revise→review cycle).
- When happy: `/code-loop <slug>` (or `/code <slug>` for a single pass without the loop).

See [`examples/feature-plan-example.md`](../examples/feature-plan-example.md) for a worked output.

---

## `/plan-loop`

**When**: ambiguous or architecturally heavy work where you want SoMi AI to iterate the plan
through reviewer feedback before you read it.

**Type**:
```text
/plan-loop Add per-team rate limiting to the public webhook ingestion endpoint.
/plan-loop rate-limiting-webhooks    # to continue revising an existing plan
```

**Expect**: bounded plan → review → revise cycles (default cap: 3). Stops on approve, on cap
hit, on divergence (plan keeps churning without findings dropping), or on user `stop`.
Architectural decisions still go through the planner's verification protocol even inside the
loop. See [`commands/plan-loop.md`](../commands/plan-loop.md) for the gate table.

---

## `/code`

**When**: you have an approved plan; or, for trivial work, a self-contained task description.
This is the **single-pass** form — for the bounded code↔review loop, use `/code-loop`.

**Type**:
```text
/code rate-limiting-webhooks                            # picks up next not-started iteration
/code rate-limiting-webhooks phase 1, iteration 1       # explicit target
/code Implement the in-memory RateLimiter described in phases/01-define-limiter.md
```

**Expect**:
- SoMi AI reads `spec.md`, the iteration's phase file, recent `diary.md`, and the surrounding
  code. Marks the iteration `in-progress` in `progress.md` (single source of truth for status).
- Edits or writes code, adds tests, runs them.
- If implementation reveals the plan needs to change (constraints, dead ends, false assumptions),
  it follows the **plan-change protocol**: updates spec/decisions/phases in place, updates
  `progress.md`, appends a `diary.md` entry, surfaces to you before continuing.
- Marks the iteration `done` in `progress.md`, appends a final diary entry.
- Summarises back: files changed, tests added, anything **not done**, plan changes (if any),
  tradeoffs, what to look at, next step (`/review <slug>`).

**Hook guardrails fire during this stage**: dangerous shell commands, secret writes, protected
paths, and unsanctioned dependency installs are denied deterministically. See [HOOKS.md](./HOOKS.md).

---

## `/code-loop`

**When**: same as `/code`, but you want the code↔review loop run automatically with bounds.

**Type**:
```text
/code-loop rate-limiting-webhooks phase 1, iteration 1
```

**Expect**: bounded code → review → fix cycles per iteration (default caps: 3 passes, Major
severity floor, 400-line diff cap, circuit breaker if the same finding recurs). Stops on
approve, cap hit, scope expansion, or user `stop`. See
[`commands/code-loop.md`](../commands/code-loop.md) for the gate table. Override caps via env
vars (`SOMI_CODE_LOOP_MAX_PASSES`, `SOMI_CODE_LOOP_DIFF_CAP`, etc.).

---

## `/review`

**When**: before merge; after each iteration; whenever you want a skeptical second opinion. Use
`plan <slug>` for plan-level review (no separate `/plan-review` command).

**Type**:
```text
/review rate-limiting-webhooks         # reviews the latest iteration's diff against the spec
/review                                # working-tree diff, scoped if exactly one work item is in-progress
/review main..feature-x                # reviews a revision range
/review #1234                          # reviews a GitHub PR (if gh available)
/review plan rate-limiting-webhooks    # reviews the spec/decisions/phases (canonical form for plan review)
```

**Expect**:
- Severity-graded findings: Blocker / Major / Minor / Nit, each with High / Medium / Low
  confidence. Plan reviews use the plan-specific severity calibration.
- Plan-vs-code checks: did the diff stay within the iteration scope? Are decision changes
  captured?
- **Auto-invokes consultants** based on the trigger table in [`commands/review.md`](../commands/review.md):
  - Auth/crypto/input/upload/deserialization → `security-reviewer`.
  - New module/contract/service → `architecture-reviewer`.
  - Mock-heavy/flaky/wrong-shaped tests → `test-strategist`.
  Consultant findings are merged into the review under attributed sections.
- Written to `.somi/reviews/<slug>/<YYYY-MM-DD>-<phase>.<iter>-<verdict>.md` (or
  `…-plan-review-<verdict>.md` for plan reviews).
- A line in `progress.md` "Recent activity"; a diary entry if findings affect the plan.
- Summary: verdict, counts, top 3 findings.

See [`examples/code-review-example.md`](../examples/code-review-example.md) for a worked review.

---

## `/ship`

End-to-end pipeline: plan → code → review, with **hard human-in-the-loop gates** between stages.
Stage 2-3 (code↔review) delegates to `/code-loop` so it inherits caps automatically.

**Type**:
```text
/ship Add a --dry-run flag to the migrate CLI that prints the SQL it would execute without
      applying.
```

**Expect**:
- Stage 1 (Plan): creates `.somi/plans/<slug>/`, pauses on every architectural decision for
  verification, finishes with `progress.md` status `awaiting-approval`. Stops, asks `approve` /
  `revise` / `abort`.
- Stage 2 (Code, first iteration): invokes `/code-loop` for the iteration. Bounded by `/code-loop`'s
  caps. Stops, asks `next` or `stop`.
- Loops back to Stage 2 for the next iteration until done.

`/ship` does **not** skip review, verification, or rubber-stamp anything — the inner `/code-loop`
caps make sure cosmetic findings can't loop forever.

See [`examples/full-pipeline-example.md`](../examples/full-pipeline-example.md) for a transcript.

---

## `/ship-loop`

**When**: you want both layers (plan + code) automated under caps, with the mandatory human gate
between plan-done and code-start still in place.

**Type**:
```text
/ship-loop Add per-team rate limiting to the public webhook endpoint.
```

**Expect**: `/plan-loop` runs first; on success, **hard human checkpoint** (non-overridable);
then per-iteration `/code-loop`. Cross-layer circuit breaker stops if a finding recurs across
loops. Global budget caps total passes. See [`commands/ship-loop.md`](../commands/ship-loop.md).

---

## Specialised commands

### `/security-review`

Targeted security review. Walks trust boundaries to sinks and produces attack-path-grounded
findings.

```text
/security-review rate-limiting-webhooks   # scoped to a work item's latest iteration
/security-review main..feature-x          # range
```

Use this in addition to `/review` when you specifically want the OWASP-Top-10 lens applied
without the rest of the code-review noise. (`/review` already auto-invokes
`security-reviewer` when its consultant-trigger table fires.)

### `/architecture-review`

Targeted architectural review. Restates the decision, evaluates forces, traces dependencies,
stress-tests the contract, checks reversibility.

```text
/architecture-review rate-limiting-webhooks
/architecture-review docs/adr/0042-event-bus.md
```

### `/test-strategy`

Designs or critiques a test strategy. Risk-driven coverage, level selection (unit/integration/e2e),
mock policy, determinism.

```text
/test-strategy rate-limiting-webhooks
/test-strategy src/order/service.ts
```

### `/refactor`

Surgical, behavior-preserving refactor of a named smell. Tests stay green; no feature work mixed
in.

```text
/refactor OrderService mixes pricing logic and persistence. Split pricing into a pure module and
          keep persistence behind a repository interface. Files: src/order/service.ts,
          src/order/repo.ts.
```

---

## What happens to the artifacts

| Artifact                              | Lives at                                             | Lifetime                                          |
|---------------------------------------|------------------------------------------------------|---------------------------------------------------|
| Work-item directory                   | `.somi/plans/<slug>/`                                | Persists indefinitely; only you delete it         |
| `context.md`, `spec.md`, `decisions.md`, `progress.md`, `diary.md` | `.somi/plans/<slug>/`            | Same                                              |
| Phase files                           | `.somi/plans/<slug>/phases/<NN>-*.md`                | Same                                              |
| Review files                          | `.somi/reviews/<slug>/<YYYY-MM-DD>-*.md`             | Same; one per review run                          |
| `audit.log`                           | `.claude/audit.log`                                  | Append-only across sessions                       |
| Context-injection state               | `.claude/somi-state/last-context-signature`          | Project-local, gitignored                         |
| Diff                                  | git                                                  | As long as the branch / history is kept           |

All artifacts under `.somi/` should be committed to the repository. They're how the team and
future readers understand what was built and why.

> **Status lives in `progress.md` only.** The phase files describe what each iteration *is*
> (scope, files, acceptance) — never what state it's in. The verbatim user problem statement
> lives in `context.md` only; `spec.md §1` is the agent's restatement; `diary.md` Work-item-started
> points back. This eliminates the drift bait the audit flagged.

## Multiple work items

Each `/plan` creates its own work item. Slugs come from the problem statement; you can pick a
different one when prompted. If you re-invoke `/plan` on the same problem, SoMi AI asks whether to
continue the existing work item (preserving diary), reset it, or branch into a new slug.

When invoking `/code` or `/review` without a slug, SoMi AI looks at `.somi/` for a single work
item with `status: in-progress` in its `progress.md` and uses it. If there are multiple, it asks.

## Plan changes during implementation

When the coder discovers something that requires changing the plan (not just the code), it
follows the **plan-change protocol**:

1. Stop the contested work.
2. Update `spec.md`, `phases/<NN>-*.md` (scope/acceptance — not status), and `progress.md`
   (status fields, single source of truth) in place.
3. In `decisions.md`, never edit an accepted entry — supersede it with a new one and mark the old
   one `superseded by D<N>`.
4. Append a `diary.md` entry (top of file, newest first) with category `plan-change` (or
   `decision-change`, `blocker`) explaining what was discovered and why the plan changed.
5. Surface to you with the revised plan before continuing.

The spec never shows stale state. The diary remembers what changed.

## Dependency additions

Adding a new runtime dependency is a decision. The `gate-dep-install` hook denies
`npm install <pkg>`, `pip install <pkg>`, `cargo add`, etc. unless you've opted in for the
session:

```bash
export SOMI_ALLOW_DEP_INSTALL=1
```

The dep should also be recorded in `decisions.md` (with the agent's case for adding it) or
surfaced in the iteration summary for human sign-off. Bare lockfile-respecting reinstalls
(`npm install` with no args) are always allowed.

## Tips

- **Edit files in `.somi/plans/<slug>/` directly** between stages. They're your artifacts.
- **Use `/review plan <slug>`** for anything you'd send to a human staff engineer for an
  architecture preview.
- **Re-run `/review`** after addressing findings. Verdicts can change — a Blocker fix sometimes
  reveals a new Major.
- **Commit `.somi/`** with the feature branch — the artifact set explains the work to future
  readers.
- **Inspect `audit.log`** if you're curious what tools SoMi AI touched during a session.
- **`diary.md` is the time machine** — when you come back to a work item in three months, read
  diary first to understand the journey.
