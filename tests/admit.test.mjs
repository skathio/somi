// Before a task costs a draw, admission shows its hidden suite fair and discriminating: both oracles pass, the fixture alone fails
// what is to be built and passes what already works, each mutant is caught and repeated runs agree. Each case breaks a small
// synthetic task in one way, and admission must refuse it for that reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeFiles } from './helpers.mjs';
import { admitTask } from './evals/lib/admit.mjs';
import { taskHash } from './evals/lib/task-store.mjs';

const CANARY = 'SOMI-CANARY-ADMIT-0123456789';
const TESTS = `// ${CANARY}
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
const load = () => import(path.join(process.env.TASK_WORKSPACE, 'src', 'add.mjs'));
test('adds two numbers', async () => assert.equal((await load()).add(2, 3), 5));
test('returns a number [regression]', async () => assert.equal(typeof (await load()).add(1, 1), 'number'));
`;
const ORACLE = `// ${CANARY}\nexport const add = (a, b) => a + b;\n`;
const NAMES = ['adds two numbers', 'returns a number [regression]'];

function task(t, change = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-admit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const json = { schema_version: 1, statements: ['Make add add.'], runner: 'node-test', canary: CANARY, source: ['src/'], test_dir: 'test', root_files: [], brief: 'Make add add.' };
  writeFiles(dir, {
    'task.json': JSON.stringify(json),
    'fixture/src/add.mjs': 'export const add = () => 0;\n',
    'fixture/README.md': 'add\n',
    'hidden/add.test.mjs': TESTS,
    'oracle/src/add.mjs': ORACLE,
    'oracle2/src/add.mjs': `// ${CANARY}\nexport const add = (a, b) => b + a;\n`,
    ...change,
  });
  return dir;
}
const admit = (dir, opts = {}) => admitTask(dir, { repeats: 2, timeoutMs: 20000, ...opts });

test('a fair task is admitted with its hash, its test names and the mutants it caught', (t) => {
  const dir = task(t);
  const mutants = [{ name: 'subtracts', file: 'src/add.mjs', find: 'a + b', replace: 'a - b' }];
  assert.deepEqual(admit(dir, { mutants }), { ok: true, hash: taskHash(dir).hash, names: NAMES, total: 2, repeats: 2, mutantsKilled: [{ name: 'subtracts', failed: ['adds two numbers'] }] });
});

test('each oracle must pass every test', (t) => {
  assert.deepEqual(admit(task(t, { 'oracle/src/add.mjs': `// ${CANARY}\nexport const add = () => 4;\n` })), { ok: false, reason: 'oracle: scores 1/2, failing adds two numbers' });
  assert.deepEqual(admit(task(t, { 'oracle2/src/add.mjs': `// ${CANARY}\nexport const add = () => 4;\n` })), { ok: false, reason: 'oracle2: scores 1/2, failing adds two numbers' });
});

test('the fixture alone must fail what is to be built and pass what already works', (t) => {
  assert.deepEqual(admit(task(t, { 'fixture/src/add.mjs': 'export const add = (a, b) => a + b;\n' })), { ok: false, reason: 'nop: on the fixture alone every [regression] test must pass and every other test must fail; wrong: adds two numbers' });
  assert.deepEqual(admit(task(t, { 'fixture/src/add.mjs': 'export const add = () => "0";\n' })), { ok: false, reason: 'nop: on the fixture alone every [regression] test must pass and every other test must fail; wrong: returns a number [regression]' });
  const allRegression = TESTS.replace("'adds two numbers'", "'adds two numbers [regression]'");
  const both = task(t, { 'hidden/add.test.mjs': allRegression, 'fixture/src/add.mjs': 'export const add = (a, b) => a + b;\n' });
  assert.deepEqual(admit(both), { ok: false, reason: 'nop: every test passes on the fixture alone, so nothing is left to implement' });
});

test('a mutant is checked before any run, and must be caught', (t) => {
  const dir = task(t);
  const m = (over) => [{ name: 'm', file: 'src/add.mjs', find: 'a + b', replace: 'a - b', ...over }];
  const cases = [
    [m({ name: 'bad name' }), 'mutant: each mutant needs a unique name of 1..64 characters [A-Za-z0-9._-]'],
    [[...m(), ...m()], 'mutant: each mutant needs a unique name of 1..64 characters [A-Za-z0-9._-]'],
    [[null], 'mutant: each mutant needs a unique name of 1..64 characters [A-Za-z0-9._-]'],
    [m({ file: 'src/other.mjs' }), 'mutant: m: file is not a file under oracle/'],
    [m({ file: '../task.json' }), 'mutant: m: file is not a file under oracle/'],
    [m({ find: '' }), 'mutant: m: find must be a non-empty string and replace a string'],
    [m({ replace: 7 }), 'mutant: m: find must be a non-empty string and replace a string'],
    [m({ find: 'a * b' }), 'mutant: m: find occurs 0 times, it must occur exactly once'],
    [m({ find: 'a' }), 'mutant: m: find occurs 3 times, it must occur exactly once'],
    [m({ find: 'export', replace: '/* $& */ export' }), 'mutant: m survives: 2/2 tests still pass'],
  ];
  for (const [mutants, reason] of cases) assert.deepEqual(admit(dir, { mutants }), { ok: false, reason }, reason);
});

test('repeated oracle runs must agree, so state left by a run shows', (t) => {
  const once = `// ${CANARY}\nimport fs from 'node:fs';\nconst mark = new URL('./ran', import.meta.url);\nexport const add = (a, b) => { if (fs.existsSync(mark)) return 0; fs.writeFileSync(mark, ''); return a + b; };\n`;
  assert.deepEqual(admit(task(t, { 'oracle/src/add.mjs': once }), { repeats: 3 }), { ok: false, reason: 'stability: run 2 scored 1/2 where the first scored 2/2' });
  assert.equal(admit(task(t, { 'oracle/src/add.mjs': once }), { repeats: 1 }).ok, true, 'one run cannot disagree with itself');
});

test('a setup script makes files in every workspace, and a failing one refuses the task', (t) => {
  const setup = `// ${CANARY}\nimport fs from 'node:fs';\nimport path from 'node:path';\nfs.writeFileSync(path.join(process.argv[2], 'made.txt'), 'made');\n`;
  const uses = `${TESTS}test('has the made file [regression]', () => assert.equal(fs.readFileSync(path.join(process.env.TASK_WORKSPACE, 'made.txt'), 'utf8'), 'made'));\nimport fs from 'node:fs';\n`;
  assert.deepEqual(admit(task(t, { 'hidden/setup.mjs': setup, 'hidden/add.test.mjs': uses })).names, [...NAMES, 'has the made file [regression]']);
  assert.deepEqual(admit(task(t, { 'hidden/setup.mjs': `// ${CANARY}\nprocess.exit(3);\n` })), { ok: false, reason: 'setup: the setup exited with 3' });
  assert.deepEqual(admit(task(t, { 'hidden/setup.mjs': `// ${CANARY}\nsetInterval(() => {}, 1000);\n` }), { repeats: 1 }).reason.startsWith('setup: '), true);
});

test('a task that fails its canary check, or malformed options, are refused before anything runs', (t) => {
  assert.deepEqual(admit(task(t, { 'fixture/README.md': `${CANARY}\n` })), { ok: false, reason: 'canary: fixture/README.md: candidate-visible file contains the canary' });
  const dir = task(t);
  const cases = [
    [[7, {}], 'arguments: a task directory and an options object are required'],
    [[dir, null], 'arguments: a task directory and an options object are required'],
    [[dir, []], 'arguments: a task directory and an options object are required'],
    [[dir, { repeats: 0 }], 'arguments: repeats must be an integer from 1 to 50'],
    [[dir, { repeats: 51 }], 'arguments: repeats must be an integer from 1 to 50'],
    [[dir, { mutants: {} }], 'arguments: mutants must be an array of at most 64'],
    [[dir, { mutants: Array.from({ length: 65 }, () => ({})) }], 'arguments: mutants must be an array of at most 64'],
  ];
  for (const [args, reason] of cases) assert.deepEqual(admitTask(...args), { ok: false, reason }, reason);
});

// Admission and the scorer make their directories in os.tmpdir(), so a private one shows everything they leave.
test('admission leaves no workspace or harness directory behind', (t) => {
  const good = task(t);
  const bad = task(t, { 'oracle/src/add.mjs': `// ${CANARY}\nexport const add = () => 4;\n` });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-admit-tmp-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const saved = process.env.TMPDIR;
  t.after(() => { if (saved === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = saved; });
  process.env.TMPDIR = tmp;
  assert.equal(admit(good).ok, true);
  assert.equal(admit(bad).ok, false);
  assert.deepEqual(fs.readdirSync(tmp), []);
});
