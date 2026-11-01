#!/usr/bin/env bash
# Guards the fact-sheet library modules under scripts/lib. Each section runs a module's test lib, then proves
# the suite has teeth: every mutation of the module, applied to a scratch copy, must turn the test NAMED for it red
# (a mutant that fails some other way, or not at all, is a failure). Hermetic: temp tree only, no network, no model.
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
  local lib="$1" mod="$2" label="$3" named="$4" mut="$TMP/mutant-$(basename "$2")"
  node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const t=s.replace(process.argv[2],()=>process.argv[3]);if(t===s)process.exit(3);fs.writeFileSync(process.argv[4],t)" "$mod" "$5" "$6" "$mut"
  if [ $? != 0 ]; then bad "mutation '$label' did not change the module (stale pattern)"; return; fi
  local out; out="$(node "$lib" "$mut" 2>&1)"
  if grep -qF -- "  FAIL $named" <<<"$out"; then ok "mutation '$label' turns '$named' red"; else bad "mutation '$label' did not turn '$named' red"; fi
}

# ---- scripts/lib/path-safety.mjs ----
echo "== fact sheet: path safety =="
PS="$ROOT/scripts/lib/path-safety.mjs"; PST="$ROOT/tests/scripts/lib/path-safety-tests.mjs"
run_suite "$PST" "$PS"
ps() { mutate "$PST" "$PS" "$@"; }
T_STAT='a deny-listed name is decided without any filesystem call'
ps 'deny-list stats the file' "$T_STAT" "if (denied) return { kind: 'denied' };" "if (denied) { try { fs.lstatSync(root); } catch { /* the probe is the call itself */ } return { kind: 'denied' }; }"
ps 'refusal drops the denied fact' 'a malformed deny-listed name returns the refusal id' 'if (bad) return refused(bad, denied);' 'if (bad) return refused(bad);'
ps 'case folding removed' 'denies case variants' ".normalize('NFKC').toUpperCase().toLowerCase()" ".normalize('NFKC')"
ps 'compatibility normalisation removed' 'denies a name written with another separator' ".normalize('NFKC').toUpperCase().toLowerCase()" '.toUpperCase().toLowerCase()'
ps 'full case folding reduced to lower-casing' 'denies a name that only full case folding' '.toUpperCase().toLowerCase()' '.toLowerCase()'
ps 'backslash not a separator in the deny test' 'denies a name written with another separator' 'const SEPARATORS = /[\\/]+/;' 'const SEPARATORS = /[/]+/;'
ps 'trailing dot and space not stripped' 'denies a name written with another separator' 'trimDots(piece)' 'piece'
T_SEP='denies a name whose compatibility fold writes a separator'
ps 'fold, then split, restored' "$T_SEP" 'return raw.split(SEPARATORS).some((segment) => {' "return raw.normalize('NFKC').toUpperCase().toLowerCase().split(SEPARATORS).some((segment) => {"
ps 'the folded segment tested only as its pieces' "$T_SEP" 'new Set([folded, ...folded.split(SEPARATORS)])' 'new Set(folded.split(SEPARATORS))'
ps 'the folded segment tested only whole' "$T_SEP" 'new Set([folded, ...folded.split(SEPARATORS)])' 'new Set([folded])'
T_BIG='a huge name is refused as path_length'
ps 'the raw-length bound removed' "$T_BIG" 'if (raw.length > MAX_PATH_CHARS) return true;' ''
ps 'the regex trim restored without the bound' "$T_BIG" "if (raw.length > MAX_PATH_CHARS) return true;
  return raw.split(SEPARATORS).some((segment) => {
    const folded = segment.normalize('NFKC').toUpperCase().toLowerCase();
    return [...new Set([folded, ...folded.split(SEPARATORS)])].some((piece) => {
      const name = trimDots(piece);" "return raw.split(SEPARATORS).some((segment) => {
    const folded = segment.normalize('NFKC').toUpperCase().toLowerCase();
    return [...new Set([folded, ...folded.split(SEPARATORS)])].some((piece) => {
      const name = piece.replace(/[. ]+\$/, '');"
ps 'the short-name rule removed' 'denies Windows short names' '/~\d/.test(name) || ' ''
ps 'the stream-suffix rule removed' 'denies Windows short names' "name.includes(':') || " ''
ps 'the short-name rule over-matches a bare tilde' 'does not deny look-alikes' '/~\d/' '/~/'
ps 'the short-name rule narrowed to a bare stem' 'floors drive-letter paths and ~<digit> names' '/~\d/.test(name)' '/^[a-z]+~\d$/.test(name)'
ps 'the drive-letter floor removed' 'floors drive-letter paths and ~<digit> names' "name.includes(':') || " ''
ps 'the .ssh segment not matched' 'denies .env, key and certificate' "'.ssh', " ''
ps 'the .tfvars suffix not matched' 'denies .env, key and certificate' "'.tfvars', " ''
ps 'the .npmrc name not matched' 'denies .env, key and certificate' "'.npmrc', " ''
T_HOOK='denies the secret names the repository secret-write hook denies'
T_LIST='the hook secret-name patterns and the representative table list the same literals'
T_MATCH='each hook pattern, built with its own flags, matches the basename of its representative'
T_REP='every representative of a hook pattern is denied here'
T_ADDED='denies .env, key and certificate'
T_LOOK='does not deny the look-alikes of the added names'
ps 'the -key.json suffix not matched' "$T_HOOK" "'-key.json', " ''
ps 'the -key.json suffix over-matches key.json' 'does not deny look-alikes of those names' "'-key.json'" "'key.json'"
ps 'the credentials.json suffix not matched' "$T_REP" ", 'credentials.json'" ''
ps 'the credentials.json suffix not matched (file in the name table)' "$T_ADDED" ", 'credentials.json'" ''
ps 'the credentials.json suffix over-matches any json' 'does not deny look-alikes of those names' ", 'credentials.json'" ", '.json'"
ps 'the service-account rule not matched' "$T_HOOK" 'service[-_]?account.*\.json$|' ''
ps 'the service-account rule loses its extension' 'does not deny look-alikes of those names' 'service[-_]?account.*\.json$' 'service[-_]?account'
ps 'the service-account rule loses its underscore form' "$T_ADDED" 'service[-_]?account' 'service-?account'
ps 'the service-account rule loses its optional separator' "$T_ADDED" 'service[-_]?account' 'service[-_]account'
ps 'the service-account rule matches a bare account.json' "$T_LOOK" 'service[-_]?account' 'account'
ps 'the client_secret rule not matched' "$T_ADDED" '|client_secret.*\.json$' ''
ps 'the client_secret rule loses its extension' "$T_LOOK" 'client_secret.*\.json$' 'client_secret'
ps 'the .netrc suffix not matched' "$T_REP" " '.netrc', '.pgpass', '-key.json'" " '.pgpass', '-key.json'"
ps 'the .netrc suffix not matched (name table)' "$T_ADDED" " '.netrc', '.pgpass', '-key.json'" " '.pgpass', '-key.json'"
ps 'the .pgpass suffix not matched' "$T_REP" " '.pgpass', '-key.json'" " '-key.json'"
ps 'the .pgpass suffix not matched (name table)' "$T_ADDED" " '.pgpass', '-key.json'" " '-key.json'"
ps 'the .tfstate.backup suffix not matched' "$T_ADDED" " '.tfstate.backup'," ''
ps 'the .tfstate.backup suffix over-matches any .backup' "$T_LOOK" "'.tfstate.backup'" "'.backup'"
ps 'the exact key.json rule removed' "$T_ADDED" '|^key\.json$' ''
ps 'the key.json rule unanchored' 'does not deny look-alikes of those names' '^key\.json$' 'key\.json$'
ps 'the tfstate backup-copy rule removed' "$T_ADDED" '|\.tfstate\..*\.backup$' ''
ps 'the tfstate backup-copy rule over-matches' "$T_LOOK" '\.tfstate\..*\.backup$' '\.tfstate\..*'
ps 'a bare config denied' 'a bare config stays allowed on purpose' "'.docker', 'credentials'];" "'.docker', 'credentials', 'config'];"
ps 'credentials denied only as a file, not as a directory' 'credentials/ is denied as a directory' "return raw.split(SEPARATORS).some((segment) => {
    const folded = segment.normalize('NFKC').toUpperCase().toLowerCase();
    return [...new Set([folded, ...folded.split(SEPARATORS)])].some((piece) => {
      const name = trimDots(piece);
      return NAME_EXACT.includes(name) ||" "return raw.split(SEPARATORS).some((segment, _, all) => {
    const folded = segment.normalize('NFKC').toUpperCase().toLowerCase();
    return [...new Set([folded, ...folded.split(SEPARATORS)])].some((piece) => {
      const name = trimDots(piece);
      return (NAME_EXACT.includes(name) && (name !== 'credentials' || segment === all.at(-1))) ||"
ps 'the secrets rule not matched' "$T_HOOK" '|secrets?\.(?:ya?ml|json)$' ''
ps 'the secrets rule loses its extension' 'does not deny look-alikes of those names' 'secrets?\.(?:ya?ml|json)$' 'secrets?\.'
ps 'the credentials name not matched' "$T_HOOK" ", 'credentials'];" '];'
ps 'the .tfstate suffix not matched' "$T_HOOK" "'.tfstate', " ''
ps 'the _netrc name not matched' "$T_HOOK" "'_netrc', " ''
ps 'the _pgpass name not matched' "$T_HOOK" "'_pgpass', " ''
ps 'the .htpasswd name not matched' "$T_HOOK" "'.htpasswd', " ''
ps 'the .p8 suffix not matched' "$T_HOOK" "'.p8', " ''
ps 'the .vault-token name not matched' "$T_HOOK" ", '.vault-token'" ''
ps 'the .kube segment not matched' "$T_HOOK" "'.kube', " ''
ps 'the .docker segment not matched' "$T_HOOK" "'.docker', " ''
ps 'the hook parity: -key.json dropped from the deny list' "$T_REP" "'-key.json', " ''
ps 'the hook parity: .kdbx dropped from the deny list (a representative no longer denied)' "$T_REP" "'.kdbx', " ''
# The hook's own source, copied with one edit and read by the test through SECRET_HOOK_SOURCE.
HOOK="$ROOT/hooks/pre-tool/block-secret-writes.mjs"
hk() {
  local label="$1" named="$2" mut="$TMP/hook-mutant.mjs" out
  node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const t=s.replace(process.argv[2],()=>process.argv[3]);if(t===s)process.exit(3);fs.writeFileSync(process.argv[4],t)" "$HOOK" "$3" "$4" "$mut"
  if [ $? != 0 ]; then bad "hook mutation '$label' did not change the hook (stale pattern)"; return; fi
  out="$(SECRET_HOOK_SOURCE="$mut" node "$PST" "$PS" 2>&1)"
  if grep -qF -- "  FAIL $named" <<<"$out"; then ok "hook mutation '$label' turns '$named' red"; else bad "hook mutation '$label' did not turn '$named' red"; fi
}
hk 'a hook pattern gains a flag' "$T_LIST" '  /\.pem$/,' '  /\.pem$/i,'
hk 'a hook pattern gains a flag the test must build with' "$T_MATCH" '  /\.pem$/,' '  /\.pem$/y,'
hk 'a hook pattern is added with no representative' "$T_LIST" '  /\.kdbx$/,' '  /\.kdbx$/,
  /\.tfplan$/,'
hk 'a hook pattern with a character class is added with no representative' "$T_LIST" '  /\.kdbx$/,' '  /\.kdbx$/,
  /[a-z]\.tfplan$/,'
hk 'a hook entry that is not a plain literal is added' "$T_LIST" '  /\.kdbx$/,' '  /\.kdbx$/,
  new RegExp("x"),'
hk 'a hook pattern is altered' "$T_LIST" '/-key\.json$/,' '/-key\.jsonl$/,'
hk 'a hook pattern is removed and its representative goes stale' "$T_LIST" '  /\.pgpass$/,
' ''
ps 'the realpath re-check removed' 'a path whose canonical on-disk spelling is a denied name' "if (denyListed(rel)) return { kind: 'denied' };" ''
ps 'the .git segment not matched' 'denies .env, key and certificate' "NAME_EXACT.includes(name) || " ''
ps 'the .env prefix not matched' 'denies .env, key and certificate' "'.env', " ''
ps 'id_rsa not matched' 'denies .env, key and certificate' "'id_rsa', " ''
ps 'the .pfx suffix not matched' 'denies .env, key and certificate' "'.pfx', " ''
ps 'the deny list over-matches .gitignore' 'does not deny look-alikes' "NAME_EXACT.includes(name)" "name.startsWith('.git')"
ps 'the backslash dropped from the absolute check' 'refuses an absolute path' '^(?:[\\/]|[a-z]:)' '^(?:[/]|[a-z]:)'
ps 'the absolute check removed' 'refuses an absolute path' "if (ABSOLUTE.test(raw)) return 'absolute';" ''
ps 'the parent-segment check removed' 'refuses a parent segment' "if (segments.some((s) => PARENT_SEGMENT.test(s))) return 'traversal';" ''
ps 'control characters allowed' 'refuses NUL and control' '[\p{Cc}\p{Cf}' '[\p{Cf}'
ps 'bidi characters allowed' 'refuses bidi' '[\p{Cc}\p{Cf}' '[\p{Cc}'
ps 'lone surrogates allowed' 'refuses lone surrogates' '\p{Cs}' ''
ps 'a non-string name read as text' 'refuses an empty' "if (typeof raw !== 'string') return 'malformed';" ''
ps 'the length cap off by one' 'refuses a name over the length cap' 'raw.length > MAX_PATH_CHARS' 'raw.length >= MAX_PATH_CHARS'
ps 'the count cap off by one' 'refuses a list over the count cap' 'paths.length <= MAX_PATHS' 'paths.length < MAX_PATHS'
ps 'the list refusal drops the denied fact' 'a list over the cap keeps the denied fact' 'paths.some(denyListed)' 'false'
ps 'a far-over-cap list is scanned' 'a list far over the cap is refused as denied' "if (paths.length > 4 * MAX_PATHS) return refused('path_count', true);" ''
ps 'the scan bound off by one' 'a list far over the cap is refused as denied' 'paths.length > 4 * MAX_PATHS' 'paths.length >= 4 * MAX_PATHS'
ps 'a symlink component allowed' 'refuses a symlinked file' "if (stat.isSymbolicLink()) return { result: refused('symlink') };" ''
ps 'an escape outside the root allowed' 'refuses a path whose canonical form leaves the root' 'rel.startsWith(`..${path.sep}`) ||' ''
ps 'the root itself allowed' 'refuses a path whose canonical form leaves the root' "rel === '' ||" ''
ps 'the parent of the root allowed' 'refuses a path whose canonical form leaves the root' "rel === '..' ||" ''
ps 'a name starting with two dots read as an escape' 'a file whose name begins with two dots' 'rel.startsWith(`..${path.sep}`)' "rel.startsWith('..')"
if [ "$(uname -s)" = Linux ]; then ps 'a non-ENOENT lstat error read as a missing file' 'a name the filesystem cannot look up' "if (e.code !== 'ENOENT') return { result: refused('unreadable') };" ''
else echo "  skip mutation 'a non-ENOENT lstat error read as a missing file' on the long-name test (not Linux: the name limit counts bytes only there)"; fi
if [ "$(id -u)" = 0 ]; then echo "  skip mutation 'a non-ENOENT lstat error read as a missing file' on the unreadable-directory test (running as root, which reads it)"
else ps 'a non-ENOENT lstat error read as a missing file (directory case)' 'a file in an unreadable directory' "if (e.code !== 'ENOENT') return { result: refused('unreadable') };" ''; fi
ps 'the walk splits on slashes only' 'refuses a parent segment' 'raw.split(SEPARATORS).filter' "raw.split('/').filter"
ps 'a final non-file is opened' 'a path that does not exist, a directory or a FIFO opens nothing' "if (i === segments.length - 1 && !stat.isFile()) return { result: refused('not_file') };" ''
ps 'a probe error is rethrown' 'an error from the probe is a refusal' "result = refused('probe');" "throw new Error('PROBEMSG');"
ps 'a missing parent allowed' 'refuses a directory, a path through a file' "if (i < segments.length - 1) return { result: refused('no_parent') };" ''
ps 'a file read as a directory' 'refuses a directory, a path through a file' 'i < segments.length - 1 && !stat.isDirectory()' 'false'
ps 'a directory or device read as a file' 'refuses a directory, a path through a file' "if (!stat.isFile()) throw Object.assign(new Error(), { refusal: 'not_file' });" ''
ps 'the size cap not applied' 'refuses a file over the size cap' 'stat.size > MAX_FILE_BYTES' 'false'
ps 'the size cap off by one' 'refuses a file over the size cap' 'stat.size > MAX_FILE_BYTES' 'stat.size >= MAX_FILE_BYTES'
ps 'the open can block on a FIFO' 'a FIFO is refused and the call returns' ' | constants.O_NONBLOCK' ''
ps 'the open can take a controlling terminal' 'the open follows no link, cannot block' ' | (constants.O_NOCTTY ?? 0)' ''
ps 'the open follows a link' 'refuses a link swapped in after the check' ' | constants.O_NOFOLLOW' ''
ps 'no platform check' 'fails closed with `platform`' "if (!(constants.O_NOFOLLOW > 0 && constants.O_NONBLOCK > 0)) return refused('platform');" ''
ps 'the platform check ignores O_NONBLOCK' 'fails closed with `platform`' ' && constants.O_NONBLOCK > 0' ''
ps 'the descriptor is leaked after a probe' 'the descriptor is closed after a probe' 'fs.closeSync(opened.fd);' ''
ps 'a failed close of the descriptor is rethrown' 'a probe that closes the descriptor is a refusal' "try {
    fs.closeSync(opened.fd);
  } catch {
    return refused(probe ? 'probe' : 'unreadable'); // with a probe, the likely cause is the probe closing the descriptor
  }" 'fs.closeSync(opened.fd);'
T_CLOSE='a close that fails is unreadable with no probe'
ps 'a failed close with no probe labelled probe' "$T_CLOSE" "refused(probe ? 'probe' : 'unreadable')" "refused('probe')"
ps 'a failed close with a probe labelled unreadable' "$T_CLOSE" "refused(probe ? 'probe' : 'unreadable')" "refused('unreadable')"
ps 'the descriptor is leaked on a refusal' 'the descriptor is closed after a probe' 'fs.closeSync(fd);' ''
ps 'the probe answer is passed through' 'the probe gets an open descriptor and the size and its answer is a boolean' 'probe(opened.fd, opened.size) === true' 'probe(opened.fd, opened.size)'
ps 'an unreadable root is read through' 'an unreadable root is refused' "} catch {
    return refused('unreadable');
  }
  if (found.result)" "} catch {
    return { kind: 'contained', exists: false, rel: '' };
  }
  if (found.result)"

# ---- scripts/lib/path-facts.mjs ----
echo "== fact sheet: path facts =="
PF="$ROOT/scripts/lib/path-facts.mjs"; PFT="$ROOT/tests/scripts/lib/path-facts-tests.mjs"
ln -s "$PS" "$TMP/path-safety.mjs"   # a scratch copy of the module imports its sibling
run_suite "$PFT" "$PF"
# The timed cost check costs about a second a run, so only the mutants that name it run it.
# SKIP_TIMED is honoured only as the value mutant-run (see the stray-seam check at the end).
pf() { local skip_timed=mutant-run; case "$2" in *nested-quantifier*) skip_timed= ;; esac; SKIP_TIMED=$skip_timed mutate "$PFT" "$PF" "$@"; }
T_FLAG='an unconfigured repo flags .env, a migrations directory, a lockfile and a route file'
T_ADD='config globs are added to the built-ins, not instead of them'
T_CONT='still two with an empty container list'
T_HOSTILE='a hostile section reads as the defaults'
T_DIR='a directory glob with a slash is anchored'
T_LIT='a config glob is literal text except star'
T_UNUSABLE='an unusable entry floors instead of vanishing'
T_KEY='module key under a built-in container'
T_DENY='a denied name reports a deny_list hit'
pf 'a default glob dropped: migrations' "$T_FLAG" "migrations: ['migrations', 'migration*', 'migrate']," 'migrations: [],'
pf 'a default glob dropped: routes' "$T_FLAG" "routes: ['routes', " "routes: ["
pf 'a default glob dropped: the lockfile name' "$T_FLAG" "'package-lock.json', " ''
pf 'config replaces the sensitive globs' "$T_ADD" "const sensitive = [...SENSITIVE, ['config', extra.sensitive]];" "const sensitive = extra.sensitive.length ? [['config', extra.sensitive]] : SENSITIVE;"
pf 'config replaces the built-in containers' "$T_CONT" 'new Set([...BUILTIN_CONTAINERS, ...extra.containers])' 'new Set(extra.containers.length ? extra.containers : BUILTIN_CONTAINERS)'
T_CSPLIT='a configured container splits its children'
pf 'config containers are ignored' "$T_CSPLIT" 'out.containers.push(...names.map(containerName))' 'names.map(containerName)'
pf 'a container name is not reduced to one segment' "$T_CSPLIT" 'const s = globParts(g);' 'const s = [fold(g)];'
pf 'a container with a slash or wildcard accepted' "$T_HOSTILE" 's.length === 1 && !/[*?]/.test(s[0])' 's.length > 0'
pf 'a test file counted as production' 'a test file is not a production file' 'production: !isTest(segs)' 'production: true'
pf 'a test directory not recognised' 'a test file is not a production file' 'TEST_DIRS.has(s)' 'false'
pf 'a test file name not recognised' 'a test file is not a production file' " || TEST_FILES.some((g) => segMatch(g, segs.at(-1) ?? ''))" ''
pf 'the deny floor left out of the aggregates' "$T_DENY" 'const floor = denied ? [DENY_LIST] : [];' 'const floor = [];'
pf 'a hostile entry not floored' "$T_UNUSABLE" 'const denied = !usable || denyListed(raw);' 'const denied = usable && denyListed(raw);'
pf 'a list over the count cap classified' "$T_UNUSABLE" 'Array.isArray(paths) && paths.length <= MAX_PATHS ? paths' 'Array.isArray(paths) ? paths'
pf 'a long path echoed' "$T_UNUSABLE" "path: usable ? raw : ''," 'path: raw,'
pf 'the module key loses its container' 'one name under two containers' '`${segs[0]}/${segs[1]}`' 'segs[1]'
pf 'the module count counts files' 'one name under two containers' 'modules: new Set(files.map((f) => f.module)).size' 'modules: files.length'
pf 'a root file keyed by its name' 'module key: first segment' "if (segs.length < 2) return '';" ''
pf 'a file in a container keyed by its name' "$T_KEY" 'containers.has(head) && segs.length > 2' 'containers.has(head)'
pf 'case folding removed' 'matching is case-folded' "const fold = (s) => s.normalize('NFKC').toUpperCase().toLowerCase();" 'const fold = (s) => s;'
pf 'the module key is folded' 'the module key keeps the case' '`${segs[0]}/${segs[1]}` : segs[0]' '`${segs[0]}/${segs[1]}`.toLowerCase() : segs[0].toLowerCase()'
pf 'the container match is not folded' 'the module key keeps the case' 'const head = trim(fold(segs[0]));' 'const head = trim(segs[0]);'
T_TRIM='the trim is an extra reading'
pf 'the trimmed readings dropped' 'a trailing dot or space on a segment' '[p, trimmed(p), r, trimmed(r)]' '[p, r]'
pf 'the untrimmed readings dropped' "$T_TRIM" '[p, trimmed(p), r, trimmed(r)]' '[trimmed(p), trimmed(r)]'
T_FOLDSEP='a code point that folds to a separator'
pf 'the re-split readings dropped' "$T_FOLDSEP: the primary" '[p, trimmed(p), r, trimmed(r)]' '[p, trimmed(p)]'
pf 'the primary reading is the re-split one' "$T_FOLDSEP stays inside" 'const split = (s) => parts(s).map(fold);' 'const split = (s) => parts(fold(s));'
pf 'the test judgement reads the trimmed segments' 'a name that trims to a test directory' 'production: !isTest(segs)' 'production: !isTest(trimmed(segs))'
T_GTRIM='a glob or a container written with a trailing dot or space'
pf 'a container lookup reads the first segment as written' "$T_GTRIM" 'const head = trim(fold(segs[0]));' 'const head = fold(segs[0]);'
pf 'a container name keeps its trailing dot' "$T_GTRIM" 'const s = globParts(g); return s.length === 1' 'const s = split(g); return s.length === 1'
pf 'a glob keeps its trailing dot' "$T_GTRIM" "? globParts(glob) : ['**', ...globParts(glob)]" "? split(glob) : ['**', ...split(glob)]"
pf 'a glob that trims to nothing accepted' "$T_HOSTILE" ' && globParts(g).length > 0' ''
pf 'a glob whose trim leaves only wildcards accepted' "$T_HOSTILE" ' && !widened(g)' ''
pf 'a glob that trims to nothing is judged untrimmed' "$T_HOSTILE" 'globParts(g).length > 0' 'split(g).length > 0'
pf 'the unusable-entry module key can collide with a real segment' 'an unusable entry has a module key no real path can have' '`/?${i}`' '`?${i}`'
pf 'a glob with a slash not anchored' "$T_DIR" "/[\\\\/]/.test(glob) ? globParts(glob) : ['**', ...globParts(glob)]" "['**', ...globParts(glob)]"
pf 'a ** segment read as one segment' "$T_DIR" "part === '**'" 'part === "\0"'
pf 'a ** step restarts from every position' 'nested-quantifier shapes' 'for (let k = Math.min(...at); k <= segs.length; k++) next.add(k);' 'for (const pos of at) for (let k = pos; k <= segs.length; k++) next.add(k);'
pf 'a test directory named fixtures' 'a test file is not a production file' "'e2e', '__mocks__'" "'e2e', 'fixtures', '__mocks__'"
pf 'layers read as the last one only' 'a later layer, valid, empty' 'Array.isArray(layers) ? layers : [layers]' 'Array.isArray(layers) ? layers.slice(-1) : [layers]'
pf 'one invalid key drops the whole layer' 'one invalid key drops only itself' 'if (bounded(globs, validGlob)) out' 'if (bounded(globs, validGlob) && bounded(names, validGlob)) out'
pf 'an unusable list reported as one entry' 'an unusable list reports the counts' 'Array(MAX_PATHS).fill(null)' '[null]'
pf 'a glob no longer matches what is under its directory' "$T_DIR" 'return at.size > 0;' 'return at.has(segs.length);'
pf 'a star cannot backtrack' "$T_LIT" 'else if (star >= 0) { i = star + 1; j = ++mark; }' ''
pf 'the matcher builds a regex from config text' "$T_LIT" 'function segMatch(p, s) {' 'function segMatch(p, s) { return new RegExp(`^${p.replace(/\*/g, ".*").replace(/\?/g, ".")}$`).test(s); }
function segMatchUnused(p, s) {'
pf 'the glob length cap removed' "$T_HOSTILE" ' && g.length <= MAX_GLOB_CHARS' ''
pf 'the glob count cap off by one' "$T_HOSTILE" 'v.length <= MAX_GLOBS' 'v.length <= MAX_GLOBS + 1'
pf 'a glob with .. accepted' "$T_HOSTILE" " && !g.includes('..')" ''
pf 'an absolute glob accepted' "$T_HOSTILE" ' && !/^(?:[\\/]|[a-z]:)/i.test(g)' ''
pf 'a glob with control characters accepted' "$T_HOSTILE" '!/[\p{C}\p{Zl}\p{Zp}]/u.test(g) && ' ''
pf 'a non-array section accepted' "$T_HOSTILE" 'Array.isArray(v) && ' ''

# A stray exported seam must change nothing: the timed cost check and the real-hook parity check still run.
stray="$(env SKIP_TIMED=1 SECRET_HOOK_SOURCE=/dev/null node "$PFT" "$PF" 2>&1; env SKIP_TIMED=1 SECRET_HOOK_SOURCE=/dev/null node "$PST" "$PS" 2>&1)"
if grep -qF '  ok   nested-quantifier shapes' <<<"$stray" && grep -qF '  ok   the hook secret-name patterns and the representative table' <<<"$stray" && ! grep -qF '  skip nested-quantifier' <<<"$stray"; then ok 'a stray exported SKIP_TIMED and SECRET_HOOK_SOURCE skip and repoint nothing'; else bad 'a stray exported SKIP_TIMED or SECRET_HOOK_SOURCE changed a check'; fi

total=$((pass + fail))
echo "SUMMARY $total checks, $fail failed"
[ "$fail" = 0 ]
