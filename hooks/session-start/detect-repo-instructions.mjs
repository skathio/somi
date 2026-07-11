#!/usr/bin/env node
// hooks/session-start/detect-repo-instructions.mjs — SessionStart hook — detect repo-local
// agent/instruction files and surface them.
//
// Node port of hooks/session-start/detect-repo-instructions.sh (node-runtime-port, phase 2,
// iteration 2.7). Imports the shared read/context/projectRoot helpers from ../lib/common.mjs
// (2.1, reviewer-blessed) rather than reimplementing them.
//
// SoMi's MAX→ECO economy is "respect repo conventions as context": when a project ships its
// own instructions (CLAUDE.md / AGENTS.md / copilot-instructions / .cursorrules) or its own
// subagents (.claude/agents/), SoMi's MAX actions should read them once and fold the relevant
// conventions into the work-item brief.md, so the ECO tier inherits them without re-reading.
// Repo-local instructions WIN over SoMi defaults where they conflict; SoMi does NOT
// auto-invoke foreign agents. This hook only *surfaces* what exists (paths + a one-line
// directive) — it does not read or ingest file contents. It fires once per session and stays
// silent when nothing repo-local is present.
//
// === THE PRUNE-LIST DECISION (explicit, named, per the phase file's requirement) =============
//
// bash's nested-file find (`detect-repo-instructions.sh:41-46`) declares a prune list
// (.git/node_modules/.somi/vendor) but it is CONFIRMED NON-FUNCTIONAL on GNU find (0.4's
// finding, independently reproduced by 0.4 pass 2's review with a control experiment): GNU
// find's `-mindepth 2` suppresses evaluation of EVERY predicate — including `-prune` — for
// entries at depth < 2, and the pruned directories themselves (.git, node_modules, .somi,
// vendor) are always depth-1 children of PROJECT_ROOT. The `-prune` clause therefore never
// fires; find still descends into all four directories, bounded only by `-maxdepth 3`.
//
// This port chooses **(b): fix forward.** A directory whose basename is one of the four
// pruned names, when it appears as a direct (depth-1) child of PROJECT_ROOT — exactly the
// entries bash's `-path "$PROJECT_ROOT/.git"`-style literal-path tests target, no broader — is
// never descended into. This is the narrowest possible fix: it reproduces exactly what the
// bash `-prune` clause is WRITTEN to do (literal full-path equality against the four
// top-level names, not a basename match at arbitrary depth), just makes it actually fire. It
// is not a redesign of the prune policy, only a bug fix confined to this one file.
//
// Reasoning, considered against reproducing the bug for strict parity instead:
//
//   1. Self-documented intent, violated by an accident, not a choice. This file's own header
//      comment (both bash's and this one's) states the design goal in plain language: "cap
//      depth and count so this stays cheap and never wanders into .git / node_modules /
//      .somi." The current bash behavior directly contradicts its own stated purpose because
//      of a mechanical find/mindepth interaction bug, not because anyone decided vendored
//      dependencies should be scanned. Reproducing a bug that contradicts the file's own
//      documented intent is a weaker form of "parity" than fixing it to match that intent.
//
//   2. Correctness, not just performance: what gets SURFACED. A CLAUDE.md/AGENTS.md that
//      happens to live inside a vendored dependency (node_modules), a submodule under
//      vendor/, or somi's own internal state directory is not "this repository's own
//      instructions" in the sense this hook's entire purpose describes to the MAX actions
//      that consume its signal. Surfacing a third-party package's own CLAUDE.md as if it were
//      this repo's convention is actively misleading downstream context, not neutral noise.
//
//   3. Performance, empirically measured, not assumed (this is the argument the phase file
//      flagged as possibly strongest, and it held up under measurement). Built a synthetic
//      800-package node_modules (4802 fs entries at depth <= 3, no matches, so `head -n 10`
//      cannot short-circuit either implementation — full traversal is forced both ways) and
//      timed three walks against it: bash's find (buggy, still descends node_modules) ~14ms;
//      a naive Node readdirSync walk reproducing the SAME non-pruning bug ~31-62ms (Node's
//      per-entry overhead — Dirent construction, JS call/recursion cost — is measurably higher
//      than find's C-native traversal, so "just port the bug" is not perf-neutral, it is
//      WORSE); the fix-forward pruned walk below ~0.17-0.24ms (2 entries visited: node_modules
//      itself, pruned before descending, plus the one root-level file). That is a ~150-350x
//      difference in this synthetic case, and it scales with real node_modules trees, which
//      commonly have thousands of packages — non-negligible for a hook whose whole premise is
//      being cheap enough to run unconditionally on every SessionStart.
//
//   4. Fail-quiet in the safe direction, matching this work item's existing precedent for
//      accepted divergences (2.4's BASH_REMATCH-clobber fix, 2.6's UTF-8 truncation
//      divergence): this change can only ever make a previously-surfaced file go silent
//      (prune now excludes something it used to include); in every realistic case it never
//      surfaces something new. (Pedantic corner from the 2.7 review: with >10 nested matches
//      where pruned-dir junk sorts ahead of real files, bash's head -n 10 could truncate a
//      REAL file the pruned walk now surfaces — arguably more correct, but not absolutely
//      "never new".) A regression from this fix is "the hook says nothing when it used to
//      say something," never a false positive.
//
//   5. Confined blast radius: unlike the audit()-embedded-delimiter issue (filed work-item-
//      wide, deliberately NOT fixed in a single hook's port), this fix touches only this file
//      — no shared common.mjs contract, no other hook's behavior, no cross-file coupling.
//
// What this means for the fixture (tests/hooks/cases/detect-repo-instructions.json):
// `surfaces-nested-claude-md-under-pruned-dir` (which pinned the CURRENT bash bug — a
// node_modules/CLAUDE.md being surfaced) is renamed and re-pointed to assert the FIXED
// behavior (silent exit — node_modules is now actually pruned) as a named, reviewed edit, per
// the same convention 2.8's status-detection decision is instructed to follow. The stated
// fixture-implications of the OTHER option (had (a) been chosen instead): every other case in
// the corpus would be untouched, this one case would pass completely as-is with zero edits,
// and the.mjs would need to intentionally NOT prune node_modules/.git/.somi/vendor at
// depth 1 — i.e. deliberately reproduce the bug, at the ~150-350x-in-synthetic-testing
// performance cost measured above, and at the cost of surfacing third-party CLAUDE.md files
// as if they were this repository's own conventions.
//
// === Depth-semantics translation (find -maxdepth 3 -mindepth 2) ==============================
// PROJECT_ROOT itself is depth 0; its direct children are depth 1; two directories down is
// depth 3 — the deepest this scan reaches (maxdepth 3). mindepth 2 excludes depth-0 (root
// itself, never a candidate anyway) and depth-1 files (root-level files are handled by the
// separate ROOT_FILES loop below, matching bash's separate `-f` loop + find). Verified against
// the fixture's depth-boundary pair: a/b/CLAUDE.md (file depth 3) IS surfaced
// (surfaces-nested-claude-md-at-max-scan-depth); a/b/c/CLAUDE.md (file depth 4) is NOT
// (omits-claude-md-beyond-scan-depth).
//
// === Symlink semantics (verified by direct probe against the unmodified bash hook, not
// assumed) ======================================================================================
// bash's ROOT-file loop uses `[[ -f "$PROJECT_ROOT/$f" ]]`, which FOLLOWS symlinks — a
// symlinked root CLAUDE.md IS surfaced. bash's nested find and the .claude/agents/ count both
// use `-type f` WITHOUT `-L`/`-follow` — this does NOT follow symlinks (a symlink has type
// 'l', not 'f'), confirmed with a live probe: a symlinked nested CLAUDE.md is silently
// excluded from the find output. Node's `fs.readdirSync(dir, { withFileTypes: true })` Dirent
// entries mirror this exactly, by construction, with no special-casing needed: `isFile()`/
// `isDirectory()` are both `false` for a symlink entry (confirmed with a live probe on the
// same fixture directories) — using `fs.statSync` (follows symlinks, like bash's `-f`) for the
// root-file loop and Dirent's `isFile()`/`isDirectory()` (does not follow, like bash's
// `-type f`/`-type d`) for the nested walk and the agents count reproduces both behaviors for
// free. Same reasoning covers a CLAUDE.md that is a DIRECTORY, not a file (verified live): the
// root loop's `-f` test is false for a directory, and the nested find's `-type f` test is
// false too (but the directory is still descended into like any other, matching bash) —
// `fs.statSync(...).isFile()` and Dirent's `isFile()` both return `false` for a directory
// identically, no extra branch required.
//
// === Windows caveat (same class already flagged in 2.2/2.3/2.5) ==============================
// `path.relative()` (platform-default separator: posix on Linux/macOS, win32 on Windows) is
// used to build the relative paths this hook emits in its message text. On Windows this would
// emit backslash-separated relative paths where bash's `${nested#"$PROJECT_ROOT"/}` prefix
// strip always produced forward slashes — cosmetic only (the message is free text shown to the
// model, not machine-parsed), not fixed here, consistent with prior ports' documented-not-
// fixed Windows path-separator gaps.

import fs from 'node:fs';
import path from 'node:path';
import { readPayload, projectRoot, contextOutput, runHook } from '../lib/common.mjs';

// bash: `for f in "CLAUDE.md" "AGENTS.md" ".cursorrules" ".github/copilot-instructions.md"`.
const ROOT_FILES = ['CLAUDE.md', 'AGENTS.md', '.cursorrules', '.github/copilot-instructions.md'];

// bash: `-name 'CLAUDE.md' -o -name 'AGENTS.md'` in the nested find.
const NESTED_NAMES = new Set(['CLAUDE.md', 'AGENTS.md']);

// bash's documented prune list (`detect-repo-instructions.sh:42-43`), now actually enforced —
// see THE PRUNE-LIST DECISION above. Only matched at depth 1 (PROJECT_ROOT's direct children),
// mirroring bash's literal `-path "$PROJECT_ROOT/<name>"` full-path equality tests exactly —
// this is not a basename match at arbitrary depth.
const PRUNED_TOP_LEVEL_DIRS = new Set(['.git', 'node_modules', '.somi', 'vendor']);

const MAX_DEPTH = 3; // bash: find -maxdepth 3
const MIN_DEPTH = 2; // bash: -mindepth 2
const MAX_NESTED_RESULTS = 10; // bash: | head -n 10

// bash's closing directive line (verbatim, including the embedded single quotes bash's
// `$'...'\''...'\''...'` escaping decodes to). Byte-exact against the fixture's
// expect_context substrings.
const DIRECTIVE =
  "\nMAX actions (/discover, /design, /refactor analysis, and /plan on a cold start) should read these once and distil the relevant conventions into the work item's brief.md / context.md so the ECO tier inherits them without re-reading. Repo-local instructions WIN over SoMi defaults where they conflict. Do NOT auto-invoke the repo's own agents — surface them for the user to opt into.";

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Nested CLAUDE.md/AGENTS.md scan, bounded to depth 3, actually pruning the four top-level
// directories (see THE PRUNE-LIST DECISION above). `depth` is the depth of the entries being
// iterated inside `dir` (root's direct children are depth 1). Capped at MAX_NESTED_RESULTS,
// matching bash's `| head -n 10`. Directory-listing order is filesystem-dependent in both
// implementations (find and readdirSync both return raw, unsorted directory order) — not a
// port-introduced nondeterminism, and no fixture case stages more than 2 nested matches, so
// this never matters for what's actually asserted.
function scanNested(root) {
  const results = [];

  function walk(dir, depth) {
    if (results.length >= MAX_NESTED_RESULTS) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // matches find's `2>/dev/null` — an unreadable subtree is silently skipped.
    }
    for (const entry of entries) {
      if (results.length >= MAX_NESTED_RESULTS) return;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (depth === 1 && PRUNED_TOP_LEVEL_DIRS.has(entry.name)) continue;
        if (depth + 1 <= MAX_DEPTH) walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile()) continue; // false for symlinks and dir-named entries — see header.
      if (depth < MIN_DEPTH) continue;
      if (!NESTED_NAMES.has(entry.name)) continue;
      results.push(path.relative(root, full));
    }
  }

  walk(root, 1);
  return results;
}

// bash: `find "$PROJECT_ROOT/.claude/agents" -maxdepth 1 -name '*.md' -type f | wc -l`.
function countAgentDefs(agentsDir) {
  let entries;
  try {
    entries = fs.readdirSync(agentsDir, { withFileTypes: true });
  } catch {
    return 0;
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.md')).length;
}

function main() {
  readPayload(); // Drains stdin, matching bash's `somi::read_payload` call. No payload field is
  // read anywhere in this hook (grepped: bash never calls `somi::field` here either) — this is
  // pure discovery over the filesystem, not the tool-call JSON.

  const root = projectRoot();

  const found = [];
  for (const f of ROOT_FILES) {
    if (isFile(path.join(root, f))) found.push(f);
  }
  for (const rel of scanNested(root)) {
    found.push(rel);
  }

  let repoAgents = '';
  const agentsDir = path.join(root, '.claude', 'agents');
  if (isDirectory(agentsDir)) {
    const count = countAgentDefs(agentsDir);
    if (count > 0) {
      repoAgents = `.claude/agents/ (${count} repo-local subagent definition(s))`;
    }
  }

  if (found.length === 0 && !repoAgents) return;

  let msg =
    'somi repo-awareness — this repository ships its own instructions/agents. Respect them as context:';

  // De-duplicate while preserving order (mirrors bash's `seen` accumulator). Structurally
  // unreachable today — ROOT_FILES entries and scanNested() results can never collide, since
  // the former are always single-segment (or the fixed two-segment copilot path) and the
  // latter are always depth >= 2 relative paths pointing at a different filename set — but
  // reproduced anyway for defensive fidelity with the bash original.
  const seen = new Set();
  for (const f of found) {
    if (seen.has(f)) continue;
    seen.add(f);
    msg += `\n  - ${f}`;
  }
  if (repoAgents) msg += `\n  - ${repoAgents}`;
  msg += DIRECTIVE;

  contextOutput('SessionStart', msg);
}

runHook(main);
