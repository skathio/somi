#!/usr/bin/env node
// hooks/pre-tool/block-dangerous-bash.mjs — PreToolUse hook (matcher: Bash) — block clearly
// dangerous shell commands.
//
// Node port of hooks/pre-tool/block-dangerous-bash.sh (node-runtime-port, phase 2,
// iteration 2.9 — the work item's named highest-risk file, brief.md §3/§8). Imports the
// shared read/deny/matching helpers from ../lib/common.mjs (2.1, reviewer-blessed)
// rather than reimplementing them.
//
// This is a deterministic guardrail, not a policy debate. It catches the
// common-and-catastrophic class of mistakes; nuanced cases are the human's call. Block
// list focuses on irreversible / system-destructive / supply-chain shapes, plus
// shell-level writes to secret-bearing paths — the Bash-side complement of
// block-secret-writes.mjs (2.2), whose Write|Edit matcher a redirect / tee / sed -i /
// cp / mv would otherwise bypass entirely. Intentionally conservative — false positives
// cost less than false negatives here.
//
// COUNT CORRECTION (verified by direct read — `awk` over the array literal, not
// inherited from the phase file's/brief's stated "19"): the bash original's
// DANGEROUS_PATTERNS array holds 23 case-sensitive patterns, not 19 — same class of
// miscount 2.4 found and corrected for DEP_ADD_PATTERNS (18→19), just larger here. All
// 23 are ported below, plus the 5 case-insensitive SQL patterns (that count IS
// accurate) and the 4 secret-write patterns. "Port ALL of the patterns" wins over an
// inherited miscount, per 2.4's precedent; phases/02-hooks-port.md's iteration-2.9 scope
// line is corrected alongside this port (see the diary entry for this pass).
//
// ERE→RegExp translation rules applied uniformly (verified pattern-by-pattern, not by a
// blanket find-and-replace across the whole set — every one of the 23+5+4 patterns
// below was hand-translated and carries its own bash line reference):
//   [[:space:]]   → \s        POSIX space class → JS \s, POSITIVE (non-negated) form
//                              ONLY — see the negated-form entry below, which is NOT the
//                              same argument. POSIX [[:space:]] is exactly the 6 ASCII
//                              whitespace bytes (space/tab/LF/CR/FF/VT); JS \s is a
//                              strict SUPERSET (adds Unicode whitespace: NBSP,
//                              U+2028/U+2029, U+FEFF, other Zs). A wider POSITIVE \s can
//                              only make this hook MATCH (and therefore block) a
//                              broader set of verb/argument separators than bash would —
//                              over-gating, never under-gating. Same argument 2.4 made
//                              for gate-dep-install, and it is sound for this direction.
//   [^[:space:]]  → [^ \t\n\r\f\v]   NOT [^\s] (F-40, Major, fixed at 2.9 pass 2 after
//                              the security review caught it — a prior version of this
//                              file used [^\s] here and was WRONG). Negation INVERTS the
//                              superset relationship above: \s ⊋ [[:space:]] means
//                              [^\s] ⊊ [^[:space:]] — the negated JS class matches FEWER
//                              characters than bash's negated POSIX class, so a pattern
//                              built from [^\s] stops (and fails to reach a required
//                              literal further on) at a byte bash's [^[:space:]] would
//                              happily consume — an UNDER-gate, the unsafe direction for
//                              a security guard. Concrete, re-derived case: NBSP
//                              (U+00A0) IS in JS's \s (so it's EXCLUDED from [^\s]) but
//                              is NOT one of POSIX [[:space:]]'s 6 ASCII bytes (so it's
//                              INCLUDED in bash's [^[:space:]]) — verified live both
//                              directions: bash's `service-account[^[:space:]]*\.json`
//                              matches THROUGH a literal NBSP byte onto `.json`
//                              (BASH_REMATCH confirms the full path); the buggy
//                              `service-account[^\s]*\.json` stopped before the NBSP and
//                              never reached `.json`, so the whole pattern failed to
//                              match — a real deny→allow gap on a crafted filename.
//                              Every negated occurrence below now uses the explicit
//                              POSIX-C byte class [^ \t\n\r\f\v] (the literal 6 ASCII
//                              whitespace bytes, negated, with zero Unicode awareness to
//                              accidentally invert) instead of \s's Unicode-aware
//                              negation.
//   \+            → \+        ERE escaped '+' (LITERAL plus character, used in the
//                              +refspec force-push patterns, e.g. `git push origin
//                              +main`) → JS escaped '+' (also a literal). Both engines
//                              treat a bare, unescaped '+' as the one-or-more
//                              quantifier and require the backslash to mean "the
//                              character +" — identical escaping convention, so this is
//                              a direct 1:1 port, not a translation.
//   +             → +         ERE one-or-more quantifier → JS one-or-more quantifier,
//                              unescaped in both. (The two '+' meanings above — literal
//                              vs quantifier — are what this file's scope note flags as
//                              needing care; verified per-occurrence below, not
//                              conflated.)
//   \*  \$  \.    → \*  \$  \. ERE escaped literal metacharacters → identical JS
//                              escapes; both require the backslash for "the literal
//                              character", not "zero-or-more of the preceding" / "end
//                              of string" / "any character".
//   (a|b)  {1,2}  → identical  Byte-identical alternation and interval-quantifier
//                              syntax in both engines.
//
// DOT-SEMANTICS CAVEAT — LIVE HERE (unlike block-secret-writes.mjs/gate-dep-install.mjs,
// where the same caveat was checked and found inert because those files only ever
// match basenames or already-tokenized argument text, never raw command-string content).
//
// RE-DERIVED AT 2.9 PASS 2 (F-39, Blocker) — the paragraph that used to sit here claimed
// "POSIX ERE '.' matches every byte except '\n'" and translated '.*' to '[^\n]*'. That
// claim is WRONG for what this file actually needs: it is grep/awk-with-REG_NEWLINE
// semantics, not bash `[[ =~ ]]` semantics, and the security review caught the gap it
// produced. Re-derived from first principles, not restated:
//
// bash's `[[ "$c" =~ $pattern ]]` calls glibc `regexec()` WITHOUT the `REG_NEWLINE`
// flag. REG_NEWLINE is what makes '.' refuse a newline (and makes '^'/'$' match at
// internal line boundaries) in POSIX regex — WITHOUT it, '.' matches ANY single byte at
// all, '\n' included. Verified live, not assumed: `[[ $'a\nb' =~ ^a.b$ ]]` MATCHES in a
// real bash 5.2 shell. So every bare '.'/'.*' in bash's DANGEROUS_PATTERNS spans
// embedded newlines freely — the opposite of what the old comment here claimed.
//
// The correct translation is "match every character, no exclusions at all" — JS `[^]`
// (a negated character class with an EMPTY exclusion set is a well-known idiom meaning
// "matches anything", equivalent to `[\s\S]`), NOT `[^\n]`. Every bare '.'/'.*' in the
// bash source (patterns #7, #13, #14, #21, #22, #23 below) is translated to `[^]`/`[^]*`.
// The wrong `[^\n]*` translation made node's matched set a strict SUBSET of bash's — an
// UNDER-gate, confirmed exploitable: `git commit -m "fix\n\nbody" --no-verify` is DENIED
// by bash's `git commit .*--no-verify` (the `.*` crosses the embedded newline to reach
// `--no-verify`) but was silently ALLOWED by `[^\n]*` (which cannot cross the newline) —
// `--no-verify` disables somi's own commit/push safety hooks, and multi-line commit
// messages are completely routine, so this was a live gap, not a theoretical one. A CR
// (not LF) embedded in the same position happens to still be excluded by `[^\n]` too
// (CR isn't `\n`), which is why the pass-1 CR-embedded regression probes passed and gave
// false confidence — LF was the actual break, and pass 1 had no LF fixture.
//
// Every other '.' in this file is an ESCAPED '\.' (a literal dot character, e.g.
// `mkfs\.`), unaffected by this caveat in either engine — checked by hand per
// occurrence, not assumed.
//
// Patterns are built via `new RegExp(String.raw\`...\`)` rather than `/.../ ` literals:
// most of this file's patterns contain a bare `/` (filesystem paths, `/dev/...`,
// `origin/`), and String.raw's un-escaped backslash handling reads far more directly
// against the bash ERE source strings than a literal would once every `/` is escaped
// to `\/`. No pattern here uses a backtick or `${`, so String.raw is safe throughout.
//
// SECRET_WRITE_PATTERNS mirrors block-secret-writes.mjs's SECRET_PATTERNS set
// (block-secret-writes.mjs's SECRET_PATTERNS / block-dangerous-bash.sh:86) — "kept in
// sync by comment convention, not code sharing" today (context.md §2). Preserved as a
// deliberate duplication in this port; do not unify the two lists — that would be a
// scope-creeping refactor beyond this behavior-preserving port (same convention 2.2
// already flagged as a future-refactor target).
//
// check_secret_writes' capture-before-internal-test discipline is preserved exactly
// (see checkSecretWrites below): the matched substring is read into a local `matched`
// BEFORE the exception regex is tested against it, mirroring bash's own comment at
// block-dangerous-bash.sh:121-122 ("Capture the match first: the exception's own =~
// resets BASH_REMATCH") — the analogous JS hazard (a shared/global match result) does
// not exist here since every match lives in its own local variable, but the ordering
// discipline is kept anyway, verbatim, so a future edit to this file can't reintroduce
// bash's exact failure shape by reordering the two statements.
//
// The bare-force-push check (checkBareForcePush) is NOT a regex port — it is bash's
// own small procedural token-walk (block-dangerous-bash.sh:139-164), ported as an
// algorithm: split the command tail on whitespace, count non-flag tokens, detect a
// bare HEAD as the 2nd non-flag token. See its own comment below for the full mapping.
//
// Deny-message interpolation: bash's `${BASH_REMATCH[0]}` → this port's `m[0]`/`matched`
// (the RegExpExecArray's full-match element, returned by common.mjs's matchesAny /
// matchesAnyNocase, or from a direct `.exec()` call in checkSecretWrites).

import {
  readPayload,
  field,
  denyPretool,
  matchesAny,
  matchesAnyNocase,
  runHook,
} from '../lib/common.mjs';

// Case-sensitive patterns (block-dangerous-bash.sh:36-73, 23 entries — see the
// COUNT CORRECTION note above).
const DANGEROUS_PATTERNS = [
  // filesystem nukes (bash:38-42)
  new RegExp(String.raw`rm\s+-rf?\s+/(\s|$)`), // #1
  new RegExp(String.raw`rm\s+-rf?\s+~(\s|/|$)`), // #2
  new RegExp(String.raw`rm\s+-rf?\s+\*`), // #3
  new RegExp(String.raw`rm\s+-rf?\s+\$HOME`), // #4
  new RegExp(String.raw`:\(\)\{\s*:\|:&\s*\};:`), // #5 fork bomb

  // device / partition writes (bash:45-47)
  new RegExp(String.raw`>\s*/dev/(sd[a-z]|nvme|hd[a-z]|disk)`), // #6
  new RegExp(String.raw`dd\s+if=[^]*\s+of=/dev/(sd[a-z]|nvme|hd[a-z]|disk)`), // #7 dot-semantics: .*→[^]* (F-39)
  new RegExp(String.raw`mkfs(\.|\s)`), // #8

  // supply-chain / remote-exec one-liners (bash:50-53)
  new RegExp(String.raw`curl\s+[^|]*\|\s*(sudo\s+)?(ba)?sh`), // #9
  new RegExp(String.raw`wget\s+[^|]*\|\s*(sudo\s+)?(ba)?sh`), // #10
  new RegExp(String.raw`curl\s+[^|]*\|\s*python[0-9]*`), // #11
  new RegExp(String.raw`wget\s+[^|]*\|\s*python[0-9]*`), // #12

  // destructive git ops on protected branches (bash:57-64). Covers --force, -f,
  // --force-with-lease (with or without =value), and refspec form (origin HEAD:main).
  new RegExp(String.raw`git\s+push\s+(-{1,2}force|-f)([\s=]|$)[^]*[\s:](main|master|trunk|release)(\s|$)`), // #13 dot-semantics (F-39)
  new RegExp(String.raw`git\s+push\s+--force-with-lease([\s=][^ \t\n\r\f\v]*)?\s[^]*[\s:](main|master|trunk|release)(\s|$)`), // #14 dot-semantics + negated-class (F-39, F-40)
  // force-push via +refspec — no --force flag involved (`git push origin +main`, `+HEAD:main`)
  new RegExp(String.raw`git\s+push\s+[^;&|]*\s\+(main|master|trunk|release)([\s:]|$)`), // #15
  new RegExp(String.raw`git\s+push\s+[^;&|]*\s\+[^ \t\n\r\f\v]*:(main|master|trunk|release)(\s|$)`), // #16 negated-class (F-40)
  new RegExp(String.raw`git\s+branch\s+-D\s+(main|master|trunk)`), // #17
  new RegExp(String.raw`git\s+reset\s+--hard\s+(origin/)?(main|master|trunk)`), // #18
  new RegExp(String.raw`git\s+clean\s+-[fdx]+\s`), // #19

  // process / permission ops (bash:67-68)
  new RegExp(String.raw`chmod\s+-R\s+777\s+/`), // #20
  new RegExp(String.raw`chown\s+-R\s+[^]*\s+/`), // #21 dot-semantics: .*→[^]* (F-39)

  // skipping safety checks (only block when used in commit/push context) (bash:71-72)
  new RegExp(String.raw`git\s+commit\s+[^]*--no-verify`), // #22 dot-semantics (F-39)
  new RegExp(String.raw`git\s+push\s+[^]*--no-verify`), // #23 dot-semantics (F-39)
];

// Case-insensitive patterns (bash:76-82, 5 entries — SQL keywords arrive lowercase
// from ORM logs, mixed case from REPLs). No /i here: matchesAnyNocase (common.mjs)
// owns the case-insensitivity flag, per its documented contract — mirrors bash's own
// mechanism, where `shopt -s nocasematch` is an ambient property of the match
// operation, not a per-pattern annotation.
// DISCOVERED DIVERGENCE, found and fixed, not shipped as a known gap (empirical, not
// theoretical — reproduced with the real bash binary before concluding anything):
// POSIX ERE ([[ =~ ]]) uses LEFTMOST-LONGEST matching for alternation; JS regex uses
// leftmost-first-successful-alternative (ordered backtracking), which are the SAME
// semantics only when nothing after the group forces a shorter alternative to fail and
// backtrack into a longer one. bash's own source lists this group as
// `(public|prod|production)`, and NOTHING follows the group in the pattern — so for
// input "...production", bash's leftmost-longest picks the full "production" (11
// chars: verified live — `DROP SCHEMA production` under `shopt -s nocasematch` yields
// BASH_REMATCH[0] = "DROP SCHEMA production"), while JS's first-alternative-wins
// backtracking would try "public" (fails), then "prod" (succeeds, 4 chars) and STOP
// there without ever trying "production" — verified live with the untranslated order:
// `/DROP\s+SCHEMA\s+(public|prod|production)/i.exec("DROP SCHEMA production")[0]` →
// `"DROP SCHEMA prod"`, a genuinely shorter, wrong deny-message substring, same
// allow/deny decision either way but a corrupted `permissionDecisionReason`. Fixed by
// reordering the alternation LONGEST-FIRST (`production` before `prod`; `public` has
// no prefix relationship with either, so its position doesn't matter) — this changes
// nothing about WHICH inputs match, only WHICH substring an ambiguous input's match
// reports, restoring exact parity with bash's leftmost-longest result. Audited every
// other alternation group in this file for the same prefix-collision shape (see the
// diary for the full audit): `(main|master|trunk|release)`,
// `(sd[a-z]|nvme|hd[a-z]|disk)`, `(rsa|ed25519|ecdsa|dsa)`,
// `(local|production|prod|staging|secret)` (already longest-first in bash's own
// source), `(-{1,2}force|-f)` (protected by a mandatory boundary character after the
// group, which forces backtracking into the correct longer alternative regardless of
// try-order) — none of these has an unprotected prefix collision; this SQL pattern is
// the only one that needed a fix.
const DANGEROUS_PATTERNS_NOCASE = [
  new RegExp(String.raw`DROP\s+DATABASE`),
  new RegExp(String.raw`DROP\s+SCHEMA\s+(production|public|prod)`),
  new RegExp(String.raw`DROP\s+TABLE\s+[a-zA-Z_]+`),
  new RegExp(String.raw`TRUNCATE\s+(TABLE\s+)?[a-zA-Z_]+`),
  new RegExp(String.raw`DELETE\s+FROM\s+[a-zA-Z_]+\s*;`),
];

// Secret-bearing basename alternation (bash:86). A regex-source FRAGMENT, not a
// standalone pattern — interpolated into each of the 4 SECRET_WRITE_PATTERNS below,
// exactly as bash interpolates `${SECRET_BASENAME}` into 4 array entries.
const SECRET_BASENAME = String.raw`(\.env(\.(local|production|prod|staging|secret))?|id_(rsa|ed25519|ecdsa|dsa)|[^ \t\n\r\f\v]*\.(pem|key|p12|pfx|jks)|[^ \t\n\r\f\v]*(-key|-credentials)\.json|service-account[^ \t\n\r\f\v]*\.json|\.netrc|\.pgpass|[^ \t\n\r\f\v]*secrets?\.(ya?ml|json))`; // negated-class fixed (F-40)

// Shell-level writes to secret paths (bash:90-95): redirection, tee, in-place sed,
// cp/mv onto the target. Matched against the quote-stripped command, same as bash.
const SECRET_WRITE_PATTERNS = [
  new RegExp(String.raw`(>|>>)\s*([^ \t\n\r\f\v]*/)?${SECRET_BASENAME}(\s|$)`),
  new RegExp(String.raw`(^|[\s|;&])tee\s+(-[a-zA-Z]+\s+)*([^ \t\n\r\f\v]*/)?${SECRET_BASENAME}(\s|$)`),
  new RegExp(String.raw`(^|[\s|;&])sed\s+[^|;&]*-i[^|;&]*\s([^ \t\n\r\f\v]*/)?${SECRET_BASENAME}(\s|$)`),
  new RegExp(String.raw`(^|[\s|;&])(cp|mv)\s+[^|;&]*\s([^ \t\n\r\f\v]*/)?${SECRET_BASENAME}(\s|$)`),
]; // negated-class prefix groups fixed (F-40)

// Explicit example/template files are fine — same exception as block-secret-writes.mjs.
const EXAMPLE_ENV_RE = /\.env\.(example|sample|template|dist)/;

function checkDangerous(payload, c) {
  const m = matchesAny(c, DANGEROUS_PATTERNS);
  if (m) {
    denyPretool(
      payload,
      `somi refused this command: it matches a dangerous-shell pattern (\`${m[0]}\`).
If this is genuinely intended, stop and ask the human to run it themselves — never work around this hook silently.`,
    );
  }

  const mNocase = matchesAnyNocase(c, DANGEROUS_PATTERNS_NOCASE);
  if (mNocase) {
    denyPretool(
      payload,
      `somi refused this command: it matches a destructive-SQL pattern (\`${mNocase[0]}\`).
If this is genuinely intended, stop and ask the human to run it themselves — never work around this hook silently.`,
    );
  }
}

// Iterates SECRET_WRITE_PATTERNS directly (not via common.mjs's matchesAny) because
// bash's own loop does something matchesAny's "return the first match" contract can't
// express: on an EXCEPTION match (an explicit .env.example-style path), it `continue`s
// to the NEXT pattern rather than stopping — so a later pattern in the array can still
// deny on the same command (e.g. `sed -i s/x/y/ .env.example && cp .env.backup .env`:
// the sed pattern matches but hits the exception and is skipped; the cp/mv pattern
// then matches the real secret write and denies). Reproduced as a manual loop to keep
// that skip-and-continue behavior exact.
function checkSecretWrites(payload, c) {
  for (const pattern of SECRET_WRITE_PATTERNS) {
    const m = pattern.exec(c);
    if (!m) continue;
    const matched = m[0]; // captured before the exception's own test — see header note
    if (EXAMPLE_ENV_RE.test(matched)) continue;
    denyPretool(
      payload,
      `somi refused this command: it writes to a secret-bearing path via the shell (\`${matched}\`).
Bootstrap secret files by hand, or commit only \`.env.example\`-style templates. This is the
Bash-side twin of the Write/Edit secret guard — do not work around either silently.`,
    );
  }
}

// Force-push without a verifiable target (block-dangerous-bash.sh:133-164). The
// protected-branch patterns above only fire when the branch is named in the command —
// but `git push -f`, `git push -f origin`, and `git push -f origin HEAD` push the
// *current* branch, which this hook cannot resolve (it may well be main). Deny force
// pushes that don't name an explicit target branch; naming it is what makes the
// protected-branch check meaningful.
//
// Gate regex (bash:141) — unchanged translation rules from DANGEROUS_PATTERNS above,
// no dot-semantics concern (no '.'/'.*' in this one):
const BARE_FORCE_PUSH_GATE_RE = new RegExp(
  String.raw`git\s+push(\s+[^;&|]*)?\s(-f|--force(-with-lease(=[^ \t\n\r\f\v]*)?)?)(\s|$)`, // negated-class fixed (F-40)
);

// This is NOT a regex port — bash:144-156 is a small procedural parser (word-split the
// command tail, count non-flag tokens, flag a bare HEAD as the 2nd one). Ported as an
// algorithm, one statement at a time against its bash counterpart:
//
//   bash: after_push="${c#*push}"
//   here: slice everything after the FIRST literal occurrence of "push" in c — `#*push`
//         is bash's SHORTEST-prefix-removal for the glob `*push`, which is exactly
//         "up to and including the first occurrence of the literal substring `push`".
//
//   bash: for tok in $after_push   (IFS word-splitting; bash ALSO performs unquoted
//         pathname/glob expansion here, deliberately NOT reproduced — same judgment
//         call gate-dep-install.mjs's tokensAfterVerb() made (2.4): glob expansion
//         would make the gate's outcome depend on the hook process's cwd/filesystem
//         state, a strictly worse property for a security control, and no realistic
//         git-push argument or fixture exercises it).
//   here: afterPush.split(/\s+/).filter(Boolean)  — whitespace-run splitting only.
//
//   bash: case "$tok" in ';'|'&&'|'||'|'|') break ;; -*) continue ;; esac
//   here: exact-string boundary check, then a leading-'-' check, in the same order.
//
//   bash: nonflag_count++; if 2nd non-flag token is literally "HEAD", set the flag.
//   here: same counters, same 2nd-token check.
//
//   bash: deny if nonflag_count < 2 OR names_bare_head — i.e. fewer than a
//   remote+branch pair was named, or the named "branch" is the ambiguous bare HEAD.
function checkBareForcePush(payload, c) {
  if (!BARE_FORCE_PUSH_GATE_RE.test(c)) return;

  const pushIdx = c.indexOf('push');
  const afterPush = pushIdx === -1 ? '' : c.slice(pushIdx + 'push'.length);
  const tokens = afterPush.split(/\s+/).filter(Boolean);

  let nonFlagCount = 0;
  let namesBareHead = false;
  for (const tok of tokens) {
    if (tok === ';' || tok === '&&' || tok === '||' || tok === '|') break;
    if (tok.startsWith('-')) continue;
    nonFlagCount += 1;
    if (nonFlagCount === 2 && tok === 'HEAD') namesBareHead = true;
  }

  if (nonFlagCount < 2 || namesBareHead) {
    denyPretool(
      payload,
      `somi refused this command: force-push without an explicit target branch (the current branch cannot be verified and may be protected).
Name the remote and branch explicitly — e.g. \`git push --force-with-lease origin feature-x\`.
Force pushes naming main/master/trunk/release are always refused; if this is genuinely
intended, stop and ask the human to run it themselves.`,
    );
  }
}

function main() {
  const payload = readPayload();
  const cmd = field(payload, '.tool_input.command');
  if (!cmd) return;

  // Quote-stripped copy. `bash -c "rm -rf /"` hides the dangerous string inside quotes
  // where the patterns' trailing boundary classes ([\s]|$) don't match. Stripping
  // quote characters never removes dangerous content — it only widens matching — so
  // every check runs against both the raw and the stripped form. False positives are
  // tolerated here by design (bash:27-33).
  const cmdStripped = cmd.replace(/"/g, '').replace(/'/g, '');

  checkDangerous(payload, cmd);
  checkDangerous(payload, cmdStripped);
  checkSecretWrites(payload, cmdStripped);
  checkBareForcePush(payload, cmdStripped);
}

runHook(main);
