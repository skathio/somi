#!/usr/bin/env node
// hooks/post-tool/lint-changed-files.mjs — PostToolUse hook (matcher: Write|Edit) —
// best-effort lint of just-changed files.
//
// Node port of hooks/post-tool/lint-changed-files.sh (node-runtime-port, phase 2,
// iteration 2.5). Imports the shared read/context/projectRoot helpers from
// ../lib/common.mjs (2.1, reviewer-blessed) rather than reimplementing them.
//
// Runs the project's configured linter on the touched file, if one is available,
// keyed off file extension + presence of a config file. Result is informational —
// this hook NEVER blocks (PostToolUse: the file is already written by the time it
// runs). Every failure mode — missing linter, missing config, linter crash, linter
// non-zero exit, output truncated by maxBuffer — degrades to "no context emitted",
// never a deny, never a non-zero hook exit. Preserve that contract exactly; a
// future edit must not let any of these become a thrown, uncaught error.
//
// --- PROJECT_ROOT resolution: guarded projectRoot(), not bash's raw pattern ------
// bash: `PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"` — no `${...}`-unexpanded-
// literal guard on THIS specific line (unlike most other ported hooks' PROJECT_ROOT
// lines, context.md §2). Using common.mjs's projectRoot() here anyway (which DOES
// carry the guard) is a deliberate, safe-direction improvement, not a silent
// behavior change: if a host ever fails to expand `${CLAUDE_PROJECT_DIR}` before
// setting it, bash's un-guarded line would set PROJECT_ROOT to that literal
// garbage string, and the .ts/.go/.rs branches' `cd "$PROJECT_ROOT" &&` would then
// FAIL (nonexistent directory) — which, under this script's `set -euo pipefail`,
// aborts the ENTIRE hook script non-gracefully (a crash, not the intended
// best-effort no-op). The guarded projectRoot() falls back to `process.cwd()` in
// that same scenario instead, so this port degrades to "no lint delegate ran" for
// the broken-host case rather than crashing — strictly safer, and consistent with
// 2.1's centralization intent (every port imports the one guarded helper rather
// than re-duplicating bash's un-guarded line).
//
// --- run_if_present() -> runIfPresent(), combined with the `command -v` gate ----
// bash checks presence first (`command -v "$cmd"`), then, only if found, execs it
// with `2>&1 || true` (swallow a non-zero exit AND merge stdout+stderr). Node's
// spawnSync already reports "executable not found on PATH" as
// `result.error.code === 'ENOENT'` (Node does the PATH search itself, including
// PATHEXT on Windows) — a single spawnSync call reproduces BOTH steps (presence
// check + conditional exec) without a separate hand-rolled PATH-search helper, and
// without the check-then-exec TOCTOU race the bash original technically has
// (immaterial for a best-effort hook either way, but a strictly safer property of
// this shape, not a behavior change). `result.error` covers every reason the
// subprocess output couldn't be captured (not found, EACCES, exceeded maxBuffer,
// ...) — all of them collapse to "no lint output," matching bash's blanket `|| true`
// swallow.
//
// stdout/stderr are captured as SEPARATE buffers by spawnSync and concatenated
// (`stdout + stderr`) rather than truly interleaved the way a shell's `2>&1`
// fd-level merge would produce — Node has no direct equivalent without opening a
// real on-disk fd shared by both streams, which would be needless complexity for
// output that is purely informational and never programmatically parsed
// downstream. This is an intentional, named divergence: the acceptance criteria
// for this port pin SHAPE (does the wrapped "Lint output for the file just
// changed:" envelope appear, non-empty, when a real delegate run produces
// anything), not exact interleaved text — verified per fixture case that every
// scenario this port is actually tested against produces output on only ONE of
// the two streams, so concatenation order is moot for what's tested.
//
// --- maxBuffer -------------------------------------------------------------------
// LINT_MAX_BUFFER below is set explicitly on every output-capturing spawnSync call.
// This is the first hook port that shells out to capture an ARBITRARY THIRD-PARTY
// TOOL's own output (prior ports only capture `git`'s output for decision logic,
// not a linter's free-form diagnostic text) — Node's child_process default
// maxBuffer is 1 MB, and a verbose linter run (e.g. `cargo clippy` across a whole
// crate, or `eslint` with a large ruleset) could plausibly exceed that. 10 MB is a
// generous ceiling: enough to never truncate a realistic single-file lint run,
// small enough to bound worst-case memory use from a hook that's supposed to be a
// cheap, best-effort side note. If a real run exceeds it, spawnSync sets
// `result.error`, which `runIfPresent`'s swallow-everything contract already
// treats as "nothing to report" — an over-the-cap linter run degrades to silence,
// not a crash. This establishes the explicit-maxBuffer convention 1.1's review
// asked Phase 2's first output-capturing hook to set
// (`.somi/reviews/node-runtime-port/2026-07-06-1.1-pass1-approve.md`); later hook
// ports that capture subprocess output should follow this precedent.
//
// --- command-substitution trailing-newline stripping -----------------------------
// bash builds LINT_OUTPUT via `"$(...)"` command substitution, which
// UNCONDITIONALLY strips ALL trailing newlines from the captured text (a bash
// `$(...)` primitive, not specific to this hook). Node's spawnSync does not do
// this — reproduced explicitly via stripTrailingNewlines() below, applied to every
// branch's captured output, not just the `cargo clippy | head -50` branch that
// visibly pipes through another command.
//
// --- extension dispatch + config gating -------------------------------------------
// Ported 1:1 from the bash `case "$PATH_INPUT" in ... esac` arms, same order,
// same per-linter config-file gate, same cd-vs-no-cd behavior per branch (verified
// line-by-line against the bash original: ts/go/rust branches `cd "$PROJECT_ROOT"`
// before running their delegate; py/sh branches do not).
//
// --- cargo clippy path unreachable in the authoring/CI sandbox -------------------
// No rust toolchain exists in either environment (confirmed absent both places) —
// headLines()'s "head -50" translation is a faithful, readable-output-preserving
// port (not byte-exact POSIX `head` semantics, which don't matter here since bash's
// own `$(...)` strips trailing newlines from the piped result anyway), but is
// UNVERIFIED against a real `cargo clippy` invocation. Flagged, not silently
// assumed correct.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readPayload, field, contextOutput, projectRoot, runHook } from '../lib/common.mjs';

const LINT_MAX_BUFFER = 10 * 1024 * 1024; // 10 MB — see header comment.
const MAX_LINT_FILE_BYTES = 500000; // bash: SIZE_BYTES > 500000 skip (likely generated).

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function stripTrailingNewlines(text) {
  return text.replace(/\n+$/, '');
}

// See the header comment's "run_if_present() -> runIfPresent()" section.
function runIfPresent(cmd, args, cwd) {
  const result = spawnSync(cmd, args, { cwd, encoding: 'utf8', maxBuffer: LINT_MAX_BUFFER });
  if (result.error) return '';
  return stripTrailingNewlines((result.stdout || '') + (result.stderr || ''));
}

// head -N equivalent for the clippy branch. Bash's own `$(...)` strips trailing
// newlines from the piped-through result regardless, so byte-exact `head`
// semantics around a missing/present final newline don't matter here — see the
// header comment.
function headLines(text, n) {
  const lines = text.split('\n');
  if (lines.length <= n) return text;
  return lines.slice(0, n).join('\n');
}

// bash: nullglob loop over "$PROJECT_ROOT"/.eslintrc* filtered to `-f` (regular
// files only), OR eslint.config.js, OR eslint.config.mjs.
function hasEslintConfig(root) {
  let entries;
  try {
    entries = fs.readdirSync(root);
  } catch {
    entries = [];
  }
  const hasRcVariant = entries.some(
    (name) => name.startsWith('.eslintrc') && isFile(path.join(root, name)),
  );
  if (hasRcVariant) return true;
  return isFile(path.join(root, 'eslint.config.js')) || isFile(path.join(root, 'eslint.config.mjs'));
}

// bash: "./$(dirname "${PATH_INPUT#$PROJECT_ROOT/}")/..." — strip the
// PROJECT_ROOT/ prefix (a no-op if PATH_INPUT doesn't actually start with it,
// matching bash's `#`-prefix-removal no-op-on-no-match behavior), take the
// directory component, wrap as a `go vet` package pattern. Uses platform-default
// path.dirname (posix on Linux/macOS) — same Windows-backslash caveat 2.2/2.3
// already flagged and deferred (F-32-class divergence, not fixed here either).
function goVetPackageArg(pathInput, root) {
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  const rel = pathInput.startsWith(prefix) ? pathInput.slice(prefix.length) : pathInput;
  return `./${path.dirname(rel)}/...`;
}

function main() {
  const payload = readPayload();
  const pathInput = field(payload, '.tool_input.file_path');
  if (!pathInput) return;
  if (!isFile(pathInput)) return;

  // Skip oversized files (likely generated). bash: `wc -c < "$PATH_INPUT" 2>/dev/null
  // || echo 0` — a stat race after the isFile() check above falls back to 0 (treated
  // as "not oversized," matching bash's fallback exactly).
  let sizeBytes = 0;
  try {
    sizeBytes = fs.statSync(pathInput).size;
  } catch {
    sizeBytes = 0;
  }
  if (sizeBytes > MAX_LINT_FILE_BYTES) return;

  const root = projectRoot();
  let lintOutput = '';

  if (pathInput.endsWith('.py')) {
    if (isFile(path.join(root, 'pyproject.toml')) || isFile(path.join(root, '.ruff.toml'))) {
      lintOutput = runIfPresent('ruff', ['check', '--quiet', pathInput], undefined);
    }
  } else if (['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].some((ext) => pathInput.endsWith(ext))) {
    if (hasEslintConfig(root)) {
      lintOutput = runIfPresent('npx', ['--no-install', 'eslint', '--no-color', pathInput], root);
    }
  } else if (pathInput.endsWith('.go')) {
    if (isFile(path.join(root, 'go.mod'))) {
      lintOutput = runIfPresent('go', ['vet', goVetPackageArg(pathInput, root)], root);
    }
  } else if (pathInput.endsWith('.rs')) {
    if (isFile(path.join(root, 'Cargo.toml'))) {
      lintOutput = headLines(
        runIfPresent('cargo', ['clippy', '--quiet', '--message-format=short'], root),
        50,
      );
    }
  } else if (pathInput.endsWith('.sh')) {
    lintOutput = runIfPresent('shellcheck', [pathInput], undefined);
  }

  if (lintOutput) {
    // PostToolUse additionalContext must live under hookSpecificOutput per the
    // Claude Code hook schema (same note the bash original carried).
    contextOutput('PostToolUse', `Lint output for the file just changed:\n${lintOutput}`);
  }
}

runHook(main);
