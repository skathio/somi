---
description: Build or refresh the Repo Atlas (.somi/atlas.md) — one MAX-tier deep read of the codebase (module map, dependency rules, conventions digest, hotspots, test topology), SHA-stamped and amortized across every later /design, cold /plan, /refactor analysis, and /impact.
argument-hint: [nothing — build or refresh] | refresh
allowed-tools: Read, Grep, Glob, Bash, Write, Edit
model: opus
---

# /atlas — Build or refresh the Repo Atlas (MAX tier)

You are building the **repo-level MAX artifact**: a single deep read of this codebase, distilled
into [`templates/ATLAS.md.tmpl`](../templates/ATLAS.md.tmpl) shape at **`.somi/atlas.md`**, so
that every later MAX action starts from the atlas plus the drift since its SHA — instead of
re-reading the whole repo per work item. This is the amortization layer of the MAX→ECO economy:
`brief.md` compresses a *work item*; the atlas compresses the *repository*.

> **Runs on the most capable model end-to-end** (like `/discover` and `/design`): the entire
> value is one high-quality read, paid once. There is no subagent — the reading *is* the work.

## What to do

### 1. Staleness check (when an atlas already exists)

If `.somi/atlas.md` exists, read its stamped SHA and run `git diff --stat <SHA>..HEAD`:

- **Small drift** (edits within existing modules): **refresh in place** — deep-read only the
  drifted paths, update the affected sections (keep section ordering stable), re-stamp the SHA,
  and append a line to §8 Refresh log naming what changed.
- **Structural drift** (new/moved/deleted top-level modules, manifest or build-system changes)
  or the user typed `refresh` after large churn: rebuild the affected sections from scratch;
  keep §8's history.

No atlas → full build (below).

### 2. Read the repository — this is where the model spend goes

- **Instruction files first**: `CLAUDE.md` (root + nested), `AGENTS.md`,
  `.github/copilot-instructions.md`, `.cursorrules`; note any `.claude/agents/` (listed for
  opt-in, never auto-invoked). These seed §4's conventions digest — repo-local instructions win
  over SoMi defaults.
- **Shape**: manifests (package.json / go.mod / pyproject / …), top-level layout, the module
  boundaries as they *actually are* (imports, not intentions).
- **Conventions as practiced**: open representative files per module — error handling, test
  layout, naming, logging. Where instruction files and practice disagree, record practice and
  note the disagreement.
- **Hotspots**: the files that are large, churn-heavy (`git log --stat`), or load-bearing in a
  non-obvious way — with `file:line` pointers.
- **Test topology and CI**: where tests live, the commands that actually run them, what gates a
  merge, where coverage is thin.

### 3. Write `.somi/atlas.md`

Fill the template. Hold the author discipline: **bounded (~300 lines), descriptive not
aspirational, reference-not-inline, stable section ordering**. Stamp the current `HEAD` SHA and
date. If `.somi/README.md` doesn't exist yet, also write it from
[`templates/SOMI-README.md.tmpl`](../templates/SOMI-README.md.tmpl).

### 4. Summarise back

- The one-paragraph repo framing (§1) and the module count.
- Top 3 hotspots and the thinnest test ice.
- Any instruction-vs-practice disagreements found.
- Next step: "MAX actions now start from the atlas — `/design` / cold `/plan` / `/refactor`
  analysis / `/impact` will deep-read only the drift since `<SHA>`. Refresh with `/atlas` after
  structural changes."

## How consumers use it (the contract)

- `/design`, cold `/plan`, `/refactor` analysis, `/impact`: read the atlas **first**, run the
  staleness check, deep-read **only** drifted areas and the paths the work item touches, and
  cite atlas sections in the brief's "Repo conventions in force" instead of re-deriving them.
- A **stale atlas is worse than none** — consumers must run the `git diff --stat` check before
  trusting it, and recommend `/atlas` refresh on structural drift rather than silently working
  from an outdated map.

## Guardrails

- **Descriptive, not aspirational.** Record how the repo is, warts included. An atlas that
  describes the intended architecture misleads every downstream consumer.
- **No editing the repo.** The only writes are `.somi/atlas.md` (and `.somi/README.md` if
  missing).
- **Bounded.** If it's growing past ~300 lines, you're inlining what should be a pointer.
- **Commit it.** The atlas is a shared team artifact — recommend committing `.somi/atlas.md`
  like the other `.somi/` artifacts.
