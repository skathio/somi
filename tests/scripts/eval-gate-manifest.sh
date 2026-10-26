#!/usr/bin/env bash
# Pins the scope manifest walk and verdict (FR-8c, FR-39) in tests/evals/lib/manifest.mjs: links refused with
# nothing opened through them, open flags, swaps after lstat, special files, .git, name, mode and device rules,
# caps at both sides, sorted output, scope matching. Hermetic: temp directories outside the repository only.
# Skipped in a tarball, where tests/evals is absent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: scope manifest =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export TMP

CODE=$(cat <<'EOS'
import fs from 'node:fs';
import net from 'node:net';
import { spawnSync } from 'node:child_process';
import * as M from './tests/evals/lib/manifest.mjs';
const { lstatManifest: L, scopeVerdict: S } = M;
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const T = process.env.TMP;
process.umask(0o022); const CWD = process.cwd(); const LIB = `${CWD}/tests/evals/lib/manifest.mjs`;
let n = 0;
const put = (d, p, c = 'x') => { fs.mkdirSync(`${d}/${p}`.replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(`${d}/${p}`, c); };
const tree = (files = {}) => { const d = `${T}/d${n++}`; fs.mkdirSync(d); for (const [p, c] of Object.entries(files)) put(d, p, c); return d; };
const sparse = (p, size) => { const fd = fs.openSync(p, 'w'); fs.ftruncateSync(fd, size); fs.closeSync(fd); };
const rec = (h = {}) => { const log = { open: [], flags: [], opendir: [] }; const w = { ...fs, constants: fs.constants,
  openSync: (p, fl, ...a) => { log.open.push(p); log.flags.push(fl); h.open?.(p); return fs.openSync(p, fl, ...a); },
  opendirSync: (p, ...a) => { log.opendir.push(p); return fs.opendirSync(p, ...a); },
  lstatSync: (p, ...a) => { h.lstat?.(p); return fs.lstatSync(p, ...a); },
  readSync: (...a) => { h.read?.(); return fs.readSync(...a); } }; return [w, log]; };
const inChild = (dir) => { const r = spawnSync(process.execPath, ['--input-type=module', '-e', `import {lstatManifest} from ${JSON.stringify(LIB)}; console.log(JSON.stringify(lstatManifest(process.argv[1])));`, dir], { timeout: 5000, encoding: 'utf8' }); return r.error || r.status !== 0 ? 'HUNG-OR-FAILED' : JSON.parse(r.stdout); };
const sha = (p) => spawnSync('sha256sum', [p], { encoding: 'utf8' }).stdout.split(' ')[0];
const refuse = (reason, path) => ({ ok: false, reason, path });
const names = (r) => r.files.map((e) => e[0]);
check('the module exposes eight names; the caps are the documented numbers', [Object.keys(M).sort(), M.MAX_ENTRIES, M.MAX_DEPTH, M.MAX_FILE_BYTES, M.MAX_TOTAL_BYTES], [['MAX_DEPTH', 'MAX_ENTRIES', 'MAX_FILE_BYTES', 'MAX_TOTAL_BYTES', 'esc', 'lstatManifest', 'scopeVerdict', 'validPath'], 20000, 32, 16777216, 268435456]);
const A = tree({ 'b.txt': 'hello\n', 'sub/c.txt': 'c', 'empty': '' });
const ra = L(A); const [wf, lf] = rec(); L(A, { fs: wf });
check('every file is opened with O_NOFOLLOW and O_NONBLOCK set', [lf.flags.length, lf.flags.every((fl) => (fl & fs.constants.O_NOFOLLOW) && (fl & fs.constants.O_NONBLOCK))], [3, true]);
check('regular files only, sha256 equal to sha256sum, sorted, empty directories absent', [names(ra), ra.files[0][1] === sha(`${A}/b.txt`) ? 'same' : 'differs'], [['b.txt', 'empty', 'sub/c.txt'], 'same']);
fs.mkdirSync(`${A}/emptydir`); check('an empty directory changes nothing', L(A), ra);
const bad = [undefined, null, 5, '', 'a\0b', {}, [], `${A}\0`];
check('a malformed root -> null', bad.map((r) => L(r)), bad.map(() => null));
const badOpts = [null, 5, [], {}, { x: 1 }, { fs: {} }, { fs: null }, { fs: { ...fs, openSync: 5 } }, { fs, extra: 1 }, { fs: { ...fs, constants: undefined } }];
check('a malformed options argument or injected fs -> null', badOpts.map((o) => L(A, o)), badOpts.map(() => null));
check('a missing root and a root that is a file are refusals', [L(`${T}/absent`), L(`${A}/b.txt`)], [refuse('io-error', '.'), refuse('not-a-directory', '.')]);
// Links: rejected, and nothing is opened through them (no open at all: the walk finishes before any read).
const FIFO = `${T}/fifo`; spawnSync('mkfifo', [FIFO]);
fs.mkdirSync(`${T}/outside`); fs.writeFileSync(`${T}/outside/secret`, 's');
const links = { 'a file': (d) => fs.symlinkSync('a.txt', `${d}/z`), 'a directory': (d) => fs.symlinkSync('sub', `${d}/z`), dangling: (d) => fs.symlinkSync('nowhere', `${d}/z`), 'a target outside root': (d) => fs.symlinkSync(`${T}/outside/secret`, `${d}/z`), 'a directory outside root': (d) => fs.symlinkSync(`${T}/outside`, `${d}/z`), 'a FIFO': (d) => fs.symlinkSync(FIFO, `${d}/z`) };
for (const [what, mk] of Object.entries(links)) {
  const d = tree({ 'a.txt': 'a', 'sub/s': 's' }); mk(d);
  const [w, log] = rec();
  check(`a symlink to ${what} is refused naming it, and no file or link is opened`, [L(d, { fs: w }), log.open, log.opendir.every((p) => !p.endsWith('/z'))], [refuse('symlink', 'z'), [], true]);
}
const dl = tree({ 'a.txt': 'a', 'n/x': 'x' }); fs.symlinkSync(FIFO, `${dl}/n/link`);
check('a nested link whose target is a FIFO: the walk returns (a read would block) and refuses it', inChild(dl), refuse('symlink', 'n/link'));
const rl = `${T}/rootlink`; fs.symlinkSync(A, rl);
check('a symlinked root is refused, with or without a trailing slash', [L(rl), L(`${rl}/`)], [refuse('symlink', '.'), refuse('symlink', '.')]);
// Special files are never opened.
const sp = tree({ 'a.txt': 'a' }); spawnSync('mkfifo', [`${sp}/p`]);
const [w1, log1] = rec();
check('a FIFO entry is refused without being opened (and the walk returns in a child process)', [L(sp, { fs: w1 }), log1.open, inChild(sp)], [refuse('special-file', 'p'), [], refuse('special-file', 'p')]);
const so = tree({ 'a.txt': 'a' }); const srv = net.createServer(); process.chdir(so); await new Promise((ok) => srv.listen('sock', ok)); process.chdir(CWD);
const [w2, log2] = rec();
check('a socket entry is refused without being opened', [L(so, { fs: w2 }), log2.open], [refuse('special-file', 'sock'), []]);
srv.close();
// .git: only the root-level one is skipped.
const G = tree({ 'a.txt': 'a', '.git/HEAD': 'h', '.git/objects/o': 'o', 'sub/.git/x': 'nested' });
check('a root .git directory is ignored; a nested .git is walked like any directory', names(L(G)), ['a.txt', 'sub/.git/x']);
const GF = tree({ 'a.txt': 'a', '.git': 'gitdir: /somewhere/else\n' });
const ls = tree({ 'sub/.git': 'x' });
check('a root .git FILE (a gitdir pointer) is ignored; a .git file below the root is a plain file', [names(L(GF)), names(L(ls))], [['a.txt'], ['sub/.git']]);
const GL = tree({ 'a.txt': 'a' }); fs.symlinkSync('a.txt', `${GL}/.git`); const GP = tree({ 'a.txt': 'a' }); spawnSync('mkfifo', [`${GP}/.git`]);
check('a root .git that is a symlink or a FIFO is still refused', [L(GL), L(GP)], [refuse('symlink', '.git'), refuse('special-file', '.git')]);
// Swaps after lstat: O_NOFOLLOW, the inode check, the directory re-check.
const swap1 = tree({ 'a.txt': 'a', 'x': 'xxxx' }); const [w3] = rec({ open: (p) => { if (p.endsWith('/x')) { fs.unlinkSync(p); fs.symlinkSync(`${T}/outside/secret`, p); } } });
check('a file swapped for a symlink after lstat is caught by O_NOFOLLOW', L(swap1, { fs: w3 }), refuse('symlink', 'x'));
const swap2 = tree({ 'a.txt': 'a', 'x': 'xxxx' }); const [w4] = rec({ open: (p) => { if (p.endsWith('/x')) { fs.writeFileSync(`${T}/repl`, 'yyyy'); fs.renameSync(`${T}/repl`, p); } } });
check('a regular file swapped for another of the same size is caught by the inode check alone', L(swap2, { fs: w4 }), refuse('changed', 'x'));
const swap3 = tree({ 'a.txt': 'a', 'x': 'xxxx' }); const [w5] = rec({ open: (p) => { if (p.endsWith('/x')) fs.appendFileSync(p, 'more'); } });
check('a file that changed size between lstat and open is refused', L(swap3, { fs: w5 }), refuse('changed', 'x'));
const swap4 = tree({ 'd/f': 'f' }); let seen = 0; const [w6] = rec({ lstat: (p) => { if (p.endsWith('/d') && ++seen === 2) { fs.renameSync(p, `${p}.moved`); fs.symlinkSync(`${T}/outside`, p); } } });
check('a directory swapped for a link while it was listed is refused', L(swap4, { fs: w6 }), refuse('changed', 'd'));
let nr = 0; const grow = tree({ 'x': 'xxxx' }); const [w7] = rec({ read: () => { nr++; if (fs.statSync(`${grow}/x`).size < 9) fs.appendFileSync(`${grow}/x`, 'grown'); } });
const shrink = tree({ 'x': 'xxxxxxxx' }); const [w8] = rec({ read: () => fs.truncateSync(`${shrink}/x`, 2) });
check('a file that grows (stopping at the first read) or shrinks while being read is refused, not hashed short', [L(grow, { fs: w7 }), L(shrink, { fs: w8 }), nr], [refuse('changed', 'x'), refuse('changed', 'x'), 1]);
const sw5 = tree({ x: 'xxxx' }); const [w10] = rec({ open: (p) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30); fs.chmodSync(p, 0o600); } });
check('a same-inode, same-size file whose ctime changed between lstat and open is refused', L(sw5, { fs: w10 }), refuse('changed', 'x'));
const notf = tree({ 'x': 'x' }); const [w9a] = rec(); const nf = { ...w9a, fstatSync: (fd, o) => Object.create(fs.fstatSync(fd, o), { isFile: { value: () => false } }) }; check('an fd that is not a regular file is refused even when dev, ino and size match', L(notf, { fs: nf }), refuse('changed', 'x'));
const boom = tree({ 'x': 'x' }); check('an fs error while listing or opening is a refusal naming the path', [L(boom, { fs: { ...fs, opendirSync: () => { throw new Error('boom'); } } }), L(boom, { fs: { ...fs, openSync: () => { throw new Error('boom'); } } })], [refuse('io-error', '.'), refuse('io-error', 'x')]);
const odd = (bytes) => { const d = tree({ 'a.txt': 'a' }); fs.writeFileSync(Buffer.concat([Buffer.from(`${d}/`), Buffer.from(bytes)]), 'x'); return L(d); };
const badNames = [[0xff, 0x41], [0x61, 0x0a, 0x62], [0x1b, 0x5b, 0x32, 0x4a], [0x61, 0x5c, 0x62], [0x7f], [0xc2, 0x85], [0x65, 0xcc, 0x81], [0xed, 0xa0, 0x80], [0xc0, 0xaf], [0xe2, 0x80, 0xae], [0xe2, 0x80, 0x8b], [0xe2, 0x80, 0xa8], [0xef, 0xbb, 0xbf]];
const rb = badNames.map((b) => odd(b));
check('non-UTF-8, control (C0, DEL, C1), bidi, zero-width, line-separator, BOM, backslash, non-NFC and surrogate names are refused as bad-name', rb.map((r) => r.reason), badNames.map(() => 'bad-name'));
check('the path in such a refusal is printable ASCII only', rb.every((r) => /^[\x20-\x7e]+$/.test(r.path)), true);
check('a name of 255 bytes (the filesystem maximum) is accepted', L(tree({ ['a'.repeat(255)]: 'x' })).ok, true);
check('setuid, setgid and world-writable files are refused as unsafe-mode', [0o4755, 0o2755, 0o666].map((m) => { const d = tree({ x: 'x' }); fs.chmodSync(`${d}/x`, m); return L(d).reason; }), Array(3).fill('unsafe-mode'));
check('a directory on another device than the root is refused as a mount-point', L(tree({ 'sub/x': 'x' }), { fs: { ...fs, lstatSync: (q, o) => { const st = fs.lstatSync(q, o); return q.endsWith('/sub') ? Object.create(st, { dev: { value: st.dev + 1n } }) : st; } } }), refuse('mount-point', 'sub'));
check('a name returned twice by the listing is refused as a duplicate', L(tree(), { fs: { ...fs, opendirSync: () => { const e = [Buffer.from('x'), Buffer.from('x')]; return { readSync: () => { const b = e.shift(); return b ? { name: b } : null; }, closeSync() {} }; } } }), refuse('duplicate', '.'));
const uni = tree({ 'é日 x"y\'z': '1', 'é日 x"y\'Z': '2', 'a.b': '3' });
check('NFC unicode, spaces and quotes are fine, and case-variants stay distinct paths', names(L(uni)), ["a.b", 'é日 x"y\'Z', 'é日 x"y\'z']);
const mkMany = (order) => { const d = tree(); const all = []; for (let i = 0; i < 2000; i++) all.push(`d${i % 7}/f${i}`); all.push('a.b', 'a/b', 'Z', 'a0', 'é', 'z'); for (const p of order(all)) put(d, p, p); return d; };
const m1 = L(mkMany((x) => x)); const m2 = L(mkMany((x) => [...x].reverse()));
const sortedOk = m1.files.every((e, i) => i === 0 || Buffer.compare(Buffer.from(m1.files[i - 1][0]), Buffer.from(e[0])) < 0);
check('2,000+ files: identical across creation orders and runs, sorted by UTF-8 bytes', [m1.files.length, JSON.stringify(m1) === JSON.stringify(m2), JSON.stringify(m1) === JSON.stringify(L(mkMany((x) => x))), sortedOk], [2006, true, true, true]);
check('byte order, not locale order: Z < a.b < a/b < a0 < z < é', ['Z', 'a.b', 'a/b', 'a0', 'z', 'é'].every((p, i) => names(m1).filter((q) => !q.startsWith('d'))[i] === p), true);
let rd = 0; const cap = { ...fs, opendirSync: (q, o) => { const d = fs.opendirSync(q, o); const rs = d.readSync.bind(d); d.readSync = () => { rd++; return rs(); }; return d; } };
const many = (k) => { const d = tree(); for (let i = 0; i < k; i++) fs.writeFileSync(`${d}/f${i}`, ''); return d; };
check('20,000 entries are accepted, 20,001 refused (not truncated) after reading at most 20,001', [L(many(20000)).files?.length, L(many(20001), { fs: cap }).reason, rd - 20001], [20000, 'too-many-entries', 0]);
const spread = tree(); fs.mkdirSync(`${spread}/a`); for (let i = 0; i < 15000; i++) fs.writeFileSync(`${spread}/a/f${i}`, ''); for (let i = 0; i < 10000; i++) fs.writeFileSync(`${spread}/b${i}`, '');
check('the entry cap counts across directories (no one directory is over it): 20,001 entries refused', L(spread).reason, 'too-many-entries');
const deep = (k) => { const d = tree(); fs.mkdirSync(`${d}/${Array(k).fill('d').join('/')}`, { recursive: true }); put(d, `${Array(k).fill('d').join('/')}/f`); return d; };
check('depth 32 is accepted, depth 33 refused', [L(deep(32)).ok, L(deep(33)).reason], [true, 'too-deep']);
const big = tree(); sparse(`${big}/ok`, M.MAX_FILE_BYTES); const big2 = tree(); sparse(`${big2}/over`, M.MAX_FILE_BYTES + 1);
check('a file of exactly 16 MiB is accepted, one byte more refused', [L(big).ok, L(big2)], [true, refuse('file-too-large', 'over')]);
const tot = (k) => { const d = tree(); for (let i = 0; i < k; i++) sparse(`${d}/f${String(i).padStart(2, '0')}`, M.MAX_FILE_BYTES); return d; };
const [w9, log9] = rec(); const t17 = L(tot(17), { fs: w9 });
check('16 files of 16 MiB (exactly the total cap) are accepted; 17 are refused before any is read', [L(tot(16)).ok, t17, log9.open], [true, refuse('too-large', 'f16'), []]);
const seg = 'p'.repeat(200); const nest = (k, leaf) => { const d = tree(); put(d, `${Array(k).fill(seg).join('/')}/${leaf}`); return d; };
check('a path of 1,000 bytes is accepted and one over 1,024 refused', [L(nest(4, 'f')).ok, L(nest(5, 'f'.repeat(30))).reason], [true, 'path-too-long']);
const hl = tree({ 'a.txt': 'a' }); fs.linkSync(`${T}/outside/secret`, `${hl}/hard`);
check('residual: a hard link to a file outside root is accepted as a regular file (only the container stops it)', names(L(hl)), ['a.txt', 'hard']);
const D = { source: { files: ['lib/one.js'], dirs: ['src'] }, testDir: 'test', rootFiles: ['package.json'] };
const BASE = { 'src/a.js': 'a', 'src/deep/b.js': 'b', 'lib/one.js': '1', 'lib/two.js': '2', 'test/t.js': 't', 'package.json': '{}', 'docs/d.md': 'd', 'README.md': 'r', '.somi/n': 'n' };
const change = (mut, decl = D) => { const d = tree(BASE); const b = L(d); mut(d); return S({ before: b, after: L(d), declared: decl }); };
const inS = (mut) => change(mut).verdict;
check('a change in source dir, test dir, a tolerated root file, the declared file and .somi passes', [inS((d) => put(d, 'src/a.js', 'A')), inS((d) => put(d, 'src/deep/new/c.js')), inS((d) => put(d, 'test/t.js', 'T')), inS((d) => put(d, 'package.json', '{"a":1}')), inS((d) => put(d, 'lib/one.js', 'X')), inS((d) => put(d, '.somi/x/y'))], Array(6).fill('in-scope'));
check('removing and adding inside scope pass; no change passes', [inS((d) => fs.rmSync(`${d}/src/a.js`)), inS((d) => put(d, 'test/new.js')), inS(() => {})], Array(3).fill('in-scope'));
check('a change outside names the path (also when added or removed)', [change((d) => put(d, 'docs/d.md', 'D')), change((d) => put(d, 'new.txt')).path, change((d) => fs.rmSync(`${d}/README.md`)).path], [{ verdict: 'out-of-scope', reason: 'out of scope: docs/d.md changed', path: 'docs/d.md' }, 'new.txt', 'README.md']);
check('the first offender in byte order is named, whatever the change order', change((d) => { put(d, 'z/1'); put(d, 'docs/x'); put(d, 'src/ok'); }).path, 'docs/x');
const widen = ['SRC/x', 'src2/x', 'Src/a.js', 'lib/one.js/evil', 'lib/One.js', 'lib/two.js', 'test2/x', 'Test/x', 'sub/package.json', 'package.json/x', '.somi2/x', '.SOMI/x', 'a/.somi/x'];
check('a case variant, a sibling prefix, a file used as a dir or a nested root file do not widen scope', widen.map((p) => change((d) => { const par = p.split('/').slice(0, -1).join('/'); if (par && fs.existsSync(`${d}/${par}`) && fs.statSync(`${d}/${par}`).isFile()) fs.rmSync(`${d}/${par}`); put(d, p); }).path), widen);
check('a declared file covers only itself; a declared dir only its subtree; a bare .somi file is not tolerated', [S({ before: L(tree({ 'f': '1' })), after: L(tree({ 'f': '2' })), declared: { source: { files: ['f'], dirs: [] }, testDir: 't', rootFiles: [] } }).verdict, S({ before: L(tree()), after: L(tree({ 'src': 'x' })), declared: D }).path, S({ before: L(tree()), after: L(tree({ '.somi': 'x' })), declared: D }).path], ['in-scope', 'src', '.somi']);
const decls = ['../x', '/etc', '/', 'src/', './src', 'a//b', 'a\\b', 'a\0b', '', '.', '..', 'a/./b', 'a/..', 'a/../b', 'é', 'a\nb', 'a\ud800', ' '.repeat(2000), 5, null, ['a']];
const withSrc = decls.map((p) => ({ ...D, source: { files: [p], dirs: ['src'] } }));
const withDir = decls.map((p) => ({ ...D, testDir: p }));
const withRoot = [...decls, 'a/b'].map((p) => ({ ...D, rootFiles: [p] }));
const ok1 = L(tree({ 'f': '1' }));
const sv = (declared) => S({ before: ok1, after: ok1, declared });
check('declared paths that are absolute, climbing, empty, trailing-slashed, ./, backslashed, NUL, non-NFC or not strings -> null (source, testDir, rootFiles)', [...withSrc, ...withDir, ...withRoot].map(sv), [...withSrc, ...withDir, ...withRoot].map(() => null));
const declBad = [null, undefined, 5, [], {}, { ...D, extra: 1 }, { source: D.source, testDir: 't' }, { ...D, source: { files: [], dirs: [] } }, { ...D, source: { files: ['a'] } }, { ...D, source: { files: 'a', dirs: [] } }, { ...D, source: { files: [, 'a'], dirs: [] } }, { ...D, rootFiles: 'x' }, { ...D, testDir: ['t'] }];
check('a malformed declared object (missing, extra or mistyped key, empty source) -> null', declBad.map(sv), declBad.map(() => null));
const good = L(tree({ f: '1' })); const badArgs = [undefined, null, 5, [], {}, { before: good, after: good }, { before: good, after: good, declared: D, extra: 1 }, { before: good, after: undefined, declared: D }, { before: 5, after: good, declared: D }, { before: {}, after: good, declared: D }, { before: { ok: true }, after: good, declared: D }, { before: { ok: true, files: [['../x', 'a'.repeat(64)]] }, after: good, declared: D }, { before: { ok: true, files: [['f', 'A'.repeat(64)]] }, after: good, declared: D }, { before: { ok: true, files: [['f', 'a'.repeat(64)], ['f', 'a'.repeat(64)]] }, after: good, declared: D }, { before: { ok: true, files: [['f']] }, after: good, declared: D }, { before: { ok: true, files: 'f' }, after: good, declared: D }, { before: { ok: false, reason: 'x' }, after: good, declared: D }, { before: { ok: false, reason: 1, path: 'p' }, after: good, declared: D }];
check('a malformed argument or malformed manifest -> null', badArgs.map((a) => S(a)), badArgs.map(() => null));
check('a null manifest on either side is out-of-scope, never in-scope', [S({ before: null, after: good, declared: D }).verdict, S({ before: good, after: null, declared: D }).verdict, S({ before: null, after: null, declared: D }).verdict], Array(3).fill('out-of-scope'));
check('a refused manifest (symlink) on either side is out-of-scope and names its path', [S({ before: good, after: refuse('symlink', 'src/a'), declared: D }), S({ before: refuse('special-file', 'p'), after: good, declared: D }).path], [{ verdict: 'out-of-scope', reason: 'after manifest refused: symlink at src/a', path: 'src/a' }, 'p']);
check('a bidi-override name is a scope fail with an escaped path; a non-ASCII out-of-scope path is returned escaped', [(({ verdict, path }) => [verdict, /^[\x20-\x7e]+$/.test(path)])(change((d) => put(d, 'docs/a\u202eb', 'x'))), change((d) => put(d, 'docs/é', 'x')).path], [['out-of-scope', true], 'docs/%C3%A9']);
const sw = tree(BASE); const swB = L(sw); fs.rmSync(`${sw}/src/a.js`); fs.symlinkSync('deep/b.js', `${sw}/src/a.js`); check('an in-scope file replaced by a symlink to another in-scope file is a scope fail', S({ before: swB, after: L(sw), declared: D }), { verdict: 'out-of-scope', reason: 'after manifest refused: symlink at src/a.js', path: 'src/a.js' });
const hv = S({ before: good, after: refuse('symlink', 'a\nb\u001b'), declared: D });
check('a hostile path in a refused manifest cannot inject control characters into the reason or the path', [hv.reason, hv.path].map((v) => /^[\x20-\x7e]+$/.test(v)), [true, true]);
let reads = 0; const flip = { get source() { return reads++ === 0 ? { files: ['a'], dirs: [] } : { files: ['..'], dirs: [] }; }, testDir: 't', rootFiles: [] };
check('a getter that flips is read once', [S({ before: good, after: good, declared: flip })?.verdict, reads], ['in-scope', 1]);
for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got) + ')'));
EOS
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
[ "$ran" -ge 59 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 59 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
