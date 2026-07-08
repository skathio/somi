#!/usr/bin/env node
// hooks/pre-tool/gate-dep-install.mjs — PreToolUse hook (matcher: Bash) — gate
// dependency-adding commands.
//
// Node port of hooks/pre-tool/gate-dep-install.sh (node-runtime-port, phase 2,
// iteration 2.4). Imports the shared read/deny/audit/config helpers from
// ../lib/common.mjs (2.1, reviewer-blessed) rather than reimplementing them.
//
// Adding a runtime dependency crosses a trust boundary: it imports unreviewed code,
// expands attack surface, and creates a long-term maintenance obligation. The coder
// should not add deps as a drive-by — they belong in `decisions.md` or at minimum in
// the iteration summary so a human can sign off.
//
// This hook denies adding a *new* dep without an explicit acknowledgement
// (SOMI_ALLOW_DEP_INSTALL=1 in the env, set by the human for the session). Lockfile-
// respecting reinstalls (bare `npm install`, `yarn install`, etc.) are allowed — those
// don't add deps, they materialize what's already declared.
//
// COUNT CORRECTION (verified by direct read, not inherited from the phase file's
// prose): the bash original's DEP_ADD_PATTERNS array holds 19 patterns, not 18 — and
// the trailing "generic curl-to-installer" trio (brew/apt/apt-get) sits outside the
// six named package-manager ecosystems the file's own comments group (js: npm/yarn/
// pnpm/bun; python: pip/pipx/uv/poetry/conda; rust/go/ruby/php: cargo/go/gem/bundle/
// composer). All 19 are ported below — "port ALL of the patterns" wins over an
// inherited miscount; the phase file's iteration-2.4 scope line is corrected
// alongside this port (see the diary entry for this pass).
//
// ERE→RegExp translation notes:
//   - `[[:space:]]` → `\s`. NOT byte-identical: POSIX `[[:space:]]` matches exactly
//     the 6 ASCII whitespace bytes (space/tab/newline/CR/FF/VT); JS `\s` matches those
//     same 6 PLUS additional Unicode whitespace (U+00A0, U+2028, U+2029, U+FEFF, and
//     other Unicode Zs-category characters) — a strict SUPERSET, not the dot-narrowing
//     divergence 2.9 has to worry about. Direction matters: a wider `\s` can only make
//     this hook MATCH (and therefore gate) a *broader* set of verb/package-argument
//     separators than bash would — the safe direction for a security-adjacent gate.
//     The widening DOES produce observable fail-closed decision divergences on some
//     Unicode-whitespace separators — e.g. `npm<NBSP>install x`: bash ALLOWS (NBSP is
//     not [[:space:]], so no pattern matches), this port DENIES (NBSP is JS \s). Always
//     over-gating, never under-gating (verified in review: backtracking prevents the
//     reverse direction), and inert-to-security: every diverging input is non-functional
//     as a real shell command anyway (bash IFS only splits ASCII whitespace, so
//     `npm<NBSP>install` is a single nonexistent command token — nothing denied here
//     would have worked as an unblocked command downstream).
//   - `[^[:space:]]` → `[^\s]`: same superset relationship, applied to the negated
//     class (excludes slightly more from "package token" chars) — same safe direction.
//   - Bare/unescaped `.` or `.*` wildcard (the live POSIX-vs-JS `.` line-terminator
//     divergence that matters for block-dangerous-bash.sh, 2.9): NONE of this file's
//     19 patterns use one. The only `.` occurrences are the escaped literal
//     `\.txt` in the `pip install -r ...txt` pattern — an escaped dot means "literal
//     dot", identical in ERE and JS regex syntax, so there is no line-terminator
//     divergence to translate here. Checked every pattern by hand, not assumed.
//   - Everything else (`+`, `*`, `?`, alternation groups, negated single-char classes
//     `[^-]`) is byte-identical ERE/JS syntax — a mechanical, pattern-by-pattern port.
//   - Matching is UNANCHORED substring search in both bash (`[[ "$CMD" =~ $pattern ]]`)
//     and here (`RegExp.prototype.exec` with no `^`/`$`), and case-sensitive in both
//     (no `shopt -s nocasematch` in the bash original for this pattern set) — no
//     nocase wrapper needed.
//
// FIRST-MATCH-WINS / single-decision semantics: bash's per-pattern loop body ends in
// either `exit 0` (ALLOW, audited) or `somi::deny_pretool` (which itself calls
// `exit 0` — see common.sh:89) — so only the FIRST pattern to match the command is
// ever evaluated; the loop never reaches a second pattern. `matchesAny()` (2.1)
// returns the first-matching pattern's `RegExpExecArray` in array order, reproducing
// this exactly, and `m[0]` is the `${BASH_REMATCH[0]}` equivalent interpolated into
// the deny message.
//
// SOMI_ALLOW_DEP_INSTALL exact-value semantics: bash's `"${SOMI_ALLOW_DEP_INSTALL:-0}"
// == "1"` uses `:-`, which substitutes the default "0" for BOTH unset AND
// explicitly-empty ("") — so unset, "", and "0" are all NOT-opted-in, and every other
// string value (e.g. "true", "yes") is also NOT-opted-in; only the literal "1" opts
// in. `process.env.SOMI_ALLOW_DEP_INSTALL === '1'` below is an exact behavioral
// equivalent of that comparison (not merely a shortcut): for every value other than
// literal "1", both the bash substitution-then-compare and the direct JS comparison
// land on the same false/true outcome — verified case-by-case, not assumed.
//
// COMPOUND-COMMAND REFUSAL (config_allows_dep → configAllowsDep, the security-relevant
// detail this iteration was told to preserve exactly): the allowlist prefix-match only
// ever applies to the RAW, unmodified `$CMD`/`cmd` string — bash tests
// `[[ "$c" == *';'* || "$c" == *'&'* || "$c" == *'|'* ]]` against the WHOLE command
// text (not just the matched substring) and refuses the allow (returns 1 / false) if
// ANY of those three characters appears ANYWHERE in it — a single `&` (not just `&&`)
// or single `|` (not just `||`) is enough to refuse, same as bash's glob-style `*x*`
// substring test. Ported as three `.includes()` checks against the same raw string,
// in the same order, before any tokenization happens — not simplified to a regex or a
// "look compound" heuristic.
//
// TOKENIZATION judgment call (named per this iteration's "check exactly what bash
// checks" instruction, not a silent default): bash's `for tok in $c` performs BOTH
// IFS word-splitting AND pathname (glob) expansion on the unquoted `$c` — a token
// containing `*`/`?`/`[...]` could silently expand against files in the hook's cwd,
// making the allowlist check's actual token set depend on the filesystem at hook-run
// time. That side effect is not reproduced here: it would make the gate's outcome
// non-deterministic and cwd-dependent, a strictly worse property for a security
// control, and no realistic package-name argument or fixture case exercises it.
// `tokensAfterVerb()` below reproduces the WORD-SPLITTING half only (split on runs of
// whitespace), which is the behavior this hook's allowlist logic actually depends on.
//
// DISCOVERED DIVERGENCE, decided explicitly (differential-probe finding, not a silent
// default — same category of call as 2.7's prune-list decision and 2.8's regex-
// widening decision): the bash original's `${BASH_REMATCH[0]}` interpolation in its
// deny message is CORRUPTED whenever `.somi/config.json`'s `dep_install.allow` is
// configured (non-empty) and the command is denied via a non-compound path. Root
// cause, confirmed by isolated repro: `$BASH_REMATCH` is a bash GLOBAL, not scoped to
// the `[[ "$CMD" =~ $pattern ]]` test that finds the real match — `config_allows_dep`'s
// own internal `[[ "$tok" =~ ^(install|i|add|get|require)$ ]]` verb-detection test
// (run once `allow` is non-empty and the command isn't compound, i.e. on every
// allow-list-configured deny that reaches the token loop) OVERWRITES it as a side
// effect. By the time `somi::deny_pretool` reads `${BASH_REMATCH[0]}`, it holds the
// bare verb word ("install"/"i"/"add"/"get"/"require") from that internal test, not
// the actual matched command — e.g. `npm install lodash` denied under
// `{"dep_install":{"allow":["@types/"]}}` shows `` `install` `` in the bash original's
// message, not `` `npm install lodash` ``. Verified with a standalone bash repro
// (isolated from the hook, tracing `$BASH_REMATCH` before/after the verb loop) before
// concluding this, not inferred. The COMPOUND-command path is unaffected (its checks
// use `[[ == ]]` glob comparisons, never `=~`, so it returns before ever touching
// `$BASH_REMATCH` — confirmed by differential probe, zero divergence there).
// This corrupted text is NOT reproduced here. Reasons: (1) no fixture in
// `tests/hooks/cases/gate-dep-install.json` asserts `expect_reason` at all, so no
// pinned contract is broken; (2) D2's behavior-preservation contract is scoped to
// "identical exit codes and stdout SHAPES" (decisions.md D2) — the shape is identical,
// only this one interpolated substring's content differs, and only on an untested
// path; (3) reproducing it would mean deliberately shipping a message that names the
// wrong thing as "the dependency" in a security-relevant, audit-logged, user-facing
// deny reason — strictly worse for the human/agent reading it, not a feature. This
// port always interpolates the REAL `DEP_ADD_PATTERNS` match (`m[0]` from the outer
// `matchesAny` call, captured once and never touched by `configAllowsDep`), for every
// deny path, allow-list-configured or not. Flagged here and in the diary for explicit
// reviewer sign-off, per this iteration's "verify precisely, do not simplify or
// improve" instruction for `config_allows_dep` — this is the one place a literal
// bug-for-bug port was deliberately NOT chosen, named rather than silent.
import { readPayload, field, denyPretool, audit, matchesAny, runHook, config } from '../lib/common.mjs';

// Patterns for "add a new dependency". A trailing package argument is required;
// bare `<pm> install` (no package) is the lockfile-respecting form and is fine.
const DEP_ADD_PATTERNS = [
  // npm / yarn / pnpm / bun: install with at least one positional package
  /npm\s+(install|i|add)\s+([^-][^\s]*|--save\s+[^\s]+|--save-dev\s+[^\s]+)/,
  /yarn\s+add\s+[^-][^\s]*/,
  /pnpm\s+(add|install)\s+[^-][^\s]*/,
  /bun\s+(add|install)\s+[^-][^\s]*/,

  // python: pip / pipx / uv / poetry / conda
  /pip[0-9]*\s+install\s+([^-][^\s]*|-r\s+[^\s]+\.txt)/,
  /pip[0-9]*\s+install\s+--upgrade\s+[^-][^\s]*/,
  /pipx\s+install\s+[^-][^\s]*/,
  /uv\s+(add|pip\s+install)\s+[^-][^\s]*/,
  /poetry\s+add\s+[^-][^\s]*/,
  /conda\s+install\s+[^-][^\s]*/,

  // rust / go / ruby / php
  /cargo\s+(add|install)\s+[^-][^\s]*/,
  /go\s+get\s+[^-][^\s]*/,
  /go\s+install\s+[^-][^\s]*/,
  /gem\s+install\s+[^-][^\s]*/,
  /bundle\s+add\s+[^-][^\s]*/,
  /composer\s+(require|install)\s+[^-][^\s]*/,

  // generic curl-to-installer (`brew install` is borderline; install scripts often add tools).
  /brew\s+install\s+[^-][^\s]*/,
  /apt\s+(install|add)\s+[^-][^\s]*/,
  /apt-get\s+install\s+[^-][^\s]*/,
];

// Verb-detection alternation, matched as a FULL-token match (`^...$`), never a
// substring — mirrors bash's `[[ "$tok" =~ ^(install|i|add|get|require)$ ]]`.
const VERB_RE = /^(install|i|add|get|require)$/;

// Splits on runs of whitespace only — see the header's TOKENIZATION note for why
// bash's incidental glob-expansion side effect is deliberately not reproduced.
function tokensAfterVerb(cmd) {
  const words = cmd.split(/\s+/).filter(Boolean);
  const toks = [];
  let seenVerb = false;
  for (const tok of words) {
    if (seenVerb) {
      if (tok.startsWith('-')) continue;
      toks.push(tok);
    } else if (VERB_RE.test(tok)) {
      seenVerb = true;
    }
  }
  return toks;
}

// Per-project allowlist from .somi/config.json (`dep_install.allow`) — committed,
// reviewable policy, scoped to name prefixes, unlike the all-or-nothing env opt-in.
// An entry is a PREFIX of a package argument: "@types/" allows `npm install
// @types/node`. Conservative by construction: compound commands (`;`, `&`, `|`)
// never qualify, and EVERY package token must match an entry. See the header's
// COMPOUND-COMMAND REFUSAL note.
function configAllowsDep(cmd) {
  const allow = config('.dep_install.allow[]?');
  if (allow.length === 0) return false;
  if (cmd.includes(';') || cmd.includes('&') || cmd.includes('|')) return false;

  const toks = tokensAfterVerb(cmd);
  if (toks.length === 0) return false;

  return toks.every((t) => allow.some((a) => t.startsWith(a)));
}

function main() {
  const payload = readPayload();
  const cmd = field(payload, '.tool_input.command');
  if (!cmd) return;

  // Explicit opt-in: human acknowledged this session may add deps. See the header's
  // SOMI_ALLOW_DEP_INSTALL note for why this direct comparison is an exact bash
  // equivalent, not an approximation.
  if (process.env.SOMI_ALLOW_DEP_INSTALL === '1') return;

  const m = matchesAny(cmd, DEP_ADD_PATTERNS);
  if (!m) return;

  if (configAllowsDep(cmd)) {
    audit(payload, 'ALLOW', `dep install permitted by .somi/config.json dep_install.allow: ${cmd}`);
    return;
  }

  denyPretool(payload, `somi refused this command: it would add a new dependency (\`${m[0]}\`).
Adding a dep is a decision — record it in \`.somi/plans/<slug>/decisions.md\` (or surface it in
the iteration summary for the human) and re-run with \`SOMI_ALLOW_DEP_INSTALL=1\` in the
environment for this session, or have the human run the install themselves. Projects can also
allowlist package-name prefixes in \`.somi/config.json\` under \`dep_install.allow\`.
Lockfile-respecting reinstalls (bare \`npm install\` / \`pip install -r requirements.txt\`-less,
\`bundle install\`, etc.) are allowed without acknowledgement.`);
}

runHook(main);
