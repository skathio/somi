// What a review needs, what it found, and the one place it can stop anything: the pull request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { makeRepo, somi, writeFiles } from './helpers.mjs';
import { commitSubjects, headSha, snapshotTree, workBase } from '../scripts/lib/git-tree.mjs';
import { decideAfterReview, isBlocking, parseReviews } from '../scripts/lib/policy.mjs';
import { prGate, readReviews, recordReviews, reviewPlan } from '../scripts/lib/reviews.mjs';

const env = { ...process.env, SOMI_GLOBAL_CONFIG: '' };
const makeCtx = (dir, config = {}, layers = [config]) => ({ root: dir, env, config, configLayers: layers, host: 'claude', now: () => '2026-01-02T00:00:00Z' });
const SMALL = { 'src/app.js': 'export const one = 2;\n' };
const SINK = { 'src/app.js': 'import { exec } from "node:child_process";\nexport const run = (cmd) => exec(cmd);\n' };
const review = (agent, findings = [], verdict = findings.length ? 'request-changes' : 'approve') => ({ agent, verdict, tests_run: [], findings });
const clean = [review('somi-reviewer'), review('somi-security-reviewer')];
const blocker = { id: 'b1', severity: 'Blocker', file: 'src/app.js', line: 1, claim: 'It runs any command the caller sends.' };
const git = (dir, ...a) => execFileSync('git', a, { cwd: dir, stdio: 'ignore', env: { ...process.env, GIT_AUTHOR_NAME: 'f', GIT_AUTHOR_EMAIL: 'f@example.invalid', GIT_COMMITTER_NAME: 'f', GIT_COMMITTER_EMAIL: 'f@example.invalid' } });
const branch = (dir, name = 'work') => git(dir, 'checkout', '-q', '-b', name);

test('a clean small change needs no reviewer', (t) => {
  const ctx = makeCtx(makeRepo(t));
  branch(ctx.root);
  writeFiles(ctx.root, SMALL);
  const plan = reviewPlan(ctx);
  assert.equal(plan.needed, false);
  assert.deepEqual(plan.reviewers, []);
  assert.equal(prGate(ctx).ok, true);
});

test('nothing changed needs nothing, even when asked', (t) => {
  const ctx = makeCtx(makeRepo(t));
  assert.equal(reviewPlan(ctx, { always: true }).needed, false);
});

test('a sink in the diff gets the low reviewer and the high security reviewer, read from the real diff', (t) => {
  const ctx = makeCtx(makeRepo(t));
  writeFiles(ctx.root, SINK);
  const plan = reviewPlan(ctx);
  assert.equal(plan.needed, true);
  assert.deepEqual(plan.reviewers, [{ agent: 'somi:somi-reviewer', tier: 'low', model: 'haiku' }, { agent: 'somi:somi-security-reviewer', tier: 'high', model: 'opus' }]);
  assert.match(plan.diff, /^git diff --no-ext-diff --no-textconv [0-9a-f]+ [0-9a-f]+$/);
  assert.equal(plan.tree, snapshotTree(ctx.root));
  assert.deepEqual(plan.signals, ['sink']);
});

test('a user asking only ever adds a reviewer', (t) => {
  const ctx = makeCtx(makeRepo(t));
  writeFiles(ctx.root, SMALL);
  assert.deepEqual(reviewPlan(ctx, { always: true }).reviewers.map((r) => r.tier), ['low']);
  assert.deepEqual(reviewPlan(ctx, { security: true }).reviewers.map((r) => r.tier), ['low', 'high']);
});

test('a changed interface or a large diff alone is recorded and does not start a review; weakened tests still do', (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n', 'test/a.test.js': 'test("a", () => assert(true));\n', '.gitignore': '.somi\n' });
  const ctx = makeCtx(dir);
  writeFiles(dir, { 'src/app.js': 'export const one = 1;\nexport const two = 2;\n' });
  assert.equal(reviewPlan(ctx).needed, false);
  writeFiles(dir, { 'test/a.test.js': 'test.skip("a", () => assert(true));\n' });
  assert.deepEqual(reviewPlan(ctx).signals, ['tests-weakened']);
});

test('a project config cannot lower who reviews, and the user\'s own config can', (t) => {
  const project = { tiers: { ceiling: 'low', claude: { high: 'cheap' } } };
  const ctx = makeCtx(makeRepo(t), project, [{}, project]);
  writeFiles(ctx.root, SINK);
  const seat = reviewPlan(ctx).reviewers.find((r) => r.agent === 'somi:somi-security-reviewer');
  assert.equal(seat.tier, 'high');
  assert.equal(seat.model, 'opus');
  const mine = { tiers: { ceiling: 'medium' } };
  const own = makeCtx(makeRepo(t), mine, [mine, {}]);
  writeFiles(own.root, SINK);
  assert.equal(reviewPlan(own).reviewers.find((r) => r.agent === 'somi:somi-security-reviewer').tier, 'medium');
});

test('a missing security review is refused, not read as clean, and a report for no reviewer is refused', (t) => {
  const ctx = makeCtx(makeRepo(t));
  writeFiles(ctx.root, SINK);
  assert.throws(() => recordReviews(ctx, { reviews: [review('somi-reviewer')] }), /no review from: somi-security-reviewer/);
  assert.throws(() => recordReviews(ctx, { reviews: [...clean, review('somebody-else')] }), /not dispatched/);
  assert.equal(readReviews(ctx.root, env).length, 0, 'a refused report leaves nothing behind');
});

test('a Blocker asks for a fix, the same one coming back asks the user, and nothing stops the conversation', (t) => {
  const ctx = makeCtx(makeRepo(t));
  writeFiles(ctx.root, SINK);
  const first = recordReviews(ctx, { reviews: [review('somi-reviewer', [blocker]), review('somi-security-reviewer')] });
  assert.equal(first.verdict, 'fix');
  assert.equal(first.blocking[0].id, 'b1');
  const second = recordReviews(ctx, { reviews: [review('somi-reviewer', [blocker]), review('somi-security-reviewer')] });
  assert.equal(second.verdict, 'ask-user');
  assert.equal(second.stop, 'recurring-finding');
  assert.match(second.advice, /Tell the user/);
});

test('blocking findings still open after the pass limit go to the user', (t) => {
  const ctx = makeCtx(makeRepo(t));
  writeFiles(ctx.root, SINK);
  const finding = (claim) => ({ severity: 'Blocker', file: 'src/app.js', line: 1, claim });
  recordReviews(ctx, { reviews: [review('somi-reviewer', [finding('First problem here')]), review('somi-security-reviewer')] });
  const r = recordReviews(ctx, { reviews: [review('somi-reviewer', [finding('A different problem now')]), review('somi-security-reviewer')] });
  assert.equal(r.verdict, 'ask-user');
  assert.equal(r.stop, 'max-passes');
});

test('reviewers\' absolute paths and long claims do not cost a whole review', (t) => {
  const ctx = makeCtx(makeRepo(t));
  writeFiles(ctx.root, SINK);
  const r = recordReviews(ctx, { reviews: [review('somi:somi-reviewer', [{ severity: 'Minor', file: path.join(ctx.root, 'src/app.js'), line: 1, claim: 'x'.repeat(900), evidence: 'y'.repeat(900) }]), review('somi-security-reviewer')] });
  assert.equal(r.logged[0].file, 'src/app.js');
  assert.equal(r.logged[0].claim.length, 400);
  assert.equal(r.logged[0].evidence.length, 400);
  assert.throws(() => recordReviews(ctx, { reviews: [review('somi-reviewer', [{ severity: 'Minor', file: '/etc/passwd', claim: 'x' }]), review('somi-security-reviewer')] }), /unusable file path/);
});

test('a security finding below the bar is offered as a claim to test, once, and a plain reviewer\'s is not', (t) => {
  const ctx = makeCtx(makeRepo(t));
  writeFiles(ctx.root, SINK);
  const gap = { id: 's1', severity: 'Minor', file: 'src/app.js', line: 1, claim: 'A link in the folder lets a write escape.' };
  const removal = { id: 's2', severity: 'Major', file: 'src/app.js', line: 2, claim: 'Remove the path validation, it is too strict.' };
  const nit = { id: 'r1', severity: 'Minor', file: 'src/app.js', line: 3, claim: 'The name is unclear.' };
  const r = recordReviews(ctx, { reviews: [review('somi-reviewer', [nit]), review('somi-security-reviewer', [gap, removal])] });
  assert.equal(r.verdict, 'clear');
  assert.deepEqual(r.to_test.map((f) => f.id), ['s1']);
  assert.match(r.to_test_advice, /Fix only what a test proves, remove no check/);
  assert.equal(recordReviews(ctx, { reviews: [review('somi-reviewer'), review('somi-security-reviewer', [gap])] }).to_test, undefined);
});

test('review input is validated as untrusted', () => {
  const dispatched = [{ agent: 'somi-reviewer' }];
  const bad = (reviews) => assert.throws(() => parseReviews(reviews, dispatched));
  bad('nope');
  bad([{ agent: 'somebody-else', verdict: 'approve', findings: [] }]);
  bad([{ agent: 'somi-reviewer', verdict: 'sure', findings: [] }]);
  bad([{ agent: 'somi-reviewer', verdict: 'approve', findings: [{ severity: 'Fatal', file: 'a', claim: 'b' }] }]);
  bad([{ agent: 'somi-reviewer', verdict: 'approve', findings: [{ severity: 'Minor', file: '../../etc/passwd', claim: 'b' }] }]);
  bad([{ agent: 'somi-reviewer', verdict: 'approve', findings: [{ severity: 'Minor', file: 'a.js', claim: 12 }] }]);
  bad([{ agent: 'somi-reviewer', verdict: 'approve', findings: Array(40).fill({ severity: 'Nit', file: 'a.js', claim: 'x'.repeat(100) }) }]);
});

test('a finding that asks to remove a check is marked for verification', () => {
  const { findings } = parseReviews([{ agent: 'somi-reviewer', verdict: 'request-changes', findings: [
    { severity: 'Blocker', file: 'a.js', line: 1, claim: 'Remove the path validation, it rejects good input' },
    { severity: 'Blocker', file: 'b.js', line: 1, claim: 'The loop never terminates' },
  ] }], [{ agent: 'somi-reviewer' }]);
  assert.equal(findings[0].needs_verification, true);
  assert.equal(findings[1].needs_verification, undefined);
});

test('only a Blocker or a confirmed boundary Major is blocking', () => {
  assert.equal(isBlocking({ severity: 'Blocker', boundary: false, line: null, evidence: null }), true);
  assert.equal(isBlocking({ severity: 'Major', boundary: true, line: 4, evidence: 'input ../x' }), true);
  assert.equal(isBlocking({ severity: 'Major', boundary: true, line: 4, evidence: null }), false);
  assert.equal(isBlocking({ severity: 'Major', boundary: false, line: 4, evidence: 'x' }), false);
  assert.equal(isBlocking({ severity: 'Minor', boundary: true, line: 4, evidence: 'x' }), false);
  assert.equal(decideAfterReview({ findings: [], pass: 2 }).next, 'close');
});

test('somi pr refuses a change that needed a review and has none, and says how to go on', (t) => {
  const dir = makeRepo(t);
  branch(dir);
  writeFiles(dir, SINK);
  const r = somi(dir, ['pr']);
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /needs a review and none covers it \(sink\)/);
  assert.match(r.stderr, /--unreviewed/);
});

test('going ahead unreviewed is labelled at the top of the text, where a reader cannot miss it', (t) => {
  const dir = makeRepo(t);
  branch(dir);
  writeFiles(dir, SINK);
  const r = somi(dir, ['pr', '--unreviewed']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^> \*\*Not reviewed\.\*\*/);
  assert.match(r.stdout, /sink/);
});

test('a recorded review clears the gate for that change', (t) => {
  const dir = makeRepo(t);
  branch(dir);
  writeFiles(dir, SINK);
  assert.equal(somi(dir, ['review', '--record'], { input: JSON.stringify(clean) }).json.verdict, 'clear');
  const r = somi(dir, ['pr']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /Not reviewed/);
  assert.match(r.stdout, /somi-security-reviewer: approve/);
});

test('a blocking finding stops the pull request until a later review clears it', (t) => {
  const dir = makeRepo(t);
  branch(dir);
  const ctx = makeCtx(dir);
  writeFiles(dir, SINK);
  recordReviews(ctx, { reviews: [review('somi-reviewer', [blocker]), review('somi-security-reviewer')] });
  const gate = prGate(ctx);
  assert.equal(gate.ok, false);
  assert.equal(gate.reason, 'open-blocking');
  const r = somi(dir, ['pr']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /blocking findings are still open/);
  assert.match(somi(dir, ['pr', '--unreviewed']).stdout, /^> \*\*Not cleared by review\.\*\*/);
  writeFiles(dir, { 'src/app.js': 'import { exec } from "node:child_process";\nexport const run = () => exec("ls");\n' });
  recordReviews(ctx, { reviews: clean });
  assert.equal(prGate(ctx).ok, true);
});

test('a follow-up that fires a signal after the review needs its own, and a harmless one does not', (t) => {
  const dir = makeRepo(t, { 'src/app.js': 'export const one = 1;\n', 'src/other.js': 'export const two = 2;\n', '.gitignore': '.somi\n' });
  branch(dir);
  const ctx = makeCtx(dir);
  writeFiles(dir, SINK);
  recordReviews(ctx, { reviews: clean });
  assert.equal(prGate(ctx).ok, true);
  writeFiles(dir, { 'src/other.js': 'export const two = 3;\n' });
  assert.equal(prGate(ctx).ok, true, 'a small later edit with no signal stays covered');
  writeFiles(dir, { 'src/other.js': 'import fs from "node:fs";\nexport const two = () => fs.readFileSync(process.argv[2]);\n' });
  assert.equal(prGate(ctx).reason, 'not-reviewed', 'a later change that touches a sink is not vouched for');
});

test('commits made after the review count the same as edits, so a commit cannot walk past the gate', (t) => {
  const dir = makeRepo(t);
  branch(dir);
  const ctx = makeCtx(dir);
  writeFiles(dir, SINK);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'Run commands');
  assert.equal(prGate(ctx).reason, 'not-reviewed', 'committing does not skip the review');
  recordReviews(ctx, { reviews: clean });
  assert.equal(prGate(ctx).ok, true);
  writeFiles(dir, { 'src/app.js': 'import { exec } from "node:child_process";\nexport const run = (c) => exec(`sudo ${c}`);\n' });
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'A follow-up');
  assert.equal(prGate(ctx).reason, 'not-reviewed');
  assert.deepEqual(commitSubjects(dir, workBase(dir)), ['Run commands', 'A follow-up']);
});

test('the base is where the branch left the default branch, and can be named', (t) => {
  const dir = makeRepo(t);
  const start = headSha(dir);
  assert.equal(workBase(dir), start, 'on the default branch with no upstream, only what is not committed counts');
  branch(dir);
  writeFiles(dir, SMALL);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'one');
  assert.equal(workBase(dir), start);
  const ctx = makeCtx(dir);
  assert.equal(reviewPlan(ctx, { base: 'HEAD' }).base, headSha(dir));
  assert.throws(() => reviewPlan(ctx, { base: 'no-such-ref' }), /cannot find the base/);
  assert.throws(() => reviewPlan(ctx, { base: '--output=/tmp/x' }), /cannot find the base/);
});

test('a review without the security reviewer does not cover a change that needs one, whatever the record says', (t) => {
  const dir = makeRepo(t);
  branch(dir);
  const ctx = makeCtx(dir);
  writeFiles(dir, SINK);
  const tree = snapshotTree(dir);
  writeFiles(dir, { '.somi/state/reviews.jsonl': `${JSON.stringify({ base: 'x', tree, verdicts: [{ agent: 'somi-reviewer', verdict: 'approve' }], findings: [], blocking: [] })}\n` });
  assert.equal(prGate(ctx).reason, 'not-reviewed');
});

test('a reviewer the user asked for alone is enough when nothing calls for another', (t) => {
  const ctx = makeCtx(makeRepo(t));
  writeFiles(ctx.root, SMALL);
  assert.equal(recordReviews(ctx, { reviews: [review('somi-security-reviewer')] }).verdict, 'clear');
});

test('a state file holding something that is not an object id is not trusted', (t) => {
  const dir = makeRepo(t);
  branch(dir);
  const ctx = makeCtx(dir);
  writeFiles(dir, { ...SINK, '.somi/state/reviews.jsonl': `${JSON.stringify({ tree: '; touch owned', verdicts: [{ agent: 'somi-reviewer' }, { agent: 'somi-security-reviewer' }], findings: [] })}\n` });
  assert.equal(prGate(ctx).reason, 'not-reviewed');
  assert.equal(fs.existsSync(path.join(dir, 'owned')), false);
  writeFiles(dir, { '.somi/state/reviews.jsonl': 'not json\n' });
  assert.throws(() => readReviews(dir, env), /not JSON/);
});

test('the state writer refuses a committed link at the state folder, and state can live elsewhere on purpose', (t) => {
  const dir = makeRepo(t);
  writeFiles(dir, SMALL);
  fs.symlinkSync(path.join(dir, 'src'), path.join(dir, '.somi'));
  const r = somi(dir, ['ledger', '--kind', 'decision', '--text', 'x']);
  assert.equal(r.status, 64);
  assert.match(r.stderr, /refusing to write through a link/);
  assert.equal(fs.existsSync(path.join(dir, 'src', 'state')), false);
  const other = makeRepo(t);
  const elsewhere = path.join(other, 'outside', 'nested', 'state');
  assert.equal(somi(other, ['ledger', '--kind', 'decision', '--text', 'x'], { env: { SOMI_STATE_DIR: elsewhere } }).status, 0);
  assert.ok(fs.existsSync(path.join(elsewhere, 'ledger.md')));
  assert.equal(fs.existsSync(path.join(other, '.somi')), false);
});

test('migrate imports open findings and decisions once, and changes no old file', (t) => {
  const dir = makeRepo(t);
  const decisionsText = '# Decisions\n\n## D1 — Use one tool\n\ntext\n';
  const findingsText = JSON.stringify({ findings: [{ id: 'F-1', title: 'Still open', severity: 'Major', status: 'open', locus: { file: 'a.js' } }, { id: 'F-2', title: 'Done', status: 'fixed' }] });
  writeFiles(dir, { '.somi/plans/old-work/decisions.md': decisionsText, '.somi/reviews/old-work/findings.json': findingsText });
  assert.deepEqual(somi(dir, ['migrate']).json.imported, [{ slug: 'old-work', findings: 1, decisions: 1 }]);
  assert.deepEqual(somi(dir, ['migrate']).json.imported, []);
  assert.equal(fs.readFileSync(path.join(dir, '.somi/plans/old-work/decisions.md'), 'utf8'), decisionsText);
  assert.equal(fs.readFileSync(path.join(dir, '.somi/reviews/old-work/findings.json'), 'utf8'), findingsText);
  const status = somi(dir, ['status']).stdout;
  assert.match(status, /Major a\.js: Still open/);
  assert.match(status, /old-work: Use one tool/);
  assert.doesNotMatch(status, /Done/);
});
