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
  if printf '%s\n' "$out" | grep -qF "  FAIL $named"; then ok "mutation '$label' turns '$named' red"; else bad "mutation '$label' did not turn '$named' red"; fi
}

# ---- scripts/lib/path-safety.mjs ----
echo "== fact sheet: path safety =="
PS="$ROOT/scripts/lib/path-safety.mjs"; PST="$ROOT/tests/scripts/lib/path-safety-tests.mjs"
run_suite "$PST" "$PS"
ps() { mutate "$PST" "$PS" "$@"; }
T_STAT='a deny-listed name is decided without any filesystem call'
ps 'deny-list stats the file' "$T_STAT" "if (denied) return { kind: 'denied' };" "if (denied) { try { fs.lstatSync(root); } catch { /* the probe is the call itself */ } return { kind: 'denied' }; }"
ps 'refusal drops the denied fact' 'a malformed deny-listed name returns the refusal id' 'if (bad) return refused(bad, denied);' 'if (bad) return refused(bad);'
ps 'case folding removed' 'denies case variants' ".normalize('NFKC').toLowerCase()" ".normalize('NFKC')"
ps 'compatibility normalisation removed' 'denies a name written with another separator' ".normalize('NFKC').toLowerCase()" '.toLowerCase()'
ps 'backslash not a separator in the deny test' 'denies a name written with another separator' '.toLowerCase().split(SEPARATORS)' ".toLowerCase().split('/')"
ps 'trailing dot and space not stripped' 'denies a name written with another separator' 'trimDots(segment)' 'segment'
T_BIG='a huge name is refused as path_length'
ps 'the raw-length bound removed' "$T_BIG" 'if (raw.length > MAX_PATH_CHARS) return true;' ''
ps 'the regex trim restored without the bound' "$T_BIG" "if (raw.length > MAX_PATH_CHARS) return true;
  return raw.normalize('NFKC').toLowerCase().split(SEPARATORS).some((segment) => {
    const name = trimDots(segment);" "return raw.normalize('NFKC').toLowerCase().split(SEPARATORS).some((segment) => {
    const name = segment.replace(/[. ]+\$/, '');"
ps 'the short-name rule removed' 'denies Windows short names' '/~\d/.test(name) || ' ''
ps 'the stream-suffix rule removed' 'denies Windows short names' "name.includes(':') || " ''
ps 'the short-name rule over-matches a bare tilde' 'does not deny look-alikes' '/~\d/' '/~/'
ps 'the .ssh segment not matched' 'denies .env, key and certificate' "'.ssh', " ''
ps 'the .tfvars suffix not matched' 'denies .env, key and certificate' "'.tfvars', " ''
ps 'the .npmrc name not matched' 'denies .env, key and certificate' "'.npmrc', " ''
ps 'the realpath re-check removed' 'a path whose canonical on-disk spelling is a denied name' "if (denyListed(rel)) return { kind: 'denied' };" ''
ps 'the .git segment not matched' 'denies .env, key and certificate' "NAME_EXACT.includes(name) || " ''
ps 'the .env prefix not matched' 'denies .env, key and certificate' "'.env', " ''
ps 'id_rsa not matched' 'denies .env, key and certificate' "'id_rsa', " ''
ps 'the .pfx suffix not matched' 'denies .env, key and certificate' "'.pfx', " ''
ps 'the deny list over-matches .gitignore' 'does not deny look-alikes' "NAME_EXACT.includes(name)" "name.startsWith('.git')"
ps 'the absolute check removed' 'refuses an absolute path' "if (ABSOLUTE.test(raw)) return 'absolute';" ''
ps 'the parent-segment check removed' 'refuses a parent segment' "if (segments.some((s) => PARENT_SEGMENT.test(s))) return 'traversal';" ''
ps 'control characters allowed' 'refuses NUL and control' '[\p{Cc}\p{Cf}' '[\p{Cf}'
ps 'bidi characters allowed' 'refuses bidi' '[\p{Cc}\p{Cf}' '[\p{Cc}'
ps 'a non-string name read as text' 'refuses an empty' "if (typeof raw !== 'string') return 'malformed';" ''
ps 'the length cap off by one' 'refuses a name over the length cap' 'raw.length > MAX_PATH_CHARS' 'raw.length >= MAX_PATH_CHARS'
ps 'the count cap off by one' 'refuses a list over the count cap' 'paths.length <= MAX_PATHS' 'paths.length < MAX_PATHS'
ps 'the list refusal drops the denied fact' 'a list over the cap keeps the denied fact' 'paths.some(denyListed)' 'false'
ps 'a symlink component allowed' 'refuses a symlinked file' "if (stat.isSymbolicLink()) return { result: refused('symlink') };" ''
ps 'an escape outside the root allowed' 'refuses a path whose canonical form leaves the root' 'rel.startsWith(`..${path.sep}`) ||' ''
ps 'the root itself allowed' 'refuses a path whose canonical form leaves the root' "rel === '' ||" ''
ps 'the parent of the root allowed' 'refuses a path whose canonical form leaves the root' "rel === '..' ||" ''
ps 'a name starting with two dots read as an escape' 'a file whose name begins with two dots' 'rel.startsWith(`..${path.sep}`)' "rel.startsWith('..')"
[ "$(id -u)" = 0 ] || ps 'a non-ENOENT lstat error read as a missing file' 'a file in an unreadable directory' "if (e.code !== 'ENOENT') return { result: refused('unreadable') };" ''
ps 'the walk splits on slashes only' 'refuses a parent segment' 'raw.split(SEPARATORS).filter' "raw.split('/').filter"
ps 'a final non-file is opened' 'a path that does not exist, a directory or a FIFO opens nothing' "if (i === segments.length - 1 && !stat.isFile()) return { result: refused('not_file') };" ''
ps 'a probe error is rethrown' 'an error from the probe is a refusal' "return refused('probe');" "throw new Error('PROBEMSG');"
ps 'a missing parent allowed' 'refuses a directory, a path through a file' "if (i < segments.length - 1) return { result: refused('no_parent') };" ''
ps 'a file read as a directory' 'refuses a directory, a path through a file' 'i < segments.length - 1 && !stat.isDirectory()' 'false'
ps 'a directory or device read as a file' 'refuses a directory, a path through a file' "if (!stat.isFile()) throw Object.assign(new Error(), { refusal: 'not_file' });" ''
ps 'the size cap not applied' 'refuses a file over the size cap' 'stat.size > MAX_FILE_BYTES' 'false'
ps 'the size cap off by one' 'refuses a file over the size cap' 'stat.size > MAX_FILE_BYTES' 'stat.size >= MAX_FILE_BYTES'
ps 'the open can block on a FIFO' 'a FIFO is refused and the call returns' ' | constants.O_NONBLOCK' ''
ps 'the open follows a link' 'refuses a link swapped in after the check' ' | constants.O_NOFOLLOW' ''
ps 'no platform check' 'fails closed with `platform`' "if (!(constants.O_NOFOLLOW > 0 && constants.O_NONBLOCK > 0)) return refused('platform');" ''
ps 'the platform check ignores O_NONBLOCK' 'fails closed with `platform`' ' && constants.O_NONBLOCK > 0' ''
ps 'the descriptor is leaked after a probe' 'the descriptor is closed after a probe' 'fs.closeSync(opened.fd);' ''
ps 'the descriptor is leaked on a refusal' 'the descriptor is closed after a probe' 'fs.closeSync(fd);' ''
ps 'the probe answer is passed through' 'the probe gets an open descriptor and the size and its answer is a boolean' 'probe(opened.fd, opened.size) === true' 'probe(opened.fd, opened.size)'
ps 'an unreadable root is read through' 'an unreadable root is refused' "} catch {
    return refused('unreadable');
  }
  if (found.result)" "} catch {
    return { kind: 'contained', exists: false, rel: '' };
  }
  if (found.result)"

total=$((pass + fail))
echo "SUMMARY $total checks, $fail failed"
[ "$fail" = 0 ]
