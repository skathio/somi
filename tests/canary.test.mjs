// The canary marks what a candidate is never shown: every hidden file carries it, and no file, path or line a candidate sees may.
// Each case breaks a copy of a real task in one way, and the check must refuse it for that reason.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from './helpers.mjs';
import { canaryCheck } from './evals/lib/task-store.mjs';

const SOURCE = path.join(REPO, 'tests', 'fixtures', 'ab', 'M02-doc-permissions');

function copyTask(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-canary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.cpSync(SOURCE, dir, { recursive: true });
  const task = JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8'));
  const writeTask = (change) => fs.writeFileSync(path.join(dir, 'task.json'), JSON.stringify({ ...task, ...change }, null, 2));
  return { dir, canary: task.canary, writeTask };
}

test('a real task passes the canary check', (t) => {
  const { dir } = copyTask(t);
  assert.equal(canaryCheck(dir).ok, true);
});

test('a file a candidate sees may not hold the canary, and every hidden file must', (t) => {
  const visible = copyTask(t);
  fs.appendFileSync(path.join(visible.dir, 'fixture', 'README.md'), `\n${visible.canary}\n`);
  assert.match(canaryCheck(visible.dir).reason, /candidate-visible file contains the canary/);
  const hidden = copyTask(t);
  const file = path.join(hidden.dir, 'oracle', 'src', 'policy.mjs');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replaceAll(hidden.canary, 'x'));
  assert.match(canaryCheck(hidden.dir).reason, /missing the canary/);
});

test('the brief, a follow-up message and a declared path may not hold the canary', (t) => {
  const brief = copyTask(t);
  brief.writeTask({ brief: `Build it. ${brief.canary}` });
  assert.match(canaryCheck(brief.dir).reason, /brief.*contains the canary/);
  const turn = copyTask(t);
  turn.writeTask({ turns: [`Next, ${turn.canary}`] });
  assert.match(canaryCheck(turn.dir).reason, /turns.*a line contains the canary/);
});

test('a hidden folder that is empty or missing, or an entry outside the layout, is refused', (t) => {
  const empty = copyTask(t);
  fs.rmSync(path.join(empty.dir, 'oracle2'), { recursive: true, force: true });
  fs.mkdirSync(path.join(empty.dir, 'oracle2'));
  assert.match(canaryCheck(empty.dir).reason, /empty directory at oracle2/, 'an empty folder is refused before the canary is read');
  const missing = copyTask(t);
  fs.rmSync(path.join(missing.dir, 'oracle2'), { recursive: true, force: true });
  assert.match(canaryCheck(missing.dir).reason, /oracle2\/.*has no files/, 'a check over nothing proves nothing');
  const stray = copyTask(t);
  fs.mkdirSync(path.join(stray.dir, 'extra'));
  fs.writeFileSync(path.join(stray.dir, 'extra', 'notes.md'), `${stray.canary}\n`);
  assert.match(canaryCheck(stray.dir).reason, /unexpected top-level entry/);
});
