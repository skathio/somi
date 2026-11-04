import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { journalPath, makeRepo, somi, writeFiles } from './helpers.mjs';
import { modelNameProblems, pipefailProblems, planningIdProblems } from '../scripts/lib/gates.mjs';
import { selectTests } from '../scripts/lib/check.mjs';
import { GUARDED, candidates, mutateLine } from './mutate.mjs';

const failedGates = (r) => r.json.failed;

test('a clean change passes', (t) => {
  const dir = makeRepo(t);
  writeFiles(dir, { 'src/app.js': 'export const one = 2;\n' });
  const r = somi(dir, ['check']);
  assert.equal(r.status, 0, r.stdout);
  assert.deepEqual(failedGates(r), []);
});

// The three failures that reached a push in the last release, replayed.
test('replay: a decision id in a comment fails', (t) => {
  const dir = makeRepo(t);
  writeFiles(dir, { 'src/app.js': 'export const one = 1;\n// Chosen in D7 of the plan.\nexport const two = 2;\n' });
  const r = somi(dir, ['check']);
  assert.equal(r.status, 1);
  assert.deepEqual(failedGates(r), ['planning-ids']);
});

test('replay: a stale golden fails', (t) => {
  const goldenTest = "import { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport { render } from '../src/render.js';\ntest('golden', () => { assert.equal(render(), fs.readFileSync(new URL('./goldens/out.txt', import.meta.url), 'utf8')); });\n";
  const dir = makeRepo(t, {
    'src/render.js': "export const render = () => 'old\\n';\n",
    'tests/goldens/out.txt': 'old\n',
    'tests/golden.test.mjs': goldenTest,
    'somi.check.json': JSON.stringify({ always: ['tests/golden.test.mjs'] }),
    '.gitignore': '.somi\n',
  });
  assert.equal(somi(dir, ['check']).status, 0);
  writeFiles(dir, { 'src/render.js': "export const render = () => 'new\\n';\n" });
  const r = somi(dir, ['check']);
  assert.equal(r.status, 1);
  assert.deepEqual(failedGates(r), ['tests']);
});

test('replay: an undocumented stop status in the journal fails', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'x']);
  const text = fs.readFileSync(journalPath(dir), 'utf8');
  fs.writeFileSync(journalPath(dir), text.replace('"next":"code"', '"next":"code","stop":"stuck"'));
  const r = somi(dir, ['check']);
  assert.equal(r.status, 1);
  assert.ok(failedGates(r).includes('artefacts'));
});

test('a planted pipe into head fails the pipefail lint', (t) => {
  const dir = makeRepo(t);
  writeFiles(dir, { 'scripts/run.sh': '#!/usr/bin/env bash\nset -euo pipefail\nnpm test | head -20\n' });
  const r = somi(dir, ['check']);
  assert.equal(r.status, 1);
  assert.deepEqual(failedGates(r), ['lint']);
  assert.match(JSON.stringify(r.json.gates), /pipe into head/);
});

test('old lines never block new work', (t) => {
  const dir = makeRepo(t, { 'src/app.js': '// Chosen in D7 of the plan.\nexport const one = 1;\n', '.gitignore': '.somi\n' });
  writeFiles(dir, { 'src/app.js': '// Chosen in D7 of the plan.\nexport const one = 2;\n' });
  assert.equal(somi(dir, ['check']).status, 0);
});

test('a syntax error and invalid JSON fail lint', (t) => {
  const dir = makeRepo(t);
  writeFiles(dir, { 'src/bad.mjs': 'export const = ;\n', 'data.json': '{nope' });
  const r = somi(dir, ['check']);
  assert.deepEqual(failedGates(r), ['lint']);
  assert.match(JSON.stringify(r.json.gates), /does not parse/);
  assert.match(JSON.stringify(r.json.gates), /invalid JSON/);
});

test('conflict markers fail', (t) => {
  const dir = makeRepo(t);
  writeFiles(dir, { 'notes.txt': '<<<<<<< HEAD\na\n=======\nb\n>>>>>>> other\n' });
  assert.deepEqual(failedGates(somi(dir, ['check'])), ['conflict-markers']);
});

test('the time budget is enforced on project commands', (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n', 'somi.check.json': JSON.stringify({ budget_s: 1, fast_cmd: 'sleep 30' }), '.gitignore': '.somi\n' });
  const r = somi(dir, ['check']);
  assert.equal(r.status, 1);
  assert.match(JSON.stringify(r.json.gates), /over the time budget/);
});

test('the full gate runs the full command, the fast gate does not', (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n', 'somi.check.json': JSON.stringify({ full_cmd: 'exit 3' }), '.gitignore': '.somi\n' });
  assert.equal(somi(dir, ['check']).status, 0);
  const full = somi(dir, ['check', '--full']);
  assert.equal(full.status, 1);
  assert.deepEqual(failedGates(full), ['full-suite']);
});

test('affected tests come from the map, changed tests run themselves, and an unmapped file falls back', () => {
  const plan = { always: ['tests/always.test.mjs'], map: { 'src/a.js': ['tests/a.test.mjs'], 'hooks/': ['tests/hooks.test.mjs'] } };
  const exists = () => true;
  assert.deepEqual(selectTests(['src/a.js'], plan, exists), { tests: ['tests/a.test.mjs', 'tests/always.test.mjs'], unmapped: false });
  assert.deepEqual(selectTests(['hooks/x.mjs', 'tests/b.test.mjs'], plan, exists), { tests: ['tests/always.test.mjs', 'tests/b.test.mjs', 'tests/hooks.test.mjs'], unmapped: false });
  assert.equal(selectTests(['src/unknown.js'], plan, exists).unmapped, true);
  assert.equal(selectTests(['README.md'], plan, exists).unmapped, false);
});

test('gates: ids only in comments for code, narrower in prose', () => {
  const line = (file, text) => ({ file, sign: '+', text });
  assert.equal(planningIdProblems([line('a.js', "const name = 'D7';")]).length, 0);
  assert.equal(planningIdProblems([line('a.js', '// see D7')]).length, 1);
  assert.equal(planningIdProblems([line('a.sh', '# iteration 4 fixed this')]).length, 1);
  assert.equal(planningIdProblems([line('a.js', '// per .somi/plans/x')]).length, 1);
  assert.equal(planningIdProblems([line('a.md', 'Decided in (D7).')]).length, 1);
  assert.equal(planningIdProblems([line('a.md', 'Use D7 as a sample.')]).length, 0);
  assert.equal(modelNameProblems([line('a.md', 'Runs on claude-opus-4-5.')]).length, 1);
  assert.equal(modelNameProblems([line('a.md', 'The review tier defaults to opus.')]).length, 0);
});

test('gates: a marked pipe passes, a script without pipefail fails', () => {
  assert.deepEqual(pipefailProblems('a.sh', 'set -o pipefail\nls | head -1 # pipe-ok\n'), []);
  assert.equal(pipefailProblems('a.sh', 'echo hi\n').length, 1);
  assert.deepEqual(pipefailProblems('a.sh', 'set -euo pipefail\n# ls | head\n'), []);
});

test('the check result joins the journal once per tree and result', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'x']);
  writeFiles(dir, { 'src/app.js': 'export const one = 2;\n' });
  somi(dir, ['check']);
  somi(dir, ['check']);
  const lines = fs.readFileSync(path.join(dir, '.somi/state/journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.filter((e) => e.type === 'check').length, 1);
});

test('the mutation tool flips operators on changed code lines only', () => {
  assert.equal(mutateLine('if (a === b) return;'), 'if (a !== b) return;');
  assert.equal(mutateLine('// if (a === b) return;'), null);
  assert.equal(mutateLine('const x = 1;'), null);
  assert.deepEqual(candidates('const a = true;\nconst b = true;\n', ['const b = true;']), [{ index: 1, mutated: 'const b = false;' }]);
  assert.ok(GUARDED.test('scripts/lib/policy.mjs'));
  assert.ok(GUARDED.test('hooks/pre-tool/block-secret-writes.mjs'));
  assert.equal(GUARDED.test('scripts/lib/views.mjs'), false);
});

test("SoMi's own plan is not scanned, and the same line in shipped code still fails", (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n' });
  writeFiles(dir, { '.somi/plan.md': 'Option A, chosen in D7 of the plan (D7).\n' });
  assert.equal(somi(dir, ['check']).status, 0);
  writeFiles(dir, { 'src/app.js': 'export const one = 1;\n// Chosen in D7 of the plan.\n' });
  assert.deepEqual(failedGates(somi(dir, ['check'])), ['planning-ids']);
});

test('a project\'s committed files under .somi are scanned, and only the working plan is not', (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n' });
  writeFiles(dir, { '.somi/rules/team.md': 'Option A, chosen in D7 of the plan (D7).\n' });
  assert.deepEqual(failedGates(somi(dir, ['check'])), ['planning-ids']);
  const nested = makeRepo(t, { 'src/app.js': 'export const one = 1;\n' });
  writeFiles(nested, { 'pkg/.somi/plan.md': 'Option A, chosen in D7 of the plan (D7).\n' });
  assert.deepEqual(failedGates(somi(nested, ['check'])), ['planning-ids']);
});
