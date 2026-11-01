#!/usr/bin/env bash
# Guards scripts/lib/escalation.mjs and escalation-facts.mjs. Runs each test lib, then proves the suite has teeth: every mutation of the module,
# applied to a scratch copy, must turn the test NAMED for it red (a mutant that fails some other way, or not at all, is
# a failure). Hermetic: temp tree only, no network, no model.
set -uo pipefail
umask 022

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT
pass=0; fail=0
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

# run_suite <test lib> <module>: prints the suite's lines, folds its SUMMARY into the totals.
run_suite() {
  local out rc total failed
  out="$(node "$1" "$2" 2>&1)"; rc=$?
  printf '%s\n' "$out" | grep -v '^SUMMARY'
  total="$(printf '%s\n' "$out" | awk '/^SUMMARY/{print $2}')"; failed="$(printf '%s\n' "$out" | awk '/^SUMMARY/{print $3}')"
  pass=$((pass + ${total:-0} - ${failed:-0})); fail=$((fail + ${failed:-1}))
  [ "$rc" = 0 ] || [ "${failed:-1}" -gt 0 ] || fail=$((fail+1))
}

# mutate <test lib> <module> <label> <test it must break> <from> <to>: the first <from> in the module becomes <to>.
mutate() {
  local lib="$1" mod="$2" label="$3" named="$4" mut="${MUT_OUT:-$TMP/mutant-$(basename "$2")}"
  node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const t=s.replace(process.argv[2],()=>process.argv[3]);if(t===s)process.exit(3);fs.writeFileSync(process.argv[4],t)" "$mod" "$5" "$6" "$mut"
  if [ $? != 0 ]; then bad "mutation '$label' did not change the module (stale pattern)"; return; fi
  local out; out="$(node "$lib" "$mut" 2>&1)"
  if grep -qF -- "  FAIL $named" <<<"$out"; then ok "mutation '$label' turns '$named' red"; else bad "mutation '$label' did not turn '$named' red"; fi
}

echo "== escalation =="
ES="$ROOT/scripts/lib/escalation.mjs"; EST="$ROOT/tests/scripts/lib/escalation-tests.mjs"
unset SKIP_DOMAIN  # an inherited value would skip the exhaustive checks on the real run
run_suite "$EST" "$ES"

T_EMPTY='an empty fact set seats only the reviewer'
T_SIZE='size_flag at the line and file edges'
T_WEAK='tests_weakened at net -19 and -20'
T_MOVED='a moved test (a delete plus an add'
T_TWK='tests_weakened raises security and seats the test strategist'
T_MOD='modules at 2 and 3, and one new top directory'
T_STRAT='the test strategist: a large test change'
T_PLAN='the plan and sdlc lenses follow their flags'
T_SENS='every sensitive class name raises security'
T_BOUND='every boundary class name raises security'
T_CONTRACT='a contract or ci class name raises no lens'
T_DENIED='a denied flag, or the deny_list class name'
T_HARD='hard-surface ids: manifest, lockfile'
T_SECLENS='the raising classes and reasons name security'
T_REFUSED='refused input returns the raising result'
T_REFALL='the refused result seats every lens'
T_INTERNAL='an unexpected error in the rules'
T_FROZEN='the registries and constants are frozen'
T_DOM='the monotonicity domain has 55,296 evaluations'
T_MONO='a fact moved one step up never turns off'
T_RMIN='review_min is null or security over the whole domain'
T_TOP='the refused result dominates every result'
# The exhaustive checks cost about two seconds, so the mutants that do not name one of them skip them.
es() { local skip=mutant-run; case "$2" in "$T_DOM"*|"$T_MONO"*|"$T_RMIN"*|"$T_TOP"*) skip= ;; esac; SKIP_DOMAIN=$skip mutate "$EST" "$ES" "$@"; }

# the raise
es 'sensitive class names dropped from the raise' "$T_SENS" '...sensitive.filter((n) => n !== DENY).map((n) => `sensitive:${n}`),' ''
es 'boundary class names dropped from the raise' "$T_BOUND" '...boundary.filter((n) => n !== DENY).map((n) => `boundary:${n}`),' ''
es 'denied ignored' "$T_DENIED" "...when(denied, DENY), ...when(tests_weakened, 'tests_weakened')," "...when(tests_weakened, 'tests_weakened'),"
es 'the deny_list class name no longer reads as denied' "$T_DENIED" 'sensitive.includes(DENY) || boundary.includes(DENY)' 'false'
es 'tests_weakened ignored in the raise' "$T_TWK" "...when(denied, DENY), ...when(tests_weakened, 'tests_weakened')," '...when(denied, DENY),'
es 'security seat read from fewer reasons than the raise' "$T_SECLENS" "'somi-security-reviewer': reasons," "'somi-security-reviewer': reasons.slice(1),"
es 'review_min allowed to return another value' "$T_RMIN" "review_min: reasons.length > 0 ? 'security' : null," "review_min: reasons.length > 2 ? 'panel' : reasons.length > 0 ? 'security' : null,"
# tests_weakened
es 'the -20 edge moved' "$T_WEAK" '-net >= WEAKENED_NET_LINES' '-net > WEAKENED_NET_LINES'
es 'the net-loss constant changed' "$T_WEAK" 'WEAKENED_NET_LINES = 20' 'WEAKENED_NET_LINES = 21'
es 'a deleted test file no longer counts' "$T_WEAK" 'f.test_files_deleted >= 1 || ' ''
es 'the moved-test case flipped' "$T_MOVED" 'net < 0 &&' 'net <= 0 &&'
# size mark
es 'the line edge moved' "$T_SIZE" 'f.production_lines > SIZE_FLAG_LINES' 'f.production_lines >= SIZE_FLAG_LINES'
es 'the file edge moved' "$T_SIZE" 'f.production_files > SIZE_FLAG_FILES' 'f.production_files >= SIZE_FLAG_FILES'
es 'size raises a lens' "$T_SIZE" 'reasons = [' 'reasons = [...when(f.production_lines > SIZE_FLAG_LINES, "size"),'
# the lens rules
es 'the reviewer seat dropped' "$T_EMPTY" $'\'somi-reviewer\': [\'always\'],\n      \'somi-security-reviewer\': reasons,' $'\'somi-reviewer\': [],\n      \'somi-security-reviewer\': reasons,'
es 'the modules edge moved' "$T_MOD" 'f.modules > MAX_MODULES_SEAT' 'f.modules >= MAX_MODULES_SEAT'
es 'new top directories no longer seat architecture' "$T_MOD" "...when(f.new_top_dirs >= 1, 'new_top_dirs'), " ''
es 'a contract name no longer seats architecture' "$T_CONTRACT" '...contract.map((n) => `contract:${n}`), ' ''
es 'the large-test-change edge moved' "$T_STRAT" 'f.test_lines_added + f.test_lines_deleted >= LARGE_TEST_CHANGE' 'f.test_lines_added + f.test_lines_deleted > LARGE_TEST_CHANGE'
es 'untested production no longer seats the strategist' "$T_STRAT" "...when(f.production_lines >= UNTESTED_PRODUCTION_LINES && f.test_files_changed === 0, 'untested_production')," ''
es 'the untested-production edge moved' "$T_STRAT" 'f.production_lines >= UNTESTED_PRODUCTION_LINES' 'f.production_lines > UNTESTED_PRODUCTION_LINES'
es 'the plan-paths rule dropped' "$T_PLAN" "...when(f.plan_paths, 'plan_paths')" ''
es 'the work-item-paths rule dropped' "$T_PLAN" "...when(f.work_item_paths, 'work_item_paths')" ''
# hard surface
es 'contract names dropped from the hard surface' "$T_HARD" 'const hard = [...contract, ' 'const hard = ['
es 'migrations no longer a hard surface' "$T_HARD" "...when(sensitive.includes('migrations'), 'migration'), " ''
es 'the ci class name no longer a hard surface' "$T_HARD" 'ci.length > 0 || ' ''
# monotonicity
es 'a bigger diff turns the size mark off' "$T_MONO" 'f.production_lines > SIZE_FLAG_LINES || f.production_files > SIZE_FLAG_FILES' '(f.production_lines > SIZE_FLAG_LINES && f.production_files < 6) || (f.production_files > SIZE_FLAG_FILES && f.production_lines < 151)'
es 'many reasons turn the lens off' "$T_MONO" "review_min: reasons.length > 0 ? 'security' : null," "review_min: reasons.length > 0 && reasons.length < 4 ? 'security' : null,"
es 'a new top directory turns the module seat off' "$T_MONO" 'f.modules > MAX_MODULES_SEAT' '(f.modules > MAX_MODULES_SEAT && f.new_top_dirs < 1)'
es 'the refused result lacks a hard-surface id' "$T_TOP" 'hard_surface: [...HARD_SURFACE_IDS],' 'hard_surface: [],'
# refused input
es 'the refused result does not raise' "$T_REFUSED" "review_min: 'security',
  reasons: [reason]," "review_min: null,
  reasons: [reason],"
es 'a throw escapes' "$T_REFUSED" 'catch { return refused(REFUSED_REASON); }' 'catch (e) { throw e; }'
es 'an unreadable input is reported as an internal error' "$T_REFUSED" 'catch { return refused(REFUSED_REASON); }' 'catch { return refused(INTERNAL_REASON); }'
es 'an internal error is reported as unreadable input' "$T_INTERNAL" 'catch { return refused(INTERNAL_REASON); }' 'catch { return refused(REFUSED_REASON); }'
es 'an internal error escapes' "$T_INTERNAL" 'catch { return refused(INTERNAL_REASON); }' 'catch (e) { throw e; }'
es 'an accessor is read' "$T_REFUSED" "return d && 'value' in d ? d.value : refuse();" 'return d ? o[k] : refuse();'
es 'a negative count accepted' "$T_REFUSED" 'Number.isSafeInteger(v) && v >= 0' 'Number.isSafeInteger(v)'
es 'an unknown class name accepted' "$T_REFUSED" 'out.every((n) => allowed.includes(n)) ?' 'true ?'
es 'a non-plain object accepted' "$T_REFUSED" '[Object.prototype, null].includes(Object.getPrototypeOf(o))' 'true'
es 'a duplicate class name kept' "$T_SECLENS" '? [...new Set(out)].sort() :' '? out.sort() :'
es 'an unknown key accepted' "$T_REFUSED" 'have.length === want.length && ' ''
es 'the refused result seats fewer lenses' "$T_REFALL" 'seated(Object.fromEntries(SEATS.map((l) => [l, [reason]])))' "seated(Object.fromEntries(SEATS.map((l) => [l, l === 'somi-reviewer' ? ['always'] : []])))"
es 'the registries left mutable' "$T_FROZEN" '[k, Object.freeze(v)]' '[k, v]'

# A shrunk monotonicity domain must turn the suite red: the same lib with one value taken out, run on the real module.
shrunk="$TMP/escalation-tests-shrunk.mjs"
node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const t=s.replace('[0, 150, 151], [0, 5, 6]','[0, 150], [0, 5, 6]');if(t===s)process.exit(3);fs.writeFileSync(process.argv[2],t)" "$EST" "$shrunk"
out="$(node "$shrunk" "$ES" 2>&1)"
if grep -qF -- "  FAIL $T_DOM" <<<"$out"; then ok 'a shrunk monotonicity domain turns the count red'; else bad 'a shrunk monotonicity domain did not turn the count red'; fi

# A stray exported SKIP_DOMAIN must not turn the exhaustive checks off.
stray="$(SKIP_DOMAIN=1 node "$EST" "$ES" 2>&1)"
if grep -qF "  ok   $T_DOM" <<<"$stray" && ! grep -qF '  skip ' <<<"$stray"; then ok 'a stray exported SKIP_DOMAIN skips nothing'; else bad 'a stray exported SKIP_DOMAIN skipped a check'; fi

# ---- scripts/lib/escalation-facts.mjs ----
echo "== escalation facts =="
EF="$ROOT/scripts/lib/escalation-facts.mjs"; EFT="$ROOT/tests/scripts/lib/escalation-facts-tests.mjs"
ln -s "$ROOT/scripts/lib/path-facts.mjs" "$TMP/path-facts.mjs"; ln -s "$ROOT/scripts/lib/path-safety.mjs" "$TMP/path-safety.mjs"; ln -s "$ES" "$TMP/escalation.mjs"   # a scratch copy imports its siblings
run_suite "$EFT" "$EF"
ef() { mutate "$EFT" "$EF" "$@"; }
TF_ROWS='a new 40-line file sizes nothing'; TF_DENY='a deleted .env, a renamed id_rsa'; TF_HARD='each hard-surface id comes from its path'; TF_CI='CI paths raise security as a sensitive name'
TF_WEAK='tests_weakened: a moved test'; TF_TOP='a top directory is new only when'; TF_IGN='planning churn under .somi is ignored'; TF_CFG='through the real loadConfig'; TF_PLAN='plan inputs: a plan directory'
TF_GUARD='the guard raises sensitive config on every row'; TF_UNPLAIN='a name with an empty, dot or dot-dot segment'; TF_SUM='a summed count past the safe integers'
TF_GROWN='a name that only passes the length cap once folded'; TF_ONLY='only undefined or the loadConfig shape is read'; TF_REF='a refused sensitive_paths key is noted'
TF_ALSO='the guard raises on a row among ordinary ones'; TF_QUIET='the guard is not wider than its names'
TF_FLIP='the config layers are read once'; TF_NOROW='a refused config shape raises sensitive config with no row'
TF_COVER='every degraded result covers a full read'
TF_HOST='a path over the length cap, a control character'; TF_MANY='10,000 rows, a non-list'; TF_BOX='a time box that runs out returns the floor'
ef 'the contract class not mapped' "$TF_HARD" "const KINDS = ['sensitive', 'boundary', 'contract'];" "const KINDS = ['sensitive', 'boundary'];"
ef 'the boundary class not mapped' "$TF_ROWS" "const KINDS = ['sensitive', 'boundary', 'contract'];" "const KINDS = ['sensitive', 'contract'];"
ef 'CI routed only into classes.ci' "$TF_CI" 'sensitive: names(seen.sensitive),' "sensitive: names(new Set([...seen.sensitive].filter((n) => n !== 'ci'))),"
ef 'the ci list emptied' "$TF_CI" "ci: seen.sensitive.has('ci') ? ['ci'] : []" 'ci: []'
ef 'the status letter ignored for deleted tests' "$TF_WEAK" "if (r.status === 'D') f.test_files_deleted++;" 'f.test_files_deleted++;'
ef 'the status letter ignored for new directories' "$TF_TOP" "&& r.status === 'A'" ''
ef 'denied computed after the status filter' "$TF_DENY" 'f.denied ||= c.denied;' "f.denied ||= c.denied && r.status !== 'D';"
ef 'the production split ignored' '151 production lines flag the size mark' 'if (c.production) {' 'if (true) {'
ef 'the module count dropped' "$TF_TOP" 'modules.add(c.module);' ''
ef 'the .somi ignore removed' "$TF_IGN" "['.somi', '.claude'].includes(file.split('/')[0])" 'false'
ef 'an ignored row no longer floors a denied name' "$TF_IGN" 'f.denied ||= denyListed(r.file);' ';'
ef 'the quoted-name rule removed' 'a git-quoted name is an unusable row' "&& !r.file.startsWith('\"')" ''
ef 'the control-character check removed' "$TF_HOST" ' && !UNSAFE_CHARS.test(r.file)' ''
ef 'the path length check removed' "$TF_HOST" 'r.file.length > 0 && r.file.length <= MAX_PATH_CHARS' 'r.file.length > 0'
ef 'the row cap removed' "$TF_MANY" 'rows.length > MAX_ROWS' 'false'
ef 'the config not passed on' "$TF_CFG" 'classifyPaths(chunk.map((r) => r.file), config)' 'classifyPaths(chunk.map((r) => r.file))'
ef 'the time box removed' "$TF_BOX" 'if (Date.now() - start >= budget) return' 'if (false) return'
ef 'the time box returns the partial facts' "$TF_BOX" "return { facts: floor(plan), notes: ['time_box'] };" 'break;'
ef 'the floor lets test lines switch tests_weakened off' 'every degraded result covers a full read' 'test_lines_added: 0, test_files_changed: 0, ' ''
ef 'the chunk step skips a row' 'rows past the first chunk are read' 'at += CHUNK) {' 'at += CHUNK + 1) {'
ef 'the chunk loop stops after the first chunk' 'rows past the first chunk are read' 'at += CHUNK) {' 'at += 1000) {'
ef 'the guard reads the case as written' "$TF_GUARD" 'flatMap((s) => foldName(s).split(SEP))' 'flatMap((s) => s.split(SEP))'
ef 'the guard does not re-split a folded separator' "$TF_GUARD" 'foldName(s).split(SEP)' '[foldName(s)]'
ef 'the guard re-splits a folded separator on forward slashes only' "$TF_GUARD" 'foldName(s).split(SEP)' "foldName(s).split('/')"
ef 'the guard splits on forward slashes only' "$TF_GUARD" 'const SEP = /[\\/]/;' 'const SEP = /\//;'
ef 'the guard keeps trailing dots and spaces' "$TF_GUARD" '.map(trimDots);' ';'
ef 'the guard runs only on ignored rows' "$TF_GUARD" 'if (guarded(r.file)) seen' 'if (hidden(r.file) && guarded(r.file)) seen'
ef 'the guard reaches only a root .claude' "$TF_GUARD" "segs.includes('.claude') ||" "head === '.claude' ||"
ef 'the guard drops a bare .claude' "$TF_GUARD" "segs.includes('.claude') ||" "(segs.includes('.claude') && second !== undefined) ||"
ef 'the guard drops a bare .somi' "$TF_GUARD" 'second === undefined || ' ''
ef 'the guard drops .somi/config.json' "$TF_GUARD" " || second === 'config.json'" ''
ef 'the plugins exemption restored' "$TF_GUARD" "segs.includes('.claude') ||" "(segs.includes('.claude') && segs.slice(1, 3).join('/') !== 'plugins/somi') ||"
ef 'the guard reaches only the first level of .claude' "$TF_GUARD" "segs.includes('.claude') ||" "(segs.includes('.claude') && segs.length < 3) ||"
ef 'the guard drops .somi/rules' "$TF_GUARD" " || second === 'rules'" ''
ef 'the guard drops CLAUDE.md' "$TF_GUARD" "segs.includes('claude.md') || " ''
ef 'the guard drops AGENTS.md' "$TF_GUARD" "segs.includes('agents.md') || " ''
ef 'CLAUDE.md guarded at the root only' "$TF_GUARD" "segs.includes('claude.md')" "head === 'claude.md'"
ef 'AGENTS.md guarded at the root only' "$TF_GUARD" "segs.includes('agents.md')" "head === 'agents.md'"
ef 'a name that merely contains claude.md guarded' "$TF_QUIET" "segs.includes('claude.md')" "segs.some((x) => x.includes('claude.md'))"
ef 'every .somi child guarded' "$TF_QUIET" "second === 'rules'" 'second !== undefined'
ef 'a guarded row dropped when it is not an exact ignored prefix' "$TF_ALSO" 'if (!hidden(r.file)) kept.push(r);' 'if (!hidden(r.file) && !guarded(r.file)) kept.push(r);'
ef 'a name that grows past the cap when folded accepted' "$TF_GROWN" ' && foldName(r.file).length <= MAX_PATH_CHARS' ''
ef 'an empty, dot or dot-dot segment accepted' "$TF_UNPLAIN" " && !pieces(r.file).includes('')" ''
ef 'a summed count past the safe integers kept' "$TF_SUM" 'if (!COUNTS.every((k) => count(f[k]))) return' 'if (false) return'
ef 'a refused sensitive_paths key adds nothing' "$TF_REF" "if (refused.includes('sensitive_paths')) seen.sensitive.add('config');" ''
ef 'a refused key is noted only when a row reaches the classifier' "$TF_REF" "const refused = classifyPaths([], config).refused;" "const refused = kept.length > 0 ? classifyPaths([], config).refused : [];"
ef 'a refused key not reported' "$TF_REF" "if (refused.length > 0) notes.add('config_refused');" ''
ef 'any config shape read' "$TF_ONLY" 'if (!plain(cfg)) return null;' 'if (!plain(cfg)) continue;'
ef 'a refused config shape not reported' "$TF_ONLY" "{ notes.add('config_refused'); seen.sensitive.add('config'); }" "{ seen.sensitive.add('config'); }"
ef 'a refused config shape adds nothing' "$TF_ONLY" "{ notes.add('config_refused'); seen.sensitive.add('config'); }" "{ notes.add('config_refused'); }"
ef 'a refused config shape adds nothing when no row is read' "$TF_NOROW" "{ notes.add('config_refused'); seen.sensitive.add('config'); }" "{ notes.add('config_refused'); if (rows.length > 0) seen.sensitive.add('config'); }"
ef 'the classifier reads the caller config again in each chunk' "$TF_FLIP" 'classifyPaths(chunk.map((r) => r.file), config)' 'classifyPaths(chunk.map((r) => r.file), opts.config)'
ef 'the layers are passed on without a copy' "$TF_FLIP" "layers.push({ sizing: { sensitive_paths: glist(once(sizing, 'sensitive_paths')), module_containers: glist(once(sizing, 'module_containers')) } });" 'layers.push(cfg);'
ef 'the time box starts after the preparation' 'the time box starts before the config' 'for (let at = 0; at < kept.length; at += CHUNK) {' 'for (let at = 0, start = Date.now(); at < kept.length; at += CHUNK) {'
ef 'the floor lets the new top directories switch off' "$TF_COVER" 'test_lines_added: 0, test_files_changed: 0, denied: true' 'test_lines_added: 0, test_files_changed: 0, new_top_dirs: 0, denied: true'
ef 'the floor counts a test file changed' "$TF_COVER" 'test_lines_added: 0, test_files_changed: 0, denied: true' 'test_lines_added: 0, test_files_changed: 1e9, denied: true'
ef 'an internal error without its note' 'an unexpected error is the floor' "notes: ['internal_error']" 'notes: []'
ef 'an unusable target no longer raises' "$TF_PLAN" "typeof target !== 'string' || target.length > MAX_PATH_CHARS || " ''
ef 'the plan-paths input ignored' 'plan and sdlc sources' 'plan_paths: given(planPaths)' 'plan_paths: false'
ef 'the slug input ignored' 'plan and sdlc sources' 'slug_given: given(slug)' 'slug_given: false'

# ---- scripts/lib/loop-escalate.mjs and the rows and steps it reads ----
echo "== loop escalation =="
LET="$ROOT/tests/scripts/lib/loop-escalate-tests.mjs"
run_suite "$LET" ""
lm_n=0
# lm <file in scripts/lib> <label> <test it must break> <from> <to>: the suite runs on a scratch copy of the whole directory with one file mutated.
lm() { local d="$TMP/lib-$((++lm_n))"; cp -r "$ROOT/scripts/lib" "$d"; ESCALATE_LIB="$d" MUT_OUT="$d/$1" mutate "$LET" "$d/$1" "$2" "$3" "$4" "$5"; }
TL_KEY='a clean 40-line new file has no escalation key'; TL_IDS='the escalation object holds ids only'; TL_RAN='a config file that cannot be parsed gives'; TL_POL='a new .claude/settings.json (untracked)'
lm loop-review.mjs 'the status letter not carried' 'treeRows carries git' 'const status = letters.get(file);' 'const status = undefined;'
lm loop-review.mjs 'the policy listing without untracked files' "$TL_POL" 'return [...changed, ...added];' 'return [...changed];'
lm loop-review.mjs 'the policy listing without tracked changes' 'a committed .claude/settings.json edited' 'return [...changed, ...added];' 'return [...added];'
lm loop-review.mjs 'the policy listing without .somi/rules' 'a new .somi/config.json and a new .somi/rules/x.md' "'.somi/config.json', '.somi/rules'" "'.somi/config.json'"
lm loop-review.mjs 'the policy listing in the repository top level terms' 'a project root in a subfolder' "'-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '--ignore-submodules=none', '--end-of-options', from, '--', ...GUARDED" "'-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--end-of-options', from, '--', ...GUARDED"
lm loop-review.mjs 'a diff without the driver flags' 'every git diff the loop runs' "'--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '--ignore-submodules=none', '--end-of-options', from, to" "'--no-renames', '--relative', '--ignore-submodules=none', '--end-of-options', from, to"
lm loop-diff.mjs 'the rows not returned' "$TL_KEY" 'return { total, weighted, outOfScope, rows };' 'return { total, weighted, outOfScope };'
lm loop-escalate.mjs 'a failure swallowed as a run' "$TL_RAN" '    return { ran: false };' '    return { ran: true, reasons: [], size_flag: false, tests_weakened: false, hard_surface: [], notes: [] };'
lm loop-escalate.mjs 'the object emitted when empty' "$TL_KEY" '(e.ran === false || e.reasons.length > 0' '(true || e.reasons.length > 0'
lm loop-escalate.mjs 'a path leaked into the object' "$TL_IDS" 'reasons: ids(e.reasons),' 'reasons: [...ids(e.reasons), rows[0].file],'
lm loop-escalate.mjs 'the id shape not checked' 'the diary text reads stored state as untrusted' "|| !list.every((x) => typeof x === 'string' && ID.test(x))" ''
lm loop-escalate.mjs 'the policy rows not added' "$TL_POL" '[...rows, ...guardedRows(root, baseline)]' '[...rows]'
lm loop-escalate.mjs 'the merged config handed on' "$TL_KEY" 'loadConfig(root, env) }' 'loadConfig(root, env).config }'
lm loop-step.mjs 'the escalation not put in the response' "$TL_KEY" 'review_mode: review.mode, ...found,' 'review_mode: review.mode,'
lm loop-step-review.mjs 'the ids not put in the diary line' 'the pass' "\${diaryText(gate?.response?.escalation)}" ''

total=$((pass + fail))
echo "SUMMARY $total checks, $fail failed"
[ "$fail" = 0 ]
