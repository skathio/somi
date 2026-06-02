---
name: requirements-engineering
description: Use when writing or critiquing requirements and pre-development design documents — BRD, SRS, FRD, SDD, TDD — or when turning a fuzzy idea into testable, traceable requirements. Covers functional vs non-functional, INVEST, MoSCoW, acceptance criteria, traceability, ambiguity elimination, and what belongs in which document.
---

# Requirements engineering

The collaboration and priority rules in [`rules/50-collaboration.md`](../../rules/50-collaboration.md)
and [`rules/00-priorities.md`](../../rules/00-priorities.md) are the always-on floor. This skill adds
**operational depth** for the discovery phase: how to write a requirement that can't be misread, how
to split documents, and how to keep everything traceable. The owning agent is
[`discovery-analyst`](../../agents/discovery-analyst.md); load this skill when you are *authoring or
reviewing* requirements/design docs under `.somi/rd/<slug>/`.

Pair it with [`market-research`](../market-research/SKILL.md) (where requirements come from),
[`solid-principles`](../solid-principles/SKILL.md) and [`api-design`](../api-design/SKILL.md) (for the
SDD), and [`threat-modeling`](../threat-modeling/SKILL.md) (for security NFRs).

## The one test for every requirement

> **"How would I write a test that proves this is met?"**

If you can't answer in one sentence, the requirement is not done. "The system should be fast",
"easy to use", "handle lots of users" are not requirements — they're wishes. Rewrite as observable,
bounded statements: "p95 read latency < 200 ms at 500 rps", "a new user completes first import in
< 3 steps", "sustains 10k concurrent sessions on the reference instance".

## Which document holds what

These overlap if you're sloppy. Keep the seams clean:

| Document | Answers | Holds | Does **not** hold |
|----------|---------|-------|-------------------|
| **BRD** (business) | *Why build this, for whom, what is success?* | Problem, stakeholders, business goals, scope boundaries, success metrics, constraints | Feature specs, technical choices |
| **SRS** (software requirements) | *What must the software do and how well?* | The canonical functional (`FR-*`) and non-functional (`NFR-*`) requirements, prioritized & traceable | Business justification (lives in BRD), UI flows (FRD), tech choices (TDD) |
| **FRD** (functional detail) | *How does each function behave, step by step?* | Primary/alternate/exception flows, field-level rules, edge cases, state transitions | New requirements (those belong in SRS), design |
| **SDD** (software design, high-level) | *What is the shape of the solution?* | Major components & responsibilities, data the system owns, integration/trust boundaries, expensive-to-reverse choices | Detailed module/interface design, file layout (that's the planner) |
| **TDD** (technical design, high-level) | *What technology and what limits?* | Technology family, NFR engineering targets, security/compliance posture, rationale tied to SRS | Concrete library picks, per-iteration plans (planner) |

When in doubt: requirements (the *what*) go in SRS; behavior detail goes in FRD; the *why* goes in
BRD; the *shape* goes in SDD/TDD. If a line fits two documents, it belongs in the more upstream one
and is *referenced* (not copied) downstream.

## Functional vs non-functional

- **Functional (`FR-*`)** — what the system *does*: "FR-7 — the importer rejects rows missing a
  required column and reports the row number." A behavior you could demo.
- **Non-functional (`NFR-*`)** — *how well* it does it: performance, availability, security,
  accessibility, compliance, operability. NFRs are where products lose trust — give them numbers and
  conditions, not adjectives.

A useful prompt for NFRs: *"-ility?"* — scalability, reliability, security, usability,
maintainability, observability, portability. Each gets a measurable target or an explicit "not a
concern for v1 because …".

## INVEST — the shape of a good requirement

- **I**ndependent — minimal coupling to other requirements.
- **N**egotiable — states the need, not a pre-baked implementation.
- **V**aluable — traces to a BRD goal; if it serves no goal, cut it.
- **E**stimable — clear enough that the planner could size it.
- **S**mall — one requirement, one behavior. Split compound "and"/"or" requirements.
- **T**estable — the one test above.

## MoSCoW — prioritize, always

Every requirement is tagged **Must / Should / Could / Won't (this release)**. "Won't" is a
first-class output of discovery — it's how you record scope boundaries (and it pairs with BRD
non-goals). A spec where everything is a Must is a spec that hasn't made a decision.

## Traceability — the spine of the document set

Every requirement traces **backward** (to a business goal and, where relevant, a research finding)
and **forward** (to a design element, and later to a plan phase). Maintain this in the R&D
`README.md` traceability map. Why it pays off:

- A requirement with no upstream goal is **scope creep** — surface it or cut it.
- A business goal with no downstream requirement is an **unmet goal** — a gap.
- A design element with no requirement is **gold-plating** — design for a need that doesn't exist.

Give every requirement a **stable ID** (`FR-1`, `NFR-1`, `BR-1`). IDs are forever — supersede, never
renumber, so downstream references don't rot.

## Ambiguity elimination

Hunt these words and pin them down:

- **"etc.", "and so on"** — enumerate or scope. The reader can't test "etc."
- **"should" vs "must"** — use RFC-2119 discipline: MUST (mandatory), SHOULD (recommended, with a
  stated exception path), MAY (optional). Don't mix casually.
- **"fast / quick / soon / large / many"** — replace with a number and unit.
- **"support X"** — define what "support" means (read? write? configure? at what scale?).
- **Passive voice hiding the actor** — "the file is validated" → *who* validates, *when*, on *what
  failure*?
- **Unstated failure behavior** — every functional requirement needs its sad path: what happens when
  the input is bad, the dependency is down, the limit is hit.

## Acceptance criteria

Attach concrete, checkable acceptance criteria to requirements that need them. Given/When/Then is a
good default:

> **FR-12** — Bulk import reports accepted/rejected counts and fails loudly on any rejection.
> - **Given** a file with 3 valid and 2 invalid rows, **when** imported, **then** the response
>   states "3 accepted, 2 rejected", lists the 2 row numbers, and exits non-zero.

## Anti-patterns to call out

- **Solution-as-requirement** — "use PostgreSQL" stated as a requirement. That's a *decision* (TDD,
  verified), not a requirement. The requirement is the need it serves ("durable, queryable storage
  of orders with ACID guarantees").
- **The everything-Must spec** — no prioritization; nothing can be cut; planning can't sequence it.
- **Untestable adjectives** — "intuitive", "robust", "seamless". Restate as observable behavior.
- **Copy-paste across documents** — the same text in BRD and SRS drifts. Put it once, reference it.
- **Requirements with no failure path** — only the happy path specified.
- **Renumbered IDs** — breaks every downstream reference. Supersede instead.
- **Design smuggled into the SRS** — function signatures and module names in a requirements doc.
  Direction goes in the SDD; detail goes to the planner.

## When *not* to over-apply

- For a **small, well-understood internal tool**, a single SRS may absorb the FRD — don't force five
  documents. Omit with a reason in `README.md`.
- For work that already has a settled spec, skip discovery and hand to the
  [`planner`](../../agents/planner.md).
- Don't gold-plate NFRs for a prototype — state the targets that matter and explicitly defer the
  rest.

## When to escalate / hand off

- **To the user (verification protocol)** — any requirement- or direction-shaping decision: target
  persona, scope boundary, build-vs-integrate, an expensive-to-reverse architectural call.
- **To the [`planner`](../../agents/planner.md)** — once the SRS/SDD are ready; the planner turns
  direction into detailed, phased design. Don't do its job in the SDD.
- **To [`threat-modeling`](../threat-modeling/SKILL.md) / [`owasp-defense`](../owasp-defense/SKILL.md)**
  — when the product introduces a real attack surface; the security NFRs and trust boundaries belong
  in the SRS/SDD, grounded by those skills.
