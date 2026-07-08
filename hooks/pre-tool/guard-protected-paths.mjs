#!/usr/bin/env node
// hooks/pre-tool/guard-protected-paths.mjs — PreToolUse hook (matcher: Write|Edit) — block
// writes to paths the agent shouldn't be editing.
//
// Node port of hooks/pre-tool/guard-protected-paths.sh (node-runtime-port, phase 2,
// iteration 2.3). Imports the shared read/deny/config helpers from ../lib/common.mjs (2.1,
// reviewer-blessed) rather than reimplementing them.
//
// Targets the most common "agent overstep" cases: .git internals, vendored deps, build
// outputs, and the SOMI plugin install (so an agent doesn't rewrite its own ruleset under
// itself). Lockfile writes are blocked by default (use `npm install <pkg>` etc instead), but a
// project can opt out via SOMI_ALLOW_LOCKFILES=1 or .somi/config.json's `lockfiles.allow_edit`.
//
// --- glob translation (bash `shopt -s extglob` -> JS) --------------------------------------
// PROTECTED_GLOBS is grepped exhaustively from guard-protected-paths.sh: every entry uses ONLY
// the plain `*` wildcard — no `?`, no `[...]` bracket expressions, no extglob operator
// (`@()`/`+()`/`!()`/etc). `shopt -s extglob` is enabled in the bash original but nothing in
// this pattern set actually exercises extglob syntax, so globToRegExp() below is deliberately
// scoped to `*`-only translation, not a general fnmatch engine.
//   - `*` -> `[\s\S]*`, NOT `.*`. `[[ str == pattern ]]` is bash's plain pattern matching (no
//     FNM_PATHNAME), so `*` matches `/` AND newlines — verified empirically:
//     `[[ $'a\nb' == a*b ]]` is true, and `[[ "/x/node_modules/y" == */node_modules/* ]]` is
//     true (crosses the `/`). JS `.` excludes `\n` (and, without `/s`, `\r`/U+2028/U+2029) — the
//     same class of divergence block-secret-writes.mjs (2.2) flagged for ERE `.` vs JS `.`, here
//     applied to glob `*`. `[\s\S]*` matches every character unconditionally, closing the gap.
//   - Literal segments (`.git`, `node_modules`, ...) are regex-escaped. `.` has no special
//     meaning in glob/fnmatch syntax (unlike ERE, where it's "any char") — escaping it prevents
//     a literal `.git` segment from silently becoming a regex wildcard.
//   - Whole pattern is anchored `^...$`: `[[ str == pattern ]]` matches the ENTIRE string, not a
//     substring — distinct from block-dangerous-bash.sh's `=~` (substring search). The leading/
//     trailing `*` in each pattern is what makes "anywhere in the path" work; the match itself
//     is still full-string.
//
// --- lockfile-gate precedence reconciliation ------------------------------------------------
// Precedence: SOMI_ALLOW_LOCKFILES (env, session override, even "0") > .somi/config.json's
// `lockfiles.allow_edit` (committed project policy) > default deny. scripts/somi-check.mjs's
// lockfilesAllowed() (1.3, reviewer-blessed) already solved this exact precedence problem,
// including the jq-text string-vs-boolean subtlety: bash's `somi::config` shells out to
// `jq -r`, so a config author writing `"allow_edit": "true"` (a JSON STRING) produces the
// identical jq -r output ("true") as `"allow_edit": true` (the boolean) — both are honored as
// allowed. common.mjs's config() (2.1) already reproduces that jq -r text shape for scalar
// reads (returns '' for null/undefined/false, else the string itself or JSON.stringify(cur) for
// a non-string scalar), so `config('.lockfiles.allow_edit') === 'true'` below reproduces the
// SAME text comparison bash performs, without re-implementing a config reader the way
// somi-check.mjs (which predates common.mjs) had to. Env-side fall-through matches too: bash's
// `${SOMI_ALLOW_LOCKFILES:-}` treats unset AND explicitly-empty (`SOMI_ALLOW_LOCKFILES=""`)
// identically (falls through to the config check); the `env !== undefined && env !== ''` guard
// below reproduces that, matching lockfilesAllowed()'s own env branch. Verified by hand-tracing
// every fixture case plus the differential probes (see diary).
//
// --- platform reasoning (posix vs win32) ----------------------------------------------------
// This is the "path-heavier hook" block-secret-writes.mjs's header warned 2.3+ to reason
// through explicitly — its own divergence there was Windows-SAFER; here one of them is not:
//   1. PROTECTED_GLOBS are forward-slash literals (`*/node_modules/*`). If `tool_input.file_path`
//      ever arrives with backslash separators (a native-Windows path not already normalized to
//      forward slashes upstream), the translated regex requires a literal `/` and will NOT match
//      a `\`-separated path — a protected write could slip through undenied. This reproduces the
//      bash original's identical gap (its globs were just as forward-slash-only) rather than
//      introducing a new one; documented per this iteration's brief, not fixed — fixing would
//      mean choosing a separator-normalization policy this behavior-preserving port doesn't own.
//   2. The relative-path check (`pathInput.startsWith('/')`) hardcodes a literal POSIX leading-
//      `/` test, deliberately NOT `path.isAbsolute()` (platform-aware; would treat `C:\...` as
//      absolute on win32) — this mirrors bash's own `[[ "$PATH_INPUT" != /* ]]` glob-prefix test
//      byte-for-byte. A Windows-style absolute path would be misclassified as relative and get
//      the project root prepended — the same failure bash's own check would have on such input
//      (bash never ran natively on Windows either, so this is not a new gap either).
//   3. `path.basename()` (platform-default: posix on Linux, win32 on Windows) is used for the
//      lockfile-name comparison. Unlike (1), this divergence is SAFE: win32's basename
//      recognizes BOTH `/` and `\` as separators (documented Node behavior), so on Windows it is
//      a superset of bash's posix-only basename — never narrower. Same conclusion class as
//      block-secret-writes.mjs's own basename note, on the safe side here too.

import path from 'node:path';
import { readPayload, field, denyPretool, runHook, projectRoot, config } from '../lib/common.mjs';

const PROTECTED_GLOBS = [
  // Source-control internals.
  '*/.git/*',

  // SOMI plugin install — never let an agent rewrite the ruleset under itself.
  '*/.claude/plugins/somi/*',

  // Vendored deps & build outputs.
  '*/node_modules/*',
  '*/vendor/*',
  '*/dist/*',
  '*/build/*',
  '*/target/*',
  '*/.next/*',
  '*/.nuxt/*',
  '*/__pycache__/*',
];

const LOCKFILES = [
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
  'Gemfile.lock',
  'poetry.lock',
  'uv.lock',
  'composer.lock',
  'go.sum',
];

// See the glob-translation notes in the header comment.
function globToRegExp(glob) {
  const body = glob
    .split('*')
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\S]*');
  return new RegExp(`^${body}$`);
}

const PROTECTED_PATTERNS = PROTECTED_GLOBS.map((glob) => ({ glob, re: globToRegExp(glob) }));

// See the lockfile-gate reconciliation notes in the header comment.
function lockfilesAllowed() {
  const env = process.env.SOMI_ALLOW_LOCKFILES;
  if (env !== undefined && env !== '') return env === '1';
  return config('.lockfiles.allow_edit') === 'true';
}

function main() {
  const payload = readPayload();
  const tool = field(payload, '.tool_name');
  let pathInput = field(payload, '.tool_input.file_path');
  if (!pathInput) return;

  // Normalise relative paths so the leading-`*/` globs above still match (a relative
  // `node_modules/x.js` would otherwise slip past `*/node_modules/*`). Reuses common.mjs's
  // projectRoot() — the centralized ${...}-unexpanded-variable guard (2.1) — rather than
  // re-duplicating it here.
  if (!pathInput.startsWith('/')) {
    pathInput = `${projectRoot()}/${pathInput}`;
  }

  for (const { glob, re } of PROTECTED_PATTERNS) {
    if (re.test(pathInput)) {
      denyPretool(payload, `somi refused to ${tool} \`${pathInput}\`: this path matches a protected glob (\`${glob}\`).
These paths are owned by tooling (git / package managers / SOMI itself); changes belong in their respective workflows.`);
    }
  }

  // Lockfile gate. Precedence: env (session override, even "0") > .somi/config.json
  // (`lockfiles.allow_edit`, committed project policy) > default (deny).
  if (!lockfilesAllowed()) {
    const basename = path.basename(pathInput);
    if (LOCKFILES.includes(basename)) {
      denyPretool(payload, `somi refused to ${tool} \`${pathInput}\`: lockfiles should be regenerated by the package manager, not hand-edited.
If you genuinely need to hand-edit this lockfile, set SOMI_ALLOW_LOCKFILES=1 in your environment
for this session (or set \`lockfiles.allow_edit: true\` in \`.somi/config.json\` as project policy).`);
    }
  }
}

runHook(main);
