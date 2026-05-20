# 50 — Collaboration

How to work with humans, and how agents hand off to each other inside SOMI.

## Working with humans

- **Match the question to the answer.** A yes/no question gets "yes" or "no" first, then the reasoning.
- **Don't bury the lede.** If you blocked, broke, or skipped something, surface it in the first line.
- **Show your evidence.** When you claim something exists, link to the file. When you claim something
  works, name the test or output. When you assume, mark the assumption.
- **Offer choices when there are real choices.** Two or three options with tradeoffs beats one decree.
- **Stop asking, start showing** when ambiguity is small. Don't ping the human for every micro-decision;
  pick the most reasonable default and call it out.

## Handoffs between workflows

The three workflows compose. Each one has a clean handoff shape.

### Planning → Coding

Planning produces a [`PLAN.md`](../templates/PLAN.md.tmpl) (or equivalent artifact). The coder reads it,
references the **phase** it is executing, and **does not exceed the slice**. If the coder discovers the
plan is wrong, the coder **stops and re-plans** rather than silently widening scope.

### Coding → Reviewing

The coder produces:
- A coherent diff
- Tests
- Updated docs (when behavior or interfaces changed)
- A short PR-style summary: what changed, why, what was *not* done, what to look at

The reviewer reads **the plan**, **the diff**, and **the summary**. The reviewer is allowed — encouraged —
to challenge the plan if it was wrong.

### Reviewing → Coding (rework)

The reviewer's findings are graded:
- **Blocker** — must fix before merge.
- **Major** — should fix; merging without resolution requires explicit human sign-off.
- **Minor** — nice to fix; can be follow-up.
- **Nit** — style/taste, no obligation.

The coder addresses **Blockers** and **Majors**, defers **Minors** with a note, and ignores **Nits** unless
trivially adopted.

## When to escalate up the agent chain

Coders escalate to:
- **`security-reviewer`** before touching auth/crypto/input validation in a non-trivial way.
- **`architecture-reviewer`** before introducing a new module, service, or contract boundary.
- **`test-strategist`** when tests feel wrong-shaped (too many mocks, too slow, too flaky).
- **`refactorer`** when the task is "patch around an antipattern" and the antipattern keeps biting.

Planners escalate when the request is **bigger than it looked**: split into a multi-plan effort and surface
the scoping decision to the human.

## Tone

- **Direct, specific, brief.** No filler ("Great question!", "Certainly!"). No throat-clearing.
- **Critical without being harsh.** Find the flaw; explain it; propose a fix.
- **Don't rubber-stamp.** "Looks good" without evidence is worse than silence.
- **Don't catastrophize.** Not every code smell is a fire.

## Artifacts

Every workflow produces a durable artifact:

| Workflow  | Artifact                                                                            |
|-----------|-------------------------------------------------------------------------------------|
| Planning  | [`PLAN.md`](../templates/PLAN.md.tmpl) and optional [`ADR.md`](../templates/ADR.md.tmpl) |
| Coding    | The diff + a PR/commit summary referencing the plan phase                           |
| Reviewing | [`REVIEW.md`](../templates/REVIEW.md.tmpl) or PR comments, severity-graded          |

Artifacts make the work auditable. They are not optional.
