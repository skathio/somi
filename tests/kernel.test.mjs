import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { journal, journalPath, journalText, makeRepo, somi, writeFiles } from './helpers.mjs';
import { decideAfterReview, isBlocking, parseReviews } from '../scripts/lib/policy.mjs';
import { deriveCursor, journalProblems } from '../scripts/lib/journal.mjs';

const finding = (over = {}) => ({ severity: 'Minor', file: 'src/app.js', line: 3, claim: 'something small', ...over });
const review = (agent, findings = [], verdict = 'approve') => ({ agent, verdict, findings });
const send = (dir, reviews) => somi(dir, ['step', 'after-review'], { input: JSON.stringify(reviews) });
const reviewers = (r) => r.json.reviewers.map((x) => x.agent);

const SINK_CHANGE = { 'src/app.js': "import { exec } from 'node:child_process';\nexport const one = 1;\nexec('ls');\n" };

test('a clean small change dispatches no reviewer and closes', (t) => {
  const dir = makeRepo(t);
  assert.equal(somi(dir, ['step', 'open', '--title', 'tweak']).json.next, 'code');
  writeFiles(dir, { 'src/app.js': 'export const one = 1;\nexport const two = 2;\n' });
  const after = somi(dir, ['step', 'after-code']);
  assert.equal(after.json.next, 'close');
  assert.equal(after.json.reviewers, undefined);
  const closed = somi(dir, ['step', 'close']);
  assert.equal(closed.json.next, 'open');
  assert.equal(closed.json.outcome, 'done');
  assert.deepEqual(journalProblems(journal(dir)), []);
});

test('a diff touching a sink dispatches the generalist and the security lens', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'sink']);
  writeFiles(dir, SINK_CHANGE);
  const after = somi(dir, ['step', 'after-code']);
  assert.equal(after.json.next, 'review');
  assert.deepEqual(reviewers(after), ['somi-reviewer', 'somi-security-reviewer']);
  assert.ok(after.json.security.includes('sink'));
  assert.deepEqual(after.json.reviewers.map((r) => r.tier), ['low', 'high']);
});

test('a Minor never triggers a second pass, and a Major off a boundary only logs', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'sink']);
  writeFiles(dir, SINK_CHANGE);
  somi(dir, ['step', 'after-code']);
  const r = send(dir, [review('somi-reviewer', [finding(), finding({ severity: 'Major', claim: 'a real but narrow defect' })], 'request-changes'), review('somi-security-reviewer')]);
  assert.equal(r.json.next, 'close');
  assert.equal(r.json.logged, 2);
  assert.match(somi(dir, ['status']).stdout, /Minor src\/app\.js:3: something small/);
});

test('a Blocker re-loops, and the second pass reviews only the fix diff', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'sink']);
  writeFiles(dir, SINK_CHANGE);
  const first = somi(dir, ['step', 'after-code']);
  assert.equal(first.json.card.scope, 'milestone');
  const r = send(dir, [review('somi-reviewer', [finding({ severity: 'Blocker', claim: 'ls runs unquoted input' })], 'request-changes'), review('somi-security-reviewer')]);
  assert.equal(r.json.next, 'fix');
  assert.equal(r.json.findings[0].severity, 'Blocker');
  writeFiles(dir, { 'src/other.js': 'export const fixed = true;\n' });
  const second = somi(dir, ['step', 'after-code']);
  assert.equal(second.json.next, 'review');
  assert.equal(second.json.card.scope, 'fix-only');
  assert.deepEqual(second.json.card.files, ['src/other.js']);
  assert.deepEqual(reviewers(second), ['somi-reviewer', 'somi-security-reviewer'], 'a boundary touched earlier keeps its lens');
});

test('asked to fix with nothing changed, the machine says so instead of sending the same code back', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'sink']);
  writeFiles(dir, SINK_CHANGE);
  somi(dir, ['step', 'after-code']);
  send(dir, [review('somi-reviewer', [finding({ severity: 'Blocker', claim: 'fix me' })], 'request-changes'), review('somi-security-reviewer')]);
  const r = somi(dir, ['step', 'after-code']);
  assert.equal(r.json.next, 'fix');
  assert.equal(r.json.refused, 'nothing-changed');
  assert.equal(r.json.findings[0].claim, 'fix me');
  assert.equal(somi(dir, ['step', 'status']).json.next, 'fix');
});

test('the same blocking finding in two passes stops and asks, and only the maintainer can resume', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'sink']);
  writeFiles(dir, SINK_CHANGE);
  somi(dir, ['step', 'after-code']);
  const blocker = [review('somi-reviewer', [finding({ severity: 'Blocker', claim: 'same problem' })], 'request-changes'), review('somi-security-reviewer')];
  send(dir, blocker);
  writeFiles(dir, { 'src/other.js': 'export const fixed = true;\n' });
  somi(dir, ['step', 'after-code']);
  const stop = send(dir, blocker);
  assert.equal(stop.json.next, 'ask');
  assert.equal(stop.json.stop, 'recurring-finding');
  assert.equal(somi(dir, ['step', 'after-code']).status, 64);
  assert.equal(somi(dir, ['step', 'close']).status, 64);
  const answered = somi(dir, ['step', 'decide', '--text', 'It is a false alarm, close it', '--then', 'close']);
  assert.equal(answered.json.next, 'close');
  assert.equal(somi(dir, ['step', 'close']).json.outcome, 'closed-by-maintainer');
  assert.match(somi(dir, ['status']).stdout, /It is a false alarm, close it/);
});

test('a third pass needs the maintainer, who can grant exactly one more', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'sink']);
  writeFiles(dir, SINK_CHANGE);
  somi(dir, ['step', 'after-code']);
  send(dir, [review('somi-reviewer', [finding({ severity: 'Blocker', claim: 'first problem' })], 'request-changes'), review('somi-security-reviewer')]);
  writeFiles(dir, { 'src/other.js': 'export const fixed = 1;\n' });
  somi(dir, ['step', 'after-code']);
  const stop = send(dir, [review('somi-reviewer', [finding({ severity: 'Blocker', claim: 'second problem' })], 'request-changes'), review('somi-security-reviewer')]);
  assert.equal(stop.json.stop, 'max-passes');
  assert.equal(somi(dir, ['step', 'decide', '--text', 'One more', '--then', 'continue']).json.next, 'fix');
  writeFiles(dir, { 'src/other.js': 'export const fixed = 2;\n' });
  assert.equal(somi(dir, ['step', 'after-code']).json.next, 'review');
  assert.equal(send(dir, [review('somi-reviewer'), review('somi-security-reviewer')]).json.next, 'close');
});

test('a missing security review is refused, not read as clean', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'sink']);
  writeFiles(dir, SINK_CHANGE);
  somi(dir, ['step', 'after-code']);
  const r = send(dir, [review('somi-reviewer')]);
  assert.equal(r.status, 64);
  assert.match(r.stderr, /no review from: somi-security-reviewer/);
  assert.equal(somi(dir, ['step', 'status']).json.next, 'review');
});

test('intent gate and second area follow-up stop before any code', (t) => {
  const dir = makeRepo(t);
  const gated = somi(dir, ['step', 'open', '--title', 'schema', '--ask', 'Rewrite the schema in place, or add a table?']);
  assert.equal(gated.json.next, 'ask');
  assert.equal(gated.json.stop, 'intent-gate');
  assert.equal(somi(dir, ['step', 'decide', '--text', 'Add a table', '--then', 'continue']).json.next, 'code');
  somi(dir, ['step', 'after-code']);
  somi(dir, ['step', 'close']);
  assert.equal(somi(dir, ['step', 'open', '--title', 'first', '--follow-up', 'parser']).json.next, 'code');
  somi(dir, ['step', 'after-code']);
  somi(dir, ['step', 'close']);
  const second = somi(dir, ['step', 'open', '--title', 'second', '--follow-up', 'parser']);
  assert.equal(second.json.stop, 'area-follow-up');
});

test('a release candidate is reviewed even with no signal', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'rc', '--release-candidate']);
  assert.equal(somi(dir, ['step', 'after-code']).json.next, 'review');
});

test('a failing check holds the milestone in code and records no after-code event', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'broken']);
  writeFiles(dir, { 'src/app.js': 'export const = ;\n' });
  const r = somi(dir, ['step', 'after-code']);
  assert.equal(r.json.next, 'code');
  assert.equal(r.json.check.ok, false);
  assert.equal(journal(dir).filter((e) => e.type === 'after-code').length, 0);
  writeFiles(dir, { 'src/app.js': 'export const fine = 1;\n' });
  assert.notEqual(somi(dir, ['step', 'after-code']).json.check?.ok, false);
});

// Replay: kill the process at each transition, at each point of the write, and the retried run must leave identical bytes.
function fullRun(dir, failpoint) {
  const step = (args, opts = {}) => {
    const killed = failpoint ? somi(dir, args, { ...opts, env: { SOMI_FAILPOINT: failpoint } }) : somi(dir, args, opts);
    return killed.signal === 'SIGKILL' ? somi(dir, args, opts) : killed;
  };
  step(['step', 'open', '--title', 'replay']);
  writeFiles(dir, SINK_CHANGE);
  step(['step', 'after-code']);
  step(['step', 'after-review'], { input: JSON.stringify([review('somi-reviewer', [finding({ severity: 'Blocker', claim: 'fix me' })], 'request-changes'), review('somi-security-reviewer')]) });
  writeFiles(dir, { 'src/other.js': 'export const fixed = true;\n' });
  step(['step', 'after-code']);
  step(['step', 'after-review'], { input: JSON.stringify([review('somi-reviewer'), review('somi-security-reviewer')]) });
  step(['step', 'close']);
}

test('killing the process at any transition and resuming yields a byte-identical journal', (t) => {
  const clean = makeRepo(t);
  fullRun(clean);
  const expected = journalText(clean);
  assert.equal(journal(clean).at(-1).type, 'close');
  for (const type of ['open', 'check', 'after-code', 'after-review', 'close']) {
    for (const where of ['before', 'torn', 'after']) {
      const dir = makeRepo(t);
      fullRun(dir, `${type}:${where}`);
      assert.equal(journalText(dir), expected, `${type}:${where}`);
    }
  }
});

test('a retried step answers the same and appends nothing', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'sink']);
  assert.equal(somi(dir, ['step', 'open', '--title', 'sink']).json.milestone, 'm1');
  writeFiles(dir, SINK_CHANGE);
  const first = somi(dir, ['step', 'after-code']);
  const before = journalText(dir);
  assert.deepEqual(somi(dir, ['step', 'after-code']).json, first.json);
  assert.equal(journalText(dir), before);
  const reviews = [review('somi-reviewer', [finding()]), review('somi-security-reviewer')];
  const answer = send(dir, reviews);
  const afterReview = journalText(dir);
  assert.deepEqual(send(dir, reviews).json, answer.json);
  assert.equal(journalText(dir), afterReview);
});

test('the state writer refuses a committed link at the state folder', (t) => {
  const dir = makeRepo(t);
  fs.symlinkSync(path.join(dir, 'src'), path.join(dir, '.somi'));
  const r = somi(dir, ['step', 'open', '--title', 'x']);
  assert.equal(r.status, 64);
  assert.match(r.stderr, /refusing to write through a link/);
  assert.equal(fs.existsSync(path.join(dir, 'src', 'state')), false);
});

test('state can live outside the tree on purpose, in a folder that does not exist yet', (t) => {
  const dir = makeRepo(t);
  const elsewhere = path.join(dir, 'outside', 'nested', 'state');
  const r = somi(dir, ['step', 'open', '--title', 'x'], { env: { SOMI_STATE_DIR: elsewhere } });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(elsewhere, 'journal.jsonl')));
  assert.equal(fs.existsSync(journalPath(dir)), false);
});

test('a corrupt journal line is refused rather than guessed at', (t) => {
  const dir = makeRepo(t);
  somi(dir, ['step', 'open', '--title', 'x']);
  fs.writeFileSync(journalPath(dir), 'not json\n');
  assert.equal(somi(dir, ['step', 'status']).status, 64);
});

test('review input is validated as untrusted', () => {
  const dispatched = [{ agent: 'somi-reviewer' }];
  const bad = (reviews) => assert.throws(() => parseReviews(reviews, dispatched));
  bad('nope');
  bad([{ agent: 'somebody-else', verdict: 'approve', findings: [] }]);
  bad([{ agent: 'somi-reviewer', verdict: 'sure', findings: [] }]);
  bad([{ agent: 'somi-reviewer', verdict: 'approve', findings: [{ severity: 'Fatal', file: 'a', claim: 'b' }] }]);
  bad([{ agent: 'somi-reviewer', verdict: 'approve', findings: [{ severity: 'Minor', file: '../../etc/passwd', claim: 'b' }] }]);
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

test('the journal gate rejects undocumented statuses', () => {
  const event = { v: 1, seq: 1, key: 'k', type: 'open', milestone: 'm1', title: 't', base: 'b', next: 'code' };
  assert.deepEqual(journalProblems([event]), []);
  assert.ok(journalProblems([{ ...event, stop: 'tired' }]).length > 0);
  assert.ok(journalProblems([{ ...event, next: 'whenever' }]).length > 0);
  assert.ok(journalProblems([{ ...event, type: 'mystery' }]).length > 0);
  assert.ok(journalProblems([{ ...event, seq: 9 }]).length > 0);
});

test('the cursor is a pure fold of the events', () => {
  assert.equal(deriveCursor([]).next, 'open');
  const opened = deriveCursor([{ seq: 1, type: 'open', milestone: 'm1', title: 't', base: 'b', next: 'code' }]);
  assert.equal(opened.milestone, 'm1');
  assert.equal(deriveCursor([{ seq: 1, type: 'open', milestone: 'm1', title: 't', base: 'b', next: 'code' }, { seq: 2, type: 'close', milestone: 'm1' }]).milestone, null);
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
