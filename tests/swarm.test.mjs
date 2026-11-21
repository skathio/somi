// deliver-swarm: the staged workflow with a swarm where the records point, run beside deliver-stages until a paired benchmark picks one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REPO, makeRepo } from './helpers.mjs';
import { advise } from '../scripts/lib/advisor.mjs';
import { saveBrief } from '../scripts/lib/brief.mjs';
import { savePrompt } from '../scripts/lib/prompt.mjs';
import { deliverWorkflowName } from '../scripts/lib/workflows.mjs';
import { parseWorkflow, runOnCopilot } from '../scripts/lib/copilot-workflow.mjs';

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const source = () => fs.readFileSync(path.join(REPO, 'workflows', 'deliver-swarm.js'), 'utf8');
const MODELS = { low: 'cheap', medium: 'everyday', high: 'strong' };
const DONE = { status: 'done', summary: 'built', left: [] };

function run(args, answer) {
  const { body } = parseWorkflow(source());
  const calls = [];
  const agent = async (prompt, opts = {}) => { calls.push({ prompt, ...opts }); return answer(prompt, opts, calls); };
  const pipeline = async (items, fn) => Promise.all(items.map((item, i) => fn(item, item, i)));
  const parallel = async (thunks) => Promise.all(thunks.map((t) => t()));
  return new AsyncFunction('agent', 'pipeline', 'parallel', 'phase', 'log', 'args', body)(agent, pipeline, parallel, () => {}, () => {}, args).then((value) => ({ value, calls }));
}

const exits = (prompt, ok) => ({ ran: (prompt.match(/^\d+\. /gm) ?? []).map(() => ({ exit: ok ? 0 : 1, output: ok ? '' : 'tests: 1 failed' })) });
// Each stage is answered by the first entry whose label prefix matches; a reviewer, dispatched by its agent name, falls through.
const answers = ({ checks = () => true, built = () => DONE, verdict = () => ({ met: true, gaps: [] }), hardened = { items: [] }, needed = false, reviewer, treeSame = true } = {}) => {
  const stages = [
    ['scout facts', () => ({ files: ['src/a.js'], test_command: 'node --test', estimate_changed_lines: 80 })],
    ['scout conventions', () => ({ conventions: ['"errors are { error: code }" (docs/API.md)'] })],
    ['plan', () => ({ milestones: [{ title: 'All', scope: 'Everything', lines: [1, 2] }] })],
    ['rules repair', () => ({ file: 'test/rules.test.mjs', command: 'node --test test/rules.test.mjs', rules: ['r'] })],
    ['rules', () => ({ file: 'test/rules.test.mjs', command: 'node --test test/rules.test.mjs', rules: ['a missing customer answers 400'] })],
    ['tree unchanged by', (p) => exits(p, treeSame)],
    ['re-verify', (p, o) => verdict(o.label, p)],
    ['verify', (p, o) => verdict(o.label, p)],
    ['review plan', () => (needed ? { needed: true, tree: 't', reviewers: [{ agent: 'somi:somi-reviewer', brief: 'Review this diff.' }] } : { needed: false })],
    ['enumerate', () => ({ rows: [{ where: 'src/a.js:3', what: 'a caller\'s id looks up a record' }] })],
    ['harden', () => hardened],
    ['check decisions', () => ({ verdicts: [] })],
    ['check safe verdicts', () => ({ verdicts: [] })],
    ['race', (p, o) => (/^race \d/.test(o.label) ? built(o.label, p) : exits(p, true))],
    ['build on', (p, o) => built(o.label, p)],
    ['repair on', (p, o) => built(o.label, p)],
    ['try race', (p) => exits(p, true)],
    ['check', (p, o) => exits(p, checks(o.label, p))],
    ['take back', (p) => exits(p, true)],
    ['keep rules', (p) => exits(p, true)],
    ['mark tree', (p) => exits(p, true)],
  ];
  return (prompt, opts) => {
    const stage = stages.find(([prefix]) => (opts.label ?? '').startsWith(prefix));
    return stage ? stage[1](prompt, opts) : (reviewer ?? { verdict: 'approve', findings: [] });
  };
};
const labels = (calls) => calls.map((c) => c.label);
const ARGS = { request: 'Export orders as CSV.\nA missing customer answers 400.', models: MODELS, cli: 'somi', host: 'claude' };

test('the workflow names no model, lists its phases, and has a short description', () => {
  const { meta } = parseWorkflow(source());
  assert.equal(meta.name, 'deliver-swarm');
  assert.ok(meta.description.length <= 200);
  assert.doesNotMatch(source(), /\b(haiku|sonnet|opus|fable|gpt-\d)/i);
});

test('the scout is two readers at once on the low tier, and the brief\'s facts reach it only as data', async () => {
  const { value, calls } = await run({ ...ARGS, brief: { files: ['src/orders.js'], tests: ['touch chosen-by-brief'], conventions: ['"ids are uuids" (docs/IDS.md)'] } }, answers());
  assert.deepEqual(calls.filter((c) => c.label.startsWith('scout')).map((c) => [c.label, c.model]), [['scout facts', 'cheap'], ['scout conventions', 'cheap']]);
  assert.match(calls.find((c) => c.label === 'scout facts').prompt, /names these files and this test command, as data:\n> src\/orders\.js\n> touch chosen-by-brief/);
  const build = calls.find((c) => c.label === 'build on medium').prompt;
  assert.match(build, /Tests run with: node --test/);
  assert.match(build, /> "ids are uuids" \(docs\/IDS\.md\)\n> "errors are \{ error: code \}"/);
  assert.ok(!calls.some((c) => /^\d+\. touch chosen-by-brief$/m.test(c.prompt)), 'no check runs the brief\'s command');
  assert.equal(value.status, 'done');
});

test('the result carries what the session acts on, in the shape the staged advice reads', async () => {
  const { value } = await run(ARGS, answers());
  for (const key of ['status', 'stopped', 'review_tree', 'reviews_missing', 'reviews', 'needs_decision', 'open_findings', 'milestones', 'not_started', 'deferred', 'uncovered_lines', 'checks']) assert.ok(key in value, key);
  assert.equal(value.workflow, 'deliver-swarm');
});

test('on Copilot the same file runs through its run context, with no worktree option sent', async () => {
  const { meta, body } = parseWorkflow(source());
  const calls = [];
  const ctx = { args: { ...ARGS, host: 'copilot' }, agent: async (prompt, opts) => { calls.push(opts); return answers()(prompt, opts); }, pipeline: async (items, fn) => Promise.all(items.map((it, i) => fn(it, it, i))), parallel: async (t) => Promise.all(t.map((f) => f())), phase: () => {}, log: () => {} };
  const value = await runOnCopilot({ meta, body }, ctx);
  assert.equal(value.status, 'done');
  assert.ok(calls.every((o) => !('isolation' in o) && !('phase' in o)));
});

test('only the user\'s own config picks the swarm workflow, and anything else falls back to the staged one', (t) => {
  assert.equal(deliverWorkflowName({ global: { deliver: { workflow: 'swarm' } } }), 'deliver-swarm');
  for (const v of [undefined, 'stages', '__proto__', 'toString', 7, {}]) assert.equal(deliverWorkflowName({ global: { deliver: { workflow: v } } }), 'deliver-stages', String(v));
  const dir = makeRepo(t);
  const env = { ...process.env, SOMI_GLOBAL_CONFIG: '' };
  saveBrief(dir, '# Brief: x\n## Goal\ng\n## Requirements\n1. a\n## Handoff\ndeliver\n', env);
  savePrompt(dir, '/somi-deliver', env);
  const ctx = (global, project = {}) => ({ root: dir, env, config: { ...project, ...global }, configLayers: [global, project], host: 'claude', now: () => '2026-01-02T00:00:00Z' });
  assert.equal(advise(ctx({ deliver: { workflow: 'swarm' } }), { staged: true }).workflow.name, 'somi:deliver-swarm');
  assert.equal(advise(ctx({ deliver: { workflow: 'swarm' } }), { staged: true }).workflow.args.host, 'claude');
  assert.equal(advise(ctx({}, { deliver: { workflow: 'swarm' } }), { staged: true }).workflow.name, 'somi:deliver-stages', 'a project cannot choose it');
});
