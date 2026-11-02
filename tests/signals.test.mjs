import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSignals } from '../scripts/lib/signals.mjs';
import { parsePatch, readDiff, snapshotTree, baseRef } from '../scripts/lib/git-tree.mjs';
import { makeRepo, writeFiles } from './helpers.mjs';

const row = (file, added = 1, deleted = 0, status = 'M') => ({ file, added, deleted, status });
const add = (file, text) => ({ file, sign: '+', text });
const del = (file, text) => ({ file, sign: '-', text });

// A labelled set: each case names exactly the signals it must raise.
const LABELLED = [
  ['small change in one file', { rows: [row('src/a.js', 5, 1)], lines: [add('src/a.js', 'const total = a + b;')] }, [], []],
  ['docs only', { rows: [row('README.md', 500, 0)], lines: [add('README.md', 'exec the password fetch')] }, ['large-diff'], []],
  ['two modules', { rows: [row('packages/a/x.js'), row('packages/b/y.js')], lines: [] }, ['multi-module'], []],
  ['code and its test are one module', { rows: [row('src/a.js'), row('test/a.test.js')], lines: [add('test/a.test.js', "test('a', () => { expect(1).toBe(1); });")] }, [], []],
  ['removed export', { rows: [row('src/a.js')], lines: [del('src/a.js', 'export function old() {}')] }, ['public-api'], []],
  ['a changed export value keeps the interface', { rows: [row('src/a.js', 1, 1)], lines: [del('src/a.js', 'export const limit = 1;'), add('src/a.js', 'export const limit = 2;')] }, [], []],
  ['a changed signature moves the interface', { rows: [row('src/a.js', 1, 1)], lines: [del('src/a.js', 'export function f(a) {'), add('src/a.js', 'export function f(a, b) {')] }, ['public-api'], []],
  ['new export', { rows: [row('src/a.js')], lines: [add('src/a.js', 'export function fresh() {}')] }, [], []],
  ['schema file', { rows: [row('api/v1.proto')], lines: [] }, ['schema'], ['sensitive-path']],
  ['test deleted', { rows: [row('test/a.test.js', 0, 9, 'D')], lines: [del('test/a.test.js', 'x')] }, ['tests-weakened'], []],
  ['assertions removed', { rows: [row('test/a.test.js', 0, 2)], lines: [del('test/a.test.js', 'assert.equal(a, 1);')] }, ['tests-weakened'], []],
  ['test skipped', { rows: [row('test/a.test.js', 1, 0)], lines: [add('test/a.test.js', "test.skip('a', () => {});")] }, ['tests-weakened'], []],
  ['lockfile', { rows: [row('package-lock.json')], lines: [] }, ['dependency'], []],
  ['manifest', { rows: [row('package.json')], lines: [] }, ['dependency'], []],
  ['golden moved', { rows: [row('tests/goldens/status.txt')], lines: [] }, ['goldens-moved'], []],
  ['over 300 lines', { rows: [row('src/a.js', 301, 0)], lines: [] }, ['large-diff'], []],
  ['exactly 300 lines', { rows: [row('src/a.js', 300, 0)], lines: [] }, [], []],
  ['shell sink', { rows: [row('src/a.js')], lines: [add('src/a.js', "execSync('ls ' + name);")] }, [], ['sink']],
  ['eval sink', { rows: [row('src/a.js')], lines: [add('src/a.js', 'eval(input);')] }, [], ['sink']],
  ['sql sink', { rows: [row('src/a.js')], lines: [add('src/a.js', 'db.query(`SELECT * FROM t WHERE id=${id}`);')] }, [], ['sink']],
  ['path sink', { rows: [row('src/a.js')], lines: [add('src/a.js', 'fs.readFileSync(name);')] }, [], ['sink']],
  ['deserialising', { rows: [row('src/a.py')], lines: [add('src/a.py', 'pickle.loads(blob)')] }, [], ['sink']],
  ['regex from input', { rows: [row('src/a.js')], lines: [add('src/a.js', 'new RegExp(pattern)')] }, [], ['sink']],
  ['secrets', { rows: [row('src/a.js')], lines: [add('src/a.js', 'const apiKey = process.env.API_KEY;')] }, [], ['secrets']],
  ['network', { rows: [row('src/a.js')], lines: [add('src/a.js', 'await fetch(url);')] }, [], ['network']],
  ['cloned repo content', { rows: [row('src/a.js')], lines: [add('src/a.js', "run('git submodule update');")] }, [], ['repo-content']],
  ['agent policy file', { rows: [row('.mcp.json')], lines: [] }, [], ['policy-file']],
  ['sink in a test does not fire', { rows: [row('test/a.test.js')], lines: [add('test/a.test.js', "execSync('ls');")] }, [], []],
  ['auth path', { rows: [row('src/auth/login.js')], lines: [] }, [], ['sensitive-path']],
  ['secret name', { rows: [row('.env')], lines: [] }, [], ['sensitive-path']],
  ['unreadable diff fires everything', { rows: [], lines: [], unreadable: true }, ['unreadable-diff'], ['unreadable-diff']],
];

for (const [name, diff, review, security] of LABELLED) {
  test(`signals: ${name}`, () => {
    const s = computeSignals(diff);
    assert.deepEqual(s.review, review);
    assert.deepEqual(s.security, security);
  });
}

test('the classifier gives identical output across five runs', () => {
  const runs = Array.from({ length: 5 }, () => JSON.stringify(LABELLED.map(([, diff]) => computeSignals(diff))));
  assert.equal(new Set(runs).size, 1);
});

test('config can add sensitive paths but cannot remove a built-in', () => {
  const diff = { rows: [row('src/billing/charge.js')], lines: [] };
  assert.deepEqual(computeSignals(diff).security, []);
  assert.deepEqual(computeSignals(diff, [{ signals: { sensitive_paths: ['billing'] } }]).security, ['sensitive-path']);
  const auth = { rows: [row('src/auth/login.js')], lines: [] };
  assert.deepEqual(computeSignals(auth, [{ signals: { sensitive_paths: [] } }]).security, ['sensitive-path']);
});

test('the real diff covers tracked and untracked files, and leaves SoMi state out', (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n' });
  const base = baseRef(dir);
  writeFiles(dir, { 'src/app.js': 'export const one = 2;\n', 'src/new.js': 'export const two = 2;\n', '.somi/state/journal.jsonl': '{}\n' });
  const tree = snapshotTree(dir);
  const { rows } = readDiff(dir, base, tree);
  assert.deepEqual(rows.map((r) => r.file).sort(), ['src/app.js', 'src/new.js']);
  writeFiles(dir, { '.somi/state/journal.jsonl': '{}\n{}\n' });
  assert.equal(snapshotTree(dir), tree, 'writing the journal must not change the tree');
});

test('a same-size edit right after a commit still changes the tree', (t) => {
  for (let i = 0; i < 10; i++) {
    const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n' });
    const before = snapshotTree(dir);
    writeFiles(dir, { 'src/app.js': 'export const one = 2;\n' });
    assert.notEqual(snapshotTree(dir), before);
  }
});

test('a removed line that looks like a patch header stays a removed line', () => {
  const lines = parsePatch('diff --git a/x.sql b/x.sql\n--- a/x.sql\n+++ b/x.sql\n@@ -1,2 +1 @@\n--- drop this comment\n+++ keep this\n');
  assert.deepEqual(lines, [{ file: 'x.sql', sign: '-', text: '-- drop this comment' }, { file: 'x.sql', sign: '+', text: '++ keep this' }]);
});
