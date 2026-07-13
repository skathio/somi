---
description: One-time SoMi onboarding for an existing codebase. Builds the Repo Atlas, confirms detected conventions into a pre-filled 99-overrides scaffold, produces a gap report (test thin ice, hotspots, candidate first refactors), and suggests a calibration work item.
argument-hint: (no arguments — run once after installing SoMi in a repo)
allowed-tools: Task, Read, Grep, Glob, Bash, Write, Edit
model: sonnet
---

# /adopt — Onboard SoMi into an existing codebase

You are running SoMi's **one-time brownfield onboarding**. The goal: after this command, SoMi
already *knows this repo* — its map, its conventions, its weak spots — and the team has a
concrete first exercise, instead of "read thirteen docs and type `/plan`".

This is a composite of existing pieces, run in order, with the user confirming at each seam.

## Stage 1 — Build the Repo Atlas (MAX, the expensive step)

Run the [`/atlas`](./atlas.md) flow (it runs `opus` end-to-end): one deep read of the codebase →
`.somi/atlas.md` (module map, dependency rules, conventions digest, hotspots, test topology,
SHA-stamped). If a fresh atlas already exists, skip the rebuild and say so.

Present the atlas §1 framing + module count and pause briefly: "does this map match your mental
model?" — a wrong map should be corrected *now*, by the people who know, not discovered by the
first `/design`.

## Stage 2 — Confirm conventions into `99-overrides.md`

From the atlas §4 digest (and the instruction files it lists), draft the project's
`.somi/rules/99-overrides.md` scaffold **pre-filled with the detected conventions** — each as a
`## Convention:` block, plus a `## Override:` block for anything that contradicts a SoMi default
(name the rule file it overrides and a removal condition). `.somi/` is the neutral location
regardless of which host (Claude Code, GitHub Copilot) is consuming SoMi — never write this under
`.claude/` or `.github/`, and never at the project root.

**Present the draft to the user for confirmation before writing** — detected ≠ intended; the
team may be tolerating practices they don't want codified. Apply their edits, then write the
file (or, if one exists, propose additions only — never clobber). Where instruction files and
observed practice disagreed (the atlas records this), ask which one wins and record the answer.

## Stage 3 — Gap report

From the atlas plus targeted checks, produce a short **gap report** (in-chat, plus
`.somi/reviews/_ad-hoc/<YYYY-MM-DD>-adoption-gaps.md`):

- **Test thin ice** — the atlas §6 areas where a regression wouldn't be caught; the 2–3 places
  characterization tests would pay off first (this is [`test-strategist`](../agents/test-strategist.md)
  territory — Task it if the picture needs depth).
- **Hotspots** — atlas §5, ranked; for each, whether it blocks likely upcoming work.
- **Candidate first refactors** — untangles that would make the next changes easy
  ([`/refactor`](./refactor.md) analysis candidates), each with the smell named precisely.
- **Guardrail fit** — anything in the repo the hooks would fight (e.g. a workflow that
  hand-edits a lockfile) → recommend the matching `.somi/config.json` policy
  (`dep_install.allow`, `lockfiles.allow_edit`) instead of per-session env vars.

## Stage 4 — Suggest the calibration work item

Recommend one **small, real** feature or fix from the team's actual backlog shape (ask if none
is obvious) to run as `/ship` — the calibration exercise from
[GOVERNANCE.md](../docs/GOVERNANCE.md): it exercises plan → code-loop → review end-to-end, and
disagreements it surfaces belong in `.somi/rules/99-overrides.md` while they're fresh. For a bug, recommend
`/debug` instead.

## Summarise back

- Atlas: built/refreshed, module count, top hotspots.
- Conventions: confirmed count, overrides recorded, disagreements resolved.
- Gap report: the top 3 items, with the report's path.
- The suggested calibration item + exact next command.
- One-line orientation: "`/somi` any time for status and routing."

## Guardrails

- **Stage 2 writes nothing without confirmation.** Codifying conventions is a team decision;
  you draft, they decide (this is the batch verification protocol applied to onboarding).
- **Never clobber** an existing `.somi/rules/99-overrides.md`, `CLAUDE.md`, or atlas — propose additions.
- **The gap report is descriptive.** No unsolicited refactoring, no "fixing" anything during
  adoption. The output is knowledge + a recommended first exercise, not diffs.
- **Once per repo, roughly.** Re-running is safe (atlas refresh + report regeneration) but the
  overrides confirmation shouldn't be re-litigated on every run — propose only deltas.
