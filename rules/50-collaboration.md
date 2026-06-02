# 50 — Collaboration

How to work with humans, and how agents hand off to each other inside SOMI.

## Working with humans

- **Match the question to the answer.** A yes/no question gets "yes" or "no" first, then the reasoning.
- **Don't bury the lede.** If you blocked, broke, or skipped something, surface it in the first line.
- **Show your evidence.** When you claim something exists, link to the file. When you claim
  something works, name the test or output. When you assume, mark the assumption.
- **The user decides architecture.** You recommend; you don't decide. When a design or
  architectural choice shapes the work, present 2–4 concrete options with **specific** pros and
  cons (no vague phrasings), recommend one, and always offer two escape hatches: **Other** (the
  user proposes a custom option) and **Discover** (you ask narrowing questions to guide the
  choice). Record verified decisions in `decisions.md`.
- **Stop asking, start showing** when ambiguity is small. Don't ping the human for every
  micro-decision; pick the most reasonable default for non-architectural calls and call it out.

## Handoffs between workflows

The workflows compose. Each one has a clean handoff shape — the build trio is anchored by the
`.somi/plans/<slug>/` artifact set; the upstream discovery workflow is anchored by
`.somi/rd/<slug>/` and feeds planning.

### Discovery → Planning

Discovery (the [`discovery-analyst`](../agents/discovery-analyst.md), greenfield only) produces the
`.somi/rd/<slug>/` foundation: `research-report.md`, `brd.md`, `srs.md`, `frd.md`, `sdd.md`,
`tdd.md`, plus `decisions.md`, `diary.md`, and a `README.md` index with a traceability map. The
planner consumes it: the **SRS/FRD are the requirements source** (`spec.md` cites `FR-*`/`NFR-*`
IDs), the **SDD/TDD are architectural direction** (carried into `decisions.md`, re-opened only where
planning genuinely diverges — with a diary entry recording why), and the **research report is risk
context**. Discovery is not a prerequisite for planning; incremental work starts at `/plan`.

### Planning → Coding

Planning produces a directory of focused artifacts under `.somi/plans/<slug>/`: `context.md`, `spec.md`,
`decisions.md`, `progress.md`, `diary.md`, and `phases/`. The coder reads `spec.md` and the
relevant `phases/<NN>-*.md`, executes the iteration, and **does not exceed the slice**. If
implementation reveals the plan needs to change, the coder follows the **plan-change protocol**:
updates spec/decisions/phases in place (superseding decisions, never editing accepted ones),
appends a diary entry, surfaces to the human before continuing.

### Coding → Reviewing

The coder produces:
- A coherent diff
- Tests
- Updated docs (when behavior or interfaces changed)
- Updates to `progress.md`, the phase file, and `diary.md`
- A short PR-style summary: what changed, why, what was *not* done, what to look at

The reviewer reads **the spec**, **the active phase file**, **recent diary entries**, **the
diff**, and **the summary**. The reviewer is allowed — encouraged — to challenge the plan if it
was wrong. Reviews are written to `.somi/reviews/<slug>/<YYYY-MM-DD>-…md`.

### Reviewing → Coding (rework)

The reviewer's findings are graded:
- **Blocker** — must fix before merge.
- **Major** — should fix; merging without resolution requires explicit human sign-off.
- **Minor** — nice to fix; can be follow-up.
- **Nit** — style/taste, no obligation.

The coder addresses **Blockers** and **Majors**, defers **Minors** with a note, and ignores
**Nits** unless trivially adopted. If a finding points at the **plan** (not just the code), the
plan-change protocol fires — don't patch symptoms in code when the plan needs revising.

## When to escalate up the agent chain

Coders escalate to:
- **`security-reviewer`** before touching auth/crypto/input validation in a non-trivial way.
- **`architecture-reviewer`** before introducing a new module, service, or contract boundary.
- **`test-strategist`** when tests feel wrong-shaped (too many mocks, too slow, too flaky).
- **`refactorer`** when the task is "patch around an antipattern" and the antipattern keeps
  biting.

Planners escalate when the request is **bigger than it looked**: stop, produce a scoping note,
and surface the scoping decision to the human before drafting a half-credible mega-plan.

## Tone

- **Direct, specific, brief.** No filler ("Great question!", "Certainly!"). No throat-clearing.
- **Critical without being harsh.** Find the flaw; explain it; propose a fix.
- **Don't rubber-stamp.** "Looks good" without evidence is worse than silence.
- **Don't catastrophize.** Not every code smell is a fire.

## Artifacts

Every workflow produces durable artifacts under `.somi/` (discovery in `.somi/rd/<slug>/`; the build
trio in `.somi/plans/<slug>/` and `.somi/reviews/<slug>/`):

| Workflow  | Artifacts                                                                                                |
|-----------|----------------------------------------------------------------------------------------------------------|
| Discovery | `README.md`, `research-report.md`, `brd.md`, `srs.md`, `frd.md`, `sdd.md`, `tdd.md`, `decisions.md`, `diary.md` (under `.somi/rd/<slug>/`) |
| Planning  | `context.md`, `spec.md`, `decisions.md`, `progress.md`, `diary.md`, `phases/<NN>-*.md`                   |
| Coding    | The diff + a PR/commit summary referencing the iteration; updates to `progress.md`, phase file, `diary.md` |
| Reviewing | `.somi/reviews/<slug>/<YYYY-MM-DD>-<phase>.<iter>-<verdict>.md` (severity-graded)                        |

Templates for each live under [`templates/`](../templates/). Artifacts make the work auditable.
They are not optional. Past work items remain in `.somi/` indefinitely — only humans delete from
there.
