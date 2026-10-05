#!/usr/bin/env bash
# Pins hidden-suite scoring and task admission (tests/evals/lib/{score-hidden,admit}.mjs) on a synthetic micro-task
# built here: the happy path, a refusal per admission rule, the scorer's limits and integrity checks, hostile names, the
# child environment. Each guard is mutated on a scratch copy of the libraries and its group must fail. Then every real
# task under tests/evals/ab/ is admitted. Hermetic: temp directories, no model, network or git; skipped in a tarball.
set -uo pipefail
umask 022

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: A/B task scoring and admission =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t abt.XXXXXX)"
trap 'for f in "$TMP"/*/hang*.pid; do kill -9 "$(cat "$f")" 2>/dev/null; done; chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

CODE=$(cat <<'EOS'
import fs from 'node:fs';
const { admitTask: A } = await import(`${process.env.LIB}/admit.mjs`);
const { scoreHidden: S, childEnv, SCORE_TZ } = await import(`${process.env.LIB}/score-hidden.mjs`);
const res = [];
const flush = () => { for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got) + ')')); };
const check = (name, got, want) => { res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]); if (process.env.ONLY && !res.at(-1)[0]) { flush(); process.exit(0); } };
const only = process.env.ONLY ?? ''; const want = (g) => !only || only.split(':')[0] === g; const on = (t) => !only.includes(':') || only.endsWith(`:${t}`);
const T = process.env.TMP; let n = 0; const CAN = 'canary_abcdefghijkl'; const ESC = String.fromCharCode(27); const RLO = String.fromCharCode(0x202e);
const tree = (files) => { const d = `${T}/t${n++}`; fs.mkdirSync(d); for (const [p, c] of Object.entries(files)) { if (c === null) continue; fs.mkdirSync(`${d}/${p}`.replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(`${d}/${p}`, c); } return d; };
const TJ = JSON.stringify({ schema_version: 1, statements: ['add(a, b) returns the sum of two integers'], runner: 'node-test', canary: CAN, source: ['add.mjs'], test_dir: 'test', root_files: ['package.json'], brief: 'Create add.mjs exporting add(a, b).' });
const CASES = [['adds', 'call(1, 2), 3'], ['negatives', 'call(-1, 1), 0'], ['zero', 'call(0, 0), 0'], ['big', 'call(2 ** 40, 1), 2 ** 40 + 1']];
const RUNNER = `// ${CAN}\nconst m = await import(process.env.TASK_WORKSPACE + '/add.mjs');\nconsole.log(JSON.stringify(m.add(...JSON.parse(process.argv[2]))));\n`;
const suite = (extra = '') => `// ${CAN}\nimport fs from 'node:fs';\nimport { spawnSync } from 'node:child_process';\nimport { describe, it } from 'node:test';\nimport assert from 'node:assert/strict';\nconst call = (...a) => JSON.parse(spawnSync(process.execPath, [new URL('./runner.mjs', import.meta.url).pathname, JSON.stringify(a)], { env: process.env, encoding: 'utf8' }).stdout);\ndescribe('add', () => {\n${CASES.map(([nm, ex]) => `  it('${nm}', () => { assert.equal(${ex}); });`).join('\n')}\n${extra}});\n`;
const ORACLE = `export const add = (a, b) => a + b; // ${CAN}\n`;
const ORACLE2 = `export function add(a, b) {\n  let s = a;\n  s += b;\n  return s;\n} // ${CAN}\n`;
const GOOD = { 'task.json': TJ, 'fixture/package.json': '{"type":"module"}\n', 'fixture/add.mjs': 'export const add = () => { throw new Error("todo"); };\n', 'hidden/x.test.mjs': suite(), 'hidden/runner.mjs': RUNNER, 'oracle/add.mjs': ORACLE, 'oracle2/add.mjs': ORACLE2 };
const task = (o = {}) => tree({ ...GOOD, ...o });
const rs = (r) => (r.ok ? 'ACCEPTED' : r.reason); const MU = { name: 'sub', file: 'add.mjs', find: 'a + b', replace: 'a - b' }; const opt = { repeats: 2, timeoutMs: 20000 }; const head = (r, k) => rs(r).slice(0, k); 
if (want('admit')) { const ok = A(task(), { ...opt, mutants: [MU] });
  on('happy') && check('a sound task is admitted: total 4, the mutant is killed and names the failing tests, the hash is returned', [ok.ok, ok.total, ok.repeats, ok.mutantsKilled.map((m) => [m.name, m.failed.length > 0]), /^[0-9a-f]{64}$/.test(ok.hash), [...ok.names].sort()], [true, 4, 2, [['sub', true]], true, ['adds', 'big', 'negatives', 'zero']]);
  on('canary') && check('canary: a hidden file without the canary is refused', head(A(task({ 'hidden/y.test.mjs': 'import test from "node:test"; test("y", () => {});' }), opt), 56), 'canary: hidden/y.test.mjs: missing the canary');
  on('oracle') && check('oracle: an oracle that fails a test is refused naming the score', head(A(task({ 'oracle/add.mjs': `export const add = (a, b) => a + b + (a === 0 ? 1 : 0); // ${CAN}\n` }), opt), 18), 'oracle: scores 3/4');
  on('oracle2') && check('oracle2: a second oracle that disagrees on a test is refused', head(A(task({ 'oracle2/add.mjs': `export const add = (a, b) => (a === 0 ? 1 : a + b); // ${CAN}\n` }), opt), 19), 'oracle2: scores 3/4');
  on('nop') && check('nop: a fixture that already solves the task scores above 0 and is refused', head(A(task({ 'fixture/add.mjs': 'export const add = (a, b) => a + b;\n' }), opt), 40), 'nop: the fixture alone scores 4/4, it mu');
  on('alarm') && check('a suite that changes the task material while it runs is refused by the scorer alarm', rs(A(tree({ ...GOOD, 'hidden/x.test.mjs': suite(`  it('touch', () => fs.appendFileSync(${JSON.stringify(`${T}/t${n}/fixture/package.json`)}, ' '));\n`) }), opt)), 'oracle: task material changed during the run'); on('strict') && check('a hanging second oracle is scored 0/4 by the strict run, not excluded as a timeout', head(A(task({ 'oracle2/add.mjs': `setInterval(() => {}, 1e6); await new Promise(() => {}); // ${CAN}\n` }), { ...opt, timeoutMs: 2500 }), 18), 'oracle2: scores 0/');
  on('happy') && check('the oracle overwrites a fixture file of the same path (a stub in the fixture does not shadow it)', A(task(), opt).ok, true); }
if (want('mutants')) { const m = (mu, extra) => rs(A(task(), { ...opt, mutants: [{ ...MU, ...mu }], ...extra }));
  on('mutants') && check('mutant: find absent -> occurs 0 times; find present twice -> occurs 2 times', [m({ find: 'zzz' }), m({ find: 'a' })].map((r) => r.slice(0, 40)), ['mutant: sub: find occurs 0 times, it must', 'mutant: sub: find occurs 6 times, it must'.replace('6', String(ORACLE.split('a').length - 1))].map((r) => r.slice(0, 40)));
  on('survive') && check('mutant: one that kills nothing survives and is refused by name with its own numbers', m({ find: 'export', replace: 'export' }), 'mutant: sub survives: 4/4 tests still pass');
  on('mutants') && check('mutants are validated up front: a bad mutant is refused as a mutant even when the oracle is broken', rs(A(task({ 'oracle/add.mjs': `export const add = (; // ${CAN}\n` }), { ...opt, mutants: [{ ...MU, find: 'zzz' }] })).slice(0, 7), 'mutant:');
  on('mutants') && check('mutant: a file outside oracle/, a bad name, an empty find and a non-string replace are refused', [m({ file: 'nope.mjs' }), m({ file: '../x' }), m({ name: 'a b' }), m({ find: '' }), m({ replace: 5 })].map((r) => r.slice(0, 7)), Array(5).fill('mutant:'));
  on('dup') && check('mutant: a duplicate name is refused; a mutant that breaks the module kills every test', [rs(A(task(), { ...opt, mutants: [MU, MU] })).slice(0, 7), A(task(), { ...opt, mutants: [{ ...MU, find: 'export', replace: 'export const ' }] }).mutantsKilled?.[0]?.failed.length], ['mutant:', 4]); }
if (want('stability')) { const counter = `  it('counter', () => { call(0, 0); const f = process.env.TASK_WORKSPACE + '/counter'; const c = fs.existsSync(f) ? Number(fs.readFileSync(f, 'utf8')) : 0; fs.writeFileSync(f, String(c + 1)); assert.equal(c, 0); });\n`;
  check('stability: a test that depends on state left by the previous run is refused at run 2; with one repeat it passes', [head(A(task({ 'hidden/x.test.mjs': suite(counter) }), opt), 28), A(task({ 'hidden/x.test.mjs': suite(counter) }), { ...opt, repeats: 1 }).ok], ['stability: run 2 scored 4/5 ', true]); }
if (want('arguments')) { check('admitTask refuses a non-string directory, bad repeats, too many mutants and a missing directory', [A(5), A(task(), { repeats: 0 }), A(task(), { repeats: 51 }), A(task(), { mutants: Array(65).fill(MU) }), A(task(), []), A(`${T}/absent`, opt)].map((r) => rs(r).split(':')[0]), ['arguments', 'arguments', 'arguments', 'arguments', 'arguments', 'canary']); }

const ws = () => tree({ 'add.mjs': ORACLE }); const probe = (body, name = 'p.test.mjs') => tree({ [name]: `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\n${body}\n` }); const sc = (hidden, o = {}) => S({ workspace: ws(), hiddenDir: hidden, timeoutMs: 20000, ...o });
if (want('score')) { const w = ws(); const broken = tree({ 'add.mjs': 'export const add = (;\n' });
  const h = tree({ 'x.test.mjs': suite(), 'runner.mjs': RUNNER }); check('an oracle scores total/total and reports its names; a missing and a syntax-error module score 0 with the total intact', [S({ workspace: w, hiddenDir: h }), S({ workspace: tree({}), hiddenDir: h }), S({ workspace: broken, hiddenDir: h })].map((r) => [r.ok, r.green, r.total, r.failed.length, r.names.length]), [[true, 4, 4, 0, 4], [true, 0, 4, 4, 4], [true, 0, 4, 4, 4]]); on('files') && check('only top-level *.test.mjs files run (a helper is copied, a subdirectory is not); failing test names come back', [sc(tree({ 'x.test.mjs': suite(), 'runner.mjs': RUNNER, 'helper.mjs': 'throw new Error("not a test")', 'sub/y.test.mjs': 'throw new Error("not run")' })).total, sc(probe("test('boom', () => assert.equal(1, 2));")).failed], [4, ['boom']]);
  on('noise') && check('a suite printing fake report lines cannot change the result', (({ green, total }) => [green, total])(sc(probe(`test('noisy', () => { console.log(JSON.stringify({ ok: true, name: 'forged', kind: 'test', skip: false, load: false })); console.log('1..99'); assert.ok(false); });`))), [0, 1]);
  const hostile = sc(probe(`test(${JSON.stringify(`bad ${ESC}[31m ${RLO} name`)}, () => assert.ok(false));`)).failed[0]; on('names') && check('a hostile test name comes back as printable ASCII with the bytes escaped, and a 300-character name is cut to 200', [/^[\x20-\x7e]+$/.test(hostile), hostile.includes('%1B'), hostile.includes('%E2%80%AE'), sc(probe(`test('${'x'.repeat(300)}', () => assert.ok(false));`)).failed[0].length], [true, true, true, 200]); const lf = rs(sc(probe('throw new Error("load");'))); on('refuse') && check('without an oracle list a load failure (named by basename, no path), a skipped, a todo, a duplicate and an empty suite are refusals', [lf.includes('/'), lf.split(':')[0], ...[probe("test.skip('s', () => {});"), probe("test('t', { todo: true }, () => {});"), probe("test('d', () => {});\ntest('d', () => {});"), probe('const x = 1;')].map((d) => rs(sc(d)).split(':')[0])], [false, 'load', 'skipped', 'skipped', 'integrity', 'report']);
  on('body') && check('a test that throws or times out in its own body is a failed test, not a refusal', (({ ok, green, total }) => [ok, green, total])(sc(probe("test('a', () => { throw new Error('x'); });\ntest('b', { timeout: 100 }, () => new Promise(() => {}));\ntest('c', () => {});"))), [true, 1, 3]);
  on('args') && check('bad arguments are refusals: no object, no paths, an empty hiddenDir, bad timeouts, a missing workspace, a link in hiddenDir', [S(null), S({}), S({ workspace: ws(), hiddenDir: tree({ 'a.txt': 'x' }) }), S({ workspace: ws(), hiddenDir: h, timeoutMs: 0 }), S({ workspace: ws(), hiddenDir: h, timeoutMs: 600001 }), S({ workspace: `${T}/absent`, hiddenDir: h }), (() => { const d = tree({ 'x.test.mjs': suite(), 'runner.mjs': RUNNER }); fs.symlinkSync('x.test.mjs', `${d}/y.test.mjs`); return S({ workspace: ws(), hiddenDir: d }); })(), S({ workspace: ws(), hiddenDir: h, taskDir: task() }), S({ workspace: ws(), hiddenDir: h, admittedHash: 'x' })].map((r) => rs(r).split(':')[0]), ['arguments', 'arguments', 'hiddenDir', 'arguments', 'arguments', 'run', 'hiddenDir', 'arguments', 'arguments']); }
if (want('strict')) { const mk = (id, last = '') => `import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('${id}1', async () => { const m = await import(process.env.TASK_WORKSPACE + '/${id}.mjs'); assert.equal(m.v, 1); });\ntest('${id}2', async () => { const m = await import(process.env.TASK_WORKSPACE + '/${id}.mjs'); await new Promise((r) => setTimeout(r, 150)); assert.equal(m.v, 1); });\n${last}`;
  const two = (b = mk('b')) => tree({ 'a.test.mjs': mk('a'), 'b.test.mjs': b }); const EXP = { total: 4, names: ['a1', 'a2', 'b1', 'b2'] }; const GOODM = 'export const v = 1;'; const st = (b, o = {}) => S({ workspace: tree({ 'a.mjs': GOODM, 'b.mjs': b ?? GOODM }), hiddenDir: o.hiddenDir ?? two(), timeoutMs: 20000, expect: EXP, ...o }); const brief = (r) => [r.ok, r.green, r.total, r.failed]; on('base') && check('with the oracle list: a good candidate scores 4/4, and the oracle list is reported by discovery', [brief(st()), S({ workspace: tree({ 'a.mjs': GOODM, 'b.mjs': GOODM }), hiddenDir: two() }).names.sort()], [[true, 4, 4, []], EXP.names]); on('unreported') && check('process.exit(0) in one candidate file scores 2/4 (the total stays 4), not 2/2 and not a refusal', brief(st('process.exit(0);')), [true, 2, 4, ['b1', 'b2']]);
  const late = st('export const v = 1; setTimeout(() => { throw new Error("late"); }, 20);'); const killer = st('process.kill(process.ppid, "SIGKILL"); export const v = 1;'); on('late') && check('a late uncaught error and a candidate that kills the runner score below the total, never a refusal; the kill is flagged', [late.ok && late.green < 4 && late.total === 4, killer.ok && killer.green < 4 && killer.total === 4, killer.crashed], [true, true, true]); on('late') && check('a test file that fails to load scores its expected tests as failed and sets loadFailed', (({ ok, green, total, loadFailed }) => [ok, green, total, loadFailed])(st(undefined, { hiddenDir: two('throw new Error("load");\n') })), [true, 2, 4, true]);
  const iu = st(undefined, { expect: { total: 3, names: ['a1', 'a2', 'b1'] } }); on('integrity') && check('a reported test the oracle does not have, and a name reported twice, score green 0 with integrity set, never a refusal', [iu, S({ workspace: ws(), hiddenDir: probe("test('d', () => {});\ntest('d', () => {});"), expect: { total: 2, names: ['d', 'x'] } })].map((r) => [r.ok, r.green, r.total, r.integrity]), [[true, 0, 3, true], [true, 0, 2, true]]); on('integrity') && check('a malformed expect (duplicate names, wrong total, not an object, non-string names) is refused', [{ total: 2, names: ['a', 'a'] }, { total: 2, names: ['a'] }, 5, { total: 1, names: [1] }, { total: 0, names: [] }, { total: 10001, names: Array.from({ length: 10001 }, (_, i) => `n${i}`) }].map((e) => rs(S({ workspace: ws(), hiddenDir: two(), expect: e })).split(':')[0]), Array(6).fill('arguments'));
  const where = tree({}); const hd = probe(`test('w', () => { const u = new URL(import.meta.url); fs.writeFileSync(process.env.TASK_WORKSPACE + '/where.json', JSON.stringify({ p: u.pathname, mode: fs.statSync(u).mode & 0o777, dir: fs.statSync(new URL('.', import.meta.url)).mode & 0o777 })); });`); S({ workspace: where, hiddenDir: hd, timeoutMs: 20000 }); const wh = JSON.parse(fs.readFileSync(`${where}/where.json`, 'utf8')); on('copy') && check('the suite runs from a copy (files 0444, directory 0555), not from hiddenDir', [wh.p.startsWith(hd), wh.mode, wh.dir], [false, 0o444, 0o555]);
  const tpf = (body) => tree({ 'p.test.mjs': `import test from 'node:test';\nimport fs from 'node:fs';\ntest('p1', () => { const d = new URL('.', import.meta.url); const q = new URL('./q.test.mjs', import.meta.url); ${body} });\n`, 'q.test.mjs': "import test from 'node:test';\ntest('q1', () => {});\n" }); const leak = `${T}/leak`; fs.mkdirSync(leak); const oldTmp = process.env.TMPDIR; process.env.TMPDIR = leak;
  const tams = ["fs.chmodSync(q, 0o644); fs.appendFileSync(q, ' ');", 'fs.chmodSync(q, 0);', 'fs.chmodSync(d, 0);', "fs.renameSync(d, new URL('../hidden_x/', import.meta.url));"].map((b) => S({ workspace: ws(), hiddenDir: tpf(b), expect: { total: 2, names: ['p1', 'q1'] } })); if (oldTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = oldTmp;
  on('copy') && check('with an oracle list a rewritten, unreadable, mode-0 or renamed harness copy scores green 0 with tampered set (ok:true) and leaves no temp directory behind', [tams.map((r) => [r.ok, r.green < 2, r.tampered]), fs.readdirSync(leak).length], [Array(4).fill([true, true, true]), 0]);
  const J = (...l) => l.join('\n'); const HEAD = 'import fs from "node:fs"; import path from "node:path";'; const PHEAD = 'const hid = path.dirname(process.argv[1]); const b = path.join(hid, "b.test.mjs");';
  const R2 = J(HEAD, PHEAD, 'const orig = fs.readFileSync(b, "utf8");', 'if (!orig.includes("FORGED")) { fs.chmodSync(hid, 0o755); fs.chmodSync(b, 0o644); fs.writeFileSync(b, "// FORGED\\nimport fs from \\"node:fs\\"; import test from \\"node:test\\";\\nfs.writeFileSync(" + JSON.stringify(b) + ", " + JSON.stringify(orig) + "); fs.chmodSync(" + JSON.stringify(b) + ", 0o444); fs.chmodSync(" + JSON.stringify(hid) + ", 0o555);\\ntest(\\"b1\\", () => {}); test(\\"b2\\", () => {});\\n"); }', 'export const v = 1;');
  const R3 = J(HEAD, PHEAD, 'if (!fs.existsSync(hid + ".orig")) { fs.renameSync(hid, hid + ".orig"); fs.mkdirSync(hid); fs.writeFileSync(b, "import fs from \\"node:fs\\"; import test from \\"node:test\\";\\nfs.rmSync(" + JSON.stringify(hid) + ", { recursive: true }); fs.renameSync(" + JSON.stringify(hid + ".orig") + ", " + JSON.stringify(hid) + ");\\ntest(\\"b1\\", () => {}); test(\\"b2\\", () => {});\\n"); }', 'export const v = 1;');
  const R4 = J(HEAD, PHEAD, 'const tmp = path.dirname(hid); if (!fs.existsSync(tmp + ".orig")) { fs.renameSync(tmp, tmp + ".orig"); fs.mkdirSync(hid, { recursive: true }); fs.writeFileSync(b, "import fs from \\"node:fs\\"; import test from \\"node:test\\";\\nfs.rmSync(" + JSON.stringify(tmp) + ", { recursive: true }); fs.renameSync(" + JSON.stringify(tmp + ".orig") + ", " + JSON.stringify(tmp) + ");\\ntest(\\"b1\\", () => {}); test(\\"b2\\", () => {});\\n"); }', 'export const v = 1;');
  const SPARSE = J(HEAD, 'const hid = path.dirname(process.argv[1]);', 'try { fs.chmodSync(hid, 0o755); for (let i = 0; i < 10; i++) { const fd = fs.openSync(path.join(hid, "z" + i), "w"); fs.ftruncateSync(fd, 1900 * 1024 * 1024); fs.closeSync(fd); } } catch (e) {}', 'export const v = 1;');
  const victim = tree({ 'v.txt': 'x' }); fs.chmodSync(`${victim}/v.txt`, 0o644);
  const SWAP = J(HEAD, 'const tmp = path.dirname(path.dirname(process.argv[1]));', `if (!fs.existsSync(tmp + ".x")) { try { fs.renameSync(tmp, tmp + ".x"); fs.symlinkSync(${JSON.stringify(victim)}, tmp); } catch (e) {} }`, 'export const v = 1;');
  const bad = (src) => S({ workspace: tree({ 'a.mjs': src, 'b.mjs': GOODM }), hiddenDir: two(), timeoutMs: 20000, expect: EXP }); const t0 = Date.now(); const sp = on('sparse') ? bad(SPARSE) : null; const spMs = Date.now() - t0; const sw = on('swap') ? bad(SWAP) : null;
  on('restore') && check('rewrite-then-restore of a later test file, of the hidden directory and of the harness directory all score green 0 with tampered set', [R2, R3, R4].map((src) => { const r = bad(src); return [r.ok, r.green, r.tampered]; }), Array(3).fill([true, 0, true]));
  on('sparse') && check('ten multi-GB sparse files planted in the harness copy are detected without reading them (well under a second of post-run work)', [sp.ok, sp.green, sp.tampered, spMs < 8000], [true, 0, true, true]);
  on('swap') && check('a harness directory swapped for a link to a victim is not followed by cleanup (victim modes unchanged) and scores green 0 with tampered set', [sw.ok, sw.tampered, fs.statSync(victim).mode & 0o777, fs.statSync(`${victim}/v.txt`).mode & 0o777], [true, true, 0o755, 0o644]);
  const mkt = () => { const dn = `${T}/t${n}`; return task({ 'hidden/x.test.mjs': `import test from 'node:test';\nimport fs from 'node:fs';\ntest('m', () => fs.appendFileSync(${JSON.stringify(`${dn}/fixture/package.json`)}, ' '));\n` }); }; const tc = S({ workspace: ws(), taskDir: mkt(), expect: { total: 1, names: ['m'] } });
  on('copy') && check('a task changed during a run scores green 0 with taskChanged (ok:true) given an oracle list and is a refusal without; an unchanged task is ok; a bad taskDir and a different admitted hash refuse', [tc.ok, tc.green, tc.taskChanged, tc.tampered, rs(S({ workspace: ws(), taskDir: mkt() })), S({ workspace: ws(), taskDir: task() }).ok, rs(S({ workspace: ws(), taskDir: `${T}/absent` })).split(':')[0], rs(S({ workspace: ws(), taskDir: task(), admittedHash: '0'.repeat(64) }))], [true, 0, true, true, 'task material changed during the run', true, 'taskDir', 'task material changed since admission']);
  on('skip') && check('a skipped expected test counts as failed, not a refusal', (({ ok, green, failed }) => [ok, green, failed])(S({ workspace: ws(), hiddenDir: probe("test.skip('s', () => {});"), expect: { total: 1, names: ['s'] } })), [true, 0, ['s']]); const dump = probe("test('e', () => fs.writeFileSync(process.env.TASK_WORKSPACE + '/e.json', JSON.stringify(process.env)));"); const wx = tree({}); S({ workspace: wx, hiddenDir: dump, extraEnv: { UPSTREAM_KEY: 'planted-value' } });
  const ev = (x) => rs(S({ workspace: ws(), hiddenDir: dump, extraEnv: x })).split(':')[0]; on('envx') && check('a validated extraEnv reaches the suite; lowercase, NODE_, LD_, symbol-keyed, allowlisted, long-valued, non-string, 9-entry, array and getter forms are refused', [JSON.parse(fs.readFileSync(`${wx}/e.json`, 'utf8')).UPSTREAM_KEY, ...[{ lower: 'x' }, { NODE_OPTIONS: 'x' }, { LD_PRELOAD: 'x' }, { [Symbol('s')]: 'x' }, { TASK_WORKSPACE: 'x' }, { UPSTREAM_KEY: 'x'.repeat(257) }, { UPSTREAM_KEY: 5 }, Object.fromEntries('ABCDEFGHI'.split('').map((k) => [`TASK_${k}`, 'x'])), [], Object.defineProperty({}, 'UPSTREAM_KEY', { get: () => 'x', enumerable: true })].map(ev)], ['planted-value', ...Array(10).fill('arguments')]); }
if (want('limits')) { const hp = (i) => `${T}/hang${i}.pid`; const hang = (i) => probe(`fs.writeFileSync(${JSON.stringify(hp(i))}, String(process.pid));\ntest('ok1', () => {});\ntest('hang', () => new Promise(() => {}));`);
  const r = S({ workspace: ws(), hiddenDir: hang(1), timeoutMs: 1000, expect: { total: 2, names: ['ok1', 'hang'] } }); const d = rs(S({ workspace: ws(), hiddenDir: hang(2), timeoutMs: 1000 })); const pids = [1, 2].map((i) => Number(fs.readFileSync(hp(i), 'utf8')));
  const up = () => pids.some((pid) => { try { process.kill(pid, 0); return true; } catch { return false; } }); let alive = up(); for (let i = 0; i < 20 && alive; i++) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50); alive = up(); } for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
  on('hang') && check('a hanging candidate scores green 0 with the total intact and timedOut set (an oracle run refuses), and no test process is left', [r.ok, r.green, r.total, r.timedOut, d.slice(0, 7), alive], [true, 0, 2, true, 'timeout', false]);
  const big = probe(`test('ok1', () => {});\ntest('${'x'.repeat(9 * 1024 * 1024)}', () => {});`); const o = S({ workspace: ws(), hiddenDir: big, expect: { total: 2, names: ['ok1', 'x'.repeat(200)] } }); on('big') && check('output over 8 MiB scores what was reported before the cap (the partial last line is dropped) with truncated set, and an oracle run refuses', [o.ok, o.green, o.total, o.truncated, o.integrity, rs(sc(big)).slice(0, 7)], [true, 1, 2, true, false, 'output:']); }
if (want('env')) { process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-test-secret'; process.env.ANTHROPIC_API_KEY = 'sk-test-key'; process.env.NODE_OPTIONS = '--max-old-space-size=64'; process.env.TZ = 'UTC'; process.env.SECRET_X = 'x';
  const w = ws(); const h = probe("test('env', () => { fs.writeFileSync(process.env.TASK_WORKSPACE + '/env.json', JSON.stringify({ env: process.env, cwd: process.cwd(), off: new Date(2026, 2, 8, 12).getTimezoneOffset() })); });"); const r = S({ workspace: w, hiddenDir: h, timeoutMs: 20000 }); const seen = JSON.parse(fs.readFileSync(`${w}/env.json`, 'utf8'));
  const keys = Object.keys(seen.env).filter((k) => !['NODE_TEST_CONTEXT', 'NODE_TEST_WORKER_ID'].includes(k)).sort(); check('the suite sees only PATH, HOME, TZ, LC_ALL and TASK_WORKSPACE: no token, API key, NODE_OPTIONS or other host variable', [r.ok, keys, seen.env.TZ, seen.env.LC_ALL, seen.env.TASK_WORKSPACE === fs.realpathSync(w), Object.values(seen.env).some((v) => /sk-test|max-old-space/.test(v))], [true, ['HOME', 'LC_ALL', 'PATH', 'TASK_WORKSPACE', 'TZ'], SCORE_TZ, 'C', true, false]); check('the time zone is pinned (a March 8 noon in Los Angeles is PDT, 420 minutes) and the cwd is not the workspace', [seen.off, seen.cwd !== fs.realpathSync(w), seen.env.HOME === seen.cwd], [420, true, true]); }
if (want('real')) { const dirs = fs.existsSync('tests/evals/ab') ? fs.readdirSync('tests/evals/ab', { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort() : [];
  if (dirs.length === 0) console.log('ok\t(no tests/evals/ab/<task>/ yet: real-task admission has nothing to check)');
  for (const d of dirs) { const mf = `tests/evals/ab/${d}.mutants.json`; const r = A(`tests/evals/ab/${d}`, { mutants: fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : [], repeats: 20 }); check(`real task ${d} is admitted (${r.ok ? `${r.total} tests, ${r.mutantsKilled.length} mutants killed` : r.reason})`, r.ok, true); } }
flush();
EOS
)
suite() { LIB="$1" ONLY="${2:-}" TMP="$(mktemp -d -p "$TMP")" TZ=UTC node --input-type=module -e "$CODE" 2>&1; }
out=$(suite "$ROOT/tests/evals/lib") || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"

nm=0; JOBS="${JOBS:-4}"; dirs=(); labels=()
[[ "$JOBS" =~ ^[1-9][0-9]*$ ]] || { echo "  FAIL JOBS must be a positive integer, got '$JOBS'"; exit 1; }
mutant() { # group, file, from, to, label (runs in the background, at most JOBS at once; results are read back in order)
  local d="$TMP/m$((++nm))"; mkdir "$d"; cp tests/evals/lib/{admit,score-hidden,task-store,manifest}.mjs "$d/"; dirs+=("$d"); labels+=("$5")
  while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n; done
  ( if ! M_FILE="$d/$2" M_FROM="$3" M_TO="$4" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then echo FAIL-NOTFOUND > "$d.out"; exit 0; fi
    if [ -n "$(suite "$d" "$1" | grep -v '^ok')" ]; then echo CAUGHT > "$d.out"; else echo FAIL-SURVIVED > "$d.out"; fi ) &
}
mutant admit:canary admit.mjs "if (!canary.ok) return" "if (false) return" "canary rule"
mutant admit:oracle admit.mjs "if (first.green !== first.total)" "if (false)" "oracle rule"
mutant admit:oracle2 admit.mjs "second.green !== total" "false" "oracle2 rule"
mutant admit:nop admit.mjs "nop.green !== 0" "false" "nop rule"
mutant admit:happy admit.mjs "workspace(['fixture', 'oracle'])" "workspace(['oracle', 'fixture'])" "oracle files win over the fixture"
mutant mutants:mutants admit.mjs "if (count !== 1)" "if (count < 1)" "find must occur exactly once"
mutant mutants:survive admit.mjs "if (res.green === res.total)" "if (false)" "a surviving mutant is refused"
mutant mutants:mutants admit.mjs "|| !oracleFiles.has(file)" "" "mutant file must be an oracle file"
mutant mutants:dup admit.mjs "|| prepared.some((q) => q.name === mu.name)" "" "mutant names are unique"
mutant stability admit.mjs "if (again.green !== total)" "if (false)" "stability rule"
mutant arguments admit.mjs "|| repeats < 1 ||" "||" "repeats lower bound"
mutant score:refuse score-hidden.mjs 'if (!expect) throw new Fault(`load:' 'if (false) throw new Fault(`load:' "a file that fails to load is refused"
mutant score:refuse score-hidden.mjs "if (rec.skip && !expect) throw" "if (false) throw" "a skipped test is refused"
mutant score:refuse score-hidden.mjs "if (!expect && got.size === 0)" "if (false)" "an empty suite is refused"
mutant score score-hidden.mjs "rec.kind !== 'test' || rec.load" "rec.load" "only tests are counted, not suites"
mutant score:names score-hidden.mjs "const tname = (s) => esc(s.slice(0, MAX_NAME));" "const tname = (s) => s;" "test names are escaped and cut"
mutant limits:hang score-hidden.mjs "r.error?.code === 'ETIMEDOUT'" "false" "timeout is a refusal"
mutant limits:hang score-hidden.mjs "process.kill(-r.pid, 'SIGKILL')" "0" "the process group is killed"
mutant limits:big score-hidden.mjs "MAX_OUTPUT = 8 * 1024 * 1024" "MAX_OUTPUT = 64 * 1024 * 1024" "output cap"
mutant score:args score-hidden.mjs "timeoutMs > MAX_TIMEOUT_MS" "false" "timeout bound"
mutant env score-hidden.mjs "cwd: home" "cwd: real" "cwd is a harness directory"
mutant strict:integrity score-hidden.mjs "if (expect && !expect.names.includes(name)) throw" "if (false) throw" "an unknown test name is an integrity refusal"
mutant strict:integrity score-hidden.mjs "if (got.has(name)) throw" "if (false) throw" "a duplicate test name is an integrity refusal"
mutant strict:unreported score-hidden.mjs "got.get(n) === true &&" "got.get(n) !== false &&" "an unreported expected test counts as failed"
mutant strict:integrity score-hidden.mjs "if (!expect) return refuse(e.message);" "if (true) return refuse(e.message);" "an integrity fault with an oracle list is scored, not refused"
mutant strict:integrity score-hidden.mjs "timedOut || integrity || tampered" "timedOut || tampered" "an integrity fault scores green 0"
mutant strict:integrity score-hidden.mjs "Number.isInteger(total) && total >= 1 && total <= MAX_TESTS && Array.isArray(names) && names.length === total &&" "Number.isInteger(total) && Array.isArray(names) &&" "expect: total and names length bounds"
mutant strict:envx score-hidden.mjs "typeof k === 'string' && /^(UPSTREAM_KEY|TASK_[A-Z0-9_]+)$/.test(k) &&" "" "extraEnv key rules (symbol, name pattern)"
mutant strict:copy score-hidden.mjs "const tampered = !intact(tmp, hid, pre) || taskChanged;" "const tampered = taskChanged;" "the harness-copy digest"
mutant strict:copy score-hidden.mjs "integrity || tampered || !good(n)" "integrity || !good(n)" "a tampered copy scores green 0"
mutant strict:copy score-hidden.mjs "if (before && admittedHash !== undefined && before.hash !== admittedHash)" "if (false)" "the admitted hash is required"
mutant admit:strict admit.mjs "run(rule, ws, { total, names: first.names })" "run(rule, ws)" "later runs are scored against the oracle's names"
mutant admit:alarm admit.mjs "timeoutMs, taskDir, admittedHash: canary.hash, expect" "timeoutMs, admittedHash: canary.hash, expect" "admission passes taskDir to the scorer"
mutant strict:copy score-hidden.mjs "} catch { return false; }" "} catch { return true; }" "an unreadable harness copy is tampering"
mutant strict:copy score-hidden.mjs "!intact(tmp, hid, pre) || taskChanged;" "!intact(tmp, hid, pre);" "a changed task is tampering"
mutant strict:copy score-hidden.mjs "{ unlock(tmp); try" "{ try" "the harness directory is unlocked before removal"
mutant strict:copy score-hidden.mjs "fs.chmodSync(hid, 0o555);" "" "the copy directory is read-only"
mutant strict:skip score-hidden.mjs "rec.ok && !rec.skip" "rec.ok" "a skipped expected test counts as failed"
mutant score:args score-hidden.mjs "(admittedHash !== undefined && taskDir === undefined) ||" "" "admittedHash needs taskDir"
mutant score:args score-hidden.mjs "path.resolve(hiddenDir) !== path.resolve(taskDir, 'hidden')" "false" "hiddenDir may only be taskDir/hidden"
mutant strict:restore score-hidden.mjs "if (lst(tmp) !== pre.t || lst(hid) !== pre.h || names.join('\\0') !== pre.names.join('\\0') || names.some((n, i) => lst(path.join(hid, n)) !== pre.f[i])) return false;" "" "the lstat snapshot comparisons (names, inode, ctime, size, mode)"
mutant strict:swap score-hidden.mjs "if (same) { unlock(tmp);" "if (true) { unlock(tmp);" "cleanup does not follow a swapped-in link"
mutant limits:big score-hidden.mjs "text.slice(0, text.lastIndexOf('\n') + 1)" "text" "the partial last line of a truncated report is dropped"
mutant strict:late score-hidden.mjs "!badFiles.has(fileOf.get(n))" "true" "tests of a file that ended in an uncaught error fail"
mutant strict:integrity score-hidden.mjs "new Set(names).size === total" "true" "expected names are unique"
mutant strict:envx score-hidden.mjs "!ALLOWED.includes(k) &&" "" "extraEnv cannot replace the allowlist"
mutant strict:envx score-hidden.mjs "d.value.length <= 256" "true" "extraEnv value cap"
mutant strict:envx score-hidden.mjs "ds.length <= 8" "true" "extraEnv count cap"
mutant strict:copy score-hidden.mjs "fs.chmodSync(path.join(hid, e.name), 0o444)" "0" "the hidden copy is read-only"
mutant strict:copy score-hidden.mjs "files.push(path.join(hid, e.name))" "files.push(path.join(hiddenDir, e.name))" "the suite runs from the copy"
mutant score:args score-hidden.mjs "if (e.isSymbolicLink()) return" "if (false) return" "a link in hiddenDir is refused"
mutant strict:copy score-hidden.mjs "after.hash !== before.hash" "false" "the task-change alarm"
mutant limits:hang score-hidden.mjs "timedOut || integrity" "integrity" "a timeout scores green 0"
mutant env score-hidden.mjs "return { ...extra, PATH:" "return { ...process.env, ...extra, PATH:" "environment allowlist"
mutant env score-hidden.mjs "TZ: SCORE_TZ" "TZ: process.env.TZ" "pinned time zone"

wait
for i in "${!dirs[@]}"; do r=$(cat "${dirs[$i]}.out" 2>/dev/null); if [ "$r" = CAUGHT ]; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "${labels[$i]}"; else fail=$((fail+1)); printf '  FAIL mutation %s: %s\n' "${r:-lost}" "${labels[$i]}"; fi; done
ran=$((pass + fail))
[ "$ran" -ge 96 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 96 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
