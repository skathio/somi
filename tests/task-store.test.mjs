// A task's task.json and directory are read as hostile, though a reviewer committed them: every field is checked, every doubt is a
// refusal that names the field, and the task's hash changes with every byte. The canary rules are in canary.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from './helpers.mjs';
import { declaredScope, taskHash, validateTaskJson } from './evals/lib/task-store.mjs';

const SOURCE = path.join(REPO, 'tests', 'fixtures', 'ab', 'M02-doc-permissions');
const TASK = JSON.parse(fs.readFileSync(path.join(SOURCE, 'task.json'), 'utf8'));

function copyTask(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-task-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(SOURCE, dir, { recursive: true });
  return dir;
}

test('a valid task.json comes back as a frozen plain copy', () => {
  const v = validateTaskJson(structuredClone(TASK));
  assert.equal(v.ok, true);
  assert.deepEqual(v.task, { ...TASK, turns: TASK.turns });
  assert.equal(Object.isFrozen(v.task) && Object.isFrozen(v.task.statements) && Object.isFrozen(v.task.turns), true);
  const { turns: _t, ...noTurns } = TASK;
  assert.deepEqual(validateTaskJson(noTurns).task.turns, [], 'turns are optional');
  assert.deepEqual(declaredScope(v.task), { source: { files: [], dirs: ['src'] }, testDir: 'test', rootFiles: ['README.md'] });
  assert.deepEqual(declaredScope({ ...v.task, source: ['a.js', 'lib/'] }).source, { files: ['a.js'], dirs: ['lib'] });
});

test('each field is held to its rule, and the refusal names it', () => {
  const cases = [
    [{ extra: 1 }, 'task.json: unknown key extra'],
    [{ ['x'.repeat(100)]: 1 }, `task.json: unknown key ${'x'.repeat(64)}`],
    [{ schema_version: 2 }, 'schema_version: must be 1'],
    [{ statements: [] }, 'statements: needs 1..64 entries'],
    [{ statements: 'one' }, 'statements: not an array'],
    [{ statements: ['a', 'a'] }, 'statements: duplicate entry'],
    [{ statements: [' padded'] }, 'statements: a line is not plain 1..512-unit text'],
    [{ statements: ['x'.repeat(513)] }, 'statements: a line is not plain 1..512-unit text'],
    [{ statements: ['a​b'] }, 'statements: a line is not plain 1..512-unit text'],
    [{ statements: Array.from({ length: 65 }, (_, i) => `s${i}`) }, 'statements: needs 1..64 entries'],
    [{ runner: 'jest' }, 'runner: must be one of node-test, playwright'],
    [{ canary: 'short' }, 'canary: must match [A-Za-z0-9_-]{16,64}'],
    [{ source: [] }, 'source: needs 1..64 entries'],
    [{ source: ['src', 'src/'] }, 'source: duplicate entry'],
    [{ source: ['../x'] }, 'source: not a valid relative path'],
    [{ source: ['.somi/x'] }, 'source: .git and .somi cannot be declared'],
    [{ test_dir: '.git' }, 'test_dir: .git and .somi cannot be declared'],
    [{ test_dir: 'a//b' }, 'test_dir: not a valid relative path'],
    [{ root_files: ['a/b'] }, 'root_files: a name is not a single valid path segment'],
    [{ root_files: ['.somi'] }, 'root_files: a name is not a single valid path segment'],
    [{ root_files: ['a', 'a'] }, 'root_files: duplicate entry'],
    [{ brief: '' }, 'brief: must be 1..8192 units of plain text'],
    [{ brief: ' \n ' }, 'brief: must be 1..8192 units of plain text'],
    [{ brief: 'a\u0007' }, 'brief: must be 1..8192 units of plain text'],
    [{ turns: [] }, 'turns: needs 1..64 entries'],
    [{ turns: Array.from({ length: 17 }, (_, i) => `t${i}`) }, 'turns: must be 1..16 lines of plain 1..512-unit text'],
    [{ turns: ['ok', ''] }, 'turns: must be 1..16 lines of plain 1..512-unit text'],
  ];
  for (const [change, reason] of cases) assert.deepEqual(validateTaskJson({ ...TASK, ...change }), { ok: false, reason }, reason);
  assert.equal(validateTaskJson({ ...TASK, brief: 'tabs\tand\nnewlines are fine' }).ok, true);
});

test('only plain data is read: no getter is called, and a missing key, sparse list or odd object is refused', () => {
  const { runner: _r, ...missing } = TASK;
  assert.deepEqual(validateTaskJson(missing), { ok: false, reason: 'runner: missing' });
  let called = false;
  const getter = { ...TASK };
  Object.defineProperty(getter, 'brief', { enumerable: true, get() { called = true; return 'x'; } });
  assert.deepEqual(validateTaskJson(getter), { ok: false, reason: 'brief: not a plain data property' });
  assert.equal(called, false);
  const hidden = { ...TASK };
  Object.defineProperty(hidden, 'brief', { enumerable: false, value: TASK.brief });
  assert.equal(validateTaskJson(hidden).reason, 'brief: not a plain data property');
  const sparse = [...TASK.statements]; delete sparse[1];
  assert.equal(validateTaskJson({ ...TASK, statements: sparse }).reason, 'statements: not a dense array');
  const tagged = [...TASK.statements]; tagged.extra = 1;
  assert.equal(validateTaskJson({ ...TASK, statements: tagged }).reason, 'statements: not a dense array');
  for (const v of [null, [], 'task', Object.assign(Object.create({ inherited: 1 }), TASK)]) assert.match(validateTaskJson(v).reason, /^task\.json: not (an|a plain) object$/);
  assert.deepEqual(validateTaskJson(Object.assign(Object.create(null), TASK)).ok, true);
  const hostile = new Proxy({ ...TASK }, { ownKeys() { throw new Error('trap'); } });
  assert.deepEqual(validateTaskJson(hostile), { ok: false, reason: 'task.json: unreadable' });
});

test('a task hash is stable, and changes with every byte of every file', (t) => {
  const dir = copyTask(t);
  const first = taskHash(dir);
  assert.equal(first.ok, true);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(first.task, validateTaskJson(TASK).task);
  assert.equal(taskHash(`${dir}/`).hash, first.hash);
  assert.equal(taskHash(copyTask(t)).hash, first.hash, 'where the task sits does not matter');
  fs.appendFileSync(path.join(dir, 'fixture', 'README.md'), ' ');
  assert.notEqual(taskHash(dir).hash, first.hash);
  const moved = copyTask(t);
  fs.renameSync(path.join(moved, 'fixture', 'README.md'), path.join(moved, 'fixture', 'README2.md'));
  assert.notEqual(taskHash(moved).hash, first.hash, 'a rename changes the hash');
});

test('what the manifest does not record is refused: a root .git, an execute bit, an empty directory', (t) => {
  const git = copyTask(t);
  fs.mkdirSync(path.join(git, '.git'));
  assert.deepEqual(taskHash(git), { ok: false, reason: 'dir: root .git entry at .git' });
  const exec = copyTask(t);
  fs.chmodSync(path.join(exec, 'fixture', 'README.md'), 0o755);
  assert.deepEqual(taskHash(exec), { ok: false, reason: 'dir: execute bit at fixture/README.md' });
  const empty = copyTask(t);
  fs.mkdirSync(path.join(empty, 'fixture', 'empty'));
  assert.deepEqual(taskHash(empty), { ok: false, reason: 'dir: empty directory at fixture/empty' });
});

test('task.json must be present, readable, valid JSON, and the file the manifest hashed', (t) => {
  const gone = copyTask(t);
  fs.rmSync(path.join(gone, 'task.json'));
  assert.deepEqual(taskHash(gone), { ok: false, reason: 'task.json: missing' });
  const notJson = copyTask(t);
  fs.writeFileSync(path.join(notJson, 'task.json'), Buffer.from([0x7b, 0xff, 0x7d]));
  assert.deepEqual(taskHash(notJson), { ok: false, reason: 'task.json: not valid UTF-8 JSON' });
  const replaced = copyTask(t);
  const json = Buffer.from(JSON.stringify({ ...TASK, brief: 'BYTE' }));
  const at = json.indexOf('BYTE');
  fs.writeFileSync(path.join(replaced, 'task.json'), Buffer.concat([json.subarray(0, at), Buffer.from([0xff]), json.subarray(at + 4)]));
  assert.deepEqual(taskHash(replaced), { ok: false, reason: 'task.json: not valid UTF-8 JSON' }, 'a bad byte inside a string is refused, not replaced');
  const invalid = copyTask(t);
  fs.writeFileSync(path.join(invalid, 'task.json'), JSON.stringify({ ...TASK, runner: 'jest' }));
  assert.deepEqual(taskHash(invalid), { ok: false, reason: 'runner: must be one of node-test, playwright' });
  const big = copyTask(t);
  fs.writeFileSync(path.join(big, 'task.json'), JSON.stringify({ ...TASK, pad: 'x'.repeat(256 * 1024) }));
  assert.deepEqual(taskHash(big), { ok: false, reason: 'task.json: unreadable, too large or changed since it was hashed' });
  assert.deepEqual(taskHash(path.join(gone, 'nowhere')), { ok: false, reason: 'dir: manifest refused: io-error at .' });
  assert.deepEqual(taskHash(''), { ok: false, reason: 'dir: not a usable directory argument' });
});

test('every file the task store opens is closed again', (t) => {
  const dir = copyTask(t);
  const open = new Set();
  const methods = ['lstatSync', 'opendirSync', 'fstatSync', 'readSync', 'readdirSync'];
  const counted = { ...Object.fromEntries(methods.map((m) => [m, fs[m].bind(fs)])), constants: fs.constants,
    openSync: (...a) => { const fd = fs.openSync(...a); open.add(fd); return fd; }, closeSync: (fd) => { open.delete(fd); fs.closeSync(fd); } };
  assert.equal(taskHash(dir, { fs: counted }).ok, true);
  assert.equal(open.size, 0);
});

test('a tree that changes between the walk and the checks is refused', (t) => {
  const dir = copyTask(t);
  const methods = ['lstatSync', 'opendirSync', 'openSync', 'fstatSync', 'readSync', 'closeSync', 'readdirSync'];
  const real = Object.fromEntries(methods.map((m) => [m, fs[m].bind(fs)]));
  // The manifest hashes task.json first; the second open is the read that is parsed, and it must be the same bytes.
  let opens = 0;
  const swapped = (body) => ({ fs: { ...real, constants: fs.constants, openSync: (p, ...a) => (p.endsWith('/task.json') && ++opens === 2 ? real.openSync(body, ...a) : real.openSync(p, ...a)) } });
  const other = path.join(dir, 'fixture', 'README.md');
  assert.deepEqual(taskHash(dir, swapped(other)), { ok: false, reason: 'task.json: unreadable, too large or changed since it was hashed' });
  const added = { fs: { ...real, constants: fs.constants, readdirSync: (p, ...a) => (p.endsWith('/fixture') ? [...real.readdirSync(p, ...a), 'late.txt'] : real.readdirSync(p, ...a)), lstatSync: (p, ...a) => (p.endsWith('/late.txt') ? real.lstatSync(other, ...a) : real.lstatSync(p, ...a)) } };
  assert.deepEqual(taskHash(dir, added), { ok: false, reason: 'dir: changed since it was listed' });
  const special = { fs: { ...added.fs, lstatSync: (p, ...a) => (p.endsWith('/late.txt') ? real.lstatSync('/dev/null', ...a) : real.lstatSync(p, ...a)) } };
  assert.deepEqual(taskHash(dir, special), { ok: false, reason: 'dir: changed since it was listed at fixture/late.txt' });
  const broken = { fs: { ...real, constants: fs.constants, readdirSync: () => { throw new Error('gone'); } } };
  assert.deepEqual(taskHash(dir, broken), { ok: false, reason: 'dir: unreadable' });
});
