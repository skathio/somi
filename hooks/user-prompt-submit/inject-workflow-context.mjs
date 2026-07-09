#!/usr/bin/env node
// hooks/user-prompt-submit/inject-workflow-context.mjs — UserPromptSubmit hook — inject SOMI
// context on relevant turns.
//
// Node port of hooks/user-prompt-submit/inject-workflow-context.sh (node-runtime-port, phase 2,
// iteration 2.8 — the heaviest hook in the corpus: 12 bash arrays, process substitution, a
// signature-hash gate). Imports the shared read/context/projectRoot helpers from
// ../lib/common.mjs (2.1, reviewer-blessed) rather than reimplementing them.
//
// Two responsibilities (unchanged from bash):
//   1. Remind the agent of the priority stack and active work-item state.
//   2. Surface end-of-turn loose ends (TODO(claude) markers, scratch files) on the NEXT user
//      turn — this replaces the old Stop hook, which used an additionalContext channel that Stop
//      events don't actually have.
//
// To avoid double-loading content that's already always-on, the reminder block only fires on the
// first turn of a session OR when work-item state has changed since the last turn (the signature
// gate below). The loose-end nudges fire whenever there is something to nudge about, completely
// independent of the reminder gate (see main() — this independence is pinned by the fixture case
// "nudge-fires-independent-of-suppressed-reminder").
//
// === THE SIGNATURE-HASH GATE: what bash actually feeds sha256sum ================================
//
// bash's compute_signature() runs THREE independent `find ... -printf '%T@ %p\n' | sort |
// sha256sum | cut -d' ' -f1` pipelines (plans, reviews, rd) and joins the three resulting hex
// digests with `printf '%s:%s:%s'`. Two things here are easy to get subtly wrong, both verified
// directly against the unmodified bash hook (via `sha256sum`, `find -printf`, and staged
// throwaway directories) rather than assumed:
//
//   1. ABSENT DIRECTORY vs. EMPTY DIRECTORY are NOT the same segment value. If `.somi/plans`
//      doesn't exist at all, bash's `if [[ -d ... ]]` guard is false and `plans_state` stays the
//      shell's default empty string (`""`) — NOT a hash of anything. If `.somi/plans` exists but
//      contains zero matching `progress.md` files, `find` produces zero lines, `sort` passes
//      zero lines through, and `sha256sum` hashes the EMPTY STRING, producing the well-known
//      constant `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b85`. Verified
//      directly: a project dir with no `.somi/*` at all writes state-file content `"::\n"` (two
//      bare colons, zero-length segments); a project dir with an empty `.somi/plans/` writes
//      `"e3b0c44...b7852b85::\n"`. Reproduced below via `hashSegment()`'s `isDirectory` guard
//      returning `''` before ever calling `findMatchingPaths`, keeping the two cases distinct.
//   2. THE `%T@` FRACTIONAL-SECOND FORMAT is 10 digits, not 9, and the 10th digit is always `0`
//      at any real filesystem's resolution. Verified empirically (not from documentation, which
//      doesn't pin this precisely) by setting a file's mtime to an exact, known nanosecond value
//      via `os.utime(..., ns=...)` and reading back `find -printf '%T@\n'` against BOTH the
//      genuine GNU findutils binary at `/usr/bin/find` (bypassing this sandbox's own `find`→`bfs`
//      shell-function shim, which is layered on top of the real binary and reformats output
//      differently) and the shimmed one: mtime_ns=1712345678987654321 (987654321 ns past the
//      second) printed as `1712345678.9876543210` — the 9-digit nanosecond remainder with a
//      literal `0` appended, not a 9-digit value. Reproduced exactly below via
//      `mtimeField()`: BigInt seconds/nanoseconds from `fs.statSync(p, {bigint:true}).mtimeNs`,
//      formatted as `${seconds}.${nanos.toString().padStart(9,'0')}0`.
//
//   IMPORTANT SCOPE LIMIT on point 2: this reproduces GNU findutils' specific `%T@` format
//   (confirmed against the real `/usr/bin/find` binary on this host). It is NOT a claim that
//   every `find` implementation formats `%T@` identically — BSD find (stock macOS) doesn't
//   support `-printf` at all (a GNU extension), so bash's `compute_signature()` already silently
//   produces empty segments there today (`-printf` errors, `2>/dev/null` swallows it, `find`
//   exits non-zero, the pipeline's stdout is empty) — a pre-existing bash-only portability gap,
//   not introduced by this port. More importantly: **the gate is self-referential.** The state
//   file at `.claude/somi-state/last-context-signature` is only ever compared against a value
//   THIS SAME hook previously wrote — never against an external oracle, never read by any other
//   tool. Byte-identical hex-digest parity between a bash-computed signature and a Node-computed
//   signature for the identical on-disk state is therefore neither achievable in general (it
//   depends on which `find` binary happens to resolve first on PATH, which varies by host and
//   doesn't exist at all on Windows) nor required for correctness. What IS required, and IS
//   preserved exactly, is the gate's BEHAVIORAL contract: stable across repeated invocations when
//   nothing changed, and different whenever the matched file set or any matched file's mtime
//   changes — both verified by direct probe (see the diary). One bounded, expected consequence:
//   the FIRST Node-hook invocation on a host whose `.claude/somi-state/last-context-signature`
//   was last written by the bash hook will see a "changed" signature (different hash algorithms
//   for the same state) and re-emit the reminder ONE extra time at cutover — benign, not a bug.
//
// === THE STATUS-DETECTION DECISION (explicit, named, per the phase file's requirement) ==========
//
// 0.5's fixture pinned a real gap: bash's in-progress detection recognizes a bare status line
// matching `^[[:space:]]*<?in-progress>?[[:space:]]*$` (optional ANGLE brackets, not backticks)
// or a line matching `status:[[:space:]]*`?in-progress`?` (requires a literal "status:" prefix).
// Neither pattern matches this project's OWN `progress.md` convention: a bare, BACKTICK-wrapped
// status line with no "Status:" prefix — confirmed not just by the fixture's synthetic example
// but by this work item's own `.somi/plans/node-runtime-port/progress.md` line 10 (`` `in-progress` ``)
// and by `templates/PROGRESS.md.tmpl` line 16 (`<One of: ... | in-progress | ...>` under a bare
// `## Status` heading, zero "Status:" prefix) — the CANONICAL template every `/plan`-generated
// work item's `progress.md` follows. So the narrow bash regexes miss the mainline case, not an
// edge case: every SoMi work item created via the documented template is invisible to this
// hook's plan-hint scan today.
//
// Chosen: **(b) widen** — narrowly. `PLAN_STATUS_BARE_RE` below adds backtick as a second
// optional wrap character alongside the existing angle bracket, preserving the ORIGINAL pattern's
// own already-independent (non-paired) optionality — the bash original already accepts a
// mismatched `<in-progress` (leading `<`, no trailing `>`) since each is independently `?`; this
// widening adds backtick to the same independently-optional set, not a stricter, newly-paired
// rule the original never had. The full-line anchor (`^...$`, tested per PHYSICAL LINE, matching
// grep's line-oriented semantics, not a whole-file substring search) is preserved exactly.
//
// Reasoning, weighed explicitly against reproducing the narrow detection for parity (mirroring
// 2.7's prune-list decision structure):
//
//   1. Self-inconsistency, not a deliberate choice being preserved. SoMi's OWN planning tooling
//      generates `progress.md` files in the exact format its OWN hook fails to recognize. This
//      is not a hypothetical third-party format difference — it is SoMi authoring content for
//      itself that its own runtime cannot read.
//   2. Bounded, precisely-scoped false-positive risk — verified empirically, not assumed. Unlike
//      2.7's prune fix (which could only ever go quiet, never surface something new — fail-quiet
//      in the safe direction), THIS widening is in the OPPOSITE risk direction: it can make the
//      hook say MORE than it used to, and a badly-shaped widening could false-positive on
//      narrative text. Checked directly: `grep -nE '^\s*[<`]?in-progress[>`]?\s*$'` against this
//      work item's own ~1100-line `progress.md` — which repeatedly contains the SUBSTRING
//      "in-progress" inside narrative sentences (e.g. "Iteration left `in-progress` (pass 1);
//      review decides `done`." appears a dozen+ times in the Recent-activity/diary prose) —
//      matches EXACTLY ONE line: the real `## Status` field's own bare `` `in-progress` `` line.
//      Every narrative occurrence is disqualified by the full-line anchor (surrounding text on
//      the same physical line breaks the `^...$` match). This is the concrete evidence that a
//      substring-anywhere widening would be dangerous (it would false-positive on nearly every
//      real `progress.md` once it accumulates iteration history) while the full-line-anchored
//      widening actually chosen is not.
//   3. Confined blast radius: only `PLAN_STATUS_BARE_RE` changes. The R&D status scan
//      (`researching|drafting|awaiting-verification|ready-for-planning`) already matches this
//      repo's actual R&D README convention (`> Status: `researching``, already carrying the
//      "Status:" prefix the regex requires) — 0.5's review found no gap there, so it is
//      reproduced unchanged. `PLAN_STATUS_PREFIXED_RE` (the "status:"-prefixed in-progress form)
//      is also reproduced unchanged — it already matches its own fixture cases correctly.
//
// Consumer-observable consequence, named per D6's precedent: a work item using the bare-backtick
// `progress.md` convention (this repo's own convention) now surfaces its "Active work item:" hint
// on turns where it previously stayed silent. This is a real behavior change, not a bug fix to an
// internal-only mechanism (unlike 2.7's prune fix, which only affected an already-informational,
// no-decision-consequence context surface) — flagged for the close-out to record in decisions.md
// (a new D-entry, D6-style) and 4.4's CHANGELOG scope, alongside D6's SessionStart prune change.
//
// Fixture implication: `tests/hooks/cases/inject-workflow-context.json`'s
// `plan-hint-bare-backtick-status-not-detected` case (which pinned the bash gap as current
// behavior) is renamed to `plan-hint-bare-backtick-status-now-detected` and its expectation
// FLIPPED (`expect_context_excludes: "Active work item:"` → `expect_context: "Active work item:
// \`.somi/plans/demo-slug/\`."`) — the one deliberate, named, reviewed case edit this iteration
// makes. Every other case passes with only the `"script"` field retargeted.
//
// === Loose-end nudges: execFileSync argument arrays, explicit maxBuffer ==========================
// `git diff`/`git status` are invoked via `execFileSync` with argument ARRAYS (never a shell
// string), avoiding any shell-injection surface entirely (paths interpolated into a shell command
// string is exactly the class of bug `execFileSync(cmd, [args])` structurally forecloses). Both
// calls set `maxBuffer` explicitly (10 MB — the convention 2.5's review established for every
// output-capturing subprocess call in this port series), rather than relying on Node's low
// 1 MB default. A failed/absent `git` (ENOENT) or a non-zero exit from either command degrades to
// "no nudge from that check" — mirrors bash's `2>/dev/null` + `set -o pipefail`-tolerant `if
// pipeline; then` idiom, where either failure mode collapses to the same "condition false" outcome
// (a pipeline's non-zero exit inside an `if` condition does not abort under `set -e`).
//
// === Windows caveat (same class already flagged in 2.2/2.3/2.5/2.7) ==============================
// Paths embedded in the signature hash and extracted slugs use `path.join`/`path.basename`
// (platform-default separator). Purely internal (signature) or free-text-message (slugs) use —
// not fixed here, consistent with prior ports' documented-not-fixed Windows path-separator gaps.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readPayload, projectRoot, contextOutput, runHook } from '../lib/common.mjs';

// bash: `grep -qiE '^[[:space:]]*<?in-progress>?[[:space:]]*$'` — WIDENED per THE
// STATUS-DETECTION DECISION above: backtick added as a second optional wrap character alongside
// the original's angle bracket, independently optional on each side exactly as the original was.
const PLAN_STATUS_BARE_RE = /^\s*[<`]?in-progress[>`]?\s*$/i;
// bash: `grep -qiE 'status:[[:space:]]*`?in-progress`?'` — reproduced unchanged (already matches
// its fixture cases; no gap found here).
const PLAN_STATUS_PREFIXED_RE = /status:\s*`?in-progress`?/i;

// bash: `grep -qiE 'status:[[:space:]]*`?(researching|drafting|awaiting-verification)`?'` /
// `grep -qiE 'status:[[:space:]]*`?ready-for-planning`?'` — reproduced unchanged; 0.5's review
// found the real R&D README.md convention already carries the required "Status:" prefix.
const RD_STATUS_ACTIVE_RE = /status:\s*`?(researching|drafting|awaiting-verification)`?/i;
const RD_STATUS_READY_RE = /status:\s*`?ready-for-planning`?/i;

// bash: `grep -E '^\+.*(TODO\(claude\)|TODO\(agent\)|FIXME\(claude\))'` against `git diff` output.
const TODO_MARKER_RE = /^\+.*(TODO\(claude\)|TODO\(agent\)|FIXME\(claude\))/;
// bash: `grep -E '^\?\? .*(\.bak|\.orig|scratch_)'` against `git status --porcelain` output.
const SCRATCH_FILE_RE = /^\?\? .*(\.bak|\.orig|scratch_)/;

// 2.5's review-established convention for every output-capturing subprocess call in this port
// series (Node's spawnSync/execFileSync default maxBuffer is 1 MB — too small for a real `git
// diff`/`git status --porcelain` on a large working tree).
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

const REMINDER_BODY =
  'somi is active. Reminders:\n' +
  '- Follow rules/CLAUDE.md priorities: security > correctness > maintainability > performance > convenience.\n' +
  '- Plan before coding non-trivial work. Code from the plan, not around it.\n' +
  '- Surface tradeoffs and shortcuts in plain text; never silently compromise.\n' +
  '- Hooks may deny dangerous bash, secret writes, protected paths, and unsanctioned dep installs — do not work around them.';

function isDirectory(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

// Every filesystem entry within `dir` (bounded to `maxDepth` levels below it, `dir` itself being
// depth 0) whose basename satisfies `isMatch`. Mirrors bash's `find "$dir" -maxdepth N -name
// 'X'`: EVERY visited node (the starting dir plus every descendant up to maxDepth) is tested by
// basename — there is no `-type f` in the bash original, so a directory can match too — and only
// directories are descended into further. Shared by the signature scan (mtime hashing) and the
// plan-hint/rd-hint scans (content grep) below, exactly as bash independently runs the SAME
// `find "$dir" -maxdepth N -name 'X'` shape twice for two different purposes (once with
// `-printf`, once without).
function findMatchingPaths(dir, maxDepth, isMatch) {
  const results = [];
  function visit(p, depth) {
    if (isMatch(path.basename(p))) results.push(p);
    if (depth >= maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(p, { withFileTypes: true });
    } catch {
      return; // matches find's `2>/dev/null` — an unreadable subtree is silently skipped.
    }
    for (const entry of entries) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) {
        visit(full, depth + 1);
      } else if (isMatch(entry.name)) {
        results.push(full);
      }
    }
  }
  visit(dir, 0);
  return results;
}

// bash: `%T@` — seconds since epoch, DOT, then a 10-digit fractional part (9-digit nanosecond
// remainder plus a literal trailing `0`; see the header's empirical finding). `fs.statSync(p,
// {bigint:true}).mtimeNs` gives nanoseconds since epoch as a BigInt, letting seconds/nanoseconds
// be split exactly rather than through a lossy float.
function mtimeField(p) {
  const st = fs.statSync(p, { bigint: true });
  const seconds = st.mtimeNs / 1000000000n;
  const nanos = st.mtimeNs % 1000000000n;
  return `${seconds}.${nanos.toString().padStart(9, '0')}0`;
}

// One signature segment: `''` if `dir` doesn't exist (matches bash leaving the variable at its
// default empty string), else the sha256 hex digest of the sorted "`mtimeField` `path`" lines —
// including the digest of the EMPTY STRING when the directory exists but nothing matches (see the
// header's "absent vs. empty" finding; these are deliberately different values).
function hashSegment(dir, maxDepth, isMatch) {
  if (!isDirectory(dir)) return '';
  const lines = findMatchingPaths(dir, maxDepth, isMatch).map((p) => `${mtimeField(p)} ${p}`);
  lines.sort(); // matches `sort`'s lexicographic line order (ASCII paths only in practice, same
  // caveat class as this port series' other ASCII-only nocase/sort notes).
  const input = lines.length > 0 ? `${lines.join('\n')}\n` : '';
  return crypto.createHash('sha256').update(input, 'utf8').digest('hex');
}

// bash: `printf '%s:%s:%s' "$plans_state" "$reviews_state" "$rd_state"`.
function computeSignature(root) {
  const plansState = hashSegment(path.join(root, '.somi', 'plans'), 2, (n) => n === 'progress.md');
  const reviewsState = hashSegment(path.join(root, '.somi', 'reviews'), 3, (n) => n.endsWith('.md'));
  const rdState = hashSegment(path.join(root, '.somi', 'rd'), 2, (n) => n === 'README.md');
  return `${plansState}:${reviewsState}:${rdState}`;
}

function fileHasInProgressStatus(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return false; // matches grep's `2>/dev/null` on an unreadable path (or a directory, EISDIR).
  }
  return content
    .split(/\r?\n/)
    .some((line) => PLAN_STATUS_BARE_RE.test(line) || PLAN_STATUS_PREFIXED_RE.test(line));
}

// 'active' | 'ready' | null — bash's `if grep -qiE active-pattern ...; then ...; elif grep -qiE
// ready-pattern ...; then ...; fi`: active takes precedence when a file (implausibly) matches
// both.
function readmeStatus(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  const lines = content.split(/\r?\n/);
  if (lines.some((l) => RD_STATUS_ACTIVE_RE.test(l))) return 'active';
  if (lines.some((l) => RD_STATUS_READY_RE.test(l))) return 'ready';
  return null;
}

function computePlanHint(root) {
  const plansDir = path.join(root, '.somi', 'plans');
  if (!isDirectory(plansDir)) return '';
  const inProgress = [];
  for (const progressFile of findMatchingPaths(plansDir, 2, (n) => n === 'progress.md')) {
    if (fileHasInProgressStatus(progressFile)) {
      inProgress.push(path.basename(path.dirname(progressFile)));
    }
  }
  if (inProgress.length === 1) {
    return `\n- Active work item: \`.somi/plans/${inProgress[0]}/\`. Follow its \`spec.md\` and active iteration in \`phases/\`; update \`progress.md\` / \`diary.md\` as work proceeds.`;
  }
  if (inProgress.length > 1) {
    return `\n- Multiple in-progress work items in \`.somi/plans/\`: ${inProgress.join(',')}. Confirm with the user which one applies before coding.`;
  }
  return '';
}

function computeRdHint(root) {
  const rdDir = path.join(root, '.somi', 'rd');
  if (!isDirectory(rdDir)) return '';
  const rdActive = [];
  const rdReady = [];
  for (const readme of findMatchingPaths(rdDir, 2, (n) => n === 'README.md')) {
    const status = readmeStatus(readme);
    const slug = path.basename(path.dirname(readme));
    if (status === 'active') rdActive.push(slug);
    else if (status === 'ready') rdReady.push(slug);
  }
  if (rdActive.length >= 1) {
    return `\n- Active discovery in \`.somi/rd/\`: ${rdActive.join(',')}. This is requirements-engineering work (\`/discover\`): research the competition, author the R&D doc set, verify crossroads, before handing to \`/plan\`.`;
  }
  if (rdReady.length === 1) {
    return `\n- R&D foundation ready in \`.somi/rd/${rdReady[0]}/\`. \`/plan ${rdReady[0]}\` will consume its SRS/FRD as the requirements source and SDD/TDD as architectural direction.`;
  }
  return '';
}

// bash: `command -v git >/dev/null 2>&1`.
function isGitAvailable() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// bash: `git -C "$PROJECT_ROOT" diff --no-color --unified=0 HEAD 2>/dev/null | grep -E '...' -q`.
function hasTodoMarkerInDiff(root) {
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'diff', '--no-color', '--unified=0', 'HEAD'], {
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
    });
  } catch {
    return false; // no HEAD, git error, or non-zero exit — same "no nudge" outcome as bash's
    // pipefail-tolerant `if pipeline; then` when either side of the pipe fails.
  }
  return out.split('\n').some((line) => TODO_MARKER_RE.test(line));
}

// bash: `git -C "$PROJECT_ROOT" status --porcelain 2>/dev/null | grep -E '...' -q`.
function hasScratchFileInStatus(root) {
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'status', '--porcelain'], {
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
    });
  } catch {
    return false;
  }
  return out.split('\n').some((line) => SCRATCH_FILE_RE.test(line));
}

// bash: `if command -v git ... && [[ -d "$PROJECT_ROOT/.git" ]]; then ...; fi` gates BOTH nudge
// checks together — computed unconditionally every call, independent of the reminder-emission
// gate (see main()).
function computeNudges(root) {
  const nudges = [];
  if (isGitAvailable() && isDirectory(path.join(root, '.git'))) {
    if (hasTodoMarkerInDiff(root)) {
      nudges.push(
        "Detected new TODO(claude)/FIXME(claude) markers in the diff against HEAD. List them explicitly as 'not done' in your next summary."
      );
    }
    if (hasScratchFileInStatus(root)) {
      nudges.push('Detected scratch / .bak files in working tree. Clean them up before declaring done.');
    }
  }
  return nudges;
}

function main() {
  readPayload();

  const root = projectRoot();
  const stateDir = path.join(root, '.claude', 'somi-state');
  const stateFile = path.join(stateDir, 'last-context-signature');
  fs.mkdirSync(stateDir, { recursive: true });

  const currentSig = computeSignature(root);
  let lastSig = '';
  if (fs.existsSync(stateFile)) {
    try {
      // bash: `LAST_SIG="$(cat "$STATE_FILE" 2>/dev/null || true)"` — command substitution
      // strips ALL trailing newlines (not general whitespace), so `.replace(/\n+$/, '')` rather
      // than a generic `.trim()`.
      lastSig = fs.readFileSync(stateFile, 'utf8').replace(/\n+$/, '');
    } catch {
      lastSig = '';
    }
  }
  fs.writeFileSync(stateFile, `${currentSig}\n`); // bash: `echo "$CURRENT_SIG" > "$STATE_FILE"`.

  // bash: `[[ -z "$LAST_SIG" ]] || [[ "$LAST_SIG" != "$CURRENT_SIG" ]]` — reproduced as the exact
  // two-part condition (CURRENT_SIG is never truly empty, it's at minimum "::", but the explicit
  // first-turn branch is preserved for fidelity/clarity rather than collapsed to a single `!==`).
  const emitReminder = lastSig === '' || lastSig !== currentSig;

  const planHint = computePlanHint(root);
  const rdHint = computeRdHint(root);
  const nudges = computeNudges(root);

  const parts = [];
  if (emitReminder) {
    parts.push(`${REMINDER_BODY}${planHint}${rdHint}`);
  }
  if (nudges.length > 0) {
    let nudgeBlock = 'somi loose-end check:';
    for (const n of nudges) {
      nudgeBlock += `\n  - ${n}`;
    }
    parts.push(nudgeBlock);
  }

  if (parts.length > 0) {
    contextOutput('UserPromptSubmit', parts.join('\n\n'));
  }
}

runHook(main);
