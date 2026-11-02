#!/usr/bin/env node
// hooks/pre-tool/guard-protected-paths.mjs — PreToolUse hook (matcher: Write|Edit|MultiEdit|NotebookEdit) — block
// writes to paths the agent shouldn't be editing.
//
// Imports the shared read/deny/config helpers from ../lib/common.mjs rather than
// reimplementing them.
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
//     same class of divergence block-secret-writes.mjs flagged for ERE `.` vs JS `.`, here
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
// lockfilesAllowed() already solved this exact precedence problem,
// including the jq-text string-vs-boolean subtlety: bash's `somi::config` shells out to
// `jq -r`, so a config author writing `"allow_edit": "true"` (a JSON STRING) produces the
// identical jq -r output ("true") as `"allow_edit": true` (the boolean) — both are honored as
// allowed. common.mjs's config() already reproduces that jq -r text shape for scalar
// reads (returns '' for null/undefined/false, else the string itself or JSON.stringify(cur) for
// a non-string scalar), so `config('.lockfiles.allow_edit') === 'true'` below reproduces the
// SAME text comparison bash performs, without re-implementing a config reader the way
// somi-check.mjs (which predates common.mjs) had to. Env-side fall-through matches too: bash's
// `${SOMI_ALLOW_LOCKFILES:-}` treats unset AND explicitly-empty (`SOMI_ALLOW_LOCKFILES=""`)
// identically (falls through to the config check); the `env !== undefined && env !== ''` guard
// below reproduces that, matching lockfilesAllowed()'s own env branch.
//
// --- platform reasoning (posix vs win32) ----------------------------------------------------
// This is the "path-heavier hook" block-secret-writes.mjs's header warned later hooks to reason
// through explicitly. checkPath() turns the target into one canonical forward-slash string
// before any glob sees it:
//   1. Backslashes become `/`, so a native-Windows `.git\config` or `C:\proj\.git\config` meets
//      the same forward-slash globs. On POSIX a backslash is a legal filename character, so this
//      can only over-match (a file literally named `a\b` is read as `a/b`), never under-match.
//   2. A path is absolute if it starts with `/` or a drive letter (`C:/`); anything else is
//      joined to projectRoot() (also slash-converted). The test is a literal one, deliberately
//      not `path.isAbsolute()`, so the result does not depend on the platform running the hook.
//   3. path.posix.normalize() then collapses `..`, `.` and `//`, so `.somi/plans/../somi-state/
//      loop/x` cannot hide from a glob. A drive-letter path is normalized as it stands: posix
//      resolve() would take it for a relative path and prefix the current directory.
//   4. Climbing past a drive root (`a:/../.git/config`) leaves a relative result, which no `*/`-led
//      glob matches; a result that is neither `/`-led nor drive-led gets a leading `/`.
//   5. `path.basename()` for the lockfile-name comparison runs on that canonical string.
// Case: the `.git`, `.somi` and `.claude` globs match case-insensitively, as a case-insensitive file
// system (macOS, Windows) resolves `.GIT` to the same directory. The vendored-output globs do not.
// Not covered: Windows 8.3 short names (`PROGRA~1`), and the Windows behavior is tested on Linux only.

import path from 'node:path';
import { readPayload, field, denyPretool, runHook, projectRoot, config, writeTargets } from '../lib/common.mjs';

const PROTECTED_GLOBS = [
  // Source-control internals.
  '*/.git/*',

  // SOMI plugin install — never let an agent rewrite the ruleset under itself.
  '*/.claude/plugins/somi/*',

  // The sizing CLI's records (scripts/somi-tier.mjs): they gate the brief-only path, so only the
  // CLI writes them, never an agent's Write/Edit.
  '*/.somi/somi-state/tier/*',

  // The loop's state and the run budget's (scripts/somi-loop.mjs, scripts/lib/run-budget.mjs): the loop's
  // scripts write them from node, which no hook sees, so only an agent's Write/Edit is refused.
  '*/.somi/somi-state/loop/*',
  '*/.somi/somi-state/run/*',

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
function globToRegExp(glob, flags) {
  const body = glob
    .split('*')
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\s\\S]*');
  return new RegExp(`^${body}$`, flags);
}

// The globs naming a directory the agent must not even replace with a file (`.git` is a worktree's pointer file).
// A trailing-slash retest checks the path itself, not just paths under it; the vendored-output globs are left
// out, since a file named `build` or `vendor` anywhere is ordinary.
const OWN_PATH_GLOBS = new Set(['*/.git/*', '*/.claude/plugins/somi/*', '*/.somi/somi-state/tier/*', '*/.somi/somi-state/loop/*', '*/.somi/somi-state/run/*']);
const CASE_FOLDED = /\/\.(git|somi|claude)\//;

const PROTECTED_PATTERNS = PROTECTED_GLOBS.map((glob) => ({ glob, re: globToRegExp(glob, CASE_FOLDED.test(glob) ? 'i' : ''), own: OWN_PATH_GLOBS.has(glob) }));

// See the lockfile-gate reconciliation notes in the header comment.
function lockfilesAllowed() {
  const env = process.env.SOMI_ALLOW_LOCKFILES;
  if (env !== undefined && env !== '') return env === '1';
  return config('.lockfiles.allow_edit') === 'true';
}

function main() {
  const payload = readPayload();
  const tool = field(payload, '.tool_name');
  const { paths, known } = writeTargets(payload);
  if (!known) {
    denyPretool(payload, `somi refused to ${tool}: it could not tell which file this writes, so the protected-path guard cannot check it.`);
  }
  for (const target of paths) checkPath(payload, tool, target);
}

const ABSOLUTE = /^(\/|[A-Za-z]:\/)/;
const slashes = (p) => p.replace(/\\/g, '/');

// Where to send the agent instead, for the paths that tooling writes through a CLI.
function nextStep(glob) {
  if (glob.includes('/somi-state/tier/')) return 'Tier records are written by `node scripts/somi-tier.mjs`; change them through it.';
  if (glob.includes('/somi-state/')) return 'Loop and run state are written by the loop CLI (`node scripts/somi-loop.mjs`, or `somi-loop.mjs step`); change them through that.';
  return '';
}

function checkPath(payload, tool, target) {
  // One canonical string before any glob sees the path: forward slashes, joined to the project root when
  // relative (projectRoot() is the centralized ${...}-unexpanded-variable guard), `..`, `.` and `//` collapsed.
  // See the platform notes in the header comment.
  const t = slashes(target);
  const normal = path.posix.normalize(ABSOLUTE.test(t) ? t : `${slashes(projectRoot())}/${t}`);
  const pathInput = ABSOLUTE.test(normal) ? normal : `/${normal}`; // see note 4 in the header

  for (const { glob, re, own } of PROTECTED_PATTERNS) {
    // The trailing-slash form catches a write at a protected directory's own path (`.git` as a worktree's
    // pointer file, `.somi/somi-state/loop`), which the globs' `/*` would otherwise need a child for.
    if (re.test(pathInput) || (own && re.test(`${pathInput}/`))) {
      const next = nextStep(glob);
      denyPretool(payload, `somi refused to ${tool} \`${pathInput}\`: this path matches a protected glob (\`${glob}\`).
These paths are owned by tooling (git / package managers / SOMI itself); changes belong in their respective workflows.${next ? `\n${next}` : ''}`);
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
