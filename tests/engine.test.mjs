// The step engine: what each request routes to, who does each step on which tier, and how a route ends.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO, makeRepo, somi, writeFiles } from './helpers.mjs';
import { abandon, closeMilestone, decide, done, parseMilestones, reviewed, route } from '../scripts/lib/engine.mjs';
import { deriveCursor, journalProblems, readEvents } from '../scripts/lib/journal.mjs';
import { addToLedger, readLedger, MAX_LINES } from '../scripts/lib/ledger.mjs';
import { recordCheck } from '../scripts/lib/kernel.mjs';
import { classify } from '../scripts/lib/routes.mjs';
import { listShards, shardsFor, slot, confirmProjectShards, ShardError } from '../scripts/lib/shards.mjs';
import { snapshotTree } from '../scripts/lib/git-tree.mjs';
import { nextTier, resolveSpawn, resolveTier } from '../scripts/lib/tiers.mjs';
import { isNewer, updateNotice } from '../scripts/lib/update-notice.mjs';
import { expertiseIndex, roleBrief, WORKFLOWS } from '../scripts/lib/workflows.mjs';

const env = { ...process.env, SOMI_GLOBAL_CONFIG: '' };
const makeCtx = (dir, config = {}, host = 'claude') => ({ root: dir, env, config, configLayers: [config], host, now: () => '2026-01-02T00:00:00Z' });
const check = (ctx, ok = true) => recordCheck(ctx, { tree: snapshotTree(ctx.root), ok, failed: ok ? [] : ['tests'] });
const events = (ctx) => readEvents(ctx.root, ctx.env);
const SMALL = { 'src/app.js': 'export const one = 2;\n' };
const SINK = { 'src/app.js': 'import { exec } from "node:child_process";\nexport const run = (cmd) => exec(cmd);\n' };

test('a small request goes to one low-tier worker, and the coordinator gets its instructions from the answer', (t) => {
  const ctx = makeCtx(makeRepo(t));
  const r = route(ctx, { request: 'Add a greeting to the home page' });
  assert.equal(r.route, 'build');
  assert.equal(r.next, 'spawn');
  assert.match(r.how, /spawn\.agent/);
  assert.equal(r.spawn.agent, 'somi:somi-worker');
  assert.equal(r.spawn.tier, 'low');
  assert.equal(r.spawn.model, 'haiku');
  assert.match(r.spawn.prompt, /> Add a greeting/);
});

test('a clean small change is checked, committed and finished with no review', (t) => {
  const ctx = makeCtx(makeRepo(t));
  route(ctx, { request: 'Change the constant' });
  writeFiles(ctx.root, SMALL);
  const first = done(ctx, {});
  assert.equal(first.next, 'run');
  assert.equal(first.then, 'done');
  assert.match(first.run, /somi\.mjs" check/);
  check(ctx);
  const second = done(ctx, {});
  assert.equal(second.next, 'run');
  assert.equal(second.then, 'close');
  assert.match(second.run, /somi\.mjs" commit/);
  const end = closeMilestone(ctx);
  assert.equal(end.next, 'done');
  assert.equal(deriveCursor(events(ctx)).route, null);
  assert.deepEqual(journalProblems(events(ctx)), []);
});

test('a worker that finishes its own step leaves the coordinator one call to end the route', (t) => {
  const dir = makeRepo(t);
  const ctx = makeCtx(dir);
  route(ctx, { request: 'Change the constant' });
  writeFiles(dir, SMALL);
  const finished = somi(dir, ['finish']);
  assert.equal(finished.status, 0, finished.stderr);
  assert.equal(finished.json.committed, true);
  assert.equal(done(ctx, {}).next, 'done');
  assert.equal(deriveCursor(events(ctx)).route, null);
});

test('a worker that changes nothing ends the route with nothing to check', (t) => {
  const ctx = makeCtx(makeRepo(t));
  route(ctx, { request: 'Change the constant' });
  assert.equal(done(ctx, {}).outcome, 'no-change');
});

test('a finish that needs a review tells the worker and commits nothing', (t) => {
  const dir = makeRepo(t);
  const ctx = makeCtx(dir);
  route(ctx, { request: 'Add a command runner' });
  writeFiles(dir, SINK);
  const finished = somi(dir, ['finish']);
  assert.equal(finished.json.next, 'review');
  assert.equal(done(ctx, {}).next, 'review');
});

test('failing checks restart one tier up, once, and then ask', (t) => {
  const ctx = makeCtx(makeRepo(t));
  route(ctx, { request: 'Change the constant' });
  writeFiles(ctx.root, SMALL);
  check(ctx, false);
  const again = done(ctx, {});
  assert.equal(again.spawn.tier, 'low');
  assert.match(again.spawn.prompt, /checks failed/);
  writeFiles(ctx.root, { 'src/app.js': 'export const one = 3;\n' });
  check(ctx, false);
  const up = done(ctx, {});
  assert.equal(up.spawn.tier, 'medium');
  assert.equal(up.spawn.model, 'sonnet');
  assert.match(up.spawn.prompt, /Judge it fresh/);
  writeFiles(ctx.root, { 'src/app.js': 'export const one = 4;\n' });
  check(ctx, false);
  const stop = done(ctx, {});
  assert.equal(stop.next, 'ask');
  assert.equal(stop.stop, 'still-failing');
  assert.deepEqual(journalProblems(events(ctx)), []);
});

test('a sink in the diff gets the low reviewer and the high security reviewer', (t) => {
  const ctx = makeCtx(makeRepo(t));
  route(ctx, { request: 'Add a command runner' });
  writeFiles(ctx.root, SINK);
  check(ctx);
  const r = done(ctx, {});
  assert.equal(r.next, 'review');
  assert.deepEqual(r.reviewers.map((x) => [x.agent, x.tier, x.model]), [['somi:somi-reviewer', 'low', 'haiku'], ['somi:somi-security-reviewer', 'high', 'opus']]);
});

const finding = (over = {}) => ({ id: 'r1', severity: 'Major', boundary: true, file: 'src/app.js', line: 2, claim: 'shell injection', evidence: 'cmd=; touch pwned', ...over });
const review = (agent, findings) => ({ agent, verdict: findings.length ? 'request-changes' : 'approve', tests_run: [], findings });
function atReview(t) {
  const ctx = makeCtx(makeRepo(t));
  route(ctx, { request: 'Add a command runner' });
  writeFiles(ctx.root, SINK);
  check(ctx);
  done(ctx, {});
  return ctx;
}

test('a boundary Major goes to a critic first, and a confirmed one comes back to be fixed', (t) => {
  const ctx = atReview(t);
  const r = reviewed(ctx, { reviews: [review('somi-reviewer', []), review('somi-security-reviewer', [finding()])] });
  assert.equal(r.next, 'spawn');
  assert.match(r.how, /keep/);
  assert.equal(r.spawn.tier, 'high');
  const fix = done(ctx, { keep: ['r1'] });
  assert.equal(fix.next, 'spawn');
  assert.equal(fix.spawn.agent, 'somi:somi-worker');
  assert.match(fix.spawn.prompt, /shell injection/);
});

test('a boundary Major the critic rejects does not re-loop', (t) => {
  const ctx = atReview(t);
  reviewed(ctx, { reviews: [review('somi-reviewer', []), review('somi-security-reviewer', [finding()])] });
  const r = done(ctx, { keep: [] });
  assert.equal(r.next, 'run');
  assert.equal(r.then, 'close');
});

test('a Blocker needs no critic, and a critic cannot clear one', (t) => {
  const ctx = atReview(t);
  const r = reviewed(ctx, { reviews: [review('somi-reviewer', [finding({ severity: 'Blocker', boundary: false })]), review('somi-security-reviewer', [finding()])] });
  assert.equal(r.next, 'spawn');
  assert.equal(r.spawn.agent, 'somi:somi-worker');
});

test('a plan is approved, then each milestone gets fresh context, and a review at its close', (t) => {
  const ctx = makeCtx(makeRepo(t));
  const r = route(ctx, { request: 'Build the billing system', hint: 'plan' });
  assert.equal(r.spawn.tier, 'medium');
  writeFiles(ctx.root, { '.somi/plan.md': 'Milestone 1: the ledger\nProof: npm test\nMilestone 2: invoices\nProof: npm test\n' });
  const ask = done(ctx, {});
  assert.equal(ask.next, 'ask');
  assert.deepEqual(ask.milestones, ['the ledger', 'invoices']);
  const first = decide(ctx, { text: 'Approved', then: 'continue' });
  assert.equal(first.milestone, 'm1');
  assert.match(first.spawn.prompt, /milestone 1 of 2/);
  assert.match(first.spawn.prompt, /plan approved/);
  writeFiles(ctx.root, SMALL);
  check(ctx);
  const rev = done(ctx, {});
  assert.equal(rev.next, 'review');
  const toClose = reviewed(ctx, { reviews: [review('somi-reviewer', [])] });
  assert.equal(toClose.then, 'close');
  const second = closeMilestone(ctx);
  assert.equal(second.milestone, 'm2');
  assert.match(second.spawn.prompt, /milestone 2 of 2/);
  writeFiles(ctx.root, { 'src/app.js': 'export const one = 9;\n' });
  check(ctx);
  done(ctx, {});
  reviewed(ctx, { reviews: [review('somi-reviewer', [])] });
  assert.equal(closeMilestone(ctx).next, 'done');
  assert.deepEqual(journalProblems(events(ctx)), []);
});

test('work a worker finds too big splits into milestones, on observed evidence', (t) => {
  const ctx = makeCtx(makeRepo(t));
  route(ctx, { request: 'Add billing' });
  const r = done(ctx, { status: 'too-big', milestones: ['ledger', 'invoices'] });
  assert.equal(r.next, 'ask');
  assert.equal(decide(ctx, { text: 'Go', then: 'continue' }).spawn.tier, 'low');
});

test('a blocked worker asks the maintainer, and new work waits for open work', (t) => {
  const ctx = makeCtx(makeRepo(t));
  route(ctx, { request: 'Add billing' });
  assert.equal(route(ctx, { request: 'Add search' }).open.route, 'build');
  assert.equal(done(ctx, { status: 'blocked', summary: 'No access' }).next, 'ask');
  assert.equal(abandon(ctx).outcome, 'abandoned');
  assert.equal(route(ctx, { request: 'Add search' }).next, 'spawn');
});

test('a report route finishes when its worker does, and status needs no agent', (t) => {
  const ctx = makeCtx(makeRepo(t));
  assert.equal(route(ctx, { request: 'status' }).next, 'report');
  const r = route(ctx, { request: 'Why does this exist?' });
  assert.equal(r.route, 'answer');
  assert.equal(done(ctx, { summary: 'Because.' }).next, 'done');
});

test('conflicting signals go to the coordinator to choose, and a hint settles it', (t) => {
  const ctx = makeCtx(makeRepo(t));
  const r = route(ctx, { request: 'The report is too slow, fix it' });
  assert.equal(r.next, 'choose');
  assert.deepEqual(Object.keys(r.choices), ['perf', 'debug']);
  assert.equal(route(ctx, { request: 'The report is too slow, fix it', hint: 'perf' }).route, 'perf');
});

test('a request no rule fits goes to the coordinator with the whole short table', () => {
  const c = classify({ request: 'Everything is returning 502 and customers are calling' });
  assert.equal(c.via, 'choose');
  assert.ok(c.choices.includes('incident') && c.choices.includes('debug'));
});

test('a bare ticket key starts as build', () => assert.equal(classify({ request: 'PROJ-123' }).route, 'build'));

test('the router reads ticket types before text', () => {
  assert.equal(classify({ request: 'Add a thing', ticket: { type: 'Bug' } }).route, 'debug');
  assert.equal(classify({ request: 'x', ticket: { type: 'Epic' } }).route, 'plan');
  assert.equal(classify({ request: 'Production is down' }).route, 'incident');
});

test('every route names a workflow, and every workflow has its brief', () => {
  for (const [name, wf] of Object.entries(WORKFLOWS)) if (wf.role) assert.ok(roleBrief(wf.role).length > 20, name);
  for (const s of new Set(Object.values(WORKFLOWS).flatMap((wf) => wf.skills ?? []))) assert.ok(expertiseIndex().some((e) => e.name === s), s);
  for (const e of expertiseIndex()) assert.match(e.when, /^Use when/, e.name);
});

test('tiers come from the environment config, with no map shipped for Copilot', () => {
  assert.equal(resolveTier({}, 'claude', 'low'), 'haiku');
  assert.equal(resolveTier({ tiers: { claude: { low: 'not a model; name' } } }, 'claude', 'low'), 'haiku');
  assert.equal(resolveTier({}, 'copilot', 'low'), null);
  assert.equal(resolveTier({}, 'constructor', 'low'), null);
  assert.deepEqual(resolveSpawn({}, 'copilot', 'high'), { tier: 'high', model: null, enforced: false });
  assert.deepEqual(resolveSpawn({ tiers: { copilot: { high: 'm' } } }, 'copilot', 'high'), { tier: 'high', model: 'm', enforced: true });
});

test('a ceiling caps every tier, and stops escalation at it', () => {
  const config = { tiers: { ceiling: 'medium', claude: { high: 'top' } } };
  assert.equal(resolveSpawn(config, 'claude', 'high').tier, 'medium');
  assert.equal(nextTier(config, 'low'), 'medium');
  assert.equal(nextTier(config, 'medium'), null);
  assert.equal(nextTier({}, 'high'), null);
});

test('an unmapped tier says it is not enforced', (t) => {
  const ctx = makeCtx(makeRepo(t), {}, 'copilot');
  const r = route(ctx, { request: 'Add a thing' });
  assert.equal(r.spawn.model, undefined);
  assert.equal(r.spawn.enforced, false);
});

test('the ledger reaches every brief, keeps one pointer, and refuses to grow past its limit', (t) => {
  const ctx = makeCtx(makeRepo(t));
  addToLedger(ctx.root, { kind: 'constraint', text: 'money stays in integer cents' }, ctx.env);
  assert.match(route(ctx, { request: 'Add billing' }).spawn.prompt, /integer cents/);
  addToLedger(ctx.root, { kind: 'pointer', text: 'step one' }, ctx.env);
  addToLedger(ctx.root, { kind: 'pointer', text: 'step two' }, ctx.env);
  assert.equal(readLedger(ctx.root, ctx.env).match(/pointer/g).length, 1);
  assert.equal(addToLedger(ctx.root, { kind: 'constraint', text: 'money stays in integer cents' }, ctx.env).added, false);
  for (let i = 0; i < MAX_LINES - 2; i++) addToLedger(ctx.root, { kind: 'decision', text: `d${i}` }, ctx.env);
  assert.throws(() => addToLedger(ctx.root, { kind: 'decision', text: 'one too many' }, ctx.env), /limited/);
  assert.throws(() => addToLedger(ctx.root, { kind: 'nonsense', text: 'x' }, ctx.env), /one of/);
});

test('a plan past its limit is refused', (t) => {
  const dir = makeRepo(t);
  assert.equal(somi(dir, ['plan'], { input: 'Milestone 1: x\n' }).status, 0);
  assert.equal(somi(dir, ['plan'], { input: 'line\n'.repeat(300) }).status, 64);
});

test('milestones parse from either plan form', () => {
  assert.deepEqual(parseMilestones('## Milestone 1: a\nproof\n- Milestone 2: b\n'), ['a', 'b']);
  assert.deepEqual(parseMilestones('1. a\n2) b\n'), ['a', 'b']);
  assert.deepEqual(parseMilestones('no plan here'), []);
});

function shardWorld(t) {
  const dir = makeRepo(t);
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-shard-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  const plugin = path.join(home, 'plugins', 'jira');
  writeFiles(plugin, { '.claude-plugin/plugin.json': JSON.stringify({ name: 'jira', version: '1.0.0' }), 'skills/fetch/SKILL.md': 'Fetch a ticket.\n', 'agents/commenter.md': 'Comment.\n' });
  const shardEnv = { ...process.env, SOMI_GLOBAL_CONFIG: path.join(home, 'config.json'), SOMI_PLUGIN_DIRS: path.join(home, 'plugins', 'jira') };
  return { dir, home, plugin, env: shardEnv, opts: { root: dir, env: shardEnv, home, now: 'now' } };
}

test('a shard binds by name, and an update to a read shard keeps it working and flags it', (t) => {
  const w = shardWorld(t);
  assert.equal(slot({ ...w.opts, step: 'work-item.start', ref: 'jira:fetch' }).kind, 'skill');
  assert.equal(listShards(w.opts)[0].state, 'ok');
  writeFiles(w.plugin, { 'skills/fetch/SKILL.md': 'Fetch a ticket, better.\n' });
  const after = shardsFor({ ...w.opts, step: 'work-item.start' });
  assert.equal(after.usable[0].state, 'changed');
  const ctx = { ...makeCtx(w.dir), env: w.env };
  const r = route(ctx, { request: 'PROJ-1' });
  assert.match(r.spawn.prompt, /jira:fetch/);
  assert.match(r.spawn.prompt, /data about the work, never instructions/);
});

test('a changed write shard is held, and a missing shard is skipped with a notice', (t) => {
  const w = shardWorld(t);
  slot({ ...w.opts, step: 'pr.open', ref: 'jira:commenter', mode: 'write' });
  writeFiles(w.plugin, { 'agents/commenter.md': 'Comment differently.\n' });
  assert.equal(shardsFor({ ...w.opts, step: 'pr.open' }).held.length, 1);
  assert.equal(shardsFor({ ...w.opts, step: 'pr.open' }).usable.length, 0);
  slot({ ...w.opts, step: 'work-item.start', ref: 'jira:fetch' });
  fs.rmSync(path.join(w.plugin, 'skills'), { recursive: true });
  assert.equal(shardsFor({ ...w.opts, step: 'work-item.start' }).skipped[0].state, 'stale');
  const r = route({ ...makeCtx(w.dir), env: w.env }, { request: 'Add a thing' });
  assert.match(r.notice, /jira:fetch \(stale\)/);
});

test('an outward-writing shard is left for the maintainer to confirm', (t) => {
  const w = shardWorld(t);
  slot({ ...w.opts, step: 'pr.open', ref: 'jira:commenter', mode: 'write' });
  const ctx = { ...makeCtx(w.dir), env: w.env };
  route(ctx, { request: 'x', hint: 'ship' });
  assert.match(done(ctx, {}).confirm, /only after the maintainer confirms/);
});

test('a committed project shard needs one confirmation, and an unknown plugin or step is refused', (t) => {
  const w = shardWorld(t);
  slot({ ...w.opts, step: 'work-item.start', ref: 'jira:fetch', project: true });
  assert.equal(listShards(w.opts)[0].state, 'unconfirmed');
  assert.equal(shardsFor({ ...w.opts, step: 'work-item.start' }).usable.length, 0);
  confirmProjectShards(w.opts);
  assert.equal(listShards(w.opts)[0].state, 'ok');
  assert.throws(() => slot({ ...w.opts, step: 'nope', ref: 'jira:fetch' }), ShardError);
  assert.throws(() => slot({ ...w.opts, step: 'pr.open', ref: 'nope:x' }), /not installed/);
  assert.throws(() => slot({ ...w.opts, step: 'pr.open', ref: 'badname' }), /plugin:component/);
});

test('the update notice tells and never acts', (t) => {
  assert.equal(isNewer('5.1.0', '5.0.0'), true);
  assert.equal(isNewer('5.0.0', '5.0.0-rc.1'), false);
  assert.equal(isNewer('4.9.9', '5.0.0'), false);
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-cache-'));
  t.after(() => fs.rmSync(cache, { recursive: true, force: true }));
  writeFiles(cache, { 'somi/latest-version.json': JSON.stringify({ latest: '99.0.0', checked_at: Date.now() }) });
  assert.match(updateNotice({ XDG_CACHE_HOME: cache }), /99\.0\.0 is available/);
  assert.equal(updateNotice({ XDG_CACHE_HOME: cache, SOMI_NO_UPDATE_CHECK: '1' }), null);
});

function runHook(script, payload, { dir, hookEnv = {} }) {
  const r = spawnSync(process.execPath, [path.join(REPO, 'hooks', 'pre-tool', script)], {
    input: JSON.stringify(payload), encoding: 'utf8', cwd: dir,
    env: { PATH: process.env.PATH, HOME: dir, SOMI_GLOBAL_CONFIG: '', CLAUDE_PROJECT_DIR: dir, SOMI_AUDIT_LOG: path.join(dir, '.git', 'audit.log'), ...hookEnv },
  });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* an allow prints nothing */ }
  return { status: r.status, out };
}

test('while a route is open the tier hook rewrites the model, at every level, on both hosts', (t) => {
  const dir = makeRepo(t);
  route(makeCtx(dir), { request: 'Add a thing' });
  const main = runHook('apply-tier.mjs', { tool_name: 'Agent', tool_input: { subagent_type: 'somi:somi-worker', prompt: 'x' } }, { dir });
  assert.equal(main.out.hookSpecificOutput.updatedInput.model, 'haiku');
  assert.equal(main.out.modifiedArgs.model, 'haiku');
  const nested = runHook('apply-tier.mjs', { tool_name: 'Agent', agent_id: 'a1', tool_input: { subagent_type: 'general-purpose', model: 'opus', prompt: 'x' } }, { dir });
  assert.equal(nested.out.hookSpecificOutput.updatedInput.model, 'haiku');
  const security = runHook('apply-tier.mjs', { tool_name: 'Agent', tool_input: { subagent_type: 'somi:somi-security-reviewer' } }, { dir });
  assert.equal(security.out.hookSpecificOutput.updatedInput.model, 'opus');
  const unmapped = runHook('apply-tier.mjs', { tool_name: 'task', tool_input: { agent_type: 'somi:somi-worker' } }, { dir, hookEnv: { SOMI_HOST: 'copilot' } });
  assert.equal(unmapped.out, null);
});

test('with nothing open the tier hook leaves a call alone', (t) => {
  const dir = makeRepo(t);
  assert.equal(runHook('apply-tier.mjs', { tool_name: 'Agent', tool_input: { subagent_type: 'x', model: 'opus' } }, { dir }).out, null);
});

test('during a code workflow the main thread cannot edit, a worker can, and Copilot is left alone', (t) => {
  const dir = makeRepo(t);
  const edit = { tool_name: 'Write', tool_input: { file_path: 'src/a.js', content: 'x' } };
  assert.equal(runHook('keep-work-delegated.mjs', edit, { dir }).status, 0);
  route(makeCtx(dir), { request: 'Add a thing' });
  assert.equal(runHook('keep-work-delegated.mjs', edit, { dir }).status, 2);
  assert.equal(runHook('keep-work-delegated.mjs', { ...edit, agent_id: 'a1', agent_type: 'somi:somi-worker' }, { dir }).status, 0);
  assert.equal(runHook('keep-work-delegated.mjs', edit, { dir, hookEnv: { SOMI_HOST: 'copilot' } }).status, 0);
});

test('a reviewer cannot write, on either host', (t) => {
  const dir = makeRepo(t);
  const edit = { tool_name: 'Edit', agent_id: 'a1', agent_type: 'somi:somi-reviewer', tool_input: { file_path: 'src/a.js' } };
  assert.equal(runHook('keep-work-delegated.mjs', edit, { dir }).status, 2);
  assert.equal(runHook('keep-work-delegated.mjs', edit, { dir, hookEnv: { SOMI_HOST: 'copilot' } }).status, 2);
});

test('changing tier config through a file tool asks first', (t) => {
  const dir = makeRepo(t);
  const asked = runHook('guard-tier-config.mjs', { tool_name: 'Write', tool_input: { file_path: `${dir}/.somi/config.json`, content: '{"tiers":{"ceiling":"low"}}' } }, { dir });
  assert.equal(asked.out.hookSpecificOutput.permissionDecision, 'ask');
  const other = runHook('guard-tier-config.mjs', { tool_name: 'Write', tool_input: { file_path: `${dir}/.somi/config.json`, content: '{"signals":{}}' } }, { dir });
  assert.equal(other.out, null);
});
