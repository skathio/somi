#!/usr/bin/env bash
# Pins the task store (FR-13 inputs) in tests/evals/lib/task-store.mjs: the task.json shape (every field, unknown
# keys, hostile object shapes, path rules), the frozen task-hash encoding against an independent encoder and a
# literal known answer, and the refusals inherited from the manifest walk. Each guard is then mutated on a scratch
# copy of the library and the suite must fail. Hermetic: temp directories only; no git, model or network.
# Skipped in a tarball, where tests/evals is absent.
set -uo pipefail
umask 022

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: task store =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t tsk.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
export TMP

CODE=$(cat <<'EOS'
import fs from 'node:fs';
import { createHash } from 'node:crypto';
const { validateTaskJson: V, declaredScope: DS, taskHash: H, canaryCheck: C } = await import(`${process.env.LIB}/task-store.mjs`);
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const T = process.env.TMP;
process.umask(0o022);
const cp = (cps) => String.fromCodePoint(...cps);
const GOOD = { schema_version: 1, statements: ['GET /x returns 200', 'POST /x rejects bad JSON with 400'], runner: 'node-test', canary: 'canary_0123456789ab', source: ['server.mjs', 'lib/'], test_dir: 'test', root_files: ['package.json'], brief: 'Build server.mjs.\n\tUse node:http only.' };
const mut = (o = {}) => ({ ...GOOD, ...o });
const why = (o) => { const r = V(o); return r.ok ? 'ACCEPTED' : r.reason.split(':')[0]; };
const g = V(GOOD);
check('a minimal valid task.json is ok and returns a deep-frozen plain copy', [g.ok, g.task, Object.isFrozen(g.task), Object.isFrozen(g.task.source), g.task === GOOD], [true, GOOD, true, true, false]);
check('a valid task with no tolerated root files is ok', V(mut({ root_files: [] })).ok, true);
for (const k of Object.keys(GOOD)) { const o = mut(); delete o[k]; check(`field ${k} removed -> refused, the reason names it`, V(o).reason, `${k}: missing`); }
check('schema_version 2, "1", 1.5 and true are refused naming it', [2, '1', 1.5, true].map((v) => why(mut({ schema_version: v }))), Array(4).fill('schema_version'));
check('runner jest, empty, wrong case and a number are refused naming it; playwright is ok', [...['jest', '', 'Node-Test', 3].map((v) => why(mut({ runner: v }))), V(mut({ runner: 'playwright' })).ok], [...Array(4).fill('runner'), true]);
check('canary too short, too long, with a space, a dot, a newline or non-string -> refused naming it', ['short', 'a'.repeat(65), 'has space 0123456789', 'dot.0123456789abcdef', 'abcdefghijklmnop\n', 7].map((v) => why(mut({ canary: v }))), Array(6).fill('canary'));
check('statements: empty list, 65 lines, a non-string, empty, control, bidi, edge space, 513 units, duplicate -> refused naming it', [[], Array.from({ length: 65 }, (_, i) => `s${i}`), [5], [''], ['a\u0001b'], [`a${cp([0x202e])}b`], [' a'], ['x'.repeat(513)], ['a', 'a'], 'text'].map((v) => why(mut({ statements: v }))), Array(10).fill('statements'));
const odd = [['lone surrogate', 'a\ud800b'], ['U+2028', 'a\u2028b'], ['U+2029', 'a\u2029b'], ['U+3164', 'a\u3164b'], ['U+2800', 'a\u2800b'], ['U+FEFF', 'a\ufeffb'], ['U+200B', 'a\u200bb'], ['CR', 'a\rb']];
for (const [what, v] of odd) check(`${what} is refused in a statement and in the brief`, [why(mut({ statements: [v] })), why(mut({ brief: v }))], ['statements', 'brief']);
check('brief: empty, whitespace-only, 8193 units, bell, bidi, non-string -> refused naming it; newline and tab are ok', [...['', ' \n\t', 'x'.repeat(8193), 'a\u0007b', `a${cp([0x2066])}`, 9].map((v) => why(mut({ brief: v }))), V(mut({ brief: 'a\nb\tc' })).ok], [...Array(6).fill('brief'), true]);
const badPaths = { absolute: '/etc/passwd', 'dot-dot': '../x', 'inner dot-dot': 'a/../b', 'dot segment': './a', backslash: 'a\\b', 'empty segment': 'a//b', 'non-NFC': `e${cp([0x301])}.mjs`, bidi: `a${cp([0x202e])}b`, control: 'a\tb', empty: '', 'lone surrogate': 'a\ud800', 'non-string': 5, 'too-long name': 'n'.repeat(256) };
for (const [what, p] of Object.entries(badPaths)) check(`${what} path is refused in source, test_dir and root_files, naming each field`, [why(mut({ source: [p] })), why(mut({ test_dir: p })), why(mut({ root_files: [p] }))], ['source', 'test_dir', 'root_files']);
check('a source entry ending in // or only /, a test_dir ending in /, and a root file with a slash are refused', [why(mut({ source: ['a//'] })), why(mut({ source: ['/'] })), why(mut({ test_dir: 'test/' })), why(mut({ root_files: ['a/b'] }))], ['source', 'source', 'test_dir', 'root_files']);
check('.git and .somi (and their subpaths) are refused in source, test_dir and root_files', [['.git', '.somi/', '.somi/x', '.git/hooks'].map((p) => why(mut({ source: [p] }))), ['.git', '.somi/x'].map((p) => why(mut({ test_dir: p }))), ['.git', '.somi'].map((p) => why(mut({ root_files: [p] }))), V(mut({ source: ['.gitignore', 'x/.git'] })).ok], [Array(4).fill('source'), Array(2).fill('test_dir'), Array(2).fill('root_files'), true]);
check('empty source list, duplicate source, "src" with "src/", duplicate root files -> refused naming the field', [why(mut({ source: [] })), why(mut({ source: ['a', 'a'] })), why(mut({ source: ['src', 'src/'] })), why(mut({ root_files: ['a', 'a'] }))], ['source', 'source', 'source', 'root_files']);
const unk = (k) => String(V({ ...GOOD, [k]: 1 }).reason);
check('an unknown key is refused as task.json, including __proto__, constructor, a symbol key and a key with a colon', [why({ ...GOOD, extra: 1 }), why(JSON.parse(`{"__proto__":1,${JSON.stringify(GOOD).slice(1)}`)), why({ ...GOOD, constructor: 1 }), why({ ...GOOD, [Symbol('s')]: 1 }), unk('a: b')], ['task.json', 'task.json', 'task.json', 'task.json', 'task.json: unknown key a: b']);
const hostile = [`a\nb${cp([0x1b])}c${cp([0x202e])}d`, 'k'.repeat(100000), cp([0x10ffff, 0x1f600]).repeat(40)].map(unk);
check('a hostile unknown key is escaped to printable ASCII and cut to 64 bytes in the reason', [hostile.map((r) => /^[\x20-\x7e]+$/.test(r)), hostile.map((r) => r.length <= 'task.json: unknown key '.length + 64), hostile[0]], [[true, true, true], [true, true, true], 'task.json: unknown key a%0Ab%1Bc%E2%80%AEd']);
check('null, an array, a string, a number and undefined are refused as task.json', [null, [], 'x', 5, undefined].map(why), Array(5).fill('task.json'));
let gets = 0; const getter = mut(); Object.defineProperty(getter, 'runner', { get() { gets++; return 'node-test'; }, enumerable: true });
check('a getter field is refused as not plain data, and never called', [V(getter).reason, gets], ['runner: not a plain data property', 0]);
const hidden = mut(); Object.defineProperty(hidden, 'brief', { value: 'x', enumerable: false });
check('a non-enumerable field is refused as not plain data', V(hidden).reason, 'brief: not a plain data property');
check('an inherited field is not read (the key is missing)', why(Object.assign(Object.create({ runner: 'node-test' }), (({ runner, ...r }) => r)(GOOD))), 'task.json');
const sparse = mut({ statements: ['a', 'b'] }); delete sparse.statements[0]; const holey = []; holey[1] = 'x'; const withKey = ['a']; withKey.extra = 1;
check('a sparse array, an array with an extra key and an array getter are refused', [why(mut({ statements: sparse.statements })), why(mut({ statements: holey })), why(mut({ statements: withKey })), why(mut({ statements: Object.defineProperty(['a'], 0, { get: () => 'a', enumerable: true }) }))], Array(4).fill('statements'));
let reads = 0; const flip = new Proxy(mut(), { getOwnPropertyDescriptor(t, k) { const d = Reflect.getOwnPropertyDescriptor(t, k); if (k === 'runner') reads++; return d; } });
check('a Proxy is read through its own descriptors, each field once; a throwing Proxy is a refusal', [V(flip).ok, reads, why(new Proxy(GOOD, { ownKeys() { throw new Error('x'); } }))], [true, 1, 'task.json']);
const ap = new Proxy(['a'], { get(t, k) { if (k === 'length') return 1; return Reflect.get(t, k); } });
check('an array Proxy yields a plain frozen copy, not the proxy', [V(mut({ statements: ap })).task.statements === ap, Array.isArray(V(mut({ statements: ap })).task.statements)], [false, true]);
check('a null-prototype object is read like a plain one; a class instance is refused', [V(Object.assign(Object.create(null), GOOD)).ok, why(Object.assign(new (class X {})(), GOOD))], [true, 'task.json']);
const mutated = mut({ statements: ['a'] }); const cpy = V(mutated).task; mutated.statements.push('b');
check('the copy does not alias the input', cpy.statements, ['a']);
check('declaredScope splits a trailing slash into dirs, the rest into files, and keeps testDir and rootFiles', DS(g.task), { source: { files: ['server.mjs'], dirs: ['lib'] }, testDir: 'test', rootFiles: ['package.json'] });

// Task hash. Fixture bytes are fixed so the known answer below is a literal.
const TJ = JSON.stringify({ schema_version: 1, statements: ['one'], runner: 'node-test', canary: 'canary_0123456789ab', source: ['s.mjs'], test_dir: 'test', root_files: [], brief: 'b' });
let n = 0;
const tree = (files, order) => { const d = `${T}/t${n++}`; fs.mkdirSync(d); for (const p of order ?? Object.keys(files)) { fs.mkdirSync(`${d}/${p}`.replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(`${d}/${p}`, files[p]); } return d; };
const FIX = { 'task.json': TJ, 'fixture/a.txt': 'alpha\n', 'fixture/b/c.txt': 'c' };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const independent = (files) => { const parts = [Buffer.from('somi-task-v1\0')]; for (const p of Object.keys(files).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))) parts.push(Buffer.from(p), Buffer.from([0]), Buffer.from(sha(files[p])), Buffer.from([0])); return sha(Buffer.concat(parts)); };
const h0 = H(tree(FIX));
check('a valid task directory hashes ok, returns the validated task, and the hash equals an independent encoder', [h0.ok, h0.task.runner, h0.hash === independent(FIX), /^[0-9a-f]{64}$/.test(h0.hash)], [true, 'node-test', true, true]);
check('known answer: the fixed fixture hashes to a literal digest (the frozen format cannot drift)', h0.hash, 'c237791e4e59aa2823b3894ff3a6be26deeebbc4ee7dbdbdf0d7741ef442f60e');
check('creation order does not change the hash', H(tree(FIX, ['fixture/b/c.txt', 'task.json', 'fixture/a.txt'])).hash, h0.hash);
const bytes = (f) => H(tree({ ...FIX, ...f })).hash;
check('one changed byte, an added file and an added empty file each change the hash', [bytes({ 'fixture/a.txt': 'alphb\n' }), bytes({ 'fixture/new.txt': 'n' }), bytes({ 'fixture/e': '' })].map((h) => h !== h0.hash), [true, true, true]);
const renamed = { ...FIX }; delete renamed['fixture/a.txt']; renamed['fixture/z.txt'] = 'alpha\n';
check('a renamed file and a moved file change the hash; a removed file changes it', [H(tree(renamed)).hash !== h0.hash, H(tree({ ...Object.fromEntries(Object.entries(FIX).filter(([p]) => p !== 'fixture/a.txt')), 'fixture/b/a.txt': 'alpha\n' })).hash !== h0.hash, H(tree({ 'task.json': TJ, 'fixture/a.txt': 'alpha\n' })).hash !== h0.hash], [true, true, true]);
check('a changed task.json byte (still valid) changes the hash; a name with the same bytes elsewhere does not collide', [bytes({ 'task.json': TJ.replace('"b"', '"c"') }) !== h0.hash, H(tree({ 'task.json': TJ, 'fixture/a.txt': 'x', 'fixture/b': 'alpha\n' })).hash !== H(tree({ 'task.json': TJ, 'fixture/a.txt': 'alpha\n', 'fixture/b': 'x' })).hash], [true, true]);
const reason = (d) => { const r = H(d); return r.ok ? 'ACCEPTED' : r.reason; };
const sl = tree(FIX); fs.symlinkSync('a.txt', `${sl}/fixture/ln`);
check('a symlink anywhere in the task directory is refused, naming the manifest reason and path', reason(sl), 'dir: manifest refused: symlink at fixture/ln');
const root = tree(FIX); const rl = `${T}/rootlink`; fs.symlinkSync(root, rl);
check('a symlinked task directory is refused', reason(rl), 'dir: manifest refused: symlink at .');
check('task.json missing, a symlink, not JSON, invalid UTF-8, or an invalid task is refused naming task.json', [tree({ 'fixture/a': 'x' }), (() => { const d = tree({ 'real.json': TJ }); fs.symlinkSync('real.json', `${d}/task.json`); return d; })(), tree({ 'task.json': '{' }), tree({ 'task.json': Buffer.from(TJ.replace('"one"', '"o@"')).map((b) => (b === 0x40 ? 0xff : b)) }), tree({ 'task.json': TJ.replace('node-test', 'jest') })].map((d) => reason(d).split(':')[0]), ['task.json', 'dir', 'task.json', 'task.json', 'runner']);
check('a task.json over 256 KiB is refused', reason(tree({ 'task.json': TJ + ' '.repeat(256 * 1024) })).slice(0, 30), 'task.json: unreadable, too lar');
check('an invalid task names its field through taskHash', reason(tree({ 'task.json': TJ.replace('"one"', '""') })), 'statements: a line is not plain 1..512-unit text');
check('a missing directory and a malformed argument are refusals, never a throw', [`${T}/absent`, 5, null, ''].map((d) => reason(d).split(':')[0]), ['dir', 'dir', 'dir', 'dir']);
check('a trailing slash on the directory gives the same hash', H(`${tree(FIX)}/`).hash, h0.hash);
// Things the manifest does not record: a root .git, an execute bit, an empty directory. Each is refused naming its path.
const gd = tree(FIX); fs.mkdirSync(`${gd}/.git`); fs.writeFileSync(`${gd}/.git/HEAD`, 'h');
const gf = tree(FIX); fs.writeFileSync(`${gf}/.git`, 'gitdir: x');
const nested = tree(FIX); fs.mkdirSync(`${nested}/fixture/.git`); fs.writeFileSync(`${nested}/fixture/.git/x`, 'x');
const xb = tree(FIX); fs.chmodSync(`${xb}/fixture/a.txt`, 0o755);
const xo = tree(FIX); fs.chmodSync(`${xo}/fixture/a.txt`, 0o645);
const ed = tree(FIX); fs.mkdirSync(`${ed}/fixture/empty`);
const ed2 = tree(FIX); fs.mkdirSync(`${ed2}/a/b`, { recursive: true });
check('a root .git directory or file, an execute bit and an empty directory are refused naming the path; a nested .git with files is not', [reason(gd), reason(gf), reason(xb), reason(xo), reason(ed), reason(ed2), H(nested).ok], ['dir: root .git entry at .git', 'dir: root .git entry at .git', 'dir: execute bit at fixture/a.txt', 'dir: execute bit at fixture/a.txt', 'dir: empty directory at fixture/empty', 'dir: empty directory at a/b', true]);
check('modes without an execute bit (0600, 0444) do not change the hash', [0o600, 0o444].map((m) => { const d = tree(FIX); fs.chmodSync(`${d}/fixture/a.txt`, m); return H(d).hash === h0.hash; }), [true, true]);
// Test-only fs injection: what happens between the walk and the parse. The first open of task.json is the walk's.
const inject = (d, h) => { const log = { flags: [] }; let opens = 0; const w = { ...fs, constants: fs.constants,
  openSync: (p, fl, ...a) => { if (p.endsWith('/task.json') && ++opens === 2) { log.flags.push(fl); h.beforeRead?.(p); } return fs.openSync(p, fl, ...a); },
  fstatSync: (fd, o) => { const st = fs.fstatSync(fd, o); return h.notFile && !o?.bigint ? { isFile: () => false, size: st.size } : st; },
  readdirSync: (p, ...a) => fs.readdirSync(p, ...a).filter((x) => x !== h.hide),
  readSync: (fd, b, off, len, pos) => { const r = fs.readSync(fd, b, off, len, pos); return h.short && pos === 0 ? r - 1 : r; } }; return [H(d, { fs: w }), log]; };
const sw = tree(FIX);
check('task.json swapped for other same-size bytes between the walk and the parse is refused', inject(sw, { beforeRead: (p) => fs.writeFileSync(p, TJ.replace('"b"', '"c"')) })[0].reason, 'task.json: unreadable, too large or changed since it was hashed');
check('a file the walk listed but the later listing lacks, and one it did not list, are refused', [inject(tree(FIX), { hide: 'fixture' })[0].reason, inject(tree(FIX), { beforeRead: (p) => fs.writeFileSync(p.replace('task.json', 'new'), 'n') })[0].reason], ['dir: changed since it was listed', 'dir: changed since it was listed']);
check('a short read of task.json is refused', inject(tree(FIX), { short: true })[0].reason, 'task.json: unreadable, too large or changed since it was hashed');
check('a task.json that fstat does not call a regular file is refused', inject(tree(FIX), { notFile: true })[0].reason, 'task.json: unreadable, too large or changed since it was hashed');
const [okI, logI] = inject(tree(FIX), {});
check('with a faithful injected fs the hash is the same, and the parse open sets O_NOFOLLOW and O_NONBLOCK', [okI.hash === h0.hash, logI.flags.length, (logI.flags[0] & fs.constants.O_NOFOLLOW) !== 0, (logI.flags[0] & fs.constants.O_NONBLOCK) !== 0], [true, 1, true, true]);
check('a malformed injected fs is a refusal', [H(tree(FIX), { fs: {} }).ok, H(tree(FIX), { x: 1 }).ok], [false, false]);
// Canary check. The canary is the validated one in the hashed task.json; the caller supplies none.
const CAN = 'canary_0123456789ab';
const GOODT = { 'task.json': TJ, 'fixture/a.txt': 'alpha\n', 'hidden/h.mjs': `// ${CAN}\n`, 'oracle/o.mjs': `x ${CAN}`, 'oracle2/o.mjs': `${CAN}` };
const { 'fixture/a.txt': _drop, ...noFixture } = GOODT;
const cc = (files) => C(tree({ ...GOODT, ...files }));
const without = (...paths) => { const d = tree(GOODT); for (const p of paths) fs.rmSync(`${d}/${p}`, { recursive: true }); return C(d); };
const rs = (r) => (r.ok ? 'ACCEPTED' : r.reason);
const goodDir = tree(GOODT);
check('an all-good tree is ok and its hash is exactly taskHash\'s', [C(goodDir).ok, C(goodDir).hash === H(goodDir).hash], [true, true]);
check('a hidden, oracle or oracle2 file without the canary is refused naming the file', [cc({ 'hidden/h2.mjs': 'no' }), cc({ 'oracle/p.mjs': 'no' }), cc({ 'oracle2/p.mjs': '' })].map(rs), ['hidden/h2.mjs: missing the canary', 'oracle/p.mjs: missing the canary', 'oracle2/p.mjs: missing the canary']);
check('the canary is case-sensitive, and split by a newline, a NUL or a space it does not count', ['CANARY_0123456789AB', 'canary_01234\n56789ab', 'canary_01234\u000056789ab', 'canary_01234 56789ab'].map((c) => rs(cc({ 'hidden/h2.mjs': c }))), Array(4).fill('hidden/h2.mjs: missing the canary'));
check('a fixture file holding the canary, or a fixture file name holding it, is refused naming the file', [rs(cc({ 'fixture/b/x.txt': `see ${CAN}` })), rs(cc({ [`fixture/${CAN}.txt`]: 'x' }))], ['fixture/b/x.txt: candidate-visible file contains the canary', `fixture/${CAN}.txt: the path contains the canary`]);
check('a brief or a statement holding the canary is refused', [rs(C(tree({ ...GOODT, 'task.json': TJ.replace('"b"', `"see ${CAN}"`) }))), rs(C(tree({ ...GOODT, 'task.json': TJ.replace('"one"', `"${CAN}"`) })))], ['brief: contains the canary', 'statements: a line contains the canary']);
for (const [dn, f] of [['hidden', 'hidden/h.mjs'], ['oracle', 'oracle/o.mjs'], ['oracle2', 'oracle2/o.mjs']]) check(`${dn}/ with no file (emptied or removed) is refused naming it`, [without(f), without(dn)].map(rs), [`dir: empty directory at ${dn}`, `${dn}/: has no files (a check over nothing proves nothing)`]);
check('the needle is the whole canary: one byte fewer at either end is not enough', [cc({ 'hidden/h2.mjs': CAN.slice(0, -1) }), cc({ 'hidden/h2.mjs': CAN.slice(1) })].map(rs), Array(2).fill('hidden/h2.mjs: missing the canary'));
check('only the root task.json is skipped: hidden/task.json and hidden/x.json without the canary are named', [cc({ 'hidden/task.json': '{}' }), cc({ 'hidden/x.json': '{}' })].map(rs), ['hidden/task.json: missing the canary', 'hidden/x.json: missing the canary']);
check('the canary in any directory name is refused, under fixture/ and under hidden/ (even when the file holds it)', [cc({ [`fixture/${CAN}/x.txt`]: 'x' }), cc({ [`hidden/${CAN}/x.mjs`]: CAN })].map(rs), [`fixture/${CAN}/x.txt: the path contains the canary`, `hidden/${CAN}/x.mjs: the path contains the canary`]);
check('the canary in a declared source, test_dir or root_files path is refused naming the field', [['"s.mjs"', `"s${CAN}.mjs"`], ['"test"', `"t/${CAN}"`], ['"root_files":[]', `"root_files":["${CAN}"]`]].map(([a, b]) => rs(C(tree({ ...GOODT, 'task.json': TJ.replace(a, b) })))), ['source: a declared path contains the canary', 'test_dir: a declared path contains the canary', 'root_files: a declared path contains the canary']);
check('a task with no fixture/ directory is accepted (greenfield)', C(tree(noFixture)).ok, true);
const bin = Buffer.concat([Buffer.from([0xff, 0xfe, 0x00, 0x80]), Buffer.from(CAN), Buffer.from([0xc3, 0x28, 0x00])]);
check('a binary invalid-UTF-8 hidden file holding the canary is found; the same bytes under fixture are refused', [rs(cc({ 'hidden/bin.dat': bin })), rs(cc({ 'fixture/bin.dat': bin }))], ['ACCEPTED', 'fixture/bin.dat: candidate-visible file contains the canary']);
check('a 300 KiB hidden file with the canary at the end is found (no chunk boundary, size cap is the manifest cap)', rs(cc({ 'hidden/big.dat': Buffer.concat([Buffer.alloc(300 * 1024, 0x61), Buffer.from(CAN)]) })), 'ACCEPTED');
check('an unexpected top-level directory or file is refused naming it, nop and mutants included', [cc({ 'nop/x': CAN }), cc({ 'notes.txt': CAN }), cc({ 'mutants/m': CAN })].map(rs), ['dir: unexpected top-level entry at nop/x', 'dir: unexpected top-level entry at notes.txt', 'dir: unexpected top-level entry at mutants/m']);
check('a top-level FILE named like a layout directory is refused', rs(C(tree({ ...noFixture, fixture: 'x' }))), 'dir: unexpected top-level entry at fixture');
check('a hostile top-level name is escaped in the reason', /^[\x20-\x7e]+$/.test(rs(cc({ ['zz\u001b[0m']: 'x' }))), true);
const lk = tree(GOODT); fs.symlinkSync('h.mjs', `${lk}/hidden/ln`);
check('a symlink in hidden/, an invalid task.json, a missing directory and a caller-supplied canary are refusals', [rs(C(lk)), rs(C(tree({ ...GOODT, 'task.json': TJ.replace('node-test', 'jest') }))), rs(C(`${T}/absent`)), rs(C(tree(GOODT), CAN)), rs(C(5))], ['dir: manifest refused: symlink at hidden/ln', 'runner: must be one of node-test, playwright', 'dir: manifest refused: io-error at .', 'dir: not a usable directory argument', 'dir: not a usable directory argument']);
// The same read discipline as task.json: a swap after the walk, a non-regular fstat and the open flags.
const hinj = (h) => { const d = tree(GOODT); let opens = 0; const flags = []; const w = { ...fs, constants: fs.constants,
  openSync: (p, fl, ...a) => { if (p.endsWith('/hidden/h.mjs') && ++opens === 2) { flags.push(fl); h.swap?.(p); } return fs.openSync(p, fl, ...a); },
  fstatSync: (fd, o) => { const st = fs.fstatSync(fd, o); return h.notFile && !o?.bigint && opens === 2 ? { isFile: () => false, size: st.size } : st; } }; return [C(d, { fs: w }), flags]; };
check('a hidden file swapped for other same-size bytes without the canary after the walk is refused as changed', rs(hinj({ swap: (p) => fs.writeFileSync(p, `// ${'x'.repeat(CAN.length)}\n`) })[0]), 'hidden/h.mjs: unreadable, too large or changed since it was hashed');
check('a hidden file that fstat does not call regular is refused', rs(hinj({ notFile: true })[0]), 'hidden/h.mjs: unreadable, too large or changed since it was hashed');
const [okH, flH] = hinj({});
check('with a faithful injected fs the read open sets O_NOFOLLOW and O_NONBLOCK', [okH.ok, flH.length, (flH[0] & fs.constants.O_NOFOLLOW) !== 0, (flH[0] & fs.constants.O_NONBLOCK) !== 0], [true, 1, true, true]);
for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got) + ')'));
EOS
)
suite() { LIB="$1" TMP="$(mktemp -d -p "$TMP")" node --input-type=module -e "$CODE" 2>&1; }
out=$(suite "$ROOT/tests/evals/lib") || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"

# Mutation: each guard is broken on a scratch copy of the library; the suite must then fail.
mutant() { # file, from, to
  local d="$TMP/m$((++nm))"; mkdir "$d"; cp tests/evals/lib/manifest.mjs tests/evals/lib/task-store.mjs "$d/"
  if ! M_FILE="$d/$1" M_FROM="$2" M_TO="$3" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then fail=$((fail+1)); printf '  FAIL mutation target not found: %s\n' "$2"; return; fi
  if suite "$d" | grep -q '^FAIL'; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "$4"; else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "$4"; fi
}
nm=0
mutant task-store.mjs 'if (brief.includes(canary))' 'if (false)' "brief canary check"
mutant task-store.mjs 'statements.some((t) => t.includes(canary))' 'false' "statement canary check"
mutant task-store.mjs 'if (p.includes(canary)) return' 'if (false) return' "file-name canary check"
mutant task-store.mjs "|| !LAYOUT.includes(top)" "" "unknown top-level directory refusal"
mutant task-store.mjs "!p.includes('/') ||" "" "top-level file refusal"
mutant task-store.mjs '!== fileHash) return refuse(esc(p)' '=== "x") return refuse(esc(p)' "canary read hash compare"
mutant task-store.mjs "top === 'fixture' ? has : !has" "!has" "fixture must not hold the canary"
mutant task-store.mjs "top === 'fixture' ? has : !has" "has" "hidden must hold the canary"
mutant task-store.mjs "none === undefined ? { ok: true, hash" "true ? { ok: true, hash" "vacuous pass refusal"
mutant task-store.mjs "HIDDEN_DIRS.find((d) => !found.has(d))" "LAYOUT.find((d) => !found.has(d))" "greenfield: fixture/ not required"
mutant task-store.mjs "hash: digest(l.m.files) } : refuse" "hash: '0'.repeat(64) } : refuse" "canaryCheck hash"
mutant task-store.mjs "paths.some((x) => x.includes(canary))" "false" "declared path canary check"
mutant task-store.mjs "if (p === 'task.json') continue;" "if (p.endsWith('task.json')) continue;" "task.json skip is the exact root path"
mutant task-store.mjs "if (p.includes(canary)) return" "if (p.split('/').pop().includes(canary)) return" "directory-name canary check"
mutant task-store.mjs "Buffer.from(canary)" "Buffer.from(canary.slice(1))" "needle is the whole canary"
mutant task-store.mjs '/${p}`, MAX_FILE_BYTES)' '/${p}`)' "canary read size cap"
mutant task-store.mjs "bytes.includes(needle)" "bytes.toString('utf8').normalize('NFKC').toLowerCase().includes(canary.toLowerCase())" "case-sensitive byte search"
mutant task-store.mjs "esc(String(extra).slice(0, 64)).slice(0, 64)" "String(extra)" "unknown key escape and cut"
mutant task-store.mjs "{ fatal: true }" "{ fatal: false }" "fatal UTF-8 decode"
mutant task-store.mjs "!== entry[1]" "=== 'x'" "readSmall hash compare"
mutant task-store.mjs "!st.isFile() || " "" "readSmall isFile check"
mutant task-store.mjs "(f.constants.O_NOFOLLOW ?? 0)" "0" "O_NOFOLLOW on the parse open"
mutant task-store.mjs "(f.constants.O_NONBLOCK ?? 0)" "0" "O_NONBLOCK on the parse open"
mutant task-store.mjs "if (rel === '' && name === '.git')" "if (false)" "root .git refusal"
mutant task-store.mjs "(st.mode & 0o111) !== 0" "false" "execute-bit refusal"
mutant task-store.mjs "names.length === 0 && rel !== ''" "false" "empty-directory refusal"
mutant task-store.mjs "seen.size === listed.size && " "" "listed-file count check"
mutant task-store.mjs "if (reserved(p)) bad" "if (false) bad" "reserved .git/.somi in dirs"
mutant task-store.mjs "!p.includes('/') && !reserved(p)" "!p.includes('/')" "reserved root file"
mutant task-store.mjs "!UNSAFE.test(v.replace(/[\\n\\t]/g, ''))" "true" "brief character rule"
mutant task-store.mjs "raw.schema_version !== 1" "false" "schema_version check"
mutant task-store.mjs "['node-test', 'playwright']" "['node-test', 'playwright', 'jest']" "runner allowlist"
mutant task-store.mjs "if (!keys.includes(k)) bad(k, 'missing');" "" "missing-field check"
mutant task-store.mjs "(k) => !KEYS.includes(k)" "(k) => false" "unknown-key check"
mutant task-store.mjs "|| !('value' in d)" "" "getter refusal"
mutant task-store.mjs "|| !d.enumerable" "" "enumerable-only"
mutant task-store.mjs "Reflect.ownKeys(v).length !== n + 1" "false" "dense-array check"
mutant task-store.mjs "new Set(items).size !== items.length" "false" "duplicate check"
mutant task-store.mjs "/^[A-Za-z0-9_-]{16,64}\$/" "/^[A-Za-z0-9_-]{1,64}\$/" "canary length"
mutant task-store.mjs "!validPath(p)" "false" "path rule on declared paths"
mutant task-store.mjs "validPath(p) && !p.includes('/')" "validPath(p)" "root file single segment"
mutant task-store.mjs "&& !UNSAFE.test(v) && !EDGE_SPACE.test(v)" "" "statement character rule"
mutant task-store.mjs " && v.trim() !== ''" "" "whitespace-only brief"
mutant task-store.mjs "distinct(bare, 'source');" "" "src and src/ duplicate"
mutant task-store.mjs "Object.freeze(t[k])" "t[k]" "frozen lists"
mutant task-store.mjs "p.slice(0, -1));" "p);" "declaredScope directory slice"
mutant task-store.mjs "if (!m.ok) return refuse('dir', \`manifest refused: \${m.reason} at \${m.path}\`);" "" "manifest refusal propagated"
mutant task-store.mjs "PREFIX = 'somi-task-v1" "PREFIX = 'somi-task-v2" "hash prefix (known answer)"
mutant task-store.mjs '`${p}\0${fileHash}\0`' '`${p}\0`' "file content in the hash"
mutant task-store.mjs '`${p}\0${fileHash}\0`' '`${fileHash}\0`' "file path in the hash"
mutant task-store.mjs '`${p}\0${fileHash}\0`' '`${p}${fileHash}`' "NUL separators"
mutant task-store.mjs "st.size > max" "false" "task.json size cap"
mutant manifest.mjs "s.normalize('NFC') === s" "true" "NFC rule in the shared path check"
mutant manifest.mjs "!BAD_CHARS.test(s) && " "" "name character rule in the shared path check"

ran=$((pass + fail))
[ "$ran" -ge 148 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 148 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
