---
name: plan-review
description: Use when judging whether a SoMi plan (the .somi/plans/<slug>/ artifact set, a brief, or a standalone ADR) is sound before any code is written. Gives the checks a reviewer applies - premise, verified decisions with reversal cost, iteration sizing, concrete risks, and acceptance criteria that can actually fail.
---

# Plan review — what makes a plan sound

A plan is reviewed so it can be **rejected cleanly**: its decisions are explicit enough to argue
about. This skill holds the checks. The standard comes from the planner's quality bar and the
artifact templates (`templates/SPEC`, `DECISIONS`, `PHASE`, `DOD`, `BRIEF`); it adds no policy of
its own. When this skill and an agent file diverge on a check, the skill wins.

Read only what the review needs: `spec.md`, `context.md`, the **live** entries of `decisions.md`
(skip the superseded appendix unless a finding turns on a supersession), the phase files in scope,
and `brief.md` with its supersession overlay applied. Grade each finding Blocker / Major / Minor /
Nit with a confidence; a plan can be rejected.

## The checks

### 1. The premise holds
- The request's framing is challenged, not just restated: is it an XY problem, self-contradictory,
  or already solved by something in the repo?
- The plan would **not** survive a contradicting requirement unchanged. A plan that fits any
  problem is not responding to this one.
- Finding if missing: Major. A faithful plan for a wrong question is wasted work.

### 2. Architecture decisions are user-verified, with real options
- Every decision that shapes the spec or architecture is marked verified with the user. "Made by
  the agent" is acceptable only for trivially small choices.
- Each verified decision shows at least two **concrete** options with real consequences, and a
  stated **reversal cost** (what undoing it takes, and how that grows with consumers). "Simple vs
  flexible" with no consequences is a vague option; reject it.
- Superseded decisions were moved to the appendix and marked, not edited in place. A live decision
  that contradicts a newer one is a finding.
- Silent picks (an architectural call made because "it's obvious") are Major.

### 3. Phases and iterations are sized and honest
- Phases are named for an outcome, not a mechanic ("implement", "test", "deploy" are not phases).
- Each iteration is about one reviewable PR, self-contained and orderable, and fits the loop's diff
  and file caps. If it plainly cannot, the plan must split it.
- The `Files (approx)` list is believable against the scope: it names the files the change must
  touch, including tests and docs, not a convenient subset. A list that is obviously short is the
  usual cause of a later scope breach.
- Parallelizable is `yes` only when file sets are provably disjoint.
- Hard decisions are not deferred to "the implementer" when they gate the design.

### 4. Risks are concrete
- Each risk names a specific failure mode and a mitigation that could be carried out. Generic
  platitudes ("scope may grow", "performance may suffer") are findings.
- Security implications are in the spec's security section with the phase that triggers
  `security-reviewer`; contract-breaking changes name the version bump and deprecation path.

### 5. Acceptance criteria can fail
- Every criterion states evidence of a **kind** (a named test, a command and its expected output,
  or a described manual exercise) and a **quantity** (one run or N; one file or every file; one host
  or each), written before the result is in. "Verify before ticking" names no evidence and is
  satisfied by anything. See `templates/DOD.md.tmpl` for the standard and its worked example.
- Evidence smaller than the claim needs is a finding even if it would pass: two green runs do not
  establish a failure rate.
- Each criterion would be red if the change were wrong. Ask of each: what broken implementation
  would still pass this?

### 6. No criterion manufactures findings
- A criterion that names the **wrong invariant** (a count that legitimately differs between hosts,
  a line number that moves, a string that appears in documentation about the thing) will fail on
  correct work and force the author to bend the code or the gate. Check that what the criterion
  measures is what correctness actually depends on.
- A criterion that can only be met by weakening another gate is a Blocker.

### 7. Responsive, not ceremonial
- No section filled with "N/A" or "TBD" to look complete; an empty section with a note is better.
- No pseudo-implementation: the plan's value is the choices, not the steps.
- No speculative architecture for a third use case before the first is solid.

## Verdict

`approve` only when checks 1 to 6 pass or carry accepted, named exceptions. A plan with an
unverified architectural decision, an unfailable acceptance criterion, or an iteration that cannot
fit its caps is `request-changes` at minimum. Say what to change, concretely.
