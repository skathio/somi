#!/usr/bin/env node
// Tests of scripts/lib/path-safety.mjs. Risk: a model-named path reaching the filesystem outside the project or a
// secret inside it. Real temp tree, no mocks; the only seams are the module's own (`realpath`, `constants`). Usage:
// node path-safety-tests.mjs <module path>; tests/scripts/fact-sheet.sh runs it on the module and on scratch
// mutants of it, and each mutant must turn the test named there red. Hermetic: no model, no network, no randomness.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const modPath = path.resolve(process.argv[2]);
const M = await import(pathToFileURL(modPath).href);
const { inspectPath, denyListed, refuseList, REFUSAL_IDS, MAX_PATHS, MAX_PATH_CHARS, MAX_FILE_BYTES } = M;

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'path-safety-')));
process.on('exit', () => { try { fs.chmodSync(path.join(base, 'root', 'locked'), 0o700); } catch { /* already gone */ } fs.rmSync(base, { recursive: true, force: true }); });
const root = path.join(base, 'root');
const put = (rel, body = 'x') => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), body); };
put('a.txt', 'hello'); put('sub/b.txt'); put('..x'); put('locked/.env'); put('locked/f.txt'); put('config/secret.txt');
fs.mkdirSync(path.join(root, 'folder')); fs.mkdirSync(path.join(base, 'outside'));
fs.writeFileSync(path.join(base, 'outside', 'secret.txt'), 'outside');
fs.symlinkSync('a.txt', path.join(root, 'link.txt')); fs.symlinkSync('sub', path.join(root, 'linkdir'));
fs.symlinkSync('../outside/secret.txt', path.join(root, 'escape.txt')); fs.symlinkSync('../outside/secret.txt', path.join(root, '.env'));
fs.writeFileSync(path.join(root, 'big.bin'), Buffer.alloc(MAX_FILE_BYTES + 1)); fs.writeFileSync(path.join(root, 'max.bin'), Buffer.alloc(MAX_FILE_BYTES));
const fifo = spawnSync('mkfifo', [path.join(root, 'pipe')]).status === 0;
fs.chmodSync(path.join(root, 'locked'), 0o000);

let pass = 0; let fail = 0;
const skip = (name, why) => console.log(`  skip ${name} (${why})`);
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
// A throw is reported as a result, so a broken module fails the named check instead of ending the run.
const ins = (raw, probe, seams) => { try { return inspectPath(root, raw, probe, seams); } catch { return { kind: 'threw' }; } };
const refusalOf = (raw, seams) => { const r = ins(raw, null, seams); return r.kind === 'refused' ? r.refusal : r.kind; };
const refusals = (list, seams) => list.map((p) => refusalOf(p, seams));
const same = (n, v) => Array(n).fill(v);
const DENIED = { kind: 'denied' };

// Runs fn with the filesystem entry points counted; returns the names called.
const WATCH = ['lstatSync', 'statSync', 'openSync', 'fstatSync', 'closeSync', 'readSync', 'readFileSync', 'accessSync', 'existsSync', 'readdirSync', 'readlinkSync', 'opendirSync'];
function watched(fn) {
  const calls = []; const saved = {}; const realpath = fs.realpathSync; const native = realpath.native;
  for (const n of WATCH) { saved[n] = fs[n]; fs[n] = (...a) => { calls.push(n); return saved[n](...a); }; }
  fs.realpathSync = Object.assign((...a) => { calls.push('realpathSync'); return realpath(...a); }, { native: (...a) => { calls.push('realpathSync.native'); return native(...a); } });
  try { fn(); } finally { fs.realpathSync = realpath; for (const n of WATCH) fs[n] = saved[n]; }
  return calls;
}

// A call in its own process with a clock, so a hang is a failed check and not a stuck suite.
// `swap` stands in for a file replaced by another between the walk and the open: the canonical path becomes it.
function inChild(raw, swap = '') {
  const seam = 'process.argv[3] ? { realpath: (p) => (p.endsWith(process.argv[2]) ? process.argv[3] : fs.realpathSync.native(p)) } : undefined';
  const code = `import fs from 'node:fs'; import * as M from ${JSON.stringify(pathToFileURL(modPath).href)}; console.log(JSON.stringify(M.inspectPath(process.argv[1], process.argv[2], null, ${seam})));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, root, raw, swap], { encoding: 'utf8', timeout: 5000 });
  return r.status === 0 ? JSON.parse(r.stdout) : `child ended ${r.status ?? r.signal}`;
}

console.log('== path safety: refusing malformed names ==');
check('refuses an absolute path, a drive path and a UNC path', refusals(['/etc/passwd', 'C:\\x', 'c:x', '\\\\srv\\share\\x', '\\x']), same(5, 'absolute'));
check('refuses a parent segment in any position or separator', refusals(['../a.txt', 'sub/../../a.txt', 'sub\\..\\..\\a.txt', 'a/..', '.. /x', '..../x']), same(6, 'traversal'));
check('refuses NUL and control characters', refusals(['a\0.txt', 'a\n.txt', 'a\u001b[0m', 'a\u007f', 'a\u0085']), same(5, 'control'));
check('refuses bidi, zero-width and line-separator characters', refusals(['\u202eagro.txt', 'a\u2066b', 'a\u200bb', 'a\u2028b', 'a\ufeffb']), same(5, 'control'));
check('refuses an empty, dot-only or non-string name', refusals(['', '.', './', './/.', 5, null, undefined, {}, ['a.txt']]), same(9, 'malformed'));
const LONG = `${'.'.repeat(50000)}x`;
const t0 = performance.now();
const longResults = [ins(LONG), refuseList(Array(MAX_PATHS + 1).fill(LONG)), refuseList([LONG]), denyListed(LONG)];
check('a huge name is refused as path_length and denied, in bounded time', [longResults, performance.now() - t0 < 500], [[{ kind: 'refused', refusal: 'path_length', denied: true }, { kind: 'refused', refusal: 'path_count', denied: true }, null, true], true]);
check('refuses a name over the length cap and accepts one at it', [refusalOf('a'.repeat(MAX_PATH_CHARS + 1)), ins('a'.repeat(MAX_PATH_CHARS))], ['path_length', { kind: 'contained', exists: false, rel: 'a'.repeat(MAX_PATH_CHARS) }]);
check('refuses a list over the count cap and accepts one at it', [refuseList(Array(MAX_PATHS + 1).fill('a.txt')), refuseList(Array(MAX_PATHS).fill('a.txt')), refuseList('a.txt')], [{ kind: 'refused', refusal: 'path_count' }, null, { kind: 'refused', refusal: 'malformed' }]);
check('a list over the cap keeps the denied fact of any name in it', refuseList([...Array(MAX_PATHS).fill('a.txt'), '.env']), { kind: 'refused', refusal: 'path_count', denied: true });
const marker = 'SECRETMARK\u00e9';
const hostile = [`../${marker}`, `/${marker}`, `${marker}\0`, `${marker}/nope/x`, `${marker}/a.txt`, `x${'y'.repeat(MAX_PATH_CHARS)}${marker}`];
const out = JSON.stringify(hostile.map((p) => ins(p)));
check('refusals are closed ASCII ids and never contain the input', [REFUSAL_IDS.every((id) => /^[a-z_]+$/.test(id)), Object.isFrozen(REFUSAL_IDS), out.includes('SECRETMARK'), /^[\x20-\x7e]*$/.test(out)], [true, true, false, true]);
check('every refusal the suite saw is in the closed list', [...new Set(hostile.map((p) => refusalOf(p)))].every((id) => REFUSAL_IDS.includes(id)), true);

console.log('== path safety: the deny list is name-only ==');
const SECRET_NAMES = ['.env', 'cfg/.env.local', 'id_rsa', 'k/id_rsa.pub', 'id_dsa', 'id_ecdsa', 'id_ed25519', 'a.pem', 'a.key', 'a.p12', 'a.pfx', 'a.crt', 'a.cer', 'a.der', 'a.jks', 'a.keystore', 'a.ppk', '.git/config', 'sub/.git/HEAD', '.git',
  '.npmrc', 'h/.netrc', '.git-credentials', '.pypirc', '.pgpass', 'terraform.tfstate', 'a.tfvars', 'a.kdbx', '.ssh/config', 'x/.gnupg/k', '.aws/credentials'];
check('denies .env, key and certificate file names and any .git segment', refusals(SECRET_NAMES), same(SECRET_NAMES.length, 'denied'));
check('does not deny look-alikes', ['.gitignore', '.github/workflows/a.yml', 'environment.md', 'src/keyboard.js', 'key.txt', 'sub/b.txt', 'a.pem.txt', 'notes~.txt', 'terraform.tf', '.aws.md', 'ssh/a'].map(denyListed), same(11, false));
const WIN = ['ENV~1', 'ENV~1.LOC', 'GIT~1/config', 'key.pem::$DATA', 'a/b:c'];
check('denies Windows short names and stream suffixes', refusals(WIN), same(WIN.length, 'denied'));
const CASED = ['.ENV', '.Env.local', 'ID_RSA', 'Key.PEM', '.Git/config', '.GIT/hooks/x', 'CERT.Crt'];
check('denies case variants exactly as the lower-case forms', refusals(CASED), same(CASED.length, 'denied'));
check('denies a name written with another separator, a trailing dot or space, or compatibility characters', refusals(['sub\\.env', '.git\\config', '.env.', 'Key.pem ', '\uff0eenv', '.\uff45\uff4e\uff56', '\uff49\uff44_rsa']), same(7, 'denied'));
check('a deny-listed name is decided without any filesystem call, for a root that does not exist too', [watched(() => { inspectPath(root, '.env'); inspectPath(root, 'sub/.GIT/x'); inspectPath('/nonexistent-root', 'a.pem', null, { realpath: () => { throw new Error('called'); } }); })], [[]]);
check('denied names make no call to the injected realpath', (() => { let n = 0; ins('.env', null, { realpath: (p) => { n++; return p; } }); return n; })(), 0);
check('a missing, a symlinked and an unreadable-directory .env give the same result', [ins('nothing/.env'), ins('.env'), ins('locked/.env'), ins('.env.missing')], same(4, DENIED));
check('a deny-listed name with a missing parent or in a non-directory is still denied', [ins('a.txt/.env'), ins('nope/deeper/key.pem')], same(2, DENIED));
check('a malformed deny-listed name returns the refusal id and denied: true', [ins('../../.env'), ins('/x/id_rsa'), ins('a\0/.env'), ins('.git/../x'), ins('x'.repeat(MAX_PATH_CHARS + 1) + '/.env')], [['traversal'], ['absolute'], ['control'], ['traversal'], ['path_length']].map(([refusal]) => ({ kind: 'refused', refusal, denied: true })));
check('a malformed name that is not deny-listed carries no denied fact', [ins('../x'), ins('/etc/passwd')], [{ kind: 'refused', refusal: 'traversal' }, { kind: 'refused', refusal: 'absolute' }]);
const canon = (to) => (p) => (p.endsWith(`${path.sep}secret.txt`) ? p.replace('secret.txt', to) : fs.realpathSync.native(p));
check('a path whose canonical on-disk spelling is a denied name is denied with no open', [ins('config/secret.txt', null, { realpath: canon('KEY.PEM') }), watched(() => ins('config/secret.txt', null, { realpath: canon('KEY.PEM') })).filter((c) => c === 'openSync')], [DENIED, []]);
check('the canonical re-check also covers a .git directory spelled differently', ins('config/secret.txt', null, { realpath: (p) => (p.endsWith('secret.txt') ? path.join(root, '.GIT', 'secret.txt') : fs.realpathSync.native(p)) }), DENIED);
check('the canonical path from the injected realpath is the one reported', ins('config/secret.txt', null, { realpath: (p) => (p.endsWith('secret.txt') ? path.join(root, 'sub', 'b.txt') : fs.realpathSync.native(p)) }).rel, 'sub/b.txt');

console.log('== path safety: containment and plain files ==');
check('refuses a symlinked file, a file under a symlinked directory and a symlink that leaves the root', refusals(['link.txt', 'linkdir/b.txt', 'linkdir', 'escape.txt']), same(4, 'symlink'));
check('refuses a path whose canonical form leaves the root, is the root, or is its parent', refusals(['a.txt'], { realpath: (p) => (p.endsWith('a.txt') ? path.join(base, 'outside', 'secret.txt') : fs.realpathSync.native(p)) }).concat(refusals(['a.txt', 'sub/b.txt'], { realpath: (p) => (p.endsWith('b.txt') ? base : p.endsWith('a.txt') ? root : fs.realpathSync.native(p)) })), same(3, 'escape'));
check('a file whose name begins with two dots is inside the root', ins('..x', null).kind, 'contained');
check('refuses a link swapped in after the check, because the open does not follow it', refusalOf('a.txt', { realpath: (p) => (p.endsWith('a.txt') ? path.join(root, 'link.txt') : fs.realpathSync.native(p)) }), 'symlink');
const swapTo = (rel) => ({ realpath: (p) => (p.endsWith('a.txt') ? path.join(root, rel) : fs.realpathSync.native(p)) });
check('refuses a directory, a path through a file, a path under a missing directory, and a directory swapped in', [refusalOf('folder'), refusalOf('a.txt/x'), refusalOf('nope/new.txt'), refusalOf('a.txt', swapTo('folder'))], ['not_file', 'not_file', 'no_parent', 'not_file']);
check('a FIFO is refused and the call returns, also when swapped in after the check', fifo ? [inChild('pipe'), inChild('a.txt', path.join(root, 'pipe'))] : 'no mkfifo', same(2, { kind: 'refused', refusal: 'not_file' }));
check('a device is refused', fs.existsSync('/dev/null') ? inspectPath('/dev', 'null') : 'no /dev/null', { kind: 'refused', refusal: 'not_file' });
check('refuses a file over the size cap and accepts one at it', [refusalOf('big.bin'), ins('max.bin').size], ['file_size', MAX_FILE_BYTES]);
if (process.getuid?.() === 0) skip('a file in an unreadable directory is refused as unreadable', 'running as root, which reads it');
else check('a file in an unreadable directory is refused as unreadable', refusalOf('locked/f.txt'), 'unreadable');
check('an unreadable root is refused, not read through', inspectPath(path.join(base, 'no-root'), 'a.txt'), { kind: 'refused', refusal: 'unreadable' });
check('a new path in the root or in an existing directory is contained', [ins('new.txt'), ins('sub\\new.txt')], [{ kind: 'contained', exists: false, rel: 'new.txt' }, { kind: 'contained', exists: false, rel: 'sub/new.txt' }]);
check('a Windows-style separator reaches the same file', ins('sub\\b.txt'), { kind: 'contained', exists: true, rel: 'sub/b.txt', size: 1 });
check('a plain file is contained with its size and no content', ins('a.txt'), { kind: 'contained', exists: true, rel: 'a.txt', size: 5 });
check('result keys per kind are fixed: nothing carries file content', [ins('a.txt', () => true), ins('new.txt'), ins('.env'), ins('../x'), ins('..x', () => false)].map((r) => Object.keys(r).sort().join()), ['answer,exists,kind,rel,size', 'exists,kind,rel', 'kind', 'kind,refusal', 'answer,exists,kind,rel,size']);

console.log('== path safety: the descriptor ==');
check('the probe gets an open descriptor and the size and its answer is a boolean', [ins('a.txt', (fd, size) => size === 5 && fs.readSync(fd, Buffer.alloc(5), 0, 5, 0) === 5).answer, ins('a.txt', () => 'hello').answer, ins('a.txt', () => 1).answer], [true, false, false]);
const openClose = (fn) => { const c = watched(fn); return [c.filter((n) => n === 'openSync').length, c.filter((n) => n === 'closeSync').length]; };
check('the descriptor is closed after a probe, after a refusal and after a probe that throws', [openClose(() => ins('a.txt', () => true)), openClose(() => ins('a.txt', null, swapTo('folder'))), openClose(() => ins('big.bin')), openClose(() => { try { inspectPath(root, 'a.txt', () => { throw new Error('probe'); }); } catch { /* the probe's error propagates */ } })], same(4, [1, 1]));
check('an error from the probe is a refusal and its message does not leave', ins('a.txt', () => { throw new Error('PROBEMSG'); }), { kind: 'refused', refusal: 'probe' });
check('a path that does not exist, a directory or a FIFO opens nothing', openClose(() => { ins('new.txt'); ins('folder'); ins('pipe'); }), [0, 0]);
const spied = watched(() => ins('a.txt'));
check('the filesystem spy sees the calls a contained path makes', [spied.includes('lstatSync'), spied.includes('realpathSync.native')], [true, true]);

console.log('== path safety: a platform without O_NOFOLLOW ==');
const noFollow = { ...fs.constants, O_NOFOLLOW: undefined }; const noBlock = { ...fs.constants, O_NONBLOCK: undefined };
check('fails closed with `platform` for every reading call', [refusalOf('a.txt', { constants: noFollow }), refusalOf('new.txt', { constants: noFollow }), refusalOf('a.txt', { constants: noBlock }), refusalOf('a.txt', { constants: {} })], same(4, 'platform'));
check('still decides names without the flag: denied stays denied and malformed keeps its id', [ins('.env', null, { constants: noFollow }), ins('../.env', null, { constants: noFollow }), ins('../x', null, { constants: noFollow })], [DENIED, { kind: 'refused', refusal: 'traversal', denied: true }, { kind: 'refused', refusal: 'traversal' }]);
check('never opens without the flag', watched(() => ins('a.txt', null, { constants: noFollow })).filter((c) => c === 'openSync'), []);

console.log(`SUMMARY ${pass + fail} ${fail}`);
process.exit(fail ? 1 : 0);
