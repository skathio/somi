#!/usr/bin/env bash
# Pins the definition-set digest (FR-16) in tests/evals/lib/definition-set.mjs: the committed-tree digest,
# its canonical encoding against an independent sha256sum pipeline, the clean-tree refusal (including a
# core.autocrlf checkout) and the hardening of the git child process. Hermetic: git runs only in temp
# repos built here (HOME is a temp dir, every GIT_* variable of the caller is dropped); no model, network
# or credential. Skipped in a published tarball, where tests/evals is absent by design.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: definition-set digest =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export TMP

CODE=$(cat <<'EOF'
import fs from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import * as ds from './tests/evals/lib/definition-set.mjs';
import { DEFINITION_DIRS } from './tests/evals/lib/install.mjs';
const { DEFINITION_SET_DIRS, committedEntries, digestEntries, definitionSetDigest, assertCleanTree } = ds;
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const T = process.env.TMP;
for (const k of Object.keys(process.env)) if (k.startsWith('GIT_')) delete process.env[k];
const mkHome = (n, extra = '') => { const h = `${T}/${n}`; fs.mkdirSync(h); fs.writeFileSync(`${h}/.gitconfig`, `[user]\n\tname = t\n\temail = t@t\n[init]\n\tdefaultBranch = main\n[commit]\n\tgpgsign = false\n${extra}`); return h; };
process.env.HOME = mkHome('home');
process.env.XDG_CONFIG_HOME = `${T}/xdg`;
const G = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', env: process.env, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const put = (dir, p, c) => { fs.mkdirSync(`${dir}/${p}`.replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(`${dir}/${p}`, c); };
let nr = 0;
const mk = (files) => { const d = `${T}/r${nr++}`; fs.mkdirSync(d); G(d, 'init', '-q'); for (const [p, c] of Object.entries(files)) put(d, p, c); G(d, 'add', '-A'); G(d, 'commit', '-qm', 'c'); return d; };
const commit = (d) => { G(d, 'add', '-A'); G(d, 'commit', '-qm', 'c'); };
const sha256 = (buf) => spawnSync('sha256sum', { input: buf, encoding: 'utf8' }).stdout.split(' ')[0];
const rec = (mode, type, oid, p) => Buffer.concat([Buffer.from(`${mode} ${type} ${oid}\t`), Buffer.from(p), Buffer.from([0])]);
const want = (...recs) => sha256(Buffer.concat([Buffer.from('somi-definition-set-v1\0'), ...recs]));
const D = definitionSetDigest;
const HEX = /^[0-9a-f]{64}$/;
const FILES = { 'commands/c.md': 'c\n', 'agents/a.md': 'a\n', 'skills/s/SKILL.md': 's\n', 'rules/r.md': 'r\n', 'scripts/x.mjs': 'l1\nl2\n', 'hooks/h.mjs': 'h\n', 'README.md': 'outside\n' };
const A = mk(FILES);
const base = D(A, 'HEAD');
check('the six directories, frozen', [Object.isFrozen(DEFINITION_SET_DIRS), [...DEFINITION_SET_DIRS]], [true, ['commands', 'agents', 'skills', 'rules', 'scripts', 'hooks']]);
check('install.mjs DEFINITION_DIRS is a subset of the constant', DEFINITION_DIRS.every((d) => DEFINITION_SET_DIRS.includes(d)), true);
check('the module exposes five names and no function takes a workspace path', Object.keys(ds).sort(), ['DEFINITION_SET_DIRS', 'assertCleanTree', 'committedEntries', 'definitionSetDigest', 'digestEntries']);
// The digest against an independent pipeline.
const oid = (p) => G(A, 'rev-parse', `HEAD:${p}`);
const order = ['agents/a.md', 'commands/c.md', 'hooks/h.mjs', 'rules/r.md', 'scripts/x.mjs', 'skills/s/SKILL.md'];
check('digest is 64 hex and equals sha256sum of the hand-built canonical bytes', [HEX.test(base), base], [true, want(...order.map((p) => rec('100644', 'blob', oid(p), p)))]);
check('digest is deterministic and ref spelling does not matter (HEAD, main, full id)', [D(A, 'HEAD') === base, D(A, 'main') === base, D(A, G(A, 'rev-parse', 'HEAD')) === base], [true, true, true]);
const entry = (mode, type, sha, path) => ({ mode, type, sha, path });
const s1 = 'a'.repeat(40);
const s2 = 'b'.repeat(40);
const tiny = [entry('100644', 'blob', s2, 'scripts/b'), entry('100755', 'blob', s1, 'agents/a')];
check('digestEntries of a tiny set equals the pipeline and ignores input order', [digestEntries(tiny), digestEntries([...tiny].reverse())], Array(2).fill(want(rec('100755', 'blob', s1, 'agents/a'), rec('100644', 'blob', s2, 'scripts/b'))));
check('a 64-hex object id (sha256 repository) is accepted', HEX.test(digestEntries([entry('100644', 'blob', 'c'.repeat(64), 'rules/r')])), true);
check('entries differing in any one field give different digests', [entry('100755', 'blob', s2, 'scripts/b'), entry('160000', 'commit', s2, 'scripts/b'), entry('100644', 'blob', s1, 'scripts/b'), entry('100644', 'blob', s2, 'scripts/c')].map((e) => digestEntries([e]) !== digestEntries([tiny[0]])), Array(4).fill(true));
check('a name with a newline or a tab cannot be confused with two entries', [digestEntries([entry('100644', 'blob', s1, 'rules/a\n100644 blob ' + s1 + '\trules/b')]) !== digestEntries([entry('100644', 'blob', s1, 'rules/a'), entry('100644', 'blob', s1, 'rules/b')]), digestEntries([entry('100644', 'blob', s1, 'rules/a\tb')]) !== digestEntries([entry('100644', 'blob', s1, 'rules/a'), entry('100644', 'blob', s1, 'rules/b')])], [true, true]);
const thrower = new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });
const bad = [[], null, undefined, 'x', {}, new Array(2), [null], [[]], [thrower], [{ ...tiny[0], extra: 1 }], [{ mode: '100644', type: 'blob', sha: s1 }], [entry('100644', 'commit', s1, 'rules/a')], [entry('160000', 'blob', s1, 'rules/a')], [entry('100664', 'blob', s1, 'rules/a')], [entry('__proto__', 'blob', s1, 'rules/a')], [entry('100644', 'blob', 'A'.repeat(40), 'rules/a')], [entry('100644', 'blob', 'a'.repeat(39), 'rules/a')], [entry('100644', 'blob', s1, 'docs/a')], [entry('100644', 'blob', s1, 'rulesx/a')], [entry('100644', 'blob', s1, '/rules/a')], [entry('100644', 'blob', s1, 'rules//a')], [entry('100644', 'blob', s1, 'rules/../a')], [entry('100644', 'blob', s1, 'rules/./a')], [entry('100644', 'blob', s1, 'rules/')], [entry('100644', 'blob', s1, 'rules/a\0b')], [entry('100644', 'blob', s1, 'rules/\ud800')], [entry('100644', 'blob', s1, 5)], [entry('120000', 'blob', s1, 'rules/a')], [entry('100644', 'blob', s1, 'x/.gitattributes')], [entry('100644', 'blob', s1, '.gitattributes2')], [tiny[0], tiny[0]]];
check('malformed entries, an empty set, a duplicate path or a path outside the six directories -> null', bad.map((b) => { try { return digestEntries(b); } catch { return 'THREW'; } }), bad.map(() => null));
check('a getter that flips is read once: the value validated is the value hashed', (() => { let c = 0; const e = { mode: '100644', type: 'blob', sha: s1, get path() { return c++ === 0 ? 'rules/a' : 'docs/z'; } }; return digestEntries([e]) === digestEntries([entry('100644', 'blob', s1, 'rules/a')]); })(), true);
const digests = DEFINITION_SET_DIRS.map((d) => { const f = Object.keys(FILES).find((p) => p.startsWith(`${d}/`)); put(A, f, FILES[f] + 'x'); commit(A); const v = D(A, 'HEAD'); G(A, 'reset', '-q', '--hard', 'HEAD~1'); return v; });
check('a one-byte change in each of the six directories changes the digest, each differently', [digests.every((d) => HEX.test(d) && d !== base), new Set(digests).size], [true, 6]);
put(A, 'README.md', 'changed\n'); put(A, 'docs/new.md', 'n\n'); put(A, 'tests/t.sh', 't\n'); commit(A);
check('a change outside the six directories does not change the digest', D(A, 'HEAD'), base);
fs.chmodSync(`${A}/scripts/x.mjs`, 0o755); commit(A);
check('a mode change (exec bit) changes the digest', [HEX.test(D(A, 'HEAD')), D(A, 'HEAD') !== base], [true, true]);
G(A, 'reset', '-q', '--hard', 'main'); G(A, 'tag', 'v1', 'HEAD~1');
check('a tag, a branch with a slash and a relative ref resolve', [D(A, 'v1') === base, D(A, 'HEAD~1') === base], [true, true]);
const W = mk({ 'rules/a b': '1', 'rules/q"uote': '2', 'rules/nl\nname': '3', 'rules/tab\tname': '4', 'rules/é日': '5', 'rules/-rf': '6', 'scripts/x': '7' });
fs.symlinkSync('../../etc/passwd', `${W}/hooks-link`); commit(W);
G(W, 'update-index', '--add', '--cacheinfo', `160000,${s1},skills/sub`); G(W, 'commit', '-qm', 'sub');
const ents = committedEntries(W, 'HEAD');
check('odd names come back byte for byte and the digest matches the pipeline', [ents.map((e) => e.path).sort(), D(W, 'HEAD')], [['rules/-rf', 'rules/a b', 'rules/nl\nname', 'rules/q"uote', 'rules/tab\tname', 'rules/é日', 'scripts/x', 'skills/sub'], want(...ents.map((e) => ({ ...e, b: Buffer.from(e.path) })).sort((x, y) => Buffer.compare(x.b, y.b)).map((e) => rec(e.mode, e.type, e.sha, e.path)))]);
check('a submodule is a commit entry (160000); a symlink outside the six directories is absent', [ents.find((e) => e.path === 'skills/sub'), ents.some((e) => e.path === 'hooks-link')], [{ mode: '160000', type: 'commit', sha: s1, path: 'skills/sub' }, false]);
fs.mkdirSync(`${W}/hooks`); fs.symlinkSync('../x', `${W}/hooks/ln`); commit(W);
const X = mk({ 'scripts/x': '1' }); fs.writeFileSync(Buffer.concat([Buffer.from(`${X}/scripts/bad`), Buffer.from([0xff])]), 'x'); commit(X);
check('a symlink in the six directories, or a file name that is not valid UTF-8, makes the digest and the entries null', [D(W, 'HEAD'), committedEntries(W, 'HEAD'), D(X, 'HEAD'), committedEntries(X, 'HEAD')], [null, null, null, null]);
const refs = [undefined, null, 5, '', '-', '--output=/tmp/x', '--default=HEAD', '-HEAD', 'HEAD\n', 'HEAD\nmain', ' HEAD', 'HEAD ', 'a..b', 'HEAD^{tree}', 'HEAD:scripts', 'a*', 'a\\b', 'missing', 'refs/heads/none', '0'.repeat(40), 'x'.repeat(201), 'ref\0x'];
check('a missing ref, an option-like ref, a ref with a newline or other unlisted character -> null from both functions', refs.flatMap((r) => [D(A, r), committedEntries(A, r)]), refs.flatMap(() => [null, null]));
fs.writeFileSync(`${T}/afile`, 'x'); fs.mkdirSync(`${T}/plain`);
const repos = [undefined, null, 5, '', `${T}/absent`, `${T}/afile`, `${T}/plain`, `${A}/scripts`, 'a\0b', `${A}\0`];
check('a repo argument that is missing, a file, a non-repo directory or a subdirectory of a repo -> null (a refusal for assertCleanTree)', [repos.map((r) => D(r, 'HEAD')), repos.map((r) => assertCleanTree(r)?.ok ?? null)], [repos.map(() => null), [null, null, null, null, false, false, false, false, null, null]]);
check('a malformed repo is null for a non-string and a refusal (never ok) for a path that is not a repo top level', [assertCleanTree(5), assertCleanTree(`${T}/plain`), assertCleanTree(`${A}/scripts`).ok, assertCleanTree(`${T}/absent`).ok], [null, { ok: false, reason: 'not the top level of a git working tree' }, false, false]);
// A clean tree and each way to be dirty.
const C = mk(FILES);
check('a clean tree, with a file untracked outside the six directories, is ok', [assertCleanTree(C), (put(C, 'outside.txt', 'u'), assertCleanTree(C))], [{ ok: true }, { ok: true }]);
const dirty = (setup) => { const d = mk(FILES); setup(d); const r = assertCleanTree(d); return [r.ok, r.reason]; };
check('a modified tracked file names its path', dirty((d) => put(d, 'scripts/x.mjs', 'edit')), [false, 'dirty definition-set path "scripts/x.mjs"']);
check('an untracked file in scripts/ names its path', dirty((d) => put(d, 'scripts/new.mjs', 'n')), [false, 'dirty definition-set path "scripts/new.mjs"']);
check('an untracked file in each other directory is dirty too', DEFINITION_SET_DIRS.map((x) => dirty((d) => put(d, `${x}/new`, 'n'))[0]), Array(6).fill(false));
check('a staged but uncommitted change is dirty', dirty((d) => { put(d, 'rules/r.md', 'staged'); G(d, 'add', 'rules/r.md'); }), [false, 'dirty definition-set path "rules/r.md"']);
check('a deleted tracked file and a mode change are dirty', [dirty((d) => fs.rmSync(`${d}/hooks/h.mjs`))[0], dirty((d) => fs.chmodSync(`${d}/hooks/h.mjs`, 0o755))[0]], [false, false]);
check('an ignored file in a definition-set directory is dirty (a draw would install it)', dirty((d) => { put(d, '.gitignore', 'junk\n'); G(d, 'add', '.gitignore'); G(d, 'commit', '-qm', 'i'); put(d, 'agents/junk', 'j'); }), [false, 'dirty definition-set path "agents/junk"']);
check('an index entry hidden by assume-unchanged or skip-worktree is refused though status is silent', ['--assume-unchanged', '--skip-worktree'].map((f) => dirty((d) => { put(d, 'scripts/x.mjs', 'edit'); G(d, 'update-index', f, 'scripts/x.mjs'); })), Array(2).fill([false, 'index entry hidden from status "scripts/x.mjs"']));
check('a control character in a dirty name is quoted, never printed raw', dirty((d) => put(d, 'rules/a\u001b[2Jb', 'x')), [false, 'dirty definition-set path "rules/a\\u001b[2Jb"']);
check('a dirty submodule entry (gitlink with a different commit) is dirty', dirty((d) => { G(d, 'update-index', '--add', '--cacheinfo', `160000,${s1},skills/sub`); }), [false, 'dirty definition-set path "skills/sub"']);
const SM = mk({ x: '1' }); const SD = mk(FILES); G(SD, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', SM, 'skills/sub'); G(SD, 'config', '-f', '.gitmodules', 'submodule.skills/sub.ignore', 'all'); commit(SD); put(SD, 'skills/sub/x', 'edited');
check('an edited submodule worktree is dirty although .gitmodules says ignore=all (plain status is blind to it)', [G(SD, 'status', '--porcelain'), assertCleanTree(SD)], ['', { ok: false, reason: 'dirty definition-set path "skills/sub"' }]);
const GA = mk(FILES); put(GA, 'x/.gitattributes', 'a'); put(GA, '.gitattributes2', 'b'); commit(GA); const g1 = D(GA, 'HEAD'); put(GA, '.gitattributes', '* text eol=crlf\n'); commit(GA);
check('no root .gitattributes digests as before and a nested or look-alike one changes nothing; the root one changes the digest and is accepted as an entry', [D(mk(FILES), 'HEAD') === base, g1 === base, HEX.test(D(GA, 'HEAD')) && D(GA, 'HEAD') !== g1, HEX.test(digestEntries([entry('100644', 'blob', s1, '.gitattributes')]))], [true, true, true, true]);
check('an uncommitted edit of the root .gitattributes, or a new untracked one, is dirty', [(put(GA, '.gitattributes', 'edit'), assertCleanTree(GA)), dirty((d) => put(d, '.gitattributes', 'n'))], [{ ok: false, reason: 'dirty definition-set path ".gitattributes"' }, [false, 'dirty definition-set path ".gitattributes"']]);
// core.autocrlf: the real CRLF risk. ls-tree never reads the working tree; the clean decision must not misfire.
const L = mk(FILES);
G(T, 'clone', '-q', '-c', 'core.autocrlf=true', L, `${T}/crlf`);
check('a checkout with core.autocrlf=true holds CRLF bytes yet is clean and has the LF checkout digest', [fs.readFileSync(`${T}/crlf/scripts/x.mjs`, 'utf8'), assertCleanTree(`${T}/crlf`), D(`${T}/crlf`, 'HEAD') === D(L, 'HEAD')], ['l1\r\nl2\r\n', { ok: true }, true]);
G(`${T}/crlf`, 'config', 'core.autocrlf', 'false'); fs.utimesSync(`${T}/crlf/scripts/x.mjs`, new Date(), new Date(Date.now() + 5000));
check('control: the same CRLF bytes read without autocrlf are dirty, also after a plain status refreshed the index (the test can fail)', [assertCleanTree(`${T}/crlf`).ok, (G(`${T}/crlf`, 'status', '--porcelain'), assertCleanTree(`${T}/crlf`).ok)], [false, false]);
const home2 = mkHome('home2', '[core]\n\tautocrlf = true\n');
const keep = process.env.HOME; process.env.HOME = home2;
G(T, 'clone', '-q', L, `${T}/crlf2`);
check('a global autocrlf (the user config) is honoured: that checkout is clean', [fs.readFileSync(`${T}/crlf2/scripts/x.mjs`, 'utf8'), assertCleanTree(`${T}/crlf2`)], ['l1\r\nl2\r\n', { ok: true }]);
process.env.HOME = keep;
// The caller's environment and the repository's own config must not redirect or run anything.
const O = mk({ 'rules/other.md': 'other\n' });
const envs = { GIT_DIR: `${O}/.git`, GIT_WORK_TREE: O, GIT_INDEX_FILE: `${T}/nope-index`, GIT_EXEC_PATH: `${T}/nope`, GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: `${T}/plain`, GIT_CONFIG_GLOBAL: `${T}/nope`, GIT_NO_REPLACE_OBJECTS: '0', LD_PRELOAD: `${T}/nope.so` };
Object.assign(process.env, envs);
const viaEnv = [D(A, 'v1'), D(C, 'HEAD'), assertCleanTree(C)];
for (const k of Object.keys(envs)) delete process.env[k];
check('GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_EXEC_PATH, GIT_CONFIG_*, LD_PRELOAD in the caller change nothing', viaEnv, [base, D(C, 'HEAD'), assertCleanTree(C)]);
const H = mk(FILES);
fs.writeFileSync(`${T}/fsm.sh`, `#!/bin/sh\ntouch ${T}/fsm-marker\nprintf 'tok\\0'\n`, { mode: 0o755 });
fs.mkdirSync(`${H}/.git/hooks`, { recursive: true });
fs.writeFileSync(`${H}/.git/hooks/post-index-change`, `#!/bin/sh\ntouch ${T}/hook-marker\n`, { mode: 0o755 });
G(H, 'config', 'core.fsmonitor', `${T}/fsm.sh`); G(H, 'config', 'core.hooksPath', `${H}/.git/hooks`); G(H, 'config', 'core.fileMode', 'false');
fs.utimesSync(`${H}/scripts/x.mjs`, new Date(), new Date(Date.now() + 5000));
execFileSync('git', ['-C', H, 'status', '--porcelain'], { env: process.env, stdio: 'ignore' });
const exists = (f) => fs.existsSync(`${T}/${f}`);
check('control: plain git status in that repo runs the fsmonitor command and the index hook', [exists('fsm-marker'), exists('hook-marker')], [true, true]);
fs.rmSync(`${T}/fsm-marker`); fs.rmSync(`${T}/hook-marker`); fs.utimesSync(`${H}/rules/r.md`, new Date(), new Date(Date.now() + 9000));
const hv = [D(H, 'HEAD'), assertCleanTree(H)];
// The hooksPath pin is defence in depth: with --no-optional-locks the index is never written, so no hook fires either way.
check('the same repo through the module runs no fsmonitor command, and still digests and reads clean', [exists('fsm-marker'), hv[0] === base, hv[1]], [false, true, { ok: true }]);
fs.chmodSync(`${H}/hooks/h.mjs`, 0o755);
check('core.fileMode=false in the repo config does not hide a mode change', assertCleanTree(H).ok, false);
const K = mk(FILES); G(K, 'config', 'core.checkStat', 'minimal'); G(K, 'config', 'core.trustctime', 'false');
const kx = `${K}/scripts/x.mjs`; const t0 = new Date(Date.now() - 86400000); fs.utimesSync(kx, t0, t0); G(K, 'update-index', '--refresh'); spawnSync('sleep', ['1.1']);
fs.writeFileSync(kx, 'L1\nL2\n'); fs.utimesSync(kx, t0, t0);
check('a same-size rewrite with the old mtime is dirty although the repo config trusts less stat data (plain status is blind to it)', [G(K, 'status', '--porcelain'), assertCleanTree(K).ok], ['', false]);
const R = mk(FILES);
const first = G(R, 'rev-parse', 'HEAD'); const dg = D(R, first);
put(R, 'scripts/x.mjs', 'swapped'); commit(R); G(R, 'replace', first, 'HEAD');
check('a replace ref cannot swap the tree behind a commit id', D(R, first), dg);
// A git failure is a refusal: fake git on PATH.
const bin = `${T}/bin`; fs.mkdirSync(bin);
const fake = (body) => { fs.writeFileSync(`${bin}/git`, `#!/bin/sh\n${body}\n`, { mode: 0o755 }); const keepPath = process.env.PATH; process.env.PATH = `${bin}:${keepPath}`; try { return [D(A, 'HEAD'), assertCleanTree(C)]; } finally { process.env.PATH = keepPath; } };
const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
const but = (word) => `case "$*" in *${word}*) ${word === 'huge' ? 'head -c 17000000 /dev/zero' : 'exit 1'};; *) exec ${real} "$@";; esac`;
check('git that fails, or prints more than the output cap, gives null and a refusal', [fake('exit 1'), fake('head -c 17000000 /dev/zero')], [[null, { ok: false, reason: 'not the top level of a git working tree' }], [null, { ok: false, reason: 'not the top level of a git working tree' }]]);
check('status failing alone is not read as clean, and neither is ls-files failing alone', [fake(but('status'))[1], fake(but('ls-files'))[1], fake(but('ls-tree'))[0]], [{ ok: false, reason: 'git could not report the tree state' }, { ok: false, reason: 'git could not report the tree state' }, null]);
for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got) + ')'));
EOF
)
out=$(node --input-type=module -e "$CODE" 2>&1) || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"
ran=$((pass + fail))
[ "$ran" -ge 45 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 45 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
