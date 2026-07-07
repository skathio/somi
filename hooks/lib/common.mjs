// hooks/lib/common.mjs — shared helpers for somi hooks.
//
// Node port of hooks/lib/common.sh (node-runtime-port, phase 2, iteration 2.1).
// Zero-dependency: stdlib only (node:fs, node:path). No jq, no bash — every
// hook port (2.2-2.9) imports named exports from this module instead of
// `source`-ing a shell file.
//
// Hooks receive a JSON payload on stdin describing the tool invocation, and may
// emit a JSON response on stdout to control the harness. Output schema is
// event-specific (see https://code.claude.com/docs/en/hooks):
//
//   PreToolUse        — { hookSpecificOutput: { hookEventName, permissionDecision, permissionDecisionReason } }
//   PostToolUse       — { hookSpecificOutput: { hookEventName, additionalContext } }  or  { decision, reason }
//   UserPromptSubmit  — { hookSpecificOutput: { hookEventName, additionalContext } }  or  { decision, reason }
//   SessionStart      — { hookSpecificOutput: { hookEventName, additionalContext } }  (used by
//                         detect-repo-instructions.sh via somi::context/contextOutput, despite the
//                         bash original's doc-comment only naming three events for the
//                         additionalContext channel — ported per what the CODE does, confirmed by
//                         direct read, not per the stale comment)
//   Stop              — { decision: "block", reason }   (no additionalContext channel; no Stop
//                         hooks are wired in hooks.json today, so no helper here emits this shape)
//
// Helpers below emit the right shape per event. Use them — do not hand-emit
// legacy `{decision:"block"}` or bare `{additionalContext}` shapes; the harness
// silently drops the wrong shape for the wrong event.

import fs from 'node:fs';
import path from 'node:path';

// Thrown by denyPretool() (and available to any hook that needs an early,
// non-local exit) to unwind to the hook's own top-level handler — mirrors
// bash's unconditional `exit N` from inside a sourced function, which stops
// the calling script immediately regardless of loop/nesting depth. Every
// hook today only ever exits 0 (deny-and-stop is still a *successful* hook
// invocation from the harness's point of view — see denyPretool below), but
// the signal carries an explicit code rather than a hard-coded 0 in case a
// future hook needs a different one.
//
// Deliberately NOT using process.exit() here: scripts/somi-loop.mjs (1.1,
// reviewer-blessed) established the precedent that process.exit() risks
// truncating buffered stdout/stderr on a pipe if Node hasn't finished
// flushing yet — exactly the scenario denyPretool()/contextOutput() create
// (a console.log() immediately followed by an exit). Throwing + a top-level
// catch that sets process.exitCode lets Node drain its buffers naturally
// before exiting. Pair with runHook() below.
export class HookExit extends Error {
  constructor(code = 0) {
    super(`hook exit ${code}`);
    this.code = code;
  }
}

// Runs a hook's main() and translates a thrown HookExit into process.exitCode.
// The standard wrapper every hook port (2.2-2.9) should use at its top level,
// so denyPretool()'s early-exit contract works without each hook file
// re-declaring the same try/catch boilerplate (the somi-loop.mjs/
// somi-findings.mjs/somi-check.mjs precedent, centralized here since EVERY
// hook that calls denyPretool needs exactly this).
export function runHook(main) {
  try {
    main();
  } catch (e) {
    if (e instanceof HookExit) {
      process.exitCode = e.code;
    } else {
      throw e;
    }
  }
}

// project_root() — CLAUDE_PROJECT_DIR if set and resolvable, else cwd.
//
// Guards against UNEXPANDED variables: some hosts don't expand
// ${CLAUDE_PROJECT_DIR} inside settings.json's `env` block, so it (or
// SOMI_AUDIT_LOG, below) can arrive as the literal string
// "${CLAUDE_PROJECT_DIR}/...". Without this guard, a path built from that
// literal would create a directory named `${CLAUDE_PROJECT_DIR}` in the repo
// root. This guard is duplicated across 5+ bash files (context.md §2,
// brief.md §3) — centralized here as the ONE copy every hook port imports,
// rather than re-duplicating the `.includes('${')` check per file. (Note:
// scripts/*.mjs — a separate module graph, out of this iteration's scope —
// still carry their own copy; unifying those is a follow-up, not this pass.)
export function projectRoot() {
  let base = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (base.includes('${')) base = process.cwd();
  return base;
}

// Read the full JSON payload from stdin once, parse it. Tolerates empty or
// invalid input the way `somi::field`'s jq call does (`2>/dev/null || true`
// — no crash, just nothing to extract): returns null rather than throwing,
// and every field()/config() call below treats null the same as "field
// absent" (empty string / empty array).
export function readPayload() {
  let text = '';
  try {
    text = fs.readFileSync(0, 'utf8');
  } catch {
    return null;
  }
  if (text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// somi::field equivalent — dotted-path field extraction from the parsed
// payload, e.g. field(payload, '.tool_name'), field(payload, '.tool_input.command').
// Enumerated from every `somi::field` call site in hooks/ (grepped
// exhaustively): only ever simple dotted paths, never jq filters or array
// indexing — this is NOT a jq implementation, just the shape hooks actually
// use, and its parity claim is scoped to that: the SCALAR shapes hooks
// actually read (string, number, boolean). Mirrors `jq -r "$path // empty"`
// for those: null/missing/false collapses to '' (jq's `//` alternative only
// substitutes for null or false, not other falsy values — a value of 0 or
// "" is returned as-is by jq, matched here); a non-string scalar is
// JSON-stringified, matching jq -r's raw output for numbers/booleans. NOT
// claimed for object/array/big-int results: jq -r pretty-prints an object
// or array multi-line, where this emits compact JSON — a real divergence,
// just an inert one today, since no `somi::field` call site in hooks/ ever
// reads an object- or array-valued path (audit-log.sh's one object read
// goes through `jq -c` directly, matching compact output already).
export function field(payload, fieldPath) {
  if (payload === null || payload === undefined) return '';
  const keys = fieldPath.replace(/^\./, '').split('.').filter(Boolean);
  let cur = payload;
  for (const k of keys) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return '';
    cur = cur[k];
  }
  if (cur === null || cur === undefined || cur === false) return '';
  return typeof cur === 'string' ? cur : JSON.stringify(cur);
}

// Path to the audit log. Project-local by default; configurable via
// SOMI_AUDIT_LOG. Same unexpanded-variable guard as projectRoot(), applied a
// second time to the SOMI_AUDIT_LOG candidate itself (a host could pass an
// unexpanded literal there too, independent of CLAUDE_PROJECT_DIR).
export function auditLogPath() {
  const base = projectRoot();
  const fallback = path.join(base, '.claude', 'audit.log');
  let log = process.env.SOMI_AUDIT_LOG || fallback;
  if (log.includes('${')) log = fallback;
  return log;
}

// somi::config equivalent — reads a value from the project's committed
// config at .somi/config.json. `fieldPath` is a minimal jq-path string:
// dotted keys, optionally ending in "[]?" to request every element of an
// array (mirrors gate-dep-install.sh's `.dep_install.allow[]?` /
// `mapfile -t` idiom). These are the ONLY two shapes any `somi::config` call
// site in hooks/ uses today (grepped exhaustively) — NOT a general jq
// implementation; do not extend this ad hoc. If a future hook needs a path
// shape neither branch below covers, extend deliberately and name the new
// shape in this comment.
//
// Precedence contract (callers enforce it, same as the bash original): env
// var > .somi/config.json > default.
export function config(fieldPath) {
  const arrayMode = fieldPath.endsWith('[]?');
  const keys = (arrayMode ? fieldPath.slice(0, -3) : fieldPath)
    .replace(/^\./, '')
    .split('.')
    .filter(Boolean);

  const base = projectRoot();
  const cfgPath = path.join(base, '.somi', 'config.json');
  if (!fs.existsSync(cfgPath)) return arrayMode ? [] : '';

  let data;
  try {
    data = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return arrayMode ? [] : ''; // matches jq's `2>/dev/null || true` on invalid JSON
  }

  let cur = data;
  for (const k of keys) {
    if (cur === null || cur === undefined || typeof cur !== 'object') { cur = undefined; break; }
    cur = cur[k];
  }

  if (arrayMode) {
    if (!Array.isArray(cur)) return [];
    // jq's "// empty" on a generator (`.dep_install.allow[]? // empty`)
    // drops null/false elements from the output stream element-by-element —
    // it does NOT stringify them to "null"/"false" (verified against real
    // jq: F-29). A stray null/false entry in a committed config array is
    // silently skipped, matching that.
    return cur
      .filter((v) => v !== null && v !== false)
      .map((v) => (typeof v === 'string' ? v : JSON.stringify(v))); // jq -r per element
  }
  if (cur === null || cur === undefined || cur === false) return '';
  return typeof cur === 'string' ? cur : JSON.stringify(cur);
}

// Append a structured line to the audit log. Frozen contract (spec.md §9):
// "timestamp\tkind\ttool\tdetail\n", byte-exact — any deviation here is a
// regression, not a style choice.
export function audit(payload, kind, detail) {
  const tool = field(payload, '.tool_name');
  const log = auditLogPath();
  fs.mkdirSync(path.dirname(log), { recursive: true });
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); // date -u +%Y-%m-%dT%H:%M:%SZ
  fs.appendFileSync(log, `${timestamp}\t${kind}\t${tool || 'unknown'}\t${detail}\n`);
}

// Deny a PreToolUse tool call. Use this for block-* hooks. Emits the modern
// hookSpecificOutput.permissionDecision schema, writes the DENY audit line,
// then throws HookExit(0) — yes, exit 0: from the harness's point of view a
// hook that denies via this JSON shape completed successfully; the deny
// itself is communicated in the JSON body, not the process exit code. Pair
// with runHook() at the hook's top level so the throw is caught correctly
// and doesn't propagate as an uncaught exception.
export function denyPretool(payload, reason) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }));
  audit(payload, 'DENY', reason);
  throw new HookExit(0);
}

// Emit additionalContext for events that support it (PreToolUse, PostToolUse,
// UserPromptSubmit, SessionStart — see the header comment). The harness shows
// this to the model on its next turn. Does NOT exit — callers still fall
// through to their own exit path, same as the bash original.
export function contextOutput(event, context) {
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: event,
      additionalContext: context,
    },
  }));
}

// --- pattern-list matching --------------------------------------------------
//
// somi::matches_any / somi::matches_any_nocase equivalents. Thin wrappers:
// hooks own their actual pattern lists (as RegExp literals — see
// scripts/somi-check.mjs's SECRET_PATTERNS for the established idiom); this
// lib only owns the "does this string match any of these patterns" shape —
// it is deliberately not a pattern-list registry or a translation layer.
//
// Return contract: the RegExpExecArray from the FIRST matching pattern (so
// match[0] is the matched substring — the BASH_REMATCH[0] equivalent bash
// hooks interpolate into deny messages), or null if none matched. Returning
// the match object rather than a boolean means a caller never has to re-run
// the same pattern a second time just to recover the substring it already
// matched.
//
// FIRST-MATCH-ONLY CONTRACT (F-28): both wrappers strip the "g"/"y" flags
// from every pattern before matching, UNCONDITIONALLY — even if the
// caller's own RegExp carries one. `.exec()` on a /g or /y regex is
// STATEFUL: it advances the object's own `lastIndex` on every call, so
// running the SAME pattern object through `matchesAny` twice (e.g. 2.9
// scans its whole pattern list against the raw command, then again against
// the quote-stripped copy — block-dangerous-bash.sh:166-167) could silently
// return null on the second call even though the string still matches.
// Bash's `[[ =~ ]]` has no equivalent statefulness, so this would be a
// NEW failure mode the port introduces into the security substrate 2.9
// depends on. Rather than trust every pattern literal across 2.2-2.9 to
// never accidentally carry "g"/"y", toRegExp() makes the hazard
// unrepresentable: the effective flags are always normalized to exclude
// "g"/"y" first, so neither wrapper's returned RegExp is ever stateful
// across calls.
function toRegExp(pattern, forcedFlags) {
  const isRegExp = pattern instanceof RegExp;
  const source = isRegExp ? pattern.source : pattern;
  let flags = (isRegExp ? pattern.flags : '').replace(/[gy]/g, '');
  if (forcedFlags) {
    for (const f of forcedFlags) if (!flags.includes(f)) flags += f;
  }
  if (isRegExp && flags === pattern.flags) return pattern;
  return new RegExp(source, flags);
}

export function matchesAny(str, patterns) {
  for (const pattern of patterns) {
    const m = toRegExp(pattern).exec(str);
    if (m) return m;
  }
  return null;
}

// Case-insensitive variant. CONTRACT: the WRAPPER owns the "i" flag, not the
// caller — every pattern is matched case-insensitively regardless of what
// flags it was constructed with (a pattern missing "i" gets a flag-augmented
// copy built on the fly). This mirrors bash's actual mechanism: `shopt -s
// nocasematch` is an AMBIENT property of the matching operation, not a
// per-pattern annotation — the bash ERE pattern strings themselves have no
// case-flag syntax at all. Centralizing the flag here means a pattern added
// to a nocase list in a future hook port can never silently end up
// case-sensitive from one missing "/i" on one literal; the guarantee lives
// in which function you called, not in every pattern's own flags.
//
// ASCII-only, by construction of JS's own /i semantics — NOT by any bespoke
// folding logic here (1.2's F-23 precedent: bash's nocasematch is
// ASCII-only for these pattern classes, and Unicode-aware case folding can
// introduce surprises C-locale regex/`tr` never would). JS's /i flag
// WITHOUT the /u flag already refuses to fold a non-ASCII input character
// down to an ASCII pattern character — verified empirically:
// `/D/i.test('ď')`, `/D/i.test('Ð')`, `/i/i.test('İ')`, and
// `/k/i.test('K')` (Kelvin sign) are all `false`. Per ECMA-262's
// Canonicalize (22.2.2.9, non-Unicode mode): if a character's canonical
// form is < U+0080 but the character itself is >= U+0080, the algorithm
// returns the character UNCHANGED instead of folding it — the exact guard
// `String.prototype.toLowerCase()` lacks, which is what made
// normalizeTitle's İstanbul/café cases (somi-findings.mjs, F-23) a real
// bug. The one residual gap: two DIFFERENT non-ASCII characters Unicode
// considers case-equivalent to each other (e.g. é/É) would still fold under
// JS's /i, where bash's C-locale nocasematch would not — moot for every
// pattern in this codebase today (every nocase pattern source is pure
// ASCII), but worth naming if a future nocase pattern ever includes a
// literal non-ASCII character.
export function matchesAnyNocase(str, patterns) {
  for (const pattern of patterns) {
    const m = toRegExp(pattern, 'i').exec(str);
    if (m) return m;
  }
  return null;
}
