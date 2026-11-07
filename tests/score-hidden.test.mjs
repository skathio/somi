// The hidden-test scorer decides every benchmark score, from a workspace a candidate wrote. With an oracle's list nothing the candidate
// does may stop the scoring: a hang, a crash, a garbled report or a tampered suite each score what they earn, which is usually zero.
// Without one (an oracle being established) every doubt is a refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from './helpers.mjs';
import { SCORE_TZ, childEnv, scoreHidden } from './evals/lib/score-hidden.mjs';
import { taskHash } from './evals/lib/task-store.mjs';

const PASS = (name) => `test(${JSON.stringify(name)}, () => {});\n`;
const FAIL = (name) => `test(${JSON.stringify(name)}, () => { throw new Error('no'); });\n`;
const suite = (body) => `import { test } from 'node:test';\n${body}`;

function setup(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-score-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const hidden = path.join(dir, 'hidden');
  const workspace = path.join(dir, 'ws');
  fs.mkdirSync(hidden);
  fs.mkdirSync(workspace);
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(hidden, name), text);
  return { hidden, workspace, dir };
}
const score = (s, extra = {}) => scoreHidden({ workspace: s.workspace, hiddenDir: s.hidden, timeoutMs: 20000, ...extra });
const expectOf = (...names) => ({ total: names.length, names });
const FLAGS = { timedOut: false, truncated: false, crashed: false, loadFailed: false, integrity: false, tampered: false, taskChanged: false };

test('an oracle run reports every test by name, in file order', (t) => {
  const s = setup(t, { 'b.test.mjs': suite(PASS('b1') + FAIL('b2')), 'a.test.mjs': suite(PASS('a1')), 'helper.mjs': 'export const x = 1;\n' });
  assert.deepEqual(score(s), { ok: true, green: 2, total: 3, failed: ['b2'], names: ['a1', 'b1', 'b2'], ...FLAGS });
});

test('without an oracle list, a skip, a repeat, a load failure, an empty suite or a missing suite is refused', (t) => {
  const cases = [
    [{ 'a.test.mjs': suite(`${PASS('a1')}test('later', { skip: true }, () => {});\n`) }, 'skipped: a test is skipped or todo: later'],
    [{ 'a.test.mjs': suite(`test.todo('soon');\n`) }, 'skipped: a test is skipped or todo: soon'],
    [{ 'a.test.mjs': suite(PASS('same')), 'b.test.mjs': suite(PASS('same')) }, 'integrity: a test is reported twice: same'],
    [{ 'a.test.mjs': suite(PASS('a1')), 'b.test.mjs': 'this is not javascript(' }, 'load: a test file failed to load: b.test.mjs'],
    [{ 'a.test.mjs': suite('') }, 'report: the suite reported no tests'],
    [{ 'a.mjs': suite(PASS('a1')) }, 'hiddenDir: no *.test.mjs files'],
  ];
  for (const [files, reason] of cases) assert.deepEqual(score(setup(t, files)), { ok: false, reason }, reason);
});

test('with an oracle list, the same faults are scored, never refused', (t) => {
  const skip = setup(t, { 'a.test.mjs': suite(`${PASS('a1')}test('a2', { skip: true }, () => {});\n`) });
  assert.deepEqual(score(skip, { expect: expectOf('a1', 'a2') }), { ok: true, green: 1, total: 2, failed: ['a2'], names: ['a1', 'a2'], ...FLAGS });
  const missing = setup(t, { 'a.test.mjs': suite(PASS('a1')) });
  assert.deepEqual(score(missing, { expect: expectOf('a1', 'gone') }), { ok: true, green: 1, total: 2, failed: ['gone'], names: ['a1'], ...FLAGS });
  const unknown = setup(t, { 'a.test.mjs': suite(PASS('a1') + PASS('new')) });
  assert.deepEqual(score(unknown, { expect: expectOf('a1') }), { ok: true, green: 0, total: 1, failed: ['a1'], names: ['a1'], ...FLAGS, integrity: true });
  const twice = setup(t, { 'a.test.mjs': suite(PASS('a1')), 'b.test.mjs': suite(PASS('a1')) });
  assert.equal(score(twice, { expect: expectOf('a1') }).integrity, true);
  const load = setup(t, { 'a.test.mjs': suite(PASS('a1')), 'b.test.mjs': `${suite(PASS('b1'))}throw new Error('late');\n` });
  assert.deepEqual(score(load, { expect: expectOf('a1', 'b1') }), { ok: true, green: 1, total: 2, failed: ['b1'], names: ['a1'], ...FLAGS, loadFailed: true }, 'a file that fails to load runs none of its tests');
  const late = setup(t, { 'a.test.mjs': suite(PASS('a1')), 'b.test.mjs': suite(`test('b1', () => { setTimeout(() => { throw new Error('late'); }, 20); });\ntest('b2', () => new Promise((r) => setTimeout(r, 200)));\n`) });
  const r = score(late, { expect: expectOf('a1', 'b1', 'b2') });
  assert.deepEqual({ green: r.green, failed: r.failed, loadFailed: r.loadFailed }, { green: 1, failed: ['b1', 'b2'], loadFailed: true }, 'a test that passed in a file that then ended in an error fails');
});

test('a hang scores nothing, and without an oracle list it is refused', (t) => {
  const s = setup(t, { 'a.test.mjs': suite(`${PASS('a1')}test('hang', () => new Promise(() => setInterval(() => {}, 1000)));\n`) });
  assert.deepEqual(score(s, { timeoutMs: 1500 }), { ok: false, reason: 'timeout' });
  const r = score(s, { timeoutMs: 1500, expect: expectOf('a1', 'hang') });
  assert.deepEqual({ green: r.green, failed: r.failed, timedOut: r.timedOut }, { green: 0, failed: ['a1', 'hang'], timedOut: true });
});

test('a killed runner scores what it reported, and without an oracle list it is refused', (t) => {
  const s = setup(t, { 'a.test.mjs': suite(PASS('a1')), 'b.test.mjs': suite(`test('b1', () => { process.kill(process.ppid, 'SIGKILL'); return new Promise(() => {}); });\n`) });
  assert.deepEqual(score(s), { ok: false, reason: 'run: the suite was killed' });
  assert.deepEqual(score(s, { expect: expectOf('a1', 'b1') }), { ok: true, green: 1, total: 2, failed: ['b1'], names: ['a1'], ...FLAGS, crashed: true });
});

test('a report over 8 MiB is cut at its last whole line and flagged', (t) => {
  const s = setup(t, { 'a.test.mjs': suite(`${PASS('a1')}test('x'.repeat(9 * 1024 * 1024), () => {});\n`) });
  assert.deepEqual(score(s), { ok: false, reason: 'output: the report exceeded 8 MiB' });
  const r = score(s, { expect: expectOf('a1', 'big') });
  assert.deepEqual({ green: r.green, truncated: r.truncated, failed: r.failed }, { green: 1, truncated: true, failed: ['big'] });
});

test('a suite that rewrites its own copy is caught, and scores nothing', (t) => {
  const rewrite = `import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
test('a1', () => { fs.chmodSync(here, 0o755); fs.writeFileSync(path.join(here, 'planted.mjs'), ''); });\n`;
  const s = setup(t, { 'a.test.mjs': suite(rewrite) });
  assert.deepEqual(score(s), { ok: false, reason: 'task material changed during the run' });
  assert.deepEqual(score(s, { expect: expectOf('a1') }), { ok: true, green: 0, total: 1, failed: ['a1'], names: ['a1'], ...FLAGS, tampered: true });
  const touch = `import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
test('a1', () => { fs.writeFileSync(path.join(here, '..', 'note'), 'x'); });\n`;
  assert.equal(score(setup(t, { 'a.test.mjs': suite(touch) }), { expect: expectOf('a1') }).tampered, true, 'a write next to the suite shows too');
});

test('a suite that deletes its own copy is caught', (t) => {
  const remove = `import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
test('a1', () => { fs.chmodSync(here, 0o755); fs.rmSync(here, { recursive: true, force: true }); });\n`;
  assert.equal(score(setup(t, { 'a.test.mjs': suite(remove) }), { expect: expectOf('a1') }).tampered, true);
});

// The suite writes where its harness directory is and the pid of a file child left hanging, into the workspace it is given.
const RECORD = `import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const harness = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const note = (name, text) => fs.writeFileSync(path.join(process.env.TASK_WORKSPACE, name), String(text));\n`;
// A killed process its new parent has not reaped yet is a zombie: it still answers kill(pid, 0), but it is dead.
const alive = (pid) => { try { return !/^State:\s+Z/m.test(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); } catch { return false; } };
// A SIGKILL takes a moment to land on a process that is running, so its end is waited for, briefly.
async function ends(pid, ms = 3000) {
  for (const until = Date.now() + ms; Date.now() < until; await new Promise((res) => setTimeout(res, 50))) if (!alive(pid)) return true;
  return !alive(pid);
}

test('the harness directory is removed after the run, even when the suite locked parts of it', (t) => {
  const lock = `${RECORD}test('a1', () => { note('harness', harness); const d = path.join(process.env.HOME, 'locked', 'deep'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'f'), ''); fs.chmodSync(d, 0o500); fs.chmodSync(path.dirname(d), 0o500); });\n`;
  const s = setup(t, { 'a.test.mjs': suite(lock) });
  assert.equal(score(s, { expect: expectOf('a1') }).green, 1);
  const harness = fs.readFileSync(path.join(s.workspace, 'harness'), 'utf8');
  assert.match(path.basename(harness), /^score-/);
  assert.equal(fs.existsSync(harness), false);
});

test('a hang ends with the whole process group, so no test file outlives the run', async (t) => {
  const hang = `${RECORD}test('hang', () => { note('pid', process.pid); return new Promise(() => setInterval(() => {}, 1000)); });\n`;
  const s = setup(t, { 'a.test.mjs': suite(hang) });
  assert.equal(score(s, { timeoutMs: 2000, expect: expectOf('hang') }).timedOut, true);
  const pid = Number(fs.readFileSync(path.join(s.workspace, 'pid'), 'utf8'));
  t.after(() => { if (alive(pid)) process.kill(pid, 'SIGKILL'); });
  assert.equal(await ends(pid), true);
});

test('the suite sees only the allowlisted environment, from its own home', (t) => {
  const check = `import assert from 'node:assert/strict'; import fs from 'node:fs';
test('env', () => {
  assert.deepEqual(Object.keys(process.env).filter((k) => !k.startsWith('NODE_')).sort(), ['HOME', 'LC_ALL', 'PATH', 'TASK_PLANTED', 'TASK_WORKSPACE', 'TZ']);
  assert.equal(process.env.TASK_WORKSPACE, fs.realpathSync(${JSON.stringify('WS')}));
  assert.equal(process.env.TZ, ${JSON.stringify(SCORE_TZ)});
  assert.equal(process.env.TASK_PLANTED, 'yes');
  assert.equal(process.cwd(), process.env.HOME);
});\n`;
  const s = setup(t, {});
  fs.writeFileSync(path.join(s.hidden, 'a.test.mjs'), suite(check.replace('"WS"', JSON.stringify(s.workspace))));
  assert.deepEqual(score(s, { extraEnv: { TASK_PLANTED: 'yes' } }), { ok: true, green: 1, total: 1, failed: [], names: ['env'], ...FLAGS });
  assert.deepEqual(childEnv('/w', '/h', '/bin', { PATH: 'evil', TASK_X: '1' }), { TASK_X: '1', PATH: '/bin', HOME: '/h', TZ: SCORE_TZ, LC_ALL: 'C', TASK_WORKSPACE: '/w' });
});

test('malformed arguments and harness faults are refused before any candidate code runs', (t) => {
  const s = setup(t, { 'a.test.mjs': suite(PASS('a1')) });
  const base = { workspace: s.workspace, hiddenDir: s.hidden };
  const malformed = 'arguments: extraEnv, expect, taskDir or admittedHash is malformed';
  const cases = [
    [null, 'arguments: not an object'],
    [[], 'arguments: not an object'],
    [{ hiddenDir: s.hidden }, 'arguments: workspace and hiddenDir (or taskDir) must be paths'],
    [{ ...base, workspace: '' }, 'arguments: workspace and hiddenDir (or taskDir) must be paths'],
    [{ ...base, timeoutMs: 0 }, 'arguments: timeoutMs must be an integer from 1 to 600000'],
    [{ ...base, timeoutMs: 600001 }, 'arguments: timeoutMs must be an integer from 1 to 600000'],
    [{ ...base, timeoutMs: 1.5 }, 'arguments: timeoutMs must be an integer from 1 to 600000'],
    [{ ...base, extraEnv: { PATH: 'x' } }, malformed],
    [{ ...base, extraEnv: { TASK_WORKSPACE: 'x' } }, malformed],
    [{ ...base, extraEnv: { TASK_A: 1 } }, malformed],
    [{ ...base, extraEnv: { TASK_A: 'x'.repeat(257) } }, malformed],
    [{ ...base, extraEnv: Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`TASK_${i}`, 'x'])) }, malformed],
    [{ ...base, expect: { total: 2, names: ['a'] } }, malformed],
    [{ ...base, expect: { total: 2, names: ['a', 'a'] } }, malformed],
    [{ ...base, expect: { total: 0, names: [] } }, malformed],
    [{ ...base, expect: null }, malformed],
    [{ ...base, expect: [] }, malformed],
    [{ ...base, taskDir: 7 }, malformed],
    [{ ...base, admittedHash: 'x' }, 'arguments: admittedHash needs taskDir, and hiddenDir may only be taskDir/hidden'],
    [{ ...base, taskDir: s.dir, hiddenDir: s.workspace }, 'arguments: admittedHash needs taskDir, and hiddenDir may only be taskDir/hidden'],
    [{ ...base, workspace: path.join(s.dir, 'missing') }, 'run: the suite could not be run'],
    [{ ...base, workspace: path.join(s.hidden, 'a.test.mjs') }, 'workspace: not a directory'],
  ];
  for (const [args, reason] of cases) assert.deepEqual(scoreHidden(args), { ok: false, reason }, JSON.stringify(args)?.slice(0, 120));
  fs.symlinkSync('a.test.mjs', path.join(s.hidden, 'b.test.mjs'));
  assert.deepEqual(scoreHidden(base), { ok: false, reason: 'hiddenDir: b.test.mjs is a link' });
});

test('a task is checked against its admitted hash before the run and again after it', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-score-task-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(path.join(REPO, 'tests', 'fixtures', 'ab', 'M02-doc-permissions'), dir, { recursive: true });
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-score-ws-'));
  t.after(() => fs.rmSync(ws, { recursive: true, force: true }));
  const { hash } = taskHash(dir);
  assert.deepEqual(scoreHidden({ workspace: ws, taskDir: dir, admittedHash: '0'.repeat(64) }), { ok: false, reason: 'task material changed since admission' });
  assert.deepEqual(scoreHidden({ workspace: ws, taskDir: path.join(dir, 'nowhere') }), { ok: false, reason: 'taskDir: dir: manifest refused: io-error at .' });
  const r = scoreHidden({ workspace: ws, taskDir: dir, admittedHash: hash, timeoutMs: 60000 });
  assert.equal(r.ok, true);
  assert.equal(r.green, 0, 'the fixture alone implements nothing');
  const names = r.names;
  const canary = JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8')).canary;
  const planted = `import fs from 'node:fs';\n// ${canary}\ntest(${JSON.stringify(names[0])}, () => { fs.appendFileSync(${JSON.stringify(path.join(dir, 'fixture', 'README.md'))}, ' '); });\n`;
  fs.writeFileSync(path.join(dir, 'hidden', 'z.test.mjs'), suite(planted));
  const changed = scoreHidden({ workspace: ws, taskDir: dir, timeoutMs: 60000, expect: { total: names.length, names } });
  assert.deepEqual({ ok: changed.ok, green: changed.green, taskChanged: changed.taskChanged, tampered: changed.tampered }, { ok: true, green: 0, taskChanged: true, tampered: true });
});
