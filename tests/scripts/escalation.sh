#!/usr/bin/env bash
# Guards scripts/lib/escalation.mjs and escalation-facts.mjs. Runs each test lib, then proves the suite has teeth: every mutation of the module,
# applied to a scratch copy, must turn the test NAMED for it red (a mutant that fails some other way, or not at all, is
# a failure). Hermetic: temp tree only, no network, no model.
set -uo pipefail
umask 022

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SELF="$ROOT/tests/scripts/escalation.sh"
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
unset SKIP_DOMAIN ESCALATE_ONLY ESCALATE_LIB MUT_OUT  # inherited, these would skip checks, redirect the real runs or send every mutant to one file
# The self-checks at the end run this script up to here, asked for by an argument: nothing in the environment can stop a real run early.
[ "${1:-}" != --env-probe ] || { echo "env:${ESCALATE_ONLY+only}${ESCALATE_LIB+lib}${MUT_OUT+out}"; exit 0; }
run_suite "$EST" "$ES"
[ "${1:-}" != --first-suite ] || exit 0

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
T_REACHED='the internal-error test breaks the rules where it means to'
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
es 'the rules no longer call the method the internal-error test breaks' "$T_REACHED" $'...sensitive.filter((n) => n !== DENY).map((n) => `sensitive:${n}`),\n    ...boundary.filter((n) => n !== DENY).map((n) => `boundary:${n}`),' $'...sensitive.flatMap((n) => (n === DENY ? [] : [`sensitive:${n}`])),\n    ...boundary.flatMap((n) => (n === DENY ? [] : [`boundary:${n}`])),'
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
TF_GLOB='a glob list with a hole or past the cap'; TF_CLOCK='the clock is read once whatever the kept count'
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
ef 'the chunk step skips a row' 'rows past the first chunk are read' 'at += CHUNK;' 'at += CHUNK + 1;'
ef 'the chunk loop stops after the first chunk' 'rows past the first chunk are read' 'at += CHUNK;' 'at += 1000;'
ef 'the clock is read only when a row is kept' "$TF_CLOCK" 'do { // the clock is read at least once, whatever the kept count' 'while (kept.length > 0 && at < kept.length) {'
ef 'a glob list read through slice again, holes kept' "$TF_GLOB" 'Array.from({ length: Math.min(v.length, MAX_GLOBS + 1) }, (_, i) => v[i])' 'Array.prototype.slice.call(v, 0, MAX_GLOBS + 1)'
ef 'a glob list capped at the limit, so one past it reads as within it' "$TF_GLOB" 'Math.min(v.length, MAX_GLOBS + 1)' 'Math.min(v.length, MAX_GLOBS)'
ef 'the guard reads the case as written' "$TF_GUARD" 'flatMap((s) => foldName(s).split(SEP))' 'flatMap((s) => s.split(SEP))'
ef 'the guard does not re-split a folded separator' "$TF_GUARD" 'foldName(s).split(SEP)' '[foldName(s)]'
ef 'the guard re-splits a folded separator on forward slashes only' "$TF_GUARD" 'foldName(s).split(SEP)' "foldName(s).split('/')"
ef 'the guard splits on forward slashes only' "$TF_GUARD" 'const SEP = /[\\/]/;' 'const SEP = /\//;'
ef 'the guard keeps trailing dots and spaces' "$TF_GUARD" '.map(trimDots);' ';'
ef 'the guard runs only on ignored rows' "$TF_GUARD" 'if (guarded(r.file)) seen' 'if (hidden(r.file) && guarded(r.file)) seen'
ef 'the guard reaches only a root .claude' "$TF_GUARD" "segs.includes('.claude') ||" "head === '.claude' ||"
ef 'the guard drops CLAUDE.local.md' "$TF_GUARD" "segs.includes('claude.local.md') || " ''
ef 'the guard drops a bare .claude' "$TF_GUARD" "segs.includes('.claude') ||" "(segs.includes('.claude') && second !== undefined) ||"
ef 'the guard drops a bare .somi' "$TF_GUARD" 'second === undefined || ' ''
ef 'the guard drops .somi/config.json' "$TF_GUARD" " || second === 'config.json'" ''
ef 'the plugins exemption restored' "$TF_GUARD" "segs.includes('.claude') ||" "(segs.includes('.claude') && segs.slice(1, 3).join('/') !== 'plugins/somi') ||"
ef 'the guard reaches only the first level of .claude' "$TF_GUARD" "segs.includes('.claude') ||" "(segs.includes('.claude') && segs.length < 3) ||"
ef 'the guard drops .somi/rules' "$TF_GUARD" " || second === 'rules'" ''
ef 'the guard drops .mcp.json' "$TF_GUARD" "|| segs.includes('.mcp.json')" ''
ef '.mcp.json guarded at the root only' "$TF_GUARD" "segs.includes('.mcp.json')" "head === '.mcp.json'"
ef 'a name that merely contains mcp.json guarded' "$TF_QUIET" "segs.includes('.mcp.json')" "segs.some((x) => x.includes('mcp.json'))"
ef 'the guard drops .vscode/mcp.json' "$TF_GUARD" "|| segs.some((s, i) => s === '.vscode' && segs[i + 1] === 'mcp.json')" ''
ef '.vscode/mcp.json guarded at the root only' "$TF_GUARD" "segs.some((s, i) => s === '.vscode' && segs[i + 1] === 'mcp.json')" "(head === '.vscode' && second === 'mcp.json')"
ef 'every file under .vscode guarded' "$TF_QUIET" "s === '.vscode' && segs[i + 1] === 'mcp.json'" "s === '.vscode'"
ef 'mcp.json guarded in any directory' "$TF_QUIET" "s === '.vscode' && segs[i + 1] === 'mcp.json'" "s === 'mcp.json'"
ef 'mcp.json guarded anywhere under .vscode' "$TF_QUIET" "segs[i + 1] === 'mcp.json'" "segs.slice(i + 1).includes('mcp.json')"
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
ef 'the time box starts after the preparation' 'the time box starts before the config' 'if (Date.now() - start >= budget) return' 'if (Date.now() - Date.now() >= budget) return'
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
# ESCALATE_ONLY=mutant-run:<check> makes the suite run only the section holding the check the mutation must break.
lm() { local d="$TMP/lib-$((++lm_n))"; cp -r "$ROOT/scripts/lib" "$d"; ESCALATE_LIB="$d" ESCALATE_ONLY="mutant-run:$3" MUT_OUT="$d/$1" mutate "$LET" "$d/$1" "$2" "$3" "$4" "$5"; }
TL_KEY='a clean 40-line new file has no escalation key'; TL_IDS='the escalation object holds ids only'; TL_RAN='a config file that cannot be parsed gives'; TL_POL='a new .claude/settings.json (untracked)'
lm loop-review.mjs 'the status letter not carried' 'treeRows carries git' 'const status = letters.get(file);' 'const status = undefined;'
lm loop-review.mjs 'the policy listing without untracked files' "$TL_POL" 'return [...changed, ...added, ...links, ...ignored];' 'return [...changed, ...links, ...ignored];'
lm loop-review.mjs 'the policy listing without tracked changes' 'a committed .claude/settings.json edited' 'return [...changed, ...added, ...links, ...ignored];' 'return [...added, ...links, ...ignored];'
lm loop-review.mjs 'the policy listing without .somi/rules' 'a new .somi/config.json and a new .somi/rules/x.md' "'.somi/config.json', '.somi/rules'" "'.somi/config.json'"
lm loop-review.mjs 'the policy listing in the repository top level terms' 'a project root in a subfolder' "'-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '--ignore-submodules=none', '--end-of-options', from, '--', ...GUARDED" "'-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--ignore-submodules=none', '--end-of-options', from, '--', ...GUARDED"
lm loop-review.mjs 'the policy listing without the submodule flag' 'guardedRows: the diff lists a hidden moved submodule itself' "'--relative', '--ignore-submodules=none', '--end-of-options', from, '--', ...GUARDED" "'--relative', '--end-of-options', from, '--', ...GUARDED"
lm loop-review.mjs 'the policy listing without gitlinks from the index' 'an unchanged submodule at .claude/hooks still raises' "'-z', '--', '.claude', '.somi']).filter((t) => t.startsWith('160000 '))" "'-z', '--', '.claude', '.somi']).filter((t) => false)"
lm loop-review.mjs 'the gitlink listing without the guarded paths' 'guardedRows: an unchanged gitlink under a guarded path is a G row' "'ls-files', '-s', '-z', '--', '.claude', '.somi'" "'ls-files', '-s', '-z'"
lm loop-review.mjs 'the gitlink listing without .somi' 'a gitlink exactly at .somi is a G row' "'-z', '--', '.claude', '.somi']" "'-z', '--', '.claude']"
lm loop-review.mjs 'a nested repository at .somi not looked for' 'a gitlink exactly at .somi is a G row' "if (present(path.join(root, '.somi', '.git')) && " 'if (false && '
lm loop-review.mjs 'a nested repository at .somi looked for in .claude' 'a gitlink exactly at .somi is a G row' "path.join(root, '.somi', '.git')" "path.join(root, '.claude', '.git')"
lm loop-review.mjs 'a nested repository at .somi added beside its gitlink row' 'a gitlink at .somi inside a nested repository is one row' " && !links.some((r) => r.file === '.somi')" ''
lm loop-review.mjs 'the ignored files not compared' 'a self-ignoring .claude/.gitignore with a new' 'if (before !== undefined) {' 'if (false) {'
lm loop-review.mjs 'a state without a snapshot read as empty' 'a state without a snapshot (a loop begun before this snapshot existed)' 'if (before !== undefined) {' 'if (true) { before ??= { over: false, files: {} };'
lm loop-review.mjs 'the ignored listing without the ignored flag' 'a self-ignoring .claude/.gitignore with a new' "'ls-files', '-o', '-i', '--exclude-standard'" "'ls-files', '-o', '--exclude-standard'"
lm loop-review.mjs 'a new ignored file not raised' 'a self-ignoring .claude/.gitignore with a new' '!Object.hasOwn(before.files, file) || before.files[file] !== hash' 'Object.hasOwn(before.files, file) && before.files[file] !== hash'
lm loop-review.mjs 'a changed ignored file not raised' 'an edit to an already-ignored .claude/settings.local.json' '!Object.hasOwn(before.files, file) || before.files[file] !== hash' '!Object.hasOwn(before.files, file)'
lm loop-review.mjs 'an unchanged ignored file raised' 'planning churn under .somi, and an ignored' '!Object.hasOwn(before.files, file) || before.files[file] !== hash' 'true'
lm loop-review.mjs 'an over snapshot not raised' 'a snapshot that is over, or not of the stored shape' '!plainSnapshot(before) || before.over || now.over' '!plainSnapshot(before) || now.over'
lm loop-review.mjs 'a stored snapshot of another shape trusted' 'a snapshot that is over, or not of the stored shape' '!plainSnapshot(before) || ' ''
TL_SNAP='every guarded name, new and ignored, at any depth'; TL_FOLD='an ignored policy folder or rules folder that is itself a link'; TL_DEL='a deleted ignored policy file is a D row'; TL_DEP='a file under a dependency folder is no row'
TL_BIG='a file over 1 MiB is read to its end'; TL_DIG='past 256 entries the snapshot is one digest'; TL_BYTES='past the byte bound a file is stood for'; TL_WT='a worktree or nested repository under an ignored folder'
TL_LNK='a link is hashed with its target when that is a regular file'; TL_LND='a link to a directory or to a FIFO'; TL_LINK='an ignored link is hashed by its target'
lm loop-review.mjs 'the ignored listing without the guarded names' 'an ignored build file outside the policy paths' "'-z', '--', ...IGNORED_SPECS]" "'-z']"
lm loop-review.mjs 'the ignored pathspecs case-sensitive' "$TL_SNAP" '`:(glob,icase)${p}`' '`:(glob)${p}`'
lm loop-review.mjs 'the ignored pathspecs without glob magic' "$TL_SNAP" '`:(glob,icase)${p}`' '`:(icase)${p}`'
lm loop-review.mjs 'the ignored listing without a .claude link' "$TL_FOLD" "'**/.claude', '**/.claude/**'" "'**/.claude/**'"
lm loop-review.mjs 'the ignored listing without files under .claude' "$TL_SNAP" "'**/.claude/**', " ''
lm loop-review.mjs 'the ignored listing without CLAUDE.md' "$TL_SNAP" "'**/claude.md', " ''
lm loop-review.mjs 'the ignored listing without CLAUDE.local.md' "$TL_SNAP" "'**/claude.local.md', " ''
lm loop-review.mjs 'the ignored listing without AGENTS.md' "$TL_SNAP" "'**/agents.md', " ''
lm loop-review.mjs 'the ignored listing without .mcp.json' "$TL_SNAP" "'**/.mcp.json', " ''
lm loop-review.mjs 'the ignored listing without .vscode/mcp.json' "$TL_SNAP" "'**/.vscode/mcp.json', " ''
lm loop-review.mjs 'the ignored listing without .somi/config.json' "$TL_DEL" "'.somi/config.json', '.somi/rules'].map" "'.somi/rules'].map"
lm loop-review.mjs 'the ignored listing without .somi/rules' "$TL_FOLD" ", '.somi/rules'].map" '].map'
lm loop-review.mjs 'dependency folders not left out' "$TL_DEP" '!dependency(t)' 'true'
lm loop-review.mjs 'node_modules not a dependency folder' "$TL_DEP" "'node_modules', " ''
lm loop-review.mjs 'vendor not a dependency folder' "$TL_DEP" "'vendor', " ''
lm loop-review.mjs 'bower_components not a dependency folder' "$TL_DEP" "'bower_components', " ''
lm loop-review.mjs '.venv not a dependency folder' "$TL_DEP" "'.venv', " ''
lm loop-review.mjs 'venv not a dependency folder' "$TL_DEP" "'venv', " ''
lm loop-review.mjs 'site-packages not a dependency folder' "$TL_DEP" ", 'site-packages'" ''
lm loop-review.mjs 'a dependency folder inside .claude left out' "$TL_DEP" 'if (/^\.(claude|somi)$/i.test(s)) return false;' ''
lm loop-review.mjs 'a dependency folder inside .somi left out' "$TL_DEP" '(claude|somi)' '(claude)'
lm loop-review.mjs 'a vanished ignored file not raised' "$TL_DEL" 'for (const file of Object.keys(before.files))' 'for (const file of [])'
lm loop-review.mjs 'a vanished ignored file raised as an edit' "$TL_DEL" "deleted: 0, status: 'D' }" "deleted: 0, status: 'M' }"
lm loop-review.mjs 'a file read to its first chunk only' "$TL_BIG" 'for (let n; budget.left >= 0' 'for (let n, k = 0; k++ < 1 && budget.left >= 0'
lm loop-review.mjs 'a size cap per file' "$TL_BIG" 'if (!st.isFile()) {' 'if (!st.isFile() || st.size > 1048576n) {'
lm loop-review.mjs 'the byte budget not spent' "$TL_BYTES" 'budget.left -= n;' ''
lm loop-review.mjs 'a file past the byte budget hashed as one read' "$TL_BYTES" 'return budget.left < 0 ? `s:${st.size}:${st.ctimeNs}` : h.digest' 'return h.digest'
lm loop-review.mjs 'the stand-in without the change time' "$TL_BYTES" ':${st.ctimeNs}`' '`'
lm loop-review.mjs 'the entry bound off by one' "$TL_DIG" 'names.length + dirs.length > MAX_IGNORED' 'names.length + dirs.length >= MAX_IGNORED'
lm loop-review.mjs 'a tree past the entry bound over' "$TL_DIG" '{ over: false, files: {}, digest: sha(' '{ over: true, files: {}, digest: sha('
lm loop-review.mjs 'the digest not compared' "$TL_DIG" 'else if (before.digest !== now.digest)' 'else if (false)'
lm loop-review.mjs 'a nested repository read as a file' "$TL_WT" "f.endsWith('/') ? 'd:' : entryHash(path.join(base, f), budget)" 'entryHash(path.join(base, f), budget)'
lm loop-review.mjs 'the slash kept on a nested repository' "$TL_WT" "files[f.replace(/\\/$/, '')]" 'files[f]'
# lmp: lm for a check that rests on a file mode, which root ignores: the check is skipped for root (loop-escalate-tests.mjs), so its mutant is too.
lmp() { if [ "$(id -u)" = 0 ]; then echo "  skip mutation '$2' (root ignores file modes, so the check it breaks is skipped)"; else lm "$@"; fi; }
TL_VSC='a nested repository made under an ignored .vscode'; TL_LOOP='a link that loops, or runs through a file'; TL_EXACT='at the byte bound exactly'; TL_SHUT='a policy folder git cannot list'; TL_ADD='an untracked file in a folder git cannot list'
lmp loop-review.mjs 'an unreadable entry skipped' 'an entry that cannot be read is the over marker' '} catch { return OVER; }' '} catch { /* skipped */ }'
lm loop-review.mjs 'the exemption folder matched in any case' "$TL_DEP" '/^\.(claude|somi)$/i' '/^\.(claude|somi)$/'
lm loop-review.mjs 'the exemption folder matched at the end of a name' "$TL_DEP" '/^\.(claude|somi)$/i' '/\.(claude|somi)$/i'
lm loop-review.mjs 'a looping link an error' "$TL_LOOP" "['ENOENT', 'ELOOP', 'ENOTDIR']" "['ENOENT', 'ENOTDIR']"
lm loop-review.mjs 'a link through a file an error' "$TL_LOOP" "['ENOENT', 'ELOOP', 'ENOTDIR']" "['ENOENT', 'ELOOP']"
lm loop-review.mjs 'the byte budget spent to nothing still reads a file' "$TL_EXACT" 'for (let n; budget.left >= 0' 'for (let n; budget.left > 0'
lm loop-review.mjs 'a nested repository that appears or goes not one row' "$TL_VSC" 'if (ignored.some((r) => marker(now.files[r.file]) || marker(before.files[r.file])))' 'if (false)'
lm loop-review.mjs 'a nested repository that appears hides nothing' "$TL_VSC" 'marker(now.files[r.file]) || ' ''
lm loop-review.mjs 'a nested repository not a marker' "$TL_VSC" "v === 'd:' || " ''
TL_UNR='an unreadable ignored folder outside the policy paths'; TL_GOES='an unreadable ignored folder that goes'; TL_OPEN='a folder git cannot open that is, holds or lies under a policy name'; TL_SUBR='a project root in a subfolder names its unreadable folder'
TL_ONLYGIT='only the git warning line is an unopened directory'; TL_PARSE='the warning parser keeps the git lines'; TL_DIGU='an unreadable ignored folder with the listing past 256'
lmp loop-review.mjs 'the unopened-directory warning no refusal' "$TL_ADD" 'if (dirs.length) throw' 'if (false) throw'
lmp loop-review.mjs 'the refusal without the .gitignore way out' "$TL_ADD" ', remove it, or add it to .gitignore)' ', or remove it)'
lmp loop-review.mjs 'the ignored listing without the stderr check' "$TL_UNR" "stdio: ['ignore', 'pipe', 'pipe'], unlistable: true });" "stdio: ['ignore', 'pipe', 'pipe'] });"
lmp loop-review.mjs 'a policy folder git cannot open not the over marker' "$TL_SHUT" 'if (dirs.some(({ dir }) => POLICY_DIR.test(dir))) return OVER;' ''
lmp loop-review.mjs 'a policy folder git cannot open not the over marker (nested)' "$TL_OPEN" 'if (dirs.some(({ dir }) => POLICY_DIR.test(dir))) return OVER;' ''
lmp loop-review.mjs 'any folder git cannot open the over marker' "$TL_UNR" 'if (dirs.some(({ dir }) => POLICY_DIR.test(dir))) return OVER;' 'if (dirs.length) return OVER;'
lmp loop-review.mjs 'a .vscode folder git cannot open not a policy folder' "$TL_OPEN" '(claude|vscode)' '(claude)'
lmp loop-review.mjs 'a .claude folder git cannot open not a policy folder' "$TL_OPEN" '(claude|vscode)' '(vscode)'
lmp loop-review.mjs 'the .somi folder git cannot open not a policy folder' "$TL_OPEN" '|^\.somi(\/|$)/i' '/i'
lmp loop-review.mjs 'an unopened folder not an entry' "$TL_UNR" 'for (const { dir, why } of dirs)' 'for (const { dir, why } of [])'
lmp loop-review.mjs 'an unopened folder entry without its reason' "$TL_UNR" 'files[dir] = `u:${shown(why)}`' 'files[dir] = `u:`'
lmp loop-review.mjs 'an unopened folder entry not compared like a nested repository' "$TL_UNR" "v === 'd:' || v?.startsWith('u:') === true" "v === 'd:'"
lmp loop-review.mjs 'an unopened folder that goes raised as an edit only' "$TL_GOES" "|| v?.startsWith('u:') === true" '|| false'
lmp loop-review.mjs 'an unopened folder not counted toward the digest bound' "$TL_DIGU" 'names.length + dirs.length > MAX_IGNORED' 'names.length > MAX_IGNORED'
lmp loop-review.mjs 'an unopened folder named from the repository top' "$TL_SUBR" 'own !== '"''"' && dir.startsWith' 'false && dir.startsWith'
lmp loop-review.mjs 'an unopened folder kept with its slash' "$TL_UNR" ".replace(/\/$/, ''), why }));" ', why }));'
lm loop-review.mjs 'the warning matched anywhere in a line' "$TL_ONLYGIT" "/^warning: could not open directory '(.*)': (.*)$/gm" "/could not open directory '(.*)': (.*)$/gm"
lm loop-review.mjs 'the warning matched on the first line only' "$TL_PARSE" "(.*)$/gm;" "(.*)$/g;"
lm loop-review.mjs 'a vanished folder read as unopened' "$TL_PARSE" "m[2] !== 'No such file or directory'" 'true'
lmp loop-review.mjs 'the policy listings without the stderr check' "$TL_SHUT" "stdio: ['ignore', 'pipe', 'pipe'], unlistable: true }).split('\\0'); } catch (e) {" "stdio: ['ignore', 'pipe', 'pipe'] }).split('\\0'); } catch (e) {"
lmp loop-review.mjs 'the measured tree without the stderr check' "$TL_ADD" "stdio: ['ignore', 'ignore', 'pipe'], unlistable: true });" "stdio: ['ignore', 'ignore', 'pipe'] });"
lm loop-review.mjs 'a link read as its text only' "$TL_LNK" '${fileHash(full, true, budget)}`' '`'
lm loop-review.mjs 'a link not read' "$TL_LINK" '`l:${fs.readlinkSync(full)}:' '`l::'
lm loop-review.mjs 'a link followed' "$TL_LINK" 'if (!fs.lstatSync(full).isSymbolicLink())' 'if (true)'
lm loop-review.mjs 'a missing link target an error' "$TL_LNK" "['ENOENT', 'ELOOP', 'ENOTDIR']" '[]'
lm loop-review.mjs 'a link target that is no file an error' "$TL_LND" "if (follow) return 'special';" "if (follow) throw new Error('x');"
lm loop-review.mjs 'a link target opened with a wait' "$TL_LND" 'fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (follow' 'fs.constants.O_RDONLY | (follow'
lm loop-engine.mjs 'no snapshot taken at init' 'a self-ignoring .claude/.gitignore with a new' "if (loop === 'code') state.ignored_guarded = ignoredSnapshot(root);" 'if (false) state.ignored_guarded = ignoredSnapshot(root);'
lm loop-step.mjs 'the snapshot not handed to the escalation' 'an edit to an already-ignored .claude/settings.local.json' 'state.baseline_sha, state.ignored_guarded))' 'state.baseline_sha))'
lm loop-escalate.mjs 'the snapshot not handed to the policy rows' 'a root .gitignore that adds .claude/x' 'guardedRows(root, baseline, ignoredBefore)' 'guardedRows(root, baseline)'
lm loop-review.mjs 'the gitlink rows kept when the diff already lists the path' 'guardedRows: the diff lists a hidden moved submodule itself' ".filter((file) => !listed.has(file))" ''
lm loop-review.mjs 'the policy listing with renames on' 'a staged rename inside .claude' "'--raw', '--no-abbrev', '-z', '--no-renames'," "'--raw', '--no-abbrev', '-z',"
lm loop-review.mjs 'the policy listing of untracked files without the ignore rules' 'planning churn under .somi, and an ignored' "'ls-files', '-o', '--exclude-standard', '-z', '--', ...GUARDED" "'ls-files', '-o', '-z', '--', ...GUARDED"
lm loop-review.mjs 'a diff without the driver flags' 'every git diff the loop runs' "'--no-renames', '--no-ext-diff', '--no-textconv', '--relative', '--ignore-submodules=none', '--end-of-options', from, to" "'--no-renames', '--relative', '--ignore-submodules=none', '--end-of-options', from, to"
lm loop-diff.mjs 'the rows not returned' "$TL_KEY" 'return { total, weighted, outOfScope, rows };' 'return { total, weighted, outOfScope };'
lm escalation-facts.mjs 'the guard drops .mcp.json (loop level)' 'a new .mcp.json and a new .vscode/mcp.json' "|| segs.includes('.mcp.json')" ''
lm escalation-facts.mjs 'the guard drops .vscode/mcp.json (loop level)' 'a new .mcp.json and a new .vscode/mcp.json' "|| segs.some((s, i) => s === '.vscode' && segs[i + 1] === 'mcp.json')" ''
lm loop-escalate.mjs 'a failure swallowed as a run' "$TL_RAN" '    return { ran: false };' '    return { ran: true, reasons: [], size_flag: false, tests_weakened: false, hard_surface: [], notes: [] };'
lm loop-escalate.mjs 'the object emitted when empty' "$TL_KEY" '(e.ran === false || e.reasons.length > 0' '(true || e.reasons.length > 0'
lm loop-escalate.mjs 'a path leaked into the object' "$TL_IDS" 'reasons: ids(e.reasons),' 'reasons: [...ids(e.reasons), rows[0].file],'
lm loop-escalate.mjs 'the id shape not checked' 'the diary text reads stored state as untrusted' "|| !list.every((x) => typeof x === 'string' && ID.test(x))" ''
lm loop-escalate.mjs 'the policy rows not added' "$TL_POL" '[...rows, ...guardedRows(root, baseline, ignoredBefore)]' '[...rows]'
lm loop-escalate.mjs 'the merged config handed on' "$TL_KEY" 'loadConfig(root, env) }' 'loadConfig(root, env).config }'
lm loop-step.mjs 'the escalation not put in the response' "$TL_KEY" 'review_mode: review.mode, ...found,' 'review_mode: review.mode,'
lm loop-step-review.mjs 'the ids not put in the diary line' 'the pass' "\${diaryText(gate?.response?.escalation)}" ''

# The suite's filter and library swap hold only as ESCALATE_ONLY=mutant-run:<name> beside ESCALATE_LIB with the mutated file as the first argument,
# and a filter that matches no check fails the run.
# first_line <command...>: the first line it prints, waiting about 10 s at most; the run is stopped once it is out (a skip banner is that line when a filter took hold).
first_line() {
  local out pid i=0; out="$(mktemp "$TMP/first.XXXXXX")"
  TMPDIR="$TMP" "$@" >"$out" 2>&1 & pid=$!
  until [ -s "$out" ] || ! kill -0 "$pid" 2>/dev/null || [ $((i++)) -ge "${FIRST_LINE_TICKS:-200}" ]; do sleep 0.05; done
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
  head -n 1 "$out"
}
T_FIRST='== the report: what the loop says about its own diff, and what it leaves alone =='
TL_LATE='a repository-level diff.external and a textconv driver do not run'
# filter_ok <test lib>: it takes hold with the variables and the mutated file together, however late the named check is, and in no other case; a filter naming no check fails with that line.
filter_ok() {
  local lib="$ROOT/scripts/lib" holds nothing_a nothing_b nothing_c nothing_d none rc
  holds="$(ESCALATE_LIB="$lib" ESCALATE_ONLY="mutant-run:$TL_LATE" first_line node "$1" "$lib/loop-review.mjs")"
  nothing_a="$(ESCALATE_ONLY="mutant-run:$TL_LATE" first_line node "$1" "$lib/loop-review.mjs")"            # the variable alone
  nothing_b="$(ESCALATE_LIB="$lib" ESCALATE_ONLY="$TL_LATE" first_line node "$1" "$lib/loop-review.mjs")"   # without the prefix
  nothing_c="$(ESCALATE_LIB="$lib" ESCALATE_ONLY="mutant-run:$TL_LATE" first_line node "$1")"               # the pair exported by accident: no argument
  nothing_d="$(ESCALATE_LIB="$lib" ESCALATE_ONLY="mutant-run:$TL_LATE" first_line node "$1" "$1")"          # an argument outside the library
  none="$(ESCALATE_LIB="$lib" ESCALATE_ONLY='mutant-run:no such check' node "$1" "$lib/loop-review.mjs" 2>&1)"; rc=$?
  [ "$holds" = "  skip every section but the one holding \"$TL_LATE\" (ESCALATE_ONLY=mutant-run:...)" ] && [ "$nothing_a" = "$T_FIRST" ] && [ "$nothing_b" = "$T_FIRST" ] && [ "$nothing_c" = "$T_FIRST" ] && [ "$nothing_d" = "$T_FIRST" ] \
    && [ "$rc" != 0 ] && grep -qxF '  FAIL no check matched the filter' <<<"$none"
}
if filter_ok "$LET"; then ok 'the suite filter needs ESCALATE_LIB, the exact prefix and the mutated file as the first argument, and a filter naming no check fails'; else bad 'the suite filter took hold without all three, never took hold, or a filter naming no check passed'; fi
# fm <label> <from> <to>: the same check on a scratch copy of the suite (beside a copy of scripts/lib) with one mutation; it must fail.
fm() {
  local d="$TMP/fm-$((++lm_n))"; mkdir -p "$d/tests/scripts/lib"; cp -r "$ROOT/scripts" "$d/scripts"
  node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const t=s.replace(process.argv[2],()=>process.argv[3]);if(t===s)process.exit(3);fs.writeFileSync(process.argv[4],t)" "$LET" "$2" "$3" "$d/tests/scripts/lib/loop-escalate-tests.mjs"
  if [ $? != 0 ]; then bad "mutation '$1' did not change the suite (stale pattern)"; return; fi
  if filter_ok "$d/tests/scripts/lib/loop-escalate-tests.mjs"; then bad "mutation '$1' left the suite filter check green"; else ok "mutation '$1' turns the suite filter check red"; fi
}
fm 'any value filters' "process.env.ESCALATE_ONLY?.startsWith(FILTER)" "process.env.ESCALATE_ONLY"
fm 'the filter without ESCALATE_LIB' "process.env.ESCALATE_LIB !== undefined && " ''
fm 'the filter without the argument' "Boolean(process.argv[2]) && path.resolve(process.argv[2]).startsWith(path.resolve(process.env.ESCALATE_LIB) + path.sep)" 'true'
fm 'the argument not tied to the library' "path.resolve(process.argv[2]).startsWith(path.resolve(process.env.ESCALATE_LIB) + path.sep)" 'true'
fm 'the library swapped whatever the filter' 'const LIB = MUTANT ?' "const LIB = process.env.ESCALATE_LIB ?? (false ?"
fm 'the filter never holds' 'const ONLY = MUTANT ?' 'const ONLY = false ?'
fm 'a filter naming no check passes' 'if (ONLY !== null && pass + fail === 0)' 'if (false)'
# first_line gives up on a command that prints nothing: the function as written in a copy of this script, with 4 ticks, on a command that would wait 20 s.
fl_bound() { timeout 5 bash -c 'TMP=$1; eval "$(sed -n "/^first_line() {/,/^}/p" "$2")"; FIRST_LINE_TICKS=4 first_line sleep 20' _ "$TMP" "$1"; }
if fl_bound "$SELF"; then ok 'the first-line wait is bounded: a silent command is given up on'; else bad 'the first-line wait is not bounded'; fi
fb="$TMP/self-unbounded.sh"; sed 's/ || \[ \$((i++)) -ge "\${FIRST_LINE_TICKS:-200}" \]//' "$SELF" >"$fb"
if cmp -s "$SELF" "$fb"; then bad "mutation 'the first-line wait unbounded' did not change the script (stale pattern)"; elif fl_bound "$fb"; then bad "mutation 'the first-line wait unbounded' left the bound check green"; else ok "mutation 'the first-line wait unbounded' turns the bound check red"; fi
# The real runs start without the filter variables: this script, asked to stop where it unsets them (--env-probe) with them exported, says what is left.
probe() { ESCALATE_ONLY=x ESCALATE_LIB=y MUT_OUT=z bash "$1" --env-probe 2>&1 | tail -n 1; }
[ "$(probe "$SELF")" = 'env:' ] && ok 'the real runs start without an inherited ESCALATE_ONLY, ESCALATE_LIB or MUT_OUT' || bad 'the real runs inherit ESCALATE_ONLY, ESCALATE_LIB or MUT_OUT'
for left in ESCALATE_ONLY ESCALATE_LIB MUT_OUT; do
  d="$TMP/probe-$left"; mkdir -p "$d/tests/scripts"
  sed "/^unset /s/ $left\b//" "$SELF" >"$d/tests/scripts/escalation.sh"
  if cmp -s "$SELF" "$d/tests/scripts/escalation.sh"; then bad "mutation 'unset without $left' did not change the script (stale pattern)"
  elif [ "$(probe "$d/tests/scripts/escalation.sh")" = 'env:' ]; then bad "mutation 'unset without $left' left the probe green"; else ok "mutation 'unset without $left' turns the probe red"; fi
done
# A stray exported ESC_PROBE (the old trigger) must not stop a real run: the first suite runs in full (--first-suite stops the script after it).
stray() { local out; out="$(ESC_PROBE=1 TMPDIR="$TMP" bash "$1" --first-suite 2>&1)"; grep -qF "  ok   $T_EMPTY" <<<"$out"; }
d="$TMP/stray"; mkdir -p "$d/tests/scripts"; ln -s "$ROOT/tests/scripts/lib" "$d/tests/scripts/lib"; ln -s "$ROOT/scripts" "$d/scripts"
sed 's/^\[ "${1:-}" != --env-probe \] || /[ -z "${ESC_PROBE:-}" ] || /' "$SELF" >"$d/tests/scripts/escalation.sh"
if cmp -s "$SELF" "$d/tests/scripts/escalation.sh"; then bad "mutation 'the probe triggered by the environment' did not change the script (stale pattern)"
elif stray "$d/tests/scripts/escalation.sh"; then bad "mutation 'the probe triggered by the environment' left the stray-variable check green"; else ok "mutation 'the probe triggered by the environment' turns the stray-variable check red"; fi
if stray "$SELF"; then ok 'a stray exported ESC_PROBE still runs the full suite'; else bad 'a stray exported ESC_PROBE stopped the run'; fi

total=$((pass + fail))
echo "SUMMARY $total checks, $fail failed"
[ "$fail" = 0 ]
