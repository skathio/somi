// The scope manifest is the benchmark's record of what a draw changed, read from a directory a candidate wrote. Every doubt about
// that directory must be a refusal that names the first offender, and the verdict must count a change outside the declared scope.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFiles } from './helpers.mjs';
import { esc, lstatManifest, scopeVerdict, validPath } from './evals/lib/manifest.mjs';

const sha = (text) => createHash('sha256').update(text).digest('hex');
const HASH = sha('x');

function tree(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-manifest-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  writeFiles(dir, files);
  return dir;
}

// The real fs with some methods replaced, through the seam the manifest takes for tests.
function fakeFs(overrides) {
  const methods = ['lstatSync', 'opendirSync', 'openSync', 'fstatSync', 'readSync', 'closeSync'];
  return { fs: { ...Object.fromEntries(methods.map((m) => [m, fs[m].bind(fs)])), constants: fs.constants, ...overrides } };
}

test('a manifest lists every regular file with its hash, sorted by bytes, and skips only the root .git', (t) => {
  const dir = tree(t, { 'b.txt': 'b', 'a/z.txt': 'z', 'a/B.txt': 'B', '.git/HEAD': 'ref', 'sub/.git/x': 'nested', 'é.txt': 'e' });
  const m = lstatManifest(`${dir}///`);
  assert.deepEqual(m, { ok: true, files: [['a/B.txt', sha('B')], ['a/z.txt', sha('z')], ['b.txt', sha('b')], ['sub/.git/x', sha('nested')], ['é.txt', sha('e')]] });
  fs.rmSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git'), 'gitdir: elsewhere');
  assert.equal(lstatManifest(dir).files.length, 5, 'a root .git file is skipped too');
});

test('a malformed argument is null, never a manifest', (t) => {
  const dir = tree(t, { 'a.txt': 'a' });
  for (const bad of [undefined, '', 'a\0b', 7]) assert.equal(lstatManifest(bad), null);
  const trap = { get fs() { throw new Error('trap'); } };
  for (const opts of [null, [], {}, { fs, extra: 1 }, { fs: { lstatSync() {} } }, { fs: { ...fakeFs({}).fs, constants: null } }, trap]) assert.equal(lstatManifest(dir, opts), null);
});

test('links, special files and a root that is not a directory are refused by name', (t) => {
  const dir = tree(t, { 'a/b.txt': 'b', 'z.txt': 'z' });
  fs.symlinkSync('b.txt', path.join(dir, 'a', 'link'));
  assert.deepEqual(lstatManifest(dir), { ok: false, reason: 'symlink', path: 'a/link' });
  fs.rmSync(path.join(dir, 'a', 'link'));
  const outside = tree(t, {});
  const link = path.join(outside, 'root-link');
  fs.symlinkSync(dir, link);
  assert.deepEqual(lstatManifest(link), { ok: false, reason: 'symlink', path: '.' });
  assert.deepEqual(lstatManifest(path.join(dir, 'z.txt')), { ok: false, reason: 'not-a-directory', path: '.' });
  assert.deepEqual(lstatManifest(path.join(dir, 'missing')), { ok: false, reason: 'io-error', path: '.' });
  assert.equal(spawnSync('mkfifo', [path.join(dir, 'a', 'pipe')]).status, 0);
  assert.deepEqual(lstatManifest(dir), { ok: false, reason: 'special-file', path: 'a/pipe' });
  fs.rmSync(path.join(dir, 'a', 'pipe'));
  fs.rmSync(path.join(dir, 'a'), { recursive: true });
  fs.mkdirSync(path.join(dir, '.git'));
  assert.equal(spawnSync('mkfifo', [path.join(dir, '.git2')]).status, 0);
  fs.renameSync(path.join(dir, '.git2'), path.join(dir, '.git', '..', '.gitx'));
  assert.deepEqual(lstatManifest(dir), { ok: false, reason: 'special-file', path: '.gitx' });
});

test('a root .git that is a special file is refused, not skipped', (t) => {
  const dir = tree(t, { 'a.txt': 'a' });
  assert.equal(spawnSync('mkfifo', [path.join(dir, '.git')]).status, 0);
  assert.deepEqual(lstatManifest(dir), { ok: false, reason: 'special-file', path: '.git' });
});

test('a name that is not plain NFC UTF-8 is refused, and the shown path is printable ASCII', (t) => {
  const cases = [['é.txt', 'e%CC%81.txt'], ['a\u0001.txt', 'a%01.txt'], ['a\\b.txt', 'a%5Cb.txt'], ['a​b.txt', 'a%E2%80%8Bb.txt']];
  for (const [name, shown] of cases) {
    const dir = tree(t, {});
    fs.mkdirSync(path.join(dir, 'd'));
    fs.writeFileSync(path.join(dir, 'd', name), '');
    assert.deepEqual(lstatManifest(dir), { ok: false, reason: 'bad-name', path: `d/${shown}` }, JSON.stringify(name));
  }
  const dir = tree(t, {});
  fs.writeFileSync(Buffer.concat([Buffer.from(`${dir}/`), Buffer.from([0xff, 0x41])]), '');
  assert.deepEqual(lstatManifest(dir), { ok: false, reason: 'bad-name', path: '%FFA' });
});

test('an unsafe mode, a deep tree and a long path are refused', (t) => {
  for (const mode of [0o666, 0o4644, 0o2644]) {
    const dir = tree(t, { 'a.txt': 'a' });
    fs.chmodSync(path.join(dir, 'a.txt'), mode);
    assert.deepEqual(lstatManifest(dir), { ok: false, reason: 'unsafe-mode', path: 'a.txt' }, mode.toString(8));
  }
  const deep = tree(t, {});
  const levels = Array.from({ length: 33 }, (_, i) => `d${i}`);
  fs.mkdirSync(path.join(deep, ...levels), { recursive: true });
  assert.deepEqual(lstatManifest(deep), { ok: false, reason: 'too-deep', path: levels.join('/') });
  fs.rmdirSync(path.join(deep, ...levels));
  assert.equal(lstatManifest(deep).ok, true, '32 levels below the root are allowed');
  const long = tree(t, {});
  const names = Array.from({ length: 5 }, (_, i) => `${i}`.repeat(250));
  fs.mkdirSync(path.join(long, ...names.slice(0, 4)), { recursive: true });
  fs.writeFileSync(path.join(long, ...names.slice(0, 4), 'f'), '');
  assert.equal(lstatManifest(long).ok, true);
  fs.writeFileSync(path.join(long, ...names.slice(0, 4), 'x'.repeat(30)), '');
  assert.deepEqual(lstatManifest(long), { ok: false, reason: 'path-too-long', path: `${names.slice(0, 4).join('/')}/${'x'.repeat(30)}` });
});

test('what only a racing or unusual filesystem shows is refused too', (t) => {
  const dir = tree(t, { 'a/b.txt': 'bb', 'c.txt': 'c' });
  const real = fs.lstatSync(dir, { bigint: true });
  const shifted = (p, st, change) => (p === `${dir}/a` ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, change) : st);
  const lstat = (change) => (p, o) => shifted(p, fs.lstatSync(p, o), change);
  assert.deepEqual(lstatManifest(dir, fakeFs({ lstatSync: lstat({ dev: real.dev + 1n }) })), { ok: false, reason: 'mount-point', path: 'a' });
  let calls = 0;
  const swapped = (p, o) => { const st = fs.lstatSync(p, o); return p === `${dir}/a` && ++calls > 1 ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { ino: st.ino + 1n }) : st; };
  assert.deepEqual(lstatManifest(dir, fakeFs({ lstatSync: swapped })), { ok: false, reason: 'changed', path: 'a' });
  const big = (p, o) => { const st = fs.lstatSync(p, o); return p.endsWith('c.txt') ? Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: 16n * 1024n * 1024n + 1n }) : st; };
  assert.deepEqual(lstatManifest(dir, fakeFs({ lstatSync: big })), { ok: false, reason: 'file-too-large', path: 'c.txt' });
  const grew = (fd, o) => { const st = fs.fstatSync(fd, o); return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: st.size + 1n }); };
  assert.deepEqual(lstatManifest(dir, fakeFs({ fstatSync: grew })), { ok: false, reason: 'changed', path: 'a/b.txt' });
  let reads = 0;
  const once = (...a) => (reads++ % 2 === 0 ? Math.min(fs.readSync(...a), 1) : 0);
  assert.deepEqual(lstatManifest(dir, fakeFs({ readSync: once })), { ok: false, reason: 'changed', path: 'a/b.txt' });
  const extra = (...a) => { const n = fs.readSync(...a); return n > 0 ? n + 1 : 0; };
  assert.deepEqual(lstatManifest(dir, fakeFs({ readSync: extra })), { ok: false, reason: 'changed', path: 'a/b.txt' });
  const loop = () => { throw Object.assign(new Error('loop'), { code: 'ELOOP' }); };
  assert.deepEqual(lstatManifest(dir, fakeFs({ openSync: loop })), { ok: false, reason: 'symlink', path: 'a/b.txt' });
  const denied = () => { throw Object.assign(new Error('no'), { code: 'EACCES' }); };
  assert.deepEqual(lstatManifest(dir, fakeFs({ openSync: denied })), { ok: false, reason: 'io-error', path: 'a/b.txt' });
  assert.deepEqual(lstatManifest(dir, fakeFs({ opendirSync: denied })), { ok: false, reason: 'io-error', path: '.' });
});

test('every file opened for hashing is closed again, whatever the outcome', (t) => {
  const dir = tree(t, { 'a.txt': 'a', 'b/c.txt': 'c' });
  const open = new Set();
  const counted = fakeFs({ openSync: (...a) => { const fd = fs.openSync(...a); open.add(fd); return fd; }, closeSync: (fd) => { open.delete(fd); fs.closeSync(fd); } });
  assert.equal(lstatManifest(dir, counted).ok, true);
  assert.equal(open.size, 0);
  const grew = (fd, o) => { const st = fs.fstatSync(fd, o); return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { size: st.size + 1n }); };
  assert.equal(lstatManifest(dir, { fs: { ...counted.fs, fstatSync: grew } }).reason, 'changed');
  assert.equal(open.size, 0, 'a refused file is closed too');
});

test('a directory listing a name twice, or too many entries, is refused', (t) => {
  const dir = tree(t, { 'a.txt': 'a', 'b.txt': 'b' });
  const twice = (p, o) => {
    const d = fs.opendirSync(p, o);
    const names = []; for (let e = d.readSync(); e !== null; e = d.readSync()) names.push(e, e);
    d.closeSync();
    return { readSync: () => names.shift() ?? null, closeSync() {} };
  };
  assert.deepEqual(lstatManifest(dir, fakeFs({ opendirSync: twice })), { ok: false, reason: 'duplicate', path: '.' });
  const many = () => { let n = 0; return { readSync: () => (n++ < 20001 ? { name: Buffer.from(`f${n}`) } : null), closeSync() {} }; };
  assert.deepEqual(lstatManifest(dir, fakeFs({ opendirSync: many })), { ok: false, reason: 'too-many-entries', path: '.' });
});

test('a path is valid only as plain relative segments', () => {
  for (const p of ['a', 'a/b.txt', 'é/x']) assert.equal(validPath(p), true, p);
  for (const p of ['', '/a', 'a/', 'a//b', './a', 'a/../b', 'a\\b', 'é', 'x'.repeat(1025), 7]) assert.equal(validPath(p), false, JSON.stringify(p));
  assert.equal(esc('a%b\né'), 'a%25b%0A%C3%A9');
});

const DECLARED = { source: { files: ['src/app.js'], dirs: ['lib'] }, testDir: 'tests', rootFiles: ['package.json'] };
const manifest = (...paths) => ({ ok: true, files: paths.map((p) => (Array.isArray(p) ? p : [p, HASH])) });

test('a change inside the declared files, dirs, test dir, root files or .somi is in scope', () => {
  const before = manifest('src/app.js', 'lib/a.js', 'README.md');
  const after = manifest(['src/app.js', sha('new')], 'lib/b.js', 'tests/x.test.js', 'package.json', '.somi/state.json', 'README.md');
  assert.deepEqual(scopeVerdict({ before, after, declared: DECLARED }), { verdict: 'in-scope', reason: '6 changed path(s), all within the declared scope' });
  assert.deepEqual(scopeVerdict({ before, after: before, declared: DECLARED }), { verdict: 'in-scope', reason: '0 changed path(s), all within the declared scope' });
});

test('the first changed path outside the scope, by bytes, names the failure', () => {
  const before = manifest('src/app.js', 'README.md');
  const cases = [
    [manifest('src/app.js'), 'README.md'],
    [manifest('src/app.js', 'README.md', 'SRC/x.js', 'src2/y.js'), 'SRC/x.js'],
    [manifest('src/app.js', 'README.md', 'src2/y.js', 'lib'), 'lib'],
    [manifest('src/app.js', 'README.md', '.somi'), '.somi'],
    [manifest('src/app.js', 'README.md', 'tests'), 'tests'],
    [manifest('src/app.js', 'README.md', 'sub/package.json'), 'sub/package.json'],
  ];
  for (const [after, bad] of cases) assert.deepEqual(scopeVerdict({ before, after, declared: DECLARED }), { verdict: 'out-of-scope', reason: `out of scope: ${bad} changed`, path: bad }, bad);
});

test('a missing or refused manifest on either side is out of scope', () => {
  const ok = manifest('src/app.js');
  assert.deepEqual(scopeVerdict({ before: null, after: ok, declared: DECLARED }), { verdict: 'out-of-scope', reason: 'before manifest unavailable' });
  assert.deepEqual(scopeVerdict({ before: ok, after: null, declared: DECLARED }), { verdict: 'out-of-scope', reason: 'after manifest unavailable' });
  const refused = { ok: false, reason: 'symlink\n', path: 'a\u0001' };
  assert.deepEqual(scopeVerdict({ before: ok, after: refused, declared: DECLARED }), { verdict: 'out-of-scope', reason: 'after manifest refused: symlink%0A at a%01', path: 'a%01' });
  assert.deepEqual(scopeVerdict({ before: refused, after: null, declared: DECLARED }).reason, 'before manifest refused: symlink%0A at a%01');
});

test('anything that is not a manifest or a scope is null, never a pass', () => {
  const ok = manifest('src/app.js');
  const sparse = []; sparse[1] = ['src/app.js', HASH];
  const badManifests = [7, { ok: true }, { ok: true, files: [], extra: 1 }, { ok: 'yes', files: [] }, { ok: false, reason: 'x' }, { ok: false, reason: 1, path: 'p' },
    { ok: true, files: sparse }, manifest(['src/app.js', 'nothex']), manifest('src/app.js', 'src/app.js'), manifest(['/abs', HASH]), manifest(['a', HASH, 'extra'])];
  for (const m of badManifests) assert.equal(scopeVerdict({ before: ok, after: m, declared: DECLARED }), null, JSON.stringify(m));
  const badScopes = [null, { ...DECLARED, extra: 1 }, { ...DECLARED, source: { files: [], dirs: [] } }, { ...DECLARED, source: { files: ['a'] } },
    { ...DECLARED, rootFiles: ['a/b'] }, { ...DECLARED, source: { files: ['src/a'], dirs: [], extra: 1 } }, { ...DECLARED, testDir: '../t' }, { ...DECLARED, source: { files: ['a/'], dirs: [] } }];
  for (const d of badScopes) assert.equal(scopeVerdict({ before: ok, after: ok, declared: d }), null, JSON.stringify(d));
  assert.equal(scopeVerdict({ before: ok, after: ok }), null);
  assert.equal(scopeVerdict({ before: ok, after: ok, declared: DECLARED, extra: 1 }), null);
  assert.equal(scopeVerdict(null), null);
  const hostile = { get before() { throw new Error('trap'); }, after: ok, declared: DECLARED };
  assert.equal(scopeVerdict(hostile), null);
});
