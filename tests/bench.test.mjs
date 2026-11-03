import { RESUME_PROMPT, looksPaused, prepareWorkspace } from './evals/lib/ab-draw.mjs';
import { globalConfigPath } from '../scripts/lib/config-files.mjs';
import { resolveSpawn } from '../scripts/lib/tiers.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { REPO, makeRepo, writeFiles } from './helpers.mjs';
import { armSummary, callRatio, testShare, costDrawsPerArm, evaluateAa, evaluateRelease, holm, logRatio, nonInferiorityDrawsPerArm, nonInferiorityPower, pairedDifference, passDrawsPerArm, selectTasks, tCritical95, weightedTokens } from '../benchmarks/v2/stats.mjs';
import { WINDOW_ENV, WINDOW_SETTINGS, pilotRows, liveCandidates, openDecisions, abandonedArms, armPrompt, armsFor, buildPlan, comparableRecordings, findLeaks, isFullModelId, isQuiet, preregProblem, servedAsPinned, sha256, streamUsage, timeoutFromPilot } from '../benchmarks/v2/bench.mjs';
import { adherence, agentSplit, journalFacts, labelDraw, scopeCheck } from '../benchmarks/v2/telemetry.mjs';

// Three draws per task for one arm, from a list of solved counts per task. A solved draw passes all its tests, and another passes 90%.
function drawsFor(arm, solvedCounts, { weighted = 100, missed = 1 } = {}) {
  return solvedCounts.flatMap((solved, i) => [1, 2, 3].map((draw) => ({ task: `t${i}`, arm, draw, solved: draw <= solved, label: 'finished', green: draw <= solved ? 10 : 10 - missed, total: 10, weighted, cost: weighted / 1000, wall_ms: 1000, turns: 5 })));
}
const RULE = { min_tasks: 20, k: 3, aa_k: 3, max_cost_ratio: 1.5, test_share_margin: -0.05, solved_rate_margin: -0.2 };
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
  const v = evaluateRelease({ rule: RULE, aa: aaOk, main: [...bareRows, ...drawsFor('somi5', twenty([1, 2]), { weighted: 140 })] });
  assert.equal(v.ships, true, v.reasons.join('; '));
  assert.ok(Math.abs(v.cost_ratio - 1.4) < 1e-9);
});

test('the release rule refuses each failure, and says which', () => {
  const costly = evaluateRelease({ rule: RULE, aa: aaOk, main: [...bareRows, ...drawsFor('somi5', twenty([1, 2]), { weighted: 151 })] });
  assert.equal(costly.ships, false);
  assert.match(costly.reasons.join(), /dollars per solved/);

  const worse = evaluateRelease({ rule: RULE, aa: aaOk, main: [...bareRows, ...drawsFor('somi5', twenty([0, 0]), { weighted: 100 })] });
  assert.equal(worse.ships, false);
  assert.match(worse.reasons.join(), /solved-rate/);

  const thinner = evaluateRelease({ rule: RULE, aa: aaOk, main: [...bareRows, ...drawsFor('somi5', twenty([1, 2]), { weighted: 100, missed: 5 })] });
  assert.equal(thinner.ships, false);
  assert.match(thinner.reasons.join(), /hidden-test share/);
  assert.doesNotMatch(thinner.reasons.join(), /solved-rate/);

  const noFloor = evaluateRelease({ rule: RULE, aa: [], main: [...bareRows, ...drawsFor('somi5', twenty([1, 2]), { weighted: 100 })] });
  assert.equal(noFloor.ships, false);
  assert.match(noFloor.reasons.join(), /A\/A/);

  const small = evaluateRelease({ rule: RULE, aa: aaOk, main: [...drawsFor('bare', [1, 2, 1]), ...drawsFor('somi5', [1, 2, 1])] });
  assert.equal(small.ships, false);
  assert.match(small.reasons.join(), /only 3 tasks/);

  const gaveUp = evaluateRelease({ rule: RULE, aa: aaOk, main: [...bareRows, ...drawsFor('somi5', twenty([1, 2]), { weighted: 100 }).map((r) => ({ ...r, abandoned: true }))] });
  assert.equal(gaveUp.ships, false);
  assert.match(gaveUp.reasons.join(), /no valid score/);
});

test('selection fills each part of the mix, boundary tasks first, and names shortfalls', () => {
  const candidates = [{ id: 't0', stratum: 'a' }, { id: 't1', boundary: true, stratum: 'a' }, { id: 't2', stratum: 'a' }, { id: 't3', stratum: 'a' }, { id: 't4', stratum: 'a' }];
  const pilot = [...drawsFor('bare', [3, 2, 0, 1]), ...drawsFor('bare', [0, 0, 0, 0, 0], { missed: 8 }).filter((r) => r.task === 't4')];
  const picked = selectTasks(pilot, candidates, { mix: { band: 1, floor: 2, ceiling: 1 } });
  assert.deepEqual(picked.tasks.map((t) => t.id), ['t1', 't2', 't0']);
  assert.deepEqual(picked.shortfalls, ['1 floor tasks, 2 wanted', '1 trust-boundary tasks, 4 wanted']);
  assert.deepEqual(picked.hardest, ['t2', 't1', 't0']);
});

test('selection lets kinds take turns', () => {
  const candidates = [{ id: 'a1', stratum: 'a' }, { id: 'a2', stratum: 'a' }, { id: 'b1', stratum: 'b' }];
  const rows = ['a1', 'a2', 'b1'].flatMap((task) => drawsFor('bare', [3]).map((r) => ({ ...r, task })));
  assert.deepEqual(selectTasks(rows, candidates, { mix: { ceiling: 2 } }).tasks.map((t) => t.id), ['a1', 'b1']);
});

test('a later pilot replaces an earlier one task by task', () => {
  const dirs = { old: [{ task: 'x', solved: false }, { task: 'y', solved: true }], new: [{ task: 'x', solved: true }] };
  assert.deepEqual(pilotRows(['old', 'new'], (d) => dirs[d]).map((r) => [r.task, r.solved]), [['x', true], ['y', true]]);
});

test('a paid recording cannot run part of its plan, and only a pilot can', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'benchmarks/v2/bench.mjs'), 'run', '--phase', 'aa', '--out', 'x', '--model', 'claude-x-5-5', '--budget-total', '1', '--go', '--tasks', 'a'], { encoding: 'utf8' });
  assert.match(r.stderr, /--tasks is for a pilot or a stub/);
});

test('the candidate plan re-checks bare with one draw', () => {
  const plan = buildPlan('candidate', [{ id: 't', dir: 'd' }], 1, 6, { 'bare-check': 1 });
  const count = (arm) => plan.filter((d) => d.arm === arm).length;
  assert.deepEqual([count('somi5'), count('bare-check')], [6, 1]);
});

test('a benchmark never runs on opus', () => {
  for (const flags of [['--model', 'claude-opus-5-5'], ['--model', 'claude-sonnet-5-5', '--worker-model', 'claude-opus-5-5']]) {
    const r = spawnSync(process.execPath, [path.join(REPO, 'benchmarks/v2/bench.mjs'), 'run', '--phase', 'pilot', '--out', 'x', ...flags, '--budget-total', '1', '--go'], { encoding: 'utf8' });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /never run on opus/);
  }
  assert.equal(servedAsPinned(['claude-opus-5-5'], ['claude-sonnet-5-5', 'claude-haiku-5-5']), false);
});

test('the router clears a floor on the labelled set', async () => {
  const { scoreRouter } = await import('../benchmarks/v2/routing-score.mjs');
  const { items } = JSON.parse(fs.readFileSync(path.join(REPO, 'benchmarks/v2/routes.json'), 'utf8'));
  assert.ok(items.length >= 200, `${items.length} items`);
  assert.ok(scoreRouter(items).accuracy >= 0.8);
});

test('plans are paired, seeded and repeatable', () => {
  const tasks = [{ id: 'a', dir: 'x/a' }, { id: 'b', dir: 'x/b' }];
  const plan = buildPlan('baseline', tasks, 7);
  assert.equal(plan.length, 2 * 3 * 2);
  assert.deepEqual(plan, buildPlan('baseline', tasks, 7));
  assert.notDeepEqual(plan.map((d) => d.id), buildPlan('baseline', tasks, 8).map((d) => d.id));
  assert.equal(buildPlan('aa', tasks).length, 12);
  const round = plan.slice(0, 2).map((d) => d.task);
  assert.equal(new Set(round).size, 1, 'all arms of a task run in the same round');
});

test('each arm gets the same plain request, so the routing is what gets measured', () => {
  for (const arm of ['bare', 'bare-a', 'somi5', 'somi41', 'abl-review-off']) assert.equal(armPrompt(arm, 'do it'), 'do it');
});

test('a recording counts the machine as quiet only under half its cores', () => {
  assert.equal(isQuiet(3.9, 8), true);
  assert.equal(isQuiet(4, 8), true);
  assert.equal(isQuiet(22.9, 8), false);
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
  assert.equal(prereg.rule.test_share_margin, -0.05);
  assert.equal(prereg.rule.solved_rate_margin, -0.2);
  assert.equal(prereg.rule.max_cost_ratio, 1.5);
  assert.equal(prereg.k, 6);
  assert.equal(prereg.arm_k['bare-check'], 1);
  assert.ok(Object.values(prereg.decisions).every((v) => typeof v === 'string'));
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

test('a ratio is blocked by task, and arm sets give a main effect', () => {
  const row = (task, arm, weighted) => ({ task, arm, weighted });
  const rows = [row('t1', 'a', 200), row('t1', 'b', 100), row('t2', 'a', 80), row('t2', 'b', 40), row('t3', 'a', 660), row('t3', 'b', 300)];
  const r = logRatio(rows, 'a', 'b');
  assert.equal(r.n, 3);
  assert.ok(r.ratio > 2 && r.ratio < 2.1);
  assert.ok(r.lower <= r.ratio && r.upper >= r.ratio);
  const effect = logRatio([...rows, row('t1', 'c', 200), row('t2', 'c', 80), row('t3', 'c', 660), row('t1', 'd', 100), row('t2', 'd', 40), row('t3', 'd', 300)], ['a', 'c'], ['b', 'd']);
  assert.ok(Math.abs(effect.ratio - r.ratio) < 1e-9);
  assert.equal(logRatio([row('t1', 'a', 0), row('t1', 'b', 1)], 'a', 'b').dropped, 1);
});

test('a stopped draw scores no test share, and a ratio is called only when its whole interval clears the effect', () => {
  assert.equal(testShare({ label: 'finished', green: 9, total: 10 }), 0.9);
  assert.equal(testShare({ label: 'stopped-at-gate', green: 10, total: 10 }), 0);
  assert.equal(callRatio({ ratio: 0.6, lower: 0.5, upper: 0.74 }, 0.25), 'lower');
  assert.equal(callRatio({ ratio: 0.6, lower: 0.5, upper: 0.8 }, 0.25), 'inconclusive');
  assert.equal(callRatio({ ratio: 1.6, lower: 1.34, upper: 2 }, 0.25), 'higher');
  assert.equal(callRatio({ ratio: null }, 0.25), 'no estimate');
});

test('Holm stops at the first test that misses its share of alpha', () => {
  const out = holm([{ name: 'a', p: 0.01 }, { name: 'b', p: 0.04 }, { name: 'c', p: 0.03 }]);
  assert.deepEqual(out.map((t) => [t.name, t.significant]), [['a', true], ['c', false], ['b', false]]);
});

test('the power figures match hand calculations', () => {
  // (1.645 + 0.842)^2 * (0.15^2 + 0.41^2) / ln(0.7)^2 = 9.3, plus 2 for the t correction, rounded up.
  assert.equal(costDrawsPerArm({ sigmaA: 0.15, sigmaB: 0.41, effect: 0.3 }), 12);
  assert.equal(passDrawsPerArm({ p1: 0.5, p2: 0.6 }), 385);
  assert.equal(nonInferiorityDrawsPerArm({ margin: -0.05, sd: 0.5 }), 1571);
  assert.ok(Math.abs(nonInferiorityPower({ margin: -0.05, drawsPerArm: 60 }) - 0.079) < 0.002);
  assert.ok(Math.abs(nonInferiorityPower({ margin: -0.2, drawsPerArm: 99 }) - 0.8) < 0.01);
});

const line = (o) => JSON.stringify(o);

test('the per-agent split joins the stream to the final figures in the transcripts', () => {
  const stream = [
    line({ type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', usage: { output_tokens: 1 }, content: [{ type: 'tool_use', id: 'tu1', name: 'Agent', input: { subagent_type: 'somi-reviewer', model: 'x' } }] } }),
    line({ type: 'assistant', parent_tool_use_id: 'tu1', message: { id: 'm2', usage: { output_tokens: 1 }, content: [] } }),
  ].join('\n');
  const transcripts = [line({ type: 'assistant', message: { id: 'm1', model: 'x', usage: { output_tokens: 100 } } }), line({ type: 'assistant', isSidechain: true, message: { id: 'm2', model: 'x', usage: { input_tokens: 40, output_tokens: 10 } } })];
  const { agents, coverage } = agentSplit(stream, transcripts, 1180);
  assert.equal(agents.main.weighted, 500);
  assert.equal(agents['somi-reviewer'].weighted, 90);
  assert.equal(coverage, 590 / 1180);
  assert.equal(agentSplit(stream, [], 100).coverage, 0);
});

test('adherence reads the route, the agents and the journal', () => {
  const step = (name, input) => line({ type: 'assistant', parent_tool_use_id: null, message: { id: name, content: [{ type: 'tool_use', id: name, name, input }] } });
  const journal = [
    line({ type: 'open', milestone: 'm', next: 'code' }),
    line({ type: 'after-code', signals: ['large-diff'], security: ['sink'], facts: { lines: 400 }, next: 'review' }),
    line({ type: 'after-review', pass: 1, findings: [{ severity: 'Major' }, { severity: 'Minor' }], next: 'ask', stop: 'max-passes' }),
  ].join('\n');
  const a = adherence([step('mcp__somi__somi_step', {}), step('Bash', { command: 'node "x/somi.mjs" step after-code' }), step('Agent', { subagent_type: 'somi-reviewer', model: 'r' })].join('\n'), journal);
  assert.equal(a.route, 'mixed');
  assert.deepEqual(a.agents, [{ type: 'somi-reviewer', model: 'r' }]);
  assert.equal(a.passes, 1);
  assert.deepEqual(a.findings, { Major: 1, Minor: 1 });
  assert.deepEqual(a.gates, ['max-passes']);
  assert.equal(a.next, 'ask');
  assert.deepEqual(a.signals, ['large-diff']);
  assert.equal(adherence('', '').route, 'none');
  assert.equal(journalFacts('not json\n').opened, false);
});

test('every draw gets one label, and a stopped loop is never finished', () => {
  const none = { next: null };
  assert.deepEqual(labelDraw({ outcome: 'scored', facts: { next: 'ask', stop: 'max-passes' } }), { label: 'stopped-at-gate', gate: 'max-passes' });
  assert.deepEqual(labelDraw({ outcome: 'over-budget', facts: none }), { label: 'stopped-at-gate', gate: 'budget' });
  assert.equal(labelDraw({ outcome: 'invalid', reason: 'timeout', facts: none }).label, 'timed-out');
  assert.equal(labelDraw({ outcome: 'invalid', reason: 'tampered', facts: none }).label, 'invalid');
  assert.equal(labelDraw({ outcome: 'paused', facts: none }).label, 'asked-user');
  assert.equal(labelDraw({ outcome: 'scored', facts: none, paused: true, changed: false }).label, 'asked-user');
  assert.equal(labelDraw({ outcome: 'scored', facts: none, paused: true, changed: true }).label, 'finished');
  assert.equal(labelDraw({ outcome: 'scored', facts: { next: 'close' } }).label, 'finished');
});

test('the scope check separates a touched existing file from a new stray one', () => {
  const task = { source: ['src/'], test_dir: 'test', root_files: ['README.md'] };
  const before = [['src/a.js', '1'], ['README.md', '2'], ['lib/keep.js', '3'], ['.somi/config.json', '4']];
  const after = [['src/a.js', '9'], ['README.md', '8'], ['lib/keep.js', '7'], ['.somi/config.json', '6'], ['test/new.js', '5'], ['notes.md', '5'], ['.somi/state/journal.jsonl', '5']];
  assert.deepEqual(scopeCheck(before, after, task), { touched: ['lib/keep.js'], added: ['notes.md'] });
  assert.deepEqual(scopeCheck(before, before.slice(0, 2).concat(before[3]), task).touched, ['lib/keep.js']);
});

test('a reference solution never trips the scope check', () => {
  const { tasks } = JSON.parse(fs.readFileSync(path.join(REPO, 'benchmarks/v2/candidates.json'), 'utf8'));
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const t of tasks) {
    const dir = path.join(REPO, t.dir);
    const spec = JSON.parse(fs.readFileSync(path.join(dir, 'task.json'), 'utf8'));
    const list = (sub) => walk(path.join(dir, sub)).map((f) => [path.relative(path.join(dir, sub), f), '1']);
    const changed = list('oracle').map(([p]) => [p, '2']);
    assert.deepEqual(scopeCheck(list('fixture'), [...list('fixture').filter(([p]) => !changed.some(([q]) => q === p)), ...changed], spec), { touched: [], added: [] }, t.id);
  }
});

test('a run is pinned to a full id, and an alias or a near match is refused', () => {
  assert.equal(isFullModelId('claude-x-5-5'), true);
  assert.equal(isFullModelId('sonnet'), false);
  assert.equal(servedAsPinned(['claude-x-5-5'], ['claude-x-5-5']), true);
  assert.equal(servedAsPinned(['claude-x-5-5-20261001'], ['claude-x-5-5']), true);
  assert.equal(servedAsPinned(['claude-x-5-5-experimental'], ['claude-x-5-5']), false);
  assert.equal(servedAsPinned(['my-claude-x-5-5'], ['claude-x-5-5']), false);
  assert.equal(servedAsPinned(['claude-y-5-5'], ['claude-x-5-5']), false);
  assert.equal(servedAsPinned(['<synthetic>', 'claude-x-5-5'], ['claude-x-5-5']), true);
  const r = spawnSync(process.execPath, [path.join(REPO, 'benchmarks/v2/bench.mjs'), 'run', '--phase', 'pilot', '--out', 'x', '--model', 'sonnet', '--budget-total', '1', '--go'], { encoding: 'utf8' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /full model id/);
});

test('the privacy scan names the kind and place, never the value', () => {
  assert.deepEqual(findLeaks({ ok: 'plain', p: `${['', 'home', 'someone'].join('/')}/x` }, 'r', 'nohost'), [{ at: 'r.p', kind: 'home path' }]);
  assert.deepEqual(findLeaks([`sk-${'a'.repeat(20)}`], 'r', 'nohost'), [{ at: 'r[0]', kind: 'token-like string' }]);
  assert.deepEqual(findLeaks('built on my-laptop', 'r', 'my-laptop'), [{ at: 'r', kind: 'hostname' }]);
  assert.deepEqual(findLeaks({ a: 1, b: ['fine'] }, 'r', 'nohost'), []);
});

test('the timeout comes from the pilot and leaves room for a workflow arm', () => {
  assert.equal(timeoutFromPilot([]), null);
  const rows = Array.from({ length: 20 }, (_, i) => ({ wall_ms: (i + 1) * 60000 }));
  assert.deepEqual(timeoutFromPilot(rows), { bare_min: 29, workflow_min: 200 });
  const r = spawnSync(process.execPath, [path.join(REPO, 'benchmarks/v2/bench.mjs'), 'run', '--phase', 'aa', '--out', 'x', '--model', 'claude-x-5-5', '--budget-total', '1', '--go'], { encoding: 'utf8' });
  assert.match(r.stderr, /--timeout-min is required/);
});

test('every ablation patch still matches the shipped file exactly once', () => {
  const { patches, cells } = JSON.parse(fs.readFileSync(path.join(REPO, 'benchmarks/v2/ablations.json'), 'utf8'));
  for (const [name, { file, find }] of Object.entries(patches)) assert.equal(fs.readFileSync(path.join(REPO, file), 'utf8').split(find).length, 2, name);
  for (const [cell, list] of Object.entries(cells)) for (const name of list) assert.ok(patches[name], `${cell}: ${name}`);
  assert.ok(armsFor('ablation').includes('bare') && armsFor('ablation').includes('somi5'));
  assert.deepEqual(armsFor('pilot'), ['bare']);
});

test('recordings on another model or rule cannot be compared', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-compare-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (name, plan) => { fs.mkdirSync(path.join(dir, name)); fs.writeFileSync(path.join(dir, name, 'plan.json'), JSON.stringify(plan)); };
  const same = { phase: 'aa', model: 'm', review_model: null, rule: 'r', host: { cores: 8 } };
  write('a', same);
  write('b', { ...same, phase: 'main' });
  write('c', { ...same, model: 'other' });
  assert.equal(comparableRecordings(path.join(dir, 'a'), path.join(dir, 'b')), null);
  assert.match(comparableRecordings(path.join(dir, 'a'), path.join(dir, 'c')), /differ/);
});

test('a task that failed its probe stays out of later pilots', () => {
  assert.deepEqual(liveCandidates([{ id: 'a', retired: 'at the ceiling' }, { id: 'b' }]).map((t) => t.id), ['b']);
});

test('every candidate names a known kind of task', () => {
  const { tasks } = JSON.parse(fs.readFileSync(path.join(REPO, 'benchmarks/v2/candidates.json'), 'utf8'));
  const kinds = ['multi-file', 'misleading-bug', 'security', 'ambiguous-spec', 'refactor', 'planted-trap', 'algorithm'];
  for (const t of tasks) assert.ok(kinds.includes(t.stratum), t.id);
});

test('registration refuses while a decision is open', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-prereg-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(openDecisions({ decisions: { tier: 'medium', budget: null } }).join(), 'budget');
  assert.deepEqual(openDecisions({ decisions: { tier: 'medium' } }), []);
});

// The free smoke: the whole pipeline on one small real task with a stub agent. It plans, runs, scores with the real scorer, labels,
// reports and writes the record. It spends nothing.
function stubAgent(dir, { journal = null } = {}) {
  const oracle = path.join(REPO, 'tests/evals/ab/T1-proration/oracle');
  const events = [
    { type: 'system', subtype: 'init', session_id: 's' },
    { type: 'assistant', parent_tool_use_id: null, message: { id: 'm1', model: 'stub-1', content: [{ type: 'text', text: 'Done.' }], usage: { output_tokens: 1 } } },
    { type: 'result', subtype: 'success', session_id: 's', result: 'Done.', num_turns: 1, total_cost_usd: 0.01, modelUsage: { 'stub-1': { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 0, cacheCreationInputTokens: 0 } } },
  ];
  const file = path.join(dir, journal ? 'stub-gate' : 'stub');
  const body = [
    '#!/usr/bin/env node',
    "const fs = require('node:fs');",
    // The reference solution carries the task's canary, and the leak guard rightly refuses a silent copy, so the stub writes it without.
    `for (const f of fs.readdirSync(${JSON.stringify(oracle)}, { recursive: true, withFileTypes: true })) { if (!f.isFile()) continue; const from = require('node:path').join(f.parentPath, f.name); const to = require('node:path').relative(${JSON.stringify(oracle)}, from); fs.mkdirSync(require('node:path').dirname(to), { recursive: true }); fs.writeFileSync(to, fs.readFileSync(from, 'utf8').replace(/SOMI-CANARY-[A-Za-z0-9-]+/g, '')); }`,
    ...(journal ? [`fs.mkdirSync('.somi/state', { recursive: true }); fs.writeFileSync('.somi/state/journal.jsonl', ${JSON.stringify(journal)});`] : []),
    `for (const e of ${JSON.stringify(events)}) console.log(JSON.stringify(e));`,
  ].join('\n');
  fs.writeFileSync(file, body, { mode: 0o755 });
  return file;
}

test('the smoke runs the whole pipeline with a stub agent, and a stopped loop does not count as solved', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-smoke-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const envFile = path.join(dir, 'eval.env');
  fs.writeFileSync(envFile, `CLAUDE_CODE_OAUTH_TOKEN=stub-token-${sha256('smoke').slice(0, 40)}\n`, { mode: 0o600 });
  const { CLAUDE_CODE_OAUTH_TOKEN: _drop, ...env } = process.env;
  const bench = (args) => spawnSync(process.execPath, [path.join(REPO, 'benchmarks/v2/bench.mjs'), ...args], { encoding: 'utf8', env, timeout: 120000 });
  const common = ['--phase', 'pilot', '--model', 'stub-1', '--budget-total', '1', '--budget-draw', '0.1', '--go', '--no-sandbox', '--tasks', 'T1-proration', '--env-file', envFile];

  const out = path.join(dir, 'solved');
  const records = path.join(dir, 'records');
  const r = bench(['record', ...common, '--claude', stubAgent(dir), '--out', out, '--write', records]);
  assert.equal(r.status, 0, r.stderr + r.stdout);
  assert.match(r.stdout, /worst case: 3 draws/);
  const rows = fs.readFileSync(path.join(out, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.solved, true, JSON.stringify(row));
    assert.equal(row.label, 'finished');
    assert.deepEqual(row.scope, { touched: [], added: [] });
    assert.equal(row.adherence.route, 'none');
  }
  const written = fs.readdirSync(records).sort();
  assert.equal(written.length, 2);
  const report = fs.readFileSync(path.join(records, written[1]), 'utf8');
  assert.match(report, /\| bare \| 3 \| 3 \|/);
  assert.match(report, /finished/);
  assert.deepEqual(findLeaks(JSON.parse(fs.readFileSync(path.join(records, written[0]), 'utf8'))), []);

  assert.match(bench(['run', ...common, '--claude', stubAgent(dir), '--out', out]).stdout, /ran 0 draws; 0 remain/);

  const short = bench(['run', ...common.map((a) => (a === '1' ? '0.05' : a)), '--claude', stubAgent(dir), '--out', path.join(dir, 'short')]);
  assert.equal(short.status, 1);
  assert.match(short.stdout, /budget stop/);
  assert.equal(fs.existsSync(path.join(dir, 'short', 'results.jsonl')), false);

  const slow = path.join(dir, 'stub-slow');
  fs.writeFileSync(slow, '#!/usr/bin/env node\nsetTimeout(() => {}, 60000);\n', { mode: 0o755 });
  const late = path.join(dir, 'late');
  assert.equal(bench(['run', ...common, '--claude', slow, '--timeout-min', '0.01', '--out', late]).status, 0);
  const lateRows = fs.readFileSync(path.join(late, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lateRows.length, 3);
  for (const row of lateRows) {
    assert.equal(row.label, 'timed-out');
    assert.equal(row.solved, false);
  }

  const gated = path.join(dir, 'gated');
  const journal = `${JSON.stringify({ type: 'after-review', pass: 2, findings: [], next: 'ask', stop: 'recurring-finding' })}\n`;
  assert.equal(bench(['run', ...common, '--claude', stubAgent(dir, { journal }), '--out', gated]).status, 0);
  for (const row of fs.readFileSync(path.join(gated, 'results.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l))) {
    assert.equal(row.green, row.total, 'the hidden suite passes');
    assert.equal(row.solved, false, 'but the loop stopped');
    assert.equal(row.gate, 'recurring-finding');
  }
});

test('plan prints the draws and spends nothing', () => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'benchmarks/v2/bench.mjs'), 'plan', '--phase', 'pilot'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /draws across \d+ tasks; chunks of at most 24; no spend/);
});

test('a planner asking for choices counts as paused, and a finished report does not', () => {
  assert.equal(looksPaused('The planner needs five design decisions from you. Reply with a choice for each question, or "take the recommendations".'), true);
  assert.equal(looksPaused('All six milestones are in, and the full suite passes. I made the decisions you listed binding.'), false);
  assert.match(RESUME_PROMPT, /recommended option/);
});

test('a recording pins the tiers in the user layer too, because reviewers read only that', (t) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-bench-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const config = { tiers: { claude: { low: 'haiku', medium: 'sonnet', high: 'sonnet' } } };
  prepareWorkspace({ taskDir: path.join(REPO, 'tests/evals/ab/L1-shop-platform'), tmp, config, globalConfig: config });
  const file = globalConfigPath({ HOME: tmp }, 'linux', tmp);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), config);
  assert.equal(resolveSpawn(JSON.parse(fs.readFileSync(file, 'utf8')), 'claude', 'high').model, 'sonnet');
});

test('the lane arm asks for a plan first, the tight phase has a small window, and compactions are counted', (t) => {
  assert.match(armPrompt('somi5-lane', 'do it'), /plan first[\s\S]*do it/);
  assert.equal(armPrompt('somi5', 'do it'), 'do it');
  assert.deepEqual(armsFor('tight'), ['bare', 'somi5', 'somi5-lane']);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-usage-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'stream.jsonl');
  fs.writeFileSync(file, `${JSON.stringify({ type: 'system', subtype: 'compact_boundary' })}\n${JSON.stringify({ type: 'result', num_turns: 2, modelUsage: {} })}\n`);
  assert.equal(streamUsage(file).compactions, 1);
});

test('every compaction window is one the host accepts, because it ignores any other', () => {
  for (const { autoCompactWindow } of Object.values(WINDOW_SETTINGS)) assert.ok(autoCompactWindow >= 100000 && autoCompactWindow <= 1000000, String(autoCompactWindow));
  const pct = Number(WINDOW_ENV.tight.CLAUDE_AUTOCOMPACT_PCT_OVERRIDE);
  assert.ok(pct > 0 && pct < 100);
});
