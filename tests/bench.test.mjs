import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO, makeRepo, writeFiles } from './helpers.mjs';
import { armSummary, evaluateAa, evaluateRelease, pairedDifference, selectTasks, tCritical95, weightedTokens } from '../benchmarks/v2/stats.mjs';
import { abandonedArms, armPrompt, buildPlan, preregProblem, sha256, streamUsage } from '../benchmarks/v2/bench.mjs';

// Three draws per task for one arm, from a list of solved counts per task.
function drawsFor(arm, solvedCounts, { weighted = 100 } = {}) {
  return solvedCounts.flatMap((solved, i) => [1, 2, 3].map((draw) => ({ task: `t${i}`, arm, draw, solved: draw <= solved, weighted, cost: 0.1, wall_ms: 1000, turns: 5 })));
}
const twenty = (values) => Array.from({ length: 20 }, (_, i) => values[i % values.length]);

test('the paired difference matches a hand calculation', () => {
  const rows = [...drawsFor('a', [3, 2, 1, 0]), ...drawsFor('b', [2, 2, 0, 0])];
  const d = pairedDifference(rows, 'a', 'b');
  assert.equal(d.n, 4);
  assert.ok(Math.abs(d.mean - 1 / 6) < 1e-9);
  // Differences 1/3, 0, 1/3, 0: sample sd = 1/(2*sqrt(3)*... ) computed directly below.
  const diffs = [1 / 3, 0, 1 / 3, 0];
  const sd = Math.sqrt(diffs.reduce((s, x) => s + (x - 1 / 6) ** 2, 0) / 3);
  assert.ok(Math.abs(d.se - sd / 2) < 1e-9);
  assert.ok(Math.abs(d.lower - (d.mean - 3.182 * d.se)) < 1e-9);
});

test('tasks with missing draws do not pair, and are named', () => {
  const rows = [...drawsFor('a', [3, 2, 1]), ...drawsFor('b', [2, 2, 0]).filter((r) => !(r.task === 't2' && r.draw === 3))];
  const d = pairedDifference(rows, 'a', 'b');
  assert.equal(d.n, 2);
  assert.deepEqual(d.unpaired, ['t2']);
});

test('the t table covers small samples and falls back for large ones', () => {
  assert.equal(tCritical95(19), 2.093);
  assert.equal(tCritical95(200), 1.96);
  assert.equal(tCritical95(0), Infinity);
});

test('an A/A run of identical arms contains zero; a biased instrument does not', () => {
  assert.equal(evaluateAa([...drawsFor('bare-a', twenty([1, 2])), ...drawsFor('bare-b', twenty([2, 1]))]).contains_zero, true);
  const biased = [...drawsFor('bare-a', twenty([3, 3, 2, 3])), ...drawsFor('bare-b', twenty([1, 0, 1, 1]))];
  assert.equal(evaluateAa(biased).contains_zero, false);
  assert.equal(evaluateAa([]).contains_zero, false, 'a missing floor is not a passing floor');
});

test('pass^k, pass@1 and tokens per solved task', () => {
  const s = armSummary(drawsFor('a', [3, 1, 0]), 'a');
  assert.ok(Math.abs(s.pass_all_k - 1 / 3) < 1e-9);
  assert.ok(Math.abs(s.pass_at_1 - 2 / 3) < 1e-9);
  assert.equal(s.weighted_per_solved, (9 * 100) / 4);
  assert.equal(armSummary(drawsFor('a', [0]), 'a').weighted_per_solved, null);
  assert.equal(weightedTokens({ input: 10, output: 1, cacheRead: 100, cacheCreation: 4 }), 10 + 5 + 10 + 5);
});

const aaOk = [...drawsFor('bare-a', twenty([1, 2])), ...drawsFor('bare-b', twenty([2, 1]))];
const bareRows = drawsFor('bare', twenty([1, 2]), { weighted: 100 });

test('the release rule ships a non-inferior, affordable lane', () => {
  const v = evaluateRelease({ aa: aaOk, main: [...bareRows, ...drawsFor('somi5', twenty([1, 2]), { weighted: 140 })] });
  assert.equal(v.ships, true, v.reasons.join('; '));
  assert.ok(Math.abs(v.token_ratio - 1.4) < 1e-9);
});

test('the release rule refuses each failure, and says which', () => {
  const costly = evaluateRelease({ aa: aaOk, main: [...bareRows, ...drawsFor('somi5', twenty([1, 2]), { weighted: 151 })] });
  assert.equal(costly.ships, false);
  assert.match(costly.reasons.join(), /tokens per solved/);

  const worse = evaluateRelease({ aa: aaOk, main: [...bareRows, ...drawsFor('somi5', twenty([0, 1]), { weighted: 100 })] });
  assert.equal(worse.ships, false);
  assert.match(worse.reasons.join(), /non-inferiority/);

  const noFloor = evaluateRelease({ aa: [], main: [...bareRows, ...drawsFor('somi5', twenty([1, 2]), { weighted: 100 })] });
  assert.equal(noFloor.ships, false);
  assert.match(noFloor.reasons.join(), /A\/A/);

  const small = evaluateRelease({ aa: aaOk, main: [...drawsFor('bare', [1, 2, 1]), ...drawsFor('somi5', [1, 2, 1])] });
  assert.equal(small.ships, false);
  assert.match(small.reasons.join(), /only 3 tasks/);

  const gaveUp = evaluateRelease({ aa: aaOk, main: [...bareRows, ...drawsFor('somi5', twenty([1, 2]), { weighted: 100 }).map((r) => ({ ...r, abandoned: true }))] });
  assert.equal(gaveUp.ships, false);
  assert.match(gaveUp.reasons.join(), /no valid score/);
});

test('selection keeps tasks between floor and ceiling, boundary tasks first, and names shortfalls', () => {
  const candidates = [{ id: 't0' }, { id: 't1', boundary: true }, { id: 't2' }, { id: 't3' }];
  const pilot = drawsFor('bare', [3, 2, 0, 1]);
  const picked = selectTasks(pilot, candidates);
  assert.deepEqual(picked.tasks.map((t) => t.id), ['t1', 't3']);
  assert.equal(picked.shortfalls.length, 2);
});

test('plans are paired, seeded and repeatable', () => {
  const tasks = [{ id: 'a', dir: 'x/a' }, { id: 'b', dir: 'x/b' }];
  const plan = buildPlan('main', tasks, 7);
  assert.equal(plan.length, 2 * 3 * 3);
  assert.deepEqual(plan, buildPlan('main', tasks, 7));
  assert.notDeepEqual(plan.map((d) => d.id), buildPlan('main', tasks, 8).map((d) => d.id));
  assert.equal(buildPlan('aa', tasks).length, 12);
  const round = plan.slice(0, 3).map((d) => d.task);
  assert.equal(new Set(round).size, 1, 'all arms of a task run in the same round');
});

test('each arm gets the same task text, with only the front door added', () => {
  assert.equal(armPrompt('bare', 'do it'), 'do it');
  assert.equal(armPrompt('bare-a', 'do it'), 'do it');
  assert.equal(armPrompt('somi5', 'do it'), '/somi:task do it');
  assert.equal(armPrompt('somi41', 'do it'), '/somi:ship-loop do it');
});

test('an arm is abandoned after two window exhaustions in a row', () => {
  const hit = { arm: 'somi5', halted: 'account-limit' };
  const ok = { arm: 'somi5', solved: true };
  assert.equal(abandonedArms([hit]).has('somi5'), false);
  assert.equal(abandonedArms([hit, ok, hit]).has('somi5'), false);
  assert.equal(abandonedArms([hit, hit]).has('somi5'), true);
});

test('usage takes the last of a run of results, and adds across resumes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-usage-'));
  try {
    const usage = (inputTokens) => ({ m: { inputTokens, outputTokens: 1, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } });
    const lines = [{ type: 'result', num_turns: 2, modelUsage: usage(10) }, { type: 'result', num_turns: 1, modelUsage: usage(15) }, { type: 'assistant' }, { type: 'result', num_turns: 3, modelUsage: usage(5) }];
    const file = path.join(dir, 's.jsonl');
    fs.writeFileSync(file, `${lines.map((l) => JSON.stringify(l)).join('\n')}\nnot json\n`);
    const u = streamUsage(file);
    assert.equal(u.tokens.input, 20);
    assert.equal(u.tokens.output, 2);
    assert.equal(u.turns, 6);
    assert.deepEqual(u.models, ['m']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('registration holds only for a committed, matching task set', (t) => {
  const repo = makeRepo(t);
  const dir = path.join(repo, 'benchmarks', 'v2');
  fs.mkdirSync(dir, { recursive: true });
  assert.match(preregProblem(repo, dir), /must both exist/);
  const set = '{"tasks":[]}\n';
  writeFiles(dir, { 'task-set.json': set, 'prereg.json': JSON.stringify({ task_set_sha256: 'wrong' }) });
  assert.match(preregProblem(repo, dir), /does not name/);
  writeFiles(dir, { 'prereg.json': JSON.stringify({ task_set_sha256: sha256(set) }) });
  assert.match(preregProblem(repo, dir), /must be committed/);
  const git = (...a) => execFileSync('git', a, { cwd: repo, stdio: 'ignore', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } });
  git('add', '-A');
  git('commit', '-q', '-m', 'register');
  assert.equal(preregProblem(repo, dir), null);
  writeFiles(dir, { 'prereg.json': JSON.stringify({ task_set_sha256: sha256(set), note: 'edited after' }) });
  assert.match(preregProblem(repo, dir), /uncommitted/);
});

test('a paid run refuses without --go, and the registration is sealed in the file', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'benchmarks/v2/bench.mjs'), 'run', '--phase', 'pilot', '--out', 'x', '--model', 'm', '--budget-total', '1'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /--go/);
  const prereg = JSON.parse(fs.readFileSync(path.join(REPO, 'benchmarks/v2/prereg.json'), 'utf8'));
  assert.equal(prereg.rule.non_inferiority_margin, -0.05);
  assert.equal(prereg.rule.max_token_ratio, 1.5);
  assert.equal(prereg.k, 3);
});

test('every candidate task exists and is well formed', () => {
  const { tasks } = JSON.parse(fs.readFileSync(path.join(REPO, 'benchmarks/v2/candidates.json'), 'utf8'));
  assert.ok(tasks.length > 0);
  for (const task of tasks) {
    const spec = JSON.parse(fs.readFileSync(path.join(REPO, task.dir, 'task.json'), 'utf8'));
    assert.ok(Array.isArray(spec.statements) && spec.statements.length > 0, task.id);
    assert.ok(fs.existsSync(path.join(REPO, task.dir, 'hidden')), task.id);
  }
});
