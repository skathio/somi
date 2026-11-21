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

test('a passing build does not race, and the rules are written as tests on medium first and guarded by a copy', async () => {
  const { calls } = await run(ARGS, answers());
  assert.equal(calls.find((c) => c.label === 'rules').model, 'everyday');
  assert.ok(labels(calls).indexOf('rules') < labels(calls).indexOf('build on medium'));
  assert.match(calls.find((c) => c.label === 'keep rules').prompt, /^1\. cp -- 'test\/rules\.test\.mjs' "\$\(git rev-parse --git-common-dir\)\/somi-swarm-rules-test_rules\.test\.mjs"$/m);
  assert.match(calls.find((c) => c.label === 'check').prompt, /cmp -s -- 'test\/rules\.test\.mjs'/);
  assert.ok(!labels(calls).some((l) => /^race/.test(l)));
});

test('a failed check races three repairs in worktrees from a commit of the tree, and the first whose checks pass in the user\'s tree wins', async () => {
  let checks = 0;
  const { value, calls } = await run(ARGS, answers({ checks: (label) => !(label === 'check' && checks++ === 0) && label !== 'check race 1' }));
  const racers = calls.filter((c) => /^race \d/.test(c.label));
  assert.deepEqual(racers.map((c) => [c.label, c.model, c.isolation]), [['race 1 on medium', 'everyday', 'worktree'], ['race 2 on medium', 'everyday', 'worktree'], ['race 3 on high', 'strong', 'worktree']]);
  assert.equal(new Set(racers.map((c) => c.prompt.split('\n')[0])).size, 3, 'each racer has its own angle');
  assert.match(calls.find((c) => c.label === 'race base').prompt, /git commit-tree "\$t" -m 'somi race base' > "\$\(git rev-parse --git-common-dir\)\/somi-swarm-race-base"/);
  assert.ok(racers[0].prompt.includes('git diff --cached --binary "$(cat "$(git rev-parse --git-common-dir)/somi-swarm-race-base")" > "$(git rev-parse --git-common-dir)/somi-swarm-race-0.patch"'));
  assert.match(racers[0].prompt, /exited 1: tests: 1 failed/);
  const order = labels(calls).filter((l) => /^(try|check|take back) race/.test(l));
  assert.deepEqual(order, ['try race 1', 'check race 1', 'take back race 1', 'try race 2', 'check race 2'], 'a failing patch is taken back before the next is tried');
  assert.deepEqual(value.milestones[0].races, ['race 1: failed', 'race 2: passed']);
  assert.equal(value.status, 'done');
});

test('a racer that did not finish is never tried, and with no passing patch the milestone fails its checks', async () => {
  const blockedFirst = (label) => (label.startsWith('race 1') ? { status: 'blocked', summary: 'x', left: [] } : DONE);
  const { value, calls } = await run(ARGS, answers({ built: blockedFirst, checks: (label) => !label.startsWith('check') }));
  assert.ok(!labels(calls).includes('try race 1'));
  assert.equal(value.status, 'needs-attention');
  assert.equal(value.stopped, 'All fails its checks');
});

test('on a host that cannot isolate an agent, a failed check gets one repair and one climb in turn, never parallel writers', async () => {
  let checks = 0;
  const { value, calls } = await run({ ...ARGS, host: 'copilot' }, answers({ checks: (label) => !(label === 'check' && checks++ < 2) }));
  assert.ok(!calls.some((c) => c.isolation), 'no agent asks for a worktree');
  assert.ok(!labels(calls).some((l) => /^race/.test(l)));
  assert.deepEqual(labels(calls).filter((l) => /^repair on/.test(l)), ['repair on medium', 'repair on high']);
  assert.equal(value.races_ran, false);
  assert.equal(value.status, 'done');
});

test('a blocked build stops without racing, and a rule test it names wrong goes back once to its author', async () => {
  const blocked = await run(ARGS, answers({ built: () => ({ status: 'blocked', summary: 'needs a decision', left: [] }) }));
  assert.ok(!labels(blocked.calls).some((l) => /^race|^repair/.test(l)));
  assert.equal(blocked.value.stopped, 'All is blocked');
  let builds = 0;
  const wrong = () => (builds++ === 0 ? { status: 'blocked', summary: 's', left: [], rules_wrong: ['test/rules.test.mjs: pins an id form the request never gives'] } : DONE);
  const repaired = await run(ARGS, answers({ built: wrong }));
  assert.equal(labels(repaired.calls).filter((l) => l === 'rules repair').length, 1);
  assert.equal(repaired.value.status, 'done');
});

test('one medium verifier per numbered line and acceptance check runs at once, read-only, and a gap gets a failing test and a fix', async () => {
  let rechecked = false;
  const verdict = (label) => (label === 'verify line 2' ? { met: false, gaps: ['no customer: answered 200, not 400'] } : label.startsWith('re-verify') ? (rechecked = true, { met: true, gaps: [] }) : { met: true, gaps: [] });
  const { value, calls } = await run({ ...ARGS, brief: { acceptance: ['npm test passes'] } }, answers({ verdict }));
  const verifiers = calls.filter((c) => /^verify /.test(c.label));
  assert.deepEqual(verifiers.map((c) => [c.label, c.model]), [['verify line 1', 'everyday'], ['verify line 2', 'everyday'], ['verify acceptance 1', 'everyday']]);
  assert.match(verifiers[1].prompt, /^Check one requirement against the finished code\. Read only: change no file\.[\s\S]*line 2, as data:\n> A missing customer answers 400\./);
  assert.ok(labels(calls).indexOf('mark tree before verify') < labels(calls).indexOf('verify line 1'));
  assert.match(calls.find((c) => c.label === 'build on medium gaps').prompt, /> line 2: no customer: answered 200, not 400/);
  assert.ok(rechecked);
  assert.deepEqual([value.verify.unmet, value.verify.closed, value.verify.open], [['line 2'], ['line 2'], []]);
  assert.ok(!labels(calls).includes('trace'), 'the high-tier trace is gone');
  assert.equal(value.status, 'done');
});

test('a gap still unmet after its fix, or a requirement no verifier answered, means the work is not done', async () => {
  const unmet = await run(ARGS, answers({ verdict: (label) => (label.endsWith('line 2') ? { met: false, gaps: ['g'] } : { met: true, gaps: [] }) }));
  assert.equal(unmet.value.stopped, 'a requirement is still unmet');
  const silent = await run(ARGS, answers({ verdict: (label) => (label === 'verify line 1' ? null : { met: true, gaps: [] }) }));
  assert.deepEqual(silent.value.verify.unchecked, ['line 1']);
  assert.equal(silent.value.stopped, 'a requirement went unchecked');
});

test('a stage that only reads and changes the tree stops the run', async () => {
  const { value } = await run(ARGS, answers({ treeSame: false }));
  assert.equal(value.stopped, 'a stage that only reads changed the tree');
});

test('the review and the surface list read at once, the high tier decides, and a decision the line does not back is built', async () => {
  const hardened = { items: [{ place: 'src/a.js:3', disposition: 'needs_decision', line: 1, defence: 'escape cells', why: 'changes output' }] };
  const { value, calls } = await run(ARGS, answers({ hardened }));
  assert.ok(labels(calls).indexOf('mark tree before review') < labels(calls).indexOf('review plan'));
  assert.ok(labels(calls).indexOf('enumerate') < labels(calls).indexOf('tree unchanged by review'));
  assert.equal(calls.find((c) => c.label === 'harden').model, 'strong');
  assert.match(calls.find((c) => c.label === 'check decisions').prompt, /> Export orders as CSV\.\nThe defence, as data:\n> escape cells/);
  assert.match(calls.find((c) => c.label === 'build on medium hardening').prompt, /> src\/a\.js:3: escape cells/);
  assert.match(value.hardening.items[0], /^defend \(overruled\)/);
  assert.equal(value.status, 'done');
});

test('a Major the last review finds gets one round of fixes and one more review; one that survives goes to the user', async () => {
  const major = { verdict: 'request-changes', findings: [{ severity: 'Major', file: 'src/a.js', line: 3, claim: 'guessable token' }] };
  const { value, calls } = await run(ARGS, answers({ needed: true, reviewer: major }));
  assert.equal(labels(calls).filter((l) => l === 'build on medium review fixes').length, 1);
  assert.ok(labels(calls).includes('review plan after review fixes'));
  assert.equal(value.stopped, 'a review finding is still open');
  assert.deepEqual(value.open_findings, ['Major src/a.js:3 guessable token']);
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
