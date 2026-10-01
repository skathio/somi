---
name: sdlc-process
description: Use when judging whether a SoMi work item's artifacts match reality - progress.md accuracy, diary entries for plan and decision changes, diary compaction, decisions recorded before acting on them, review findings resolved by id, and nothing shipped that points into the planning folder. Process discipline, not code quality.
---

# SDLC process — artifact discipline

The plan artifacts are the team's memory. They only help if they stay true. This skill holds the
checks for that; the rules come from the templates (`PROGRESS`, `DIARY`, `DECISIONS`, `BRIEF`,
`REVIEW`) and `rules/50-collaboration.md`, not from new policy. When this skill and an agent file
diverge on a check, the skill wins.

Read bounded: `progress.md` in full, the live entries of `decisions.md`, the recent slice of
`diary.md` (since the last review, or the last ~10 entries), and the diff. Compare artifacts with
the **diff and the repository**, not with each other alone: an artifact can be internally consistent
and still wrong.

## The checks

### 1. `progress.md` matches reality
- An iteration marked `done` has its acceptance criteria met by the diff. Read the criterion, find
  the evidence; a `done` with no evidence is Major.
- The phase table's "iterations done / total" agrees with the iteration table. "Last activity" and
  "Currently in flight" are current.
- Status lives only in `progress.md`. Status duplicated into a phase file is a finding against the
  phase file.
- Scope creep (files outside the iteration's list) is acknowledged in follow-ups, not silent.

### 2. Plan and decision changes have diary entries
- A changed decision, phase shape, assumption from `context.md`, a hit or cleared blocker, or a
  review finding that affects the plan has an entry with the right category (`plan-change`,
  `decision-change`, `blocker`, `review-feedback`, `note`).
- Entries are short, self-contained, and say why. The diary is append-only: a wrong entry is
  corrected by a new one, not rewritten.
- Spec and code diverging with **no** entry explaining it is a finding. If an entry explains it,
  flag a Minor for visibility at most, not a Blocker.

### 3. Diary compaction was done
- After an append, if there are more than 40 `## ` entry headings, the writer compacted in the same
  edit: entries older than the newest 15 in the movable categories (`note`, `discovery`, `unblock`,
  `blocker`, `review-feedback`) went verbatim to `diary-archive.md`, leaving one `Compacted:`
  entry. A `decision-change` or `plan-change` entry never moves.
- Count the headings; do not assume. An over-threshold diary without compaction is a Minor, Major
  if reviews are visibly reading the whole file.

### 4. Decisions are recorded before they are acted on
- A choice that shapes the design appears in `decisions.md` (user-verified when architectural)
  **before** the code that relies on it, not back-filled afterward.
- Never edited in place: the old entry moved to the superseded appendix, marked `superseded by`,
  with a new entry and a diary entry. The spec's one-liner pointer matches the live decision.
- If `brief.md` exists and the superseded decision is in its "Decisions in force", a line was
  appended to its supersession overlay. A missing line means later passes build on a dead decision.
  Sections of the brief other than the overlay are not rewritten.

### 5. Review findings are recorded and resolved by id
- Findings from a review are in the ledger with an id and a severity; each is resolved with a
  status (`fixed`, `accepted`, `wontfix`) and the review that closed it. A finding discussed in
  prose and never resolved is still open.
- Open Blockers and Majors are not carried into a `done` iteration without explicit human sign-off.
- A review that points at the plan, not the code, produced a diary entry and a plan change, not a
  code patch around the symptom.

### 6. Nothing shipped points into the planning folder
- Shipped files (code, comments, agent/skill/command/doc prose) do not cite decision ids, finding
  ids, iteration or phase numbers, or planning slugs. The reader cannot resolve them; say the
  reasoning in words. Where a gate exists for this, run it rather than eyeballing; report a
  reference the gate cannot see.
- Product vocabulary ("phase", "work item", a template's sample ids) is not a finding.

## Severity guide

Blocker: an artifact claims something false that a later step will act on (a `done` that is not,
a live decision the code contradicts). Major: missing record of a plan or decision change.
Minor: stale bookkeeping that misleads but does not gate. Nit: wording.
