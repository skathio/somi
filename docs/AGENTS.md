# Agents

SoMi AI ships seven subagents. The three **core** agents are the user-facing trio
(planner / coder / reviewer). The four **support** agents are invoked by the core agents (or
directly by the user) when the work clearly enters their domain.

| Agent                                                        | Tier     | When                                                                  |
|--------------------------------------------------------------|----------|-----------------------------------------------------------------------|
| [`planner`](../agents/planner.md)                            | core     | Non-trivial change; before any code is written                        |
| [`coder`](../agents/coder.md)                                | core     | Executing against an approved plan; small, well-scoped tasks          |
| [`reviewer`](../agents/reviewer.md)                          | core     | Before merge; whenever you want a skeptical second opinion            |
| [`security-reviewer`](../agents/security-reviewer.md)        | support  | Auth, crypto, secrets, input validation, deserialization, file uploads |
| [`architecture-reviewer`](../agents/architecture-reviewer.md)| support  | New module/service/contract; dependency direction change              |
| [`test-strategist`](../agents/test-strategist.md)            | support  | Test shape feels wrong; deciding unit vs. integration; flake debugging |
| [`refactorer`](../agents/refactorer.md)                      | support  | The next change needs untangling first; behavior-preserving structure  |

## How agents get invoked

Three paths:

1. **User invokes a command** (`/plan`, `/code`, `/review`) → command calls the corresponding
   core agent.
2. **A core agent escalates** during its work — e.g., coder hits auth code and asks whether to
   consult `security-reviewer`.
3. **User invokes a specialised command** (`/security-review`, `/architecture-review`,
   `/test-strategy`, `/refactor`) which directly targets a support agent. (Plan-level review
   uses `/review plan <slug>` — there is no separate `/plan-review`.)

SoMi AI prefers **explicit handoff** over silent specialisation. When a core agent thinks a
support agent should be consulted, it surfaces the recommendation; the human (or the
orchestrating command) decides.

## The core trio

### planner

Staff-engineer-grade planning. Produces the `.somi/plans/<slug>/` artifact set (context, spec,
decisions, progress, diary, phases). Pauses for **user verification** on every architectural or
design decision: presents 2–4 concrete options with explicit pros and cons (no vague phrasings),
recommends one, and offers `Other` (user-proposed option) plus `Discover` (guided narrowing
questions) as escape hatches.

- **Model**: `opus` (heavy judgment work).
- **Won't**: write code, silently pick architectural defaults.
- **Will**: stop and recommend re-scoping if the work is much larger than presented.

### coder

Elite implementation. Executes against the plan with senior-level design judgment. Updates
`progress.md`, the phase file, and `diary.md` as it works. Follows the **plan-change protocol**
when implementation reveals the plan needs changing: updates spec/decisions/phases in place,
appends a diary entry, surfaces to the user before continuing.

- **Model**: `opus`.
- **Won't**: silently widen scope; ship without running tests; bypass hooks; let the plan show
  stale state.
- **Will**: stop and trigger the plan-change protocol if the planned approach is producing bad
  code or hits an unforeseen constraint.

### reviewer

Strict, skeptical, evidence-driven. Reviews code, plans (the `.somi/plans/<slug>/` artifact set), or
architectural proposals. Checks plan-vs-code alignment: did the diff stay within scope, did
changes get captured in `decisions.md` and `diary.md`, is `progress.md` accurate.
Severity-graded findings, will reject weak solutions.

- **Model**: `opus`.
- **Won't**: rubber-stamp; bury Blockers under Nits; review the author instead of the code.
- **Will**: call in support agents when the change matches their territory (via separate Task
  calls); return a proposed `review-feedback` diary entry when a finding surfaces a plan issue.

## The support quartet

### security-reviewer

OWASP-Top-10-lens audit. Trust-boundary-to-sink walks. Findings include **attack paths** in plain
language (preconditions, what gets executed, what the attacker gains), not just CVE-name dropping.

Invoke directly via `/security-review`, or via `/review` on a diff that touches sensitive
territory (the reviewer auto-invokes when the consultant-trigger table fires).

- **Model**: `opus`.

### architecture-reviewer

Structural decisions — new module/service, dependency direction, public-contract introduction,
ADR review. Time horizon is years; reversibility is a first-class concern.

Invoke directly via `/architecture-review`, or via `/review` when the change introduces a
contract/module/service (the consultant-trigger table auto-invokes).

- **Model**: `opus`.

### test-strategist

Decides what to test, at what level, and how. Distinguishes risk-driven coverage from
coverage-worship. Identifies when the test shape is a *design* problem.

Invoke directly via `/test-strategy`, or via `/review` when the diff has mock-heavy / flaky /
e2e-only-on-risky-code symptoms.

- **Model**: `opus`.

### refactorer

Surgical, behavior-preserving structure changes. Tests stay green at every step. No feature work
mixed in. Returns the codebase to a state where the next planned change is easy.

- **Model**: `opus`.

## Model split: commands sonnet, agents opus

| Layer        | Default model | Why                                                                        |
|--------------|---------------|----------------------------------------------------------------------------|
| Commands     | `sonnet`      | Thin orchestration — routing, file I/O, summarizing — doesn't need opus    |
| Agents       | `opus`        | Heavy judgment work (planning, design review, security analysis)          |

This split (introduced when the audit flagged that opus was running the thin router layer too)
keeps the opus spend on reasoning, not orchestration. The agent model can be overridden
per-invocation via the Task tool's `model` argument when a command knows the agent's work is
mechanical.

## Adding new agents

See [EXTENDING.md](./EXTENDING.md). The short version:

1. Add `agents/<name>.md` with proper frontmatter (`name`, `description`, `model`). Omit `tools:` — leave it unrestricted for cross-runtime compatibility.
2. Document it in this file with a one-row entry.
3. Open a PR — CI validates the frontmatter.

## Escalation matrix (which command/agent calls which)

Agents themselves cannot Task other agents. Escalations are surfaced as **recommendations** to
the calling command, which decides whether to Task the next agent. `/review` is the structural
entrypoint that auto-invokes consultants (security-reviewer, architecture-reviewer,
test-strategist) based on the trigger table in [`commands/review.md`](../commands/review.md) — so
plain prose escalations from inside an agent are no longer the only path.

```
/plan        → planner         (writes .somi/plans/<slug>/)
/code        → coder           (handoff from planner: spec + active iteration)
/code-loop   → coder + reviewer (bounded code↔review loop, single iteration)
/review      → reviewer        (and auto-invokes consultants per trigger table)
             → security-reviewer       (when sensitive territory)
             → architecture-reviewer   (when introducing structure / contract change)
             → test-strategist         (when test shape is unclear)
/security-review     → security-reviewer
/architecture-review → architecture-reviewer (+ security-reviewer if security implications)
/test-strategy       → test-strategist
/refactor    → refactorer

/ship        → /plan + (per iteration) /code-loop  (with hard human gate after plan)
/plan-loop   → planner + reviewer  (bounded plan↔review loop)
/ship-loop   → /plan-loop + (per iteration) /code-loop  (hard human gate between layers)

# Within a code workflow:
coder        → plan-change protocol  (when plan needs revising; updates spec/decisions/phases)
reviewer     → review-feedback diary entry  (when finding points at plan, not code)
```

## User verification protocol (planner-specific)

The planner has a **mandatory** verification protocol for any architectural or design decision
that shapes the spec:

1. **State the decision** in plain language.
2. **Offer 2–4 concrete options**, each with **specific pros and cons** (no vague phrasings —
   if you can't name concrete consequences, the option doesn't go on the list).
3. **Recommend** one with a one-or-two-sentence reason.
4. Offer **`Other`** (user proposes a different option) and **`Discover`** (agent asks narrowing
   questions to guide the choice) in every verification prompt.
5. Record the chosen option in `decisions.md` with `Verified with user: yes` and a one-liner in
   `spec.md` §5 (Core decisions).

Decisions changed mid-workflow are **never edited in place** — they're superseded by a new entry,
the old one stays marked `superseded by D<N>`, and a diary entry records the change.

See [`agents/planner.md`](../agents/planner.md) for the full protocol and examples.
