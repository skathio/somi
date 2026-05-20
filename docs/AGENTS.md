# Agents

SOMI ships seven subagents. The three **core** agents are the user-facing trio
(planner / coder / reviewer). The four **support** agents are invoked by the core agents (or directly
by the user) when the work clearly enters their domain.

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

1. **User invokes a command** (`/plan`, `/code`, `/review`) → command calls the corresponding core agent.
2. **A core agent escalates** during its work — e.g., coder hits auth code and asks whether to consult
   `security-reviewer`.
3. **User invokes a specialised command** (`/security-review`, `/plan-review`, `/refactor`) which directly
   targets a support agent.

SOMI prefers **explicit handoff** over silent specialisation. When a core agent thinks a support agent
should be consulted, it surfaces the recommendation; the human (or the orchestrating command) decides.

## The core trio

### planner

Staff-engineer-grade planning. Produces multi-phase plans with risks, sliced iterations, test strategy,
security considerations, observability plan, rollout/rollback, and explicit open questions for the
human to confirm.

- **Model**: `opus` (heavy judgment work).
- **Tools**: Read, Grep, Glob, WebFetch, Bash (read-only-ish).
- **Won't**: write code, modify files outside `PLAN.md`.
- **Will**: stop and recommend re-scoping if the work is much larger than presented.

### coder

Elite implementation. Executes against the plan with senior-level design judgment. Notices
antipatterns while coding and either fixes them in scope or surfaces them as follow-ups.

- **Model**: `opus`.
- **Tools**: Read, Edit, Write, Bash, Grep, Glob, WebFetch.
- **Won't**: silently widen scope; ship without running tests; bypass hooks.
- **Will**: stop and re-plan if the planned approach is producing bad code.

### reviewer

Strict, skeptical, evidence-driven. Reviews code, plans, or architectural proposals. Severity-graded
findings, will reject weak solutions.

- **Model**: `opus`.
- **Tools**: Read, Grep, Glob, Bash (read-only).
- **Won't**: rubber-stamp; bury Blockers under Nits; review the author instead of the code.
- **Will**: call in support agents when the change matches their territory.

## The support quartet

### security-reviewer

OWASP-Top-10-lens audit. Trust-boundary-to-sink walks. Findings include **attack paths** in plain
language (preconditions, what gets executed, what the attacker gains), not just CVE-name dropping.

Invoke directly via `/security-review`, or via `/review` on a diff that touches sensitive territory
(the reviewer will recommend it).

### architecture-reviewer

Structural decisions — new module/service, dependency direction, public-contract introduction,
ADR review. Time horizon is years; reversibility is a first-class concern.

### test-strategist

Decides what to test, at what level, and how. Distinguishes risk-driven coverage from
coverage-worship. Identifies when the test shape is a *design* problem.

### refactorer

Surgical, behavior-preserving structure changes. Tests stay green at every step. No feature work
mixed in. Returns the codebase to a state where the next planned change is easy.

## Choosing model size

| Tier  | Default | When to override                                                                       |
|-------|---------|----------------------------------------------------------------------------------------|
| core  | `opus`  | Use `sonnet` for very simple `/code` tasks where the iteration is mechanical          |
| support | `opus` | Use `sonnet` for `architecture-reviewer` on small ADRs; `opus` for security and large reviews |

The model is set in each agent's frontmatter and can be overridden per-invocation via the Task tool's
`model` argument when calling from a command.

## Adding new agents

See [EXTENDING.md](./EXTENDING.md). The short version:

1. Add `agents/<name>.md` with proper frontmatter (`name`, `description`, `tools`, `model`).
2. Add it to the appropriate install profile in `install/profiles/`.
3. Document it in this file with a one-row entry.
4. Run `scripts/validate.sh` to confirm the frontmatter parses.

## Escalation matrix (which agent calls which)

```
planner          → coder        (handoff: PLAN.md → iteration)
coder            → reviewer     (handoff: diff + summary)
coder            → security-reviewer       (when sensitive territory)
coder            → architecture-reviewer   (when introducing structure)
coder            → test-strategist         (when test shape is unclear)
coder            → refactorer              (when next change needs untangling)
reviewer         → security-reviewer       (when reviewing sensitive diff)
reviewer         → architecture-reviewer   (when reviewing structural change)
reviewer         → coder (rework)          (Blocker/Major findings)
reviewer         → planner (re-plan)       (when the plan itself is wrong)
refactorer       → test-strategist         (if coverage is too thin to refactor safely)
refactorer       → architecture-reviewer   (if the refactor is really structural)
test-strategist  → refactorer              (if untestable code is really untangleable)
test-strategist  → reviewer                (if a "flaky test" is actually a real bug)
```
