// Routing as advice: what each request should run as, at which tier and where, with no state and no refusal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO, makeRepo, somi, writeFiles } from './helpers.mjs';
import { advise } from '../scripts/lib/advisor.mjs';
import { addToLedger, readLedger, MAX_LINES } from '../scripts/lib/ledger.mjs';
import { closePlan, markMilestoneDone, parseMilestones, planStatus, savePlan } from '../scripts/lib/plan.mjs';
import { classify } from '../scripts/lib/routes.mjs';
import { MAX_HISTORY, MAX_HISTORY_BYTES, earlierPrompts, fit, readPrompt, savePrompt } from '../scripts/lib/prompt.mjs';
import { setupAgent } from '../scripts/lib/setup.mjs';
import { listShards, shardsFor, slot, confirmProjectShards, ShardError } from '../scripts/lib/shards.mjs';
import { mainTier, resolveSpawn, resolveTier } from '../scripts/lib/tiers.mjs';
import { isNewer, updateNotice } from '../scripts/lib/update-notice.mjs';
import { expertiseIndex, roleBrief, tierForReviewer, tierForWorker, WORKFLOWS } from '../scripts/lib/workflows.mjs';

const briefOf = (r) => r.steps.find((s) => s.brief)?.brief;
const env = { ...process.env, SOMI_GLOBAL_CONFIG: '' };
const makeCtx = (dir, config = {}, host = 'claude') => ({ root: dir, env, config, configLayers: [config], host, now: () => '2026-01-02T00:00:00Z' });
// Large work: a request long enough to be a whole piece of work, which is what goes down a tier.
const BIG = `Add a helper that doubles a number. ${'It takes one number, returns twice it, and rejects anything that is not a finite number. '.repeat(8)}`;

test('the conversation runs on medium and does small work itself, since a hand-off costs more than the work', (t) => {
  const r = advise(makeCtx(makeRepo(t)), { request: 'Add a helper that doubles a number' });
  assert.equal(mainTier({}), 'medium');
  assert.equal(r.route, 'build');
  assert.equal(r.tier, 'low');
  assert.equal(r.where, 'here');
  assert.equal(r.worker, undefined);
  assert.deepEqual(r.steps.map((s) => [s.step, s.run_on]), [['build', 'main'], ['review', 'subagent']]);
});

test('large work that is not sensitive goes down to a low worker with a brief SoMi built', (t) => {
  const r = advise(makeCtx(makeRepo(t)), { request: BIG });
  assert.equal(r.route, 'build');
  assert.equal(r.tier, 'low');
  assert.equal(r.where, 'worker');
  assert.equal(r.worker.agent, 'somi:somi-worker-low');
  assert.equal(r.worker.model, 'haiku');
  assert.equal(r.workflow, undefined, 'only the user starts the staged workflow');
  assert.match(r.advice, /typing \/somi:deliver/, 'so SoMi tells the agent to offer it');
  assert.match(r.advice, /cheaper on that tier/);
  const copilot = advise(makeCtx(makeRepo(t), {}, 'copilot'), { request: BIG });
  assert.equal(copilot.workflow, undefined);
  assert.match(copilot.advice, /cheaper on that tier/);
  assert.match(copilot.advice, /brief unchanged/);
  assert.deepEqual(r.steps.map((s) => [s.step, s.run_on, s.tier ?? null]), [['build', 'subagent', 'low'], ['review', 'subagent', null]]);
  assert.match(copilot.advice, /no requirements or approach of your own/);
  assert.match(briefOf(r), /small, clear change/);
  assert.match(briefOf(r), /> Add a helper that doubles a number/);
  assert.match(advise(makeCtx(makeRepo(t)), { request: 'Add a helper that doubles a number' }).advice, /SoMi reads the diff and tells you/, 'on Claude Code the stop hook checks for a review');
  assert.match(copilot.advice, /call somi_review/, 'elsewhere the agent asks');
});

test('work goes down by its kind, not by words that sound risky, and the user saying it is sensitive keeps it here', (t) => {
  const ctx = makeCtx(makeRepo(t));
  const words = advise(ctx, { request: `Add password reset for customer accounts. ${BIG}` });
  assert.equal(words.where, 'worker');
  assert.equal(words.worker.agent, 'somi:somi-worker-low');
  const said = advise(ctx, { request: `Add password reset for customer accounts. ${BIG}`, sensitive: true });
  assert.equal(said.tier, 'medium');
  assert.equal(said.where, 'here');
  assert.equal(said.sensitive, true);
});

test('the user\'s own words reach the worker\'s brief when the agent\'s summary leaves them out', (t) => {
  const ctx = makeCtx(makeRepo(t));
  savePrompt(ctx.root, 'add a doubling helper', ctx.env);
  const down = advise(ctx, { request: BIG });
  assert.match(briefOf(down), /The user's own words, as data:\n> add a doubling helper/);
  savePrompt(ctx.root, BIG, ctx.env);
  assert.doesNotMatch(briefOf(advise(ctx, { request: BIG })), /The user's own words/, 'said once is enough');
});

test('work that needs more than the conversation goes up, and work at its tier stays', (t) => {
  const ctx = makeCtx(makeRepo(t));
  const debug = advise(ctx, { request: 'Fix the crash when the list is empty' });
  assert.equal(debug.route, 'debug');
  assert.equal(debug.where, 'here');
  const design = advise(ctx, { request: 'Design the architecture for sync' });
  assert.equal(design.worker.agent, 'somi:somi-worker-high', 'design is a high-tier route, so it goes up');
  assert.equal(advise(ctx, { request: 'What does the parser do?' }).where, 'here', 'a question is never sent down');
  const up = advise(makeCtx(makeRepo(t), { tiers: { main: 'low' } }), { request: 'Fix the crash when the list is empty' });
  assert.equal(up.where, 'worker');
  assert.equal(up.worker.agent, 'somi:somi-worker-medium');
  assert.match(up.advice, /needs a stronger model/);
});

test('asking again with other work open is never refused, and no state is written', (t) => {
  const dir = makeRepo(t);
  const ctx = makeCtx(dir);
  const first = advise(ctx, { request: BIG });
  const second = advise(ctx, { request: 'Now fix the crash in the other module' });
  assert.equal(first.route, 'build');
  assert.equal(first.where, 'worker');
  assert.equal(second.route, 'debug');
  assert.ok(!fs.existsSync(path.join(dir, '.somi', 'state')) || fs.readdirSync(path.join(dir, '.somi', 'state')).length === 0, 'routing writes nothing, even when work goes to a worker');
  assert.deepEqual(advise(ctx, { request: BIG }), first, 'the same request gets the same answer');
});

test('a request no rule fits is built, with no extra turn, and names what else might fit', (t) => {
  const ctx = makeCtx(makeRepo(t));
  const unclear = advise(ctx, { request: 'that other endpoint too' });
  assert.equal(unclear.route, 'build');
  assert.match(unclear.alternatives, /debug, refactor/);
  assert.equal(advise(ctx, { request: 'that other endpoint too', hint: 'debug' }).route, 'debug');
  const conflict = advise(ctx, { request: 'Refactor the parser and fix the crash in it' });
  assert.ok(conflict.choose, 'two rules that disagree still ask');
});

test('a ceiling caps the conversation and every worker', (t) => {
  const dir = makeRepo(t);
  assert.equal(mainTier({ tiers: { main: 'low' } }), 'low');
  assert.equal(mainTier({ tiers: { main: 'nonsense' } }), 'medium');
  assert.equal(mainTier({ tiers: { main: 'high', ceiling: 'medium' } }), 'medium');
  const capped = advise(makeCtx(dir, { tiers: { ceiling: 'low' } }), { request: 'Add password reset', sensitive: true });
  assert.equal(capped.tier, 'low');
  assert.equal(capped.where, 'here');
});

test('with no model set on Copilot the answer says so instead of pretending', (t) => {
  const r = advise(makeCtx(makeRepo(t), {}, 'copilot'), { request: BIG });
  assert.equal(r.worker.model, undefined);
  assert.match(r.note, /No model is set/);
  const set = { tiers: { copilot: { low: 'm-low' } } };
  assert.equal(advise(makeCtx(makeRepo(t), set, 'copilot'), { request: BIG }).worker.model, 'm-low');
});

test('each workflow comes back as steps that say where each runs and on which tier', (t) => {
  const ctx = makeCtx(makeRepo(t));
  const debug = advise(ctx, { request: 'Fix the crash when the list is empty' });
  assert.deepEqual(debug.steps.map((s) => [s.step, s.run_on, s.tier ?? null]), [['reproduce', 'main', 'medium'], ['fix', 'main', 'medium'], ['review', 'subagent', null]]);
  assert.match(debug.steps[2].how, /when your turn ends/);
  assert.match(advise(makeCtx(makeRepo(t), {}, 'copilot'), { request: 'Fix the crash when the list is empty' }).steps[2].how, /somi_review/);
  const lowMain = advise(makeCtx(makeRepo(t), { tiers: { main: 'low' } }), { request: 'Fix the crash when the list is empty' });
  assert.deepEqual(lowMain.steps.map((s) => s.run_on), ['main', 'subagent', 'subagent'], 'the fix goes up when the conversation is cheaper than the work');
  assert.equal(advise(ctx, { request: 'x', hint: 'migrate' }).steps.at(-1).when, 'always');
  assert.deepEqual(advise(ctx, { request: 'x', hint: 'plan' }).steps.map((s) => s.step), ['plan', 'milestones', 'close']);
  const design = advise(ctx, { request: 'Design the architecture for sync' });
  assert.deepEqual(design.steps.map((s) => [s.step, s.run_on, s.tier]), [['design', 'subagent', 'high']]);
});

test('work the user sends with /somi:deliver runs as the staged workflow on either host, with the user\'s models in its args', (t) => {
  const ctx = makeCtx(makeRepo(t));
  const r = advise(ctx, { request: 'Add an export of all orders as CSV', staged: true });
  assert.equal(r.workflow.name, 'somi:deliver-stages');
  assert.deepEqual(r.workflow.args.models, { low: 'haiku', medium: 'sonnet', high: 'opus' });
  assert.equal(r.workflow.args.request, 'Add an export of all orders as CSV');
  assert.match(r.advice, /typed \/somi:deliver[\s\S]*Workflow tool[\s\S]*follow steps instead/);
  assert.match(r.advice, /no script and no authoring guide/);
  assert.match(r.advice, /do not read or check the work again/, 'the conversation relays; the workflow ran the checks');
  const copilot = advise(makeCtx(makeRepo(t), { tiers: { copilot: { low: 'm-low' } } }, 'copilot'), { request: 'Add an export of all orders as CSV', staged: true });
  assert.equal(copilot.workflow.name, 'somi-deliver-stages', 'the name the Copilot extension registers');
  assert.deepEqual(copilot.workflow.args.models, { low: 'm-low' });
  assert.match(copilot.advice, /experimental mode/);
  assert.equal(advise(ctx, { request: 'What does the parser do?', staged: true }).workflow, undefined, 'a question is answered, not staged');
  assert.equal(advise(ctx, { request: 'Add a helper that doubles a number' }).workflow, undefined, 'small work stays light');
  assert.match(advise(ctx, { request: 'Refactor the parser and fix the crash in it', staged: true }).advice, /staged true/, 'asked to pick, the agent keeps the user\'s choice');
});

test('the rest of the routes answer without starting anything', (t) => {
  const ctx = makeCtx(makeRepo(t));
  assert.match(advise(ctx, { request: 'x', hint: 'ship' }).advice, /somi_pr/);
  assert.match(advise(ctx, { request: 'review this', hint: 'review' }).advice, /always true/);
  assert.match(advise(ctx, { request: 'x', hint: 'security-review' }).advice, /security true/);
  assert.equal(advise(ctx, { hint: 'config' }).host, 'claude');
  assert.equal(advise(ctx, { hint: 'expertise' }).skills.length, expertiseIndex().length);
  assert.match(advise(ctx, { hint: 'status' }).advice, /status/);
  assert.match(advise(ctx, { request: 'x', hint: 'migrate' }).advice, /always reviewed/);
  assert.match(advise(ctx, { request: 'x', hint: 'plan' }).advice, /wait for their approval/);
  assert.match(advise(ctx, { request: 'x', hint: 'plan' }).advice, /somi_plan/);
});

test('a bare ticket key starts as build, and ticket types are read before text', () => {
  assert.equal(classify({ request: 'PROJ-123' }).route, 'build');
  assert.equal(classify({ request: 'Add something', ticket: { type: 'Bug' } }).route, 'debug');
  assert.equal(classify({ request: 'x', ticket: { type: 'Epic' } }).route, 'plan');
});

test('a long ticket is not routed by stray words deep inside it', () => {
  const long = `Add a report page.\n${'Some detail about the page. '.repeat(40)}\nA failure or an incident here would be bad, and a security review may follow.`;
  assert.equal(classify({ request: long }).via, 'choose');
  assert.equal(classify({ request: long, hint: 'build' }).route, 'build');
  assert.equal(classify({ request: 'Add retries for the usual error' }).route, 'build');
  assert.equal(classify({ request: 'Plan first, then add a page' }).route, 'plan');
});

test('every route names a workflow, and every workflow has its role text', () => {
  for (const [name, wf] of Object.entries(WORKFLOWS)) if (wf.role) assert.ok(roleBrief(wf.role).length > 0, name);
});

test('tiers come from the environment config, with no map shipped for Copilot', () => {
  assert.equal(resolveTier({}, 'claude', 'low'), 'haiku');
  assert.equal(resolveTier({ tiers: { claude: { low: 'not a model; name' } } }, 'claude', 'low'), 'haiku');
  assert.equal(resolveTier({}, 'copilot', 'low'), null);
  assert.equal(resolveTier({}, 'constructor', 'low'), null);
  assert.deepEqual(resolveSpawn({}, 'copilot', 'high'), { tier: 'high', model: null, enforced: false });
  assert.deepEqual(resolveSpawn({ tiers: { copilot: { high: 'm' } } }, 'copilot', 'high'), { tier: 'high', model: 'm', enforced: true });
  assert.equal(resolveSpawn({ tiers: { ceiling: 'medium', claude: { high: 'top' } } }, 'claude', 'high').tier, 'medium');
});

test('the agent\'s name carries its tier', () => {
  assert.equal(tierForWorker('somi:somi-worker-medium'), 'medium');
  assert.equal(tierForWorker('somi-worker-high'), 'high');
  assert.equal(tierForWorker('general-purpose'), null);
  assert.equal(tierForWorker('constructor'), null);
  assert.equal(tierForReviewer('somi:somi-security-reviewer'), 'high');
  assert.equal(tierForReviewer('somi:somi-worker-low'), null);
});

test('the ledger comes back with a route, keeps one pointer, and refuses to grow past its limit', (t) => {
  const ctx = makeCtx(makeRepo(t));
  addToLedger(ctx.root, { kind: 'constraint', text: 'money stays in integer cents' }, ctx.env);
  assert.match(advise(ctx, { request: 'How does billing work?' }).ledger, /integer cents/);
  assert.match(briefOf(advise(ctx, { request: BIG })), /integer cents/, 'a worker gets the ledger in its brief');
  addToLedger(ctx.root, { kind: 'pointer', text: 'step one' }, ctx.env);
  addToLedger(ctx.root, { kind: 'pointer', text: 'step two' }, ctx.env);
  assert.equal(readLedger(ctx.root, ctx.env).match(/pointer/g).length, 1);
  assert.equal(addToLedger(ctx.root, { kind: 'constraint', text: 'money stays in integer cents' }, ctx.env).added, false);
  for (let i = 0; i < MAX_LINES - 2; i++) addToLedger(ctx.root, { kind: 'decision', text: `d${i}` }, ctx.env);
  assert.throws(() => addToLedger(ctx.root, { kind: 'decision', text: 'one too many' }, ctx.env), /limited/);
  assert.throws(() => addToLedger(ctx.root, { kind: 'nonsense', text: 'x' }, ctx.env), /one of/);
});

test('a plan is a plain file that says where the work has got to', (t) => {
  const dir = makeRepo(t);
  assert.equal(planStatus(dir), null);
  savePlan(dir, '# Billing\nMilestone 1: ledger\nProof: npm test\nMilestone 2: invoices\nProof: npm test\n');
  assert.deepEqual(planStatus(dir), { total: 2, done: 0, next: 'ledger' });
  assert.deepEqual(markMilestoneDone(dir, 1), { total: 2, done: 1, next: 'invoices' });
  assert.deepEqual(markMilestoneDone(dir, 1), { total: 2, done: 1, next: 'invoices' }, 'marking twice changes nothing');
  assert.deepEqual(markMilestoneDone(dir, 2), { total: 2, done: 2, next: null });
  assert.throws(() => markMilestoneDone(dir, 3), /no number 3/);
  assert.throws(() => markMilestoneDone(dir, Number('x')), /no number/);
  const ctx = makeCtx(dir);
  addToLedger(dir, { kind: 'decision', text: 'use postgres' }, ctx.env);
  closePlan(dir, ctx.env);
  assert.equal(planStatus(dir), null);
  assert.equal(readLedger(dir, ctx.env), '', 'decisions belong to the work they were made for');
});

test('a plan past its limit is refused, and a link at the plan\'s path is not followed', (t) => {
  const dir = makeRepo(t);
  assert.equal(somi(dir, ['plan'], { input: 'Milestone 1: x\n' }).status, 0);
  assert.equal(somi(dir, ['plan', '--done', '1']).json.done, 1);
  assert.equal(somi(dir, ['plan'], { input: 'line\n'.repeat(300) }).status, 64);
  fs.rmSync(path.join(dir, '.somi', 'plan.md'));
  fs.symlinkSync(path.join(dir, 'src', 'app.js'), path.join(dir, '.somi', 'plan.md'));
  assert.notEqual(somi(dir, ['plan'], { input: 'Milestone 1: x\n' }).status, 0);
  assert.equal(fs.readFileSync(path.join(dir, 'src', 'app.js'), 'utf8'), 'export const one = 1;\n');
  assert.equal(planStatus(dir), null);
});

test('milestones parse from either plan form', () => {
  assert.deepEqual(parseMilestones('## Milestone 1: a\nproof\n- Milestone 2: b\n'), ['a', 'b']);
  assert.deepEqual(parseMilestones('1. a\n2) b\n'), ['a', 'b']);
  assert.deepEqual(parseMilestones('no plan here'), []);
});

function setupWorld(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-setup-'));
  t.after(() => fs.rmSync(home, { recursive: true, force: true }));
  return { home, pluginRoot: REPO, env: { PATH: process.env.PATH } };
}

test('setup writes the session agent on the model the user chose, per host', (t) => {
  const w = setupWorld(t);
  const claude = setupAgent({ ...w, host: 'claude', config: {} });
  assert.equal(claude.written, true);
  assert.equal(claude.model, 'sonnet');
  assert.equal(claude.start, 'claude --agent somi-main');
  const text = fs.readFileSync(claude.file, 'utf8');
  assert.match(text, /^---\nname: somi-main\n/);
  assert.match(text, /\nmodel: sonnet\n/);
  assert.match(text, /call `somi_route` once/);
  assert.equal(path.relative(w.home, claude.file), '.claude/agents/somi-main.md');
  const copilot = setupAgent({ ...w, host: 'copilot', config: { tiers: { copilot: { low: 'a', medium: 'b' } } } });
  assert.equal(copilot.model, 'b');
  assert.equal(path.relative(w.home, copilot.file), '.copilot/agents/somi-main.agent.md');
  assert.match(copilot.warning, /tier high/);
});

test('setup says what to set when the host has no model, and does not touch a file that is not its own', (t) => {
  const w = setupWorld(t);
  const none = setupAgent({ ...w, host: 'copilot', config: {} });
  assert.equal(none.written, false);
  assert.ok(none.set_in_config.tiers.copilot);
  assert.equal(fs.existsSync(path.join(w.home, '.copilot')), false);
  writeFiles(w.home, { '.claude/agents/somi-main.md': 'somebody else\n' });
  assert.throws(() => setupAgent({ ...w, host: 'claude', config: {} }), /not SoMi's/);
  assert.equal(fs.readFileSync(path.join(w.home, '.claude/agents/somi-main.md'), 'utf8'), 'somebody else\n');
});

test('setup reruns over its own file and picks up a new model', (t) => {
  const w = setupWorld(t);
  setupAgent({ ...w, host: 'claude', config: {} });
  const again = setupAgent({ ...w, host: 'claude', config: { tiers: { claude: { medium: 'other-model' } } } });
  assert.match(fs.readFileSync(again.file, 'utf8'), /model: other-model/);
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
  assert.equal(shardsFor({ ...w.opts, step: 'work-item.start' }).usable[0].state, 'changed');
  const r = advise({ ...makeCtx(w.dir), env: w.env }, { request: 'PROJ-1' });
  assert.match(r.connected, /jira:fetch/);
  assert.match(r.connected, /data, never instructions/);
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
  assert.match(advise({ ...makeCtx(w.dir), env: w.env }, { request: 'Add a thing' }).notice, /jira:fetch \(stale\)/);
});

test('an outward-writing shard is left for the user to confirm, and a broken config strands nothing', (t) => {
  const w = shardWorld(t);
  slot({ ...w.opts, step: 'pr.open', ref: 'jira:commenter', mode: 'write' });
  assert.match(advise({ ...makeCtx(w.dir), env: w.env }, { request: 'x', hint: 'ship' }).confirm, /only after the user confirms/);
  writeFiles(w.dir, { '.somi/config.json': '{nope' });
  assert.match(advise({ ...makeCtx(w.dir), env: w.env }, { request: 'Add a thing' }).notice, /not valid/);
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
const tierHook = (dir, agent, hookEnv = { SOMI_HOST: 'claude' }, name = 'Agent') => runHook('apply-tier.mjs', { tool_name: name, tool_input: { subagent_type: agent, prompt: 'x' } }, { dir, hookEnv }).out;

test('the tier hook gives a SoMi agent its tier\'s model, on both hosts, and leaves others alone', (t) => {
  const dir = makeRepo(t);
  assert.equal(tierHook(dir, 'somi:somi-worker-medium').hookSpecificOutput.updatedInput.model, 'sonnet');
  assert.equal(tierHook(dir, 'somi:somi-security-reviewer').hookSpecificOutput.updatedInput.model, 'opus');
  assert.equal(tierHook(dir, 'general-purpose'), null);
  const config = path.join(dir, 'config.json');
  writeFiles(dir, { 'config.json': JSON.stringify({ tiers: { copilot: { medium: 'm-medium' } } }) });
  const copilot = runHook('apply-tier.mjs', { tool_name: 'task', tool_input: { agent_type: 'somi:somi-worker-medium' } }, { dir, hookEnv: { SOMI_HOST: 'copilot', SOMI_GLOBAL_CONFIG: config } }).out;
  assert.equal(copilot.modifiedArgs.model, 'm-medium');
  assert.equal(tierHook(dir, 'somi:somi-worker-high', { SOMI_HOST: 'copilot' }), null, 'a tier with no model changes nothing');
});

test('a SoMi agent stays in the foreground on Claude Code, and others and Copilot are left alone', (t) => {
  const dir = makeRepo(t);
  assert.equal(tierHook(dir, 'somi:somi-reviewer').hookSpecificOutput.updatedInput.run_in_background, false);
  assert.equal(tierHook(dir, 'general-purpose'), null);
  assert.equal(tierHook(dir, 'somi:somi-reviewer', { SOMI_HOST: 'copilot' }), null);
});

test('the tier hook keeps a project config from lowering a reviewer, but not from choosing a worker\'s model', (t) => {
  const dir = makeRepo(t);
  writeFiles(dir, { '.somi/config.json': JSON.stringify({ tiers: { ceiling: 'low', claude: { low: 'cheap-one', high: 'cheap-two' } } }) });
  assert.equal(tierHook(dir, 'somi:somi-security-reviewer').hookSpecificOutput.updatedInput.model, 'opus');
  assert.equal(tierHook(dir, 'somi:somi-worker-low').hookSpecificOutput.updatedInput.model, 'cheap-one');
});

test('hooks find the repository from a subfolder, so state stays in one place', (t) => {
  const dir = makeRepo(t);
  const sub = path.join(dir, 'pkg');
  fs.mkdirSync(sub);
  const r = spawnSync(process.execPath, [path.join(REPO, 'hooks', 'pre-tool', 'apply-tier.mjs')], {
    input: JSON.stringify({ tool_name: 'Agent', tool_input: { subagent_type: 'somi:somi-worker-low', prompt: 'x' } }), encoding: 'utf8', cwd: sub,
    env: { PATH: process.env.PATH, HOME: dir, SOMI_GLOBAL_CONFIG: '', CLAUDE_PROJECT_DIR: sub, SOMI_HOST: 'claude' },
  });
  assert.equal(JSON.parse(r.stdout).hookSpecificOutput.updatedInput.model, 'haiku');
  assert.equal(fs.existsSync(path.join(sub, '.somi')), false);
});

test('the main thread can always write, and a reviewer cannot, on either host', (t) => {
  const dir = makeRepo(t);
  const main = { tool_name: 'Edit', tool_input: { file_path: 'src/a.js' } };
  assert.equal(runHook('reviewers-read-only.mjs', main, { dir }).status, 0);
  assert.equal(runHook('reviewers-read-only.mjs', { ...main, agent_id: 'a1', agent_type: 'somi:somi-worker-medium' }, { dir }).status, 0);
  const reviewer = { ...main, agent_id: 'a1', agent_type: 'somi:somi-reviewer' };
  assert.equal(runHook('reviewers-read-only.mjs', reviewer, { dir }).status, 2);
  assert.equal(runHook('reviewers-read-only.mjs', reviewer, { dir, hookEnv: { SOMI_HOST: 'copilot' } }).status, 2);
});

test('changing tier config through a file tool asks first', (t) => {
  const dir = makeRepo(t);
  const asked = runHook('guard-tier-config.mjs', { tool_name: 'Write', tool_input: { file_path: `${dir}/.somi/config.json`, content: '{"tiers":{"ceiling":"low"}}' } }, { dir });
  assert.equal(asked.out.hookSpecificOutput.permissionDecision, 'ask');
  const other = runHook('guard-tier-config.mjs', { tool_name: 'Write', tool_input: { file_path: `${dir}/.somi/config.json`, content: '{"signals":{}}' } }, { dir });
  assert.equal(other.out, null);
});

test('session start brings back the ledger and an open plan, and says what to do when SoMi is not the agent', (t) => {
  const dir = makeRepo(t);
  const run = (payload) => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'hooks', 'session-start', 'inject-digest.mjs')], {
      input: JSON.stringify(payload), encoding: 'utf8', cwd: dir,
      env: { PATH: process.env.PATH, HOME: dir, SOMI_GLOBAL_CONFIG: '', CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_ROOT: REPO, SOMI_HOST: 'claude', SOMI_NO_UPDATE_CHECK: '1' },
    });
    return JSON.parse(r.stdout).additionalContext;
  };
  addToLedger(dir, { kind: 'constraint', text: 'money stays in integer cents' }, env);
  savePlan(dir, 'Milestone 1: a\nMilestone 2: b\n');
  markMilestoneDone(dir, 1);
  const text = run({ agent_type: 'somi:somi' });
  assert.match(text, /integer cents/);
  assert.match(text, /1 of 2 milestones done/);
  assert.doesNotMatch(text, /not the active agent/);
  assert.doesNotMatch(run({ agent_type: 'somi-main' }), /not the active agent/);
  assert.match(run({}), /somi setup/);
});

test('the prompt hook keeps the latest message, adds nothing, and writes nothing to a committed state folder', (t) => {
  const dir = makeRepo(t);
  const run = (payload, extra = {}) => spawnSync(process.execPath, [path.join(REPO, 'hooks', 'user-prompt', 'capture-prompt.mjs')], {
    input: JSON.stringify(payload), encoding: 'utf8', cwd: dir, env: { PATH: process.env.PATH, HOME: dir, CLAUDE_PROJECT_DIR: dir, SOMI_GLOBAL_CONFIG: '', ...extra },
  });
  const r = run({ hook_event_name: 'UserPromptSubmit', prompt: 'Customers upload bundles' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  assert.equal(readPrompt(dir, env), 'Customers upload bundles');
  run({ prompt: 'a later message' });
  assert.equal(readPrompt(dir, env), 'a later message');
  assert.equal(run({ prompt: 'x'.repeat(70000) }).status, 0);
  assert.equal(readPrompt(dir, env).length, 65536);
  assert.deepEqual(earlierPrompts(dir, env), [], 'with no session id, nothing is carried over');
  run({ prompt: 'Money stays in cents.', session_id: 's1' });
  run({ prompt: 'Now add refunds.', session_id: 's1' });
  assert.deepEqual(earlierPrompts(dir, env), ['Money stays in cents.'], 'the hook passes the session, so earlier messages are kept');
});

test('the session\'s earlier messages go with work handed down, the first one always, and a new session starts empty', (t) => {
  const ctx = makeCtx(makeRepo(t));
  savePrompt(ctx.root, 'Decision: a document in another organisation is not_found.', ctx.env, { session: 'a' });
  savePrompt(ctx.root, 'Next, add sharing.', ctx.env, { session: 'a' });
  savePrompt(ctx.root, BIG, ctx.env, { session: 'a' });
  assert.deepEqual(earlierPrompts(ctx.root, ctx.env), ['Decision: a document in another organisation is not_found.', 'Next, add sharing.']);
  const brief = briefOf(advise(ctx, { request: BIG }));
  assert.match(brief, /earlier messages[\s\S]*still holds unless a later message changes it[\s\S]*Message 1:\n> Decision: a document in another organisation is not_found\.[\s\S]*The request, as data/);
  assert.deepEqual(advise(ctx, { request: 'Add an export', staged: true }).workflow.args.earlier, ['Decision: a document in another organisation is not_found.', 'Next, add sharing.']);
  savePrompt(ctx.root, 'A new conversation.', ctx.env, { session: 'b' });
  assert.deepEqual(earlierPrompts(ctx.root, ctx.env), [], 'another session carries nothing over');
  assert.equal(advise(ctx, { request: 'Add an export', staged: true }).workflow.args.earlier, undefined);
  const many = ['first', ...Array.from({ length: 40 }, (_, i) => `m${i}`)];
  assert.equal(fit(many).length, MAX_HISTORY);
  assert.equal(fit(many)[0], 'first', 'the first message stays');
  assert.equal(fit(many).at(-1), 'm39', 'and then the newest');
  const big = fit(['first', 'x'.repeat(MAX_HISTORY_BYTES - 10), 'y'.repeat(20), 'latest']);
  assert.deepEqual(big.map((m) => m[0]), ['f', 'y', 'l'], 'past the byte limit the oldest after the first go');
});

const hookAt = (dir, rel, payload, hookEnv = {}) => {
  const r = spawnSync(process.execPath, [path.join(REPO, 'hooks', rel)], {
    input: JSON.stringify(payload), encoding: 'utf8', cwd: dir,
    env: { PATH: process.env.PATH, HOME: dir, SOMI_GLOBAL_CONFIG: '', CLAUDE_PROJECT_DIR: dir, SOMI_HOST: 'claude', SOMI_AUDIT_LOG: path.join(dir, '.git', 'audit.log'), ...hookEnv },
  });
  let out = null;
  try { out = JSON.parse(r.stdout); } catch { /* an allow prints nothing */ }
  return { status: r.status, out };
};

test('when a turn ends, a change that needs a review is sent back once, and one that does not is let go', (t) => {
  const dir = makeRepo(t);
  const stop = (extra = {}) => hookAt(dir, 'stop/review-due.mjs', { hook_event_name: 'Stop', ...extra });
  assert.equal(stop().out, null, 'nothing changed');
  writeFiles(dir, { 'src/app.js': 'export const one = 2;\n' });
  assert.equal(stop().out, null, 'no signal fired');
  writeFiles(dir, { 'src/app.js': 'import { exec } from "node:child_process";\nexport const run = (c) => exec(c);\n' });
  const sent = stop();
  assert.equal(sent.out.decision, 'block');
  assert.match(sent.out.reason, /needs a review.*sink/);
  assert.equal(stop().out, null, 'asked once for this tree, so it never loops');
  writeFiles(dir, { 'src/app.js': 'import { exec } from "node:child_process";\nexport const run = (c) => exec(`ls ${c}`);\n' });
  assert.equal(stop({ stop_hook_active: true }).out, null, 'a turn the hook already continued ends');
  assert.equal(hookAt(dir, 'stop/review-due.mjs', { hook_event_name: 'Stop' }, { SOMI_HOST: 'copilot' }).out, null);
  assert.equal(stop().out.decision, 'block', 'a new tree is a new question');
});
