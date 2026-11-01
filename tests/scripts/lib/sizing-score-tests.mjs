#!/usr/bin/env node
// Tests of the sizing scorer (tests/evals/lib/sizing-score.mjs). Risk: a bar that passes a run it should fail (a weak
// share, an unguarded floor case, a tie read as a winner), or two runs on different labels compared as one. Tables run
// over records built from the committed set; the entry point runs as a child process for its exit codes. Each guard is
// then broken on a scratch copy of the module and the same suite must turn red. Run by
// tests/scripts/eval-gate-bench-driver.sh. Hermetic: no model, no network, no randomness.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { REPO_ROOT, TIERS, isFloorCase, labelHash, loadSet, scenarioId } from '../../evals/lib/sizing-set.mjs';

const LIB = path.join(REPO_ROOT, 'tests', 'evals', 'lib');
const set = loadSet();
const SHA = 'a'.repeat(40);
const clone = (v) => JSON.parse(JSON.stringify(v));
// A record in which every entry matches its label on all five draws, with `over` replacing some entries' draws.
const rec = (over = {}, extra = {}) => ({ label_sha256: labelHash(set), plugin_sha: SHA, arm: 'somi', entries: Object.fromEntries(set.entries.map((e) => [e.id, over[e.id] ?? Array(5).fill(e.label)])), ...extra });
const draws = (n, tier, rest = null) => [...Array(n).fill(tier), ...Array(5 - n).fill(rest)];
// The cases the tests lean on come from the set itself, so a relabelled or extended set does not silently void them.
const floors = set.entries.filter(isFloorCase);
const [O1, O2] = set.entries.filter((e) => !isFloorCase(e));
const F1 = floors[0]; const F2 = floors[1]; const F3 = floors.at(-1);
const otherThan = (...tiers) => TIERS.filter((t) => !tiers.includes(t));
const [X1] = otherThan(O1.label); const [Y1] = otherThan(O1.label, X1);
const offDraws = (e, n) => [...Array(n).fill(otherThan(e.label)[0]), ...Array(5 - n).fill(e.label)];
const rowsFor = (n) => set.entries.flatMap((e) => Array.from({ length: n }, () => ({ scenario: scenarioId(e), arm: 'somi', phase: 'sizing', tier: e.label })));
const META = { plugin_sha: SHA, arm: 'somi' };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-score-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));

// A scratch copy of the scorer (and the modules it imports, with the data directories linked) with `from` replaced by `to`.
let scratchN = 0;
function scratch(from, to) {
  const dir = path.join(tmp, `scratch${scratchN++}`, 'tests', 'evals');
  fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  for (const f of ['sizing-set.mjs', 'bench-schema.mjs', 'manifest.mjs']) fs.copyFileSync(path.join(LIB, f), path.join(dir, 'lib', f));
  for (const d of ['ab', 'ab-micro', 'fixtures', 'sizing-set']) fs.symlinkSync(path.join(REPO_ROOT, 'tests', 'evals', d), path.join(dir, d));
  const original = fs.readFileSync(path.join(LIB, 'sizing-score.mjs'), 'utf8');
  fs.writeFileSync(path.join(dir, 'lib', 'sizing-score.mjs'), original.replace(from, to));
  return { file: path.join(dir, 'lib', 'sizing-score.mjs'), applies: original.includes(from) };
}

async function suite(modPath, say) {
  let pass = 0; let fail = 0;
  const check = (name, got, want) => {
    if (isDeepStrictEqual(got, want)) { pass++; say(`  ok   ${name}`); } else { fail++; say(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
  };
  const M = await import(pathToFileURL(modPath).href);
  const refused = (fn) => { try { fn(); return 'no throw'; } catch (e) { return e instanceof M.Refusal ? e.message : `wrong error: ${e.message}`; } };
  const refusedWith = (fn, re) => re.test(refused(fn));
  const score = (r, o) => M.scoreResult(set, r, o);
  const entry = (r, id, o) => score(r, o).entries.find((x) => x.id === id);

  say('== sizing score: building a record ==');
  const built = M.buildResult(set, rowsFor(5), META);
  check('turns sizing rows into a record bound to the set', [built.label_sha256, built.plugin_sha, built.arm, Object.keys(built.entries).length, built.entries[O1.id]], [labelHash(set), SHA, 'somi', set.entries.length, Array(5).fill(O1.label)]);
  check('keeps the draw order and reads a tier outside the three as null', M.buildResult(set, rowsFor(1).map((r, i) => (i === 0 ? { ...r, tier: 'unknown' } : r)), META).entries[O1.id], [null]);
  check('reads a missing tier as null', M.buildResult(set, rowsFor(1).map((r, i) => (i === 0 ? { ...r, tier: undefined } : r)), META).entries[O1.id], [null]);
  check('refuses a row outside the sizing phase', refusedWith(() => M.buildResult(set, rowsFor(1).map((r, i) => (i === 0 ? { ...r, phase: 'experiment' } : r)), META), /not sizing/), true);
  check('refuses a scenario that is not in the set', refusedWith(() => M.buildResult(set, [...rowsFor(1), { scenario: 'S4-Z9', arm: 'somi', phase: 'sizing', tier: 'small' }], META), /not in the set/), true);
  check('refuses a row of the other arm', refusedWith(() => M.buildResult(set, rowsFor(1).map((r, i) => (i === 0 ? { ...r, arm: 'bare' } : r)), META), /arm "bare"/), true);
  check('refuses entries with different draw counts', refusedWith(() => M.buildResult(set, [...rowsFor(2), rowsFor(1)[0]], META), /same number of draws/), true);
  check('refuses an entry with no draw', refusedWith(() => M.buildResult(set, rowsFor(2).slice(2), META), /same number of draws/), true);
  check('refuses an empty list of rows', refusedWith(() => M.buildResult(set, [], META), /at least one/), true);
  const withOutcome = (outcome) => rowsFor(1).map((r, i) => (i === 0 ? { ...r, outcome } : r));
  check('refuses a draw that ended paused or over budget, so it has to be drawn again', ['paused', 'over-budget'].map((o) => refusedWith(() => M.buildResult(set, withOutcome(o), META), new RegExp(`ended ${o}`))), [true, true]);
  const withEnd = (outcome, reason) => rowsFor(1).map((r, i) => (i === 0 ? { ...r, outcome, reason } : r));
  check("takes a scored draw and the probe's own invalid draw as answers", [['scored'], ['invalid', 'probe']].map((a) => M.buildResult(set, withEnd(...a), META).entries[O1.id]), [[O1.label], [O1.label]]);
  check('refuses a draw that ended invalid for any reason but probe: a harness event, not an answer', ['timeout', 'output-cap', 'leak: token', 'unpinned-model', undefined].map((why) => refusedWith(() => M.buildResult(set, withEnd('invalid', why), META), /ended invalid/)), Array(5).fill(true));
  const timedOut = (tier, tierSource) => rowsFor(1).map((r, i) => (i === 0 ? { ...r, outcome: 'invalid', reason: 'timeout', tier, tierSource } : r));
  check('takes a timed-out draw whose tier is full from the record file as an answer', M.buildResult(set, timedOut('full', 'file'), META).entries[O1.id], ['full']);
  check('counts only the timed-out full draws it took, and never a scored draw that carries a timeout reason', [M.buildRecord(set, timedOut('full', 'file'), META).taken, M.buildRecord(set, rowsFor(1), META).taken, M.buildRecord(set, rowsFor(1).map((r, i) => (i === 0 ? { ...r, outcome: 'scored', reason: 'timeout', tier: 'full', tierSource: 'file' } : r)), META).taken], [1, 0, 0]);
  check('refuses a timeout on any other tier or tier source', [['small', 'file'], ['trivial', 'file'], ['unknown', 'file'], ['full', 'stream'], ['full', 'none'], ['full', undefined]].map((a) => refusedWith(() => M.buildResult(set, timedOut(...a), META), /ended invalid \("timeout"\)/)), Array(6).fill(true));
  check('refuses a full/file draw that ended invalid for a reason but timeout', ['output-cap', 'leak: token', 'unpinned-model', undefined].map((why) => refusedWith(() => M.buildResult(set, timedOut('full', 'file').map((r, i) => (i === 0 ? { ...r, reason: why } : r)), META), /ended invalid/)), Array(4).fill(true));
  check('refuses a bad plugin sha', refusedWith(() => M.buildResult(set, rowsFor(1), { plugin_sha: 'main', arm: 'somi' }), /plugin_sha/), true);

  say('== sizing score: the bar per entry ==');
  check('passes when every entry matches 5 of 5', score(rec()).bar_met, true);
  check('modal tier, share and need are reported', (({ modal, share, need, pass }) => ({ modal, share, need, pass }))(entry(rec({ [O1.id]: draws(4, O1.label, X1) }), O1.id)), { modal: O1.label, share: 0.8, need: 4, pass: true });
  check('fails an ordinary entry at 3 of 5', entry(rec({ [O1.id]: draws(3, O1.label, X1) }), O1.id).pass, false);
  check('passes an ordinary entry at 4 of 5', entry(rec({ [O1.id]: draws(4, O1.label, X1) }), O1.id).pass, true);
  check('fails a floor case at 4 of 5', entry(rec({ [F1.id]: draws(4, F1.label, otherThan(F1.label)[0]) }), F1.id).pass, false);
  check('passes a floor case at 5 of 5', entry(rec(), F1.id).pass, true);
  check('a floor case at 4 of 5 fails the whole bar', score(rec({ [F3.id]: draws(4, F3.label, otherThan(F3.label)[0]) })).bar_met, false);
  check('fails a 2/2/1 tie, which has no modal tier', (({ modal, pass }) => ({ modal, pass }))(entry(rec({ [O1.id]: [O1.label, O1.label, X1, X1, Y1] }), O1.id)), { modal: null, pass: false });
  check('fails a modal tier that is not the label even at 5 of 5', entry(rec({ [O1.id]: Array(5).fill(X1) }), O1.id).pass, false);
  check('counts a null tier as a miss', [entry(rec({ [O1.id]: draws(4, O1.label) }), O1.id).pass, entry(rec({ [O1.id]: draws(3, O1.label) }), O1.id).pass], [true, false]);
  check('counts a null tier as an off-label draw', score(rec({ [O1.id]: draws(4, O1.label) })).pooled.off, 1);
  check('fails a floor case with one null draw', entry(rec({ [F2.id]: draws(4, F2.label) }), F2.id).pass, false);
  check('scales the share to the draw count (10 draws need 8)', [8, 7].map((n) => entry(rec({ [O1.id]: [...Array(n).fill(O1.label), ...Array(10 - n).fill(X1)], ...Object.fromEntries(set.entries.filter((e) => e.id !== O1.id).map((e) => [e.id, Array(10).fill(e.label)])) }), O1.id).pass), [true, false]);

  say('== sizing score: the pooled reading ==');
  // Off-label draws spread over the ordinary entries, five to an entry (the set size sets the allowance: one draw in ten).
  const ordinary = set.entries.filter((e) => !isFloorCase(e));
  const spread = (n, per = 5) => Object.fromEntries(ordinary.map((e, i) => [e.id, offDraws(e, Math.max(0, Math.min(per, n - i * per)))]));
  const allowed = Math.floor((set.entries.length * 5) / 10);
  const atLimit = rec(spread(allowed)); const overLimit = rec(spread(allowed + 1));
  const failing = Math.ceil((allowed - 1) / 5);
  check(`accepts ${allowed} of ${set.entries.length * 5} off-label draws`, [score(atLimit, { mode: 'pooled' }).pooled.off, score(atLimit, { mode: 'pooled' }).bar_met], [allowed, true]);
  check('the same draws miss the per-task bar and both numbers are reported', [score(atLimit).bar_met, score(atLimit).per_task.passing, score(atLimit).pooled.allowed], [false, set.entries.length - failing, allowed]);
  check(`rejects ${allowed + 1} of ${set.entries.length * 5} off-label draws`, [score(overLimit, { mode: 'pooled' }).pooled.off, score(overLimit, { mode: 'pooled' }).bar_met], [allowed + 1, false]);
  // 3 draws an entry is a total that is not a multiple of ten: the allowance rounds down, so one draw over is rejected.
  const few = (n) => Object.fromEntries(ordinary.map((e, i) => { const k = Math.max(0, Math.min(3, n - i * 3)); return [e.id, [...Array(k).fill(otherThan(e.label)[0]), ...Array(3 - k).fill(e.label)]]; }));
  const rec3 = (over) => rec(Object.fromEntries(set.entries.map((e) => [e.id, over[e.id] ?? Array(3).fill(e.label)])));
  const allowed3 = Math.floor((set.entries.length * 3) / 10);
  check(`rounds the allowance down: ${allowed3} of ${set.entries.length * 3} accepted, ${allowed3 + 1} rejected`, [allowed3, allowed3 + 1].map((n) => score(rec3(few(n)), { mode: 'pooled' }).bar_met), [true, false]);
  check('still fails a floor case at 4 of 5', score(rec({ [F1.id]: draws(4, F1.label, otherThan(F1.label)[0]) }), { mode: 'pooled' }).bar_met, false);
  check('refuses an unknown mode', refusedWith(() => score(rec(), { mode: 'loose' }), /unknown mode/), true);

  say('== sizing score: the label-hash binding and malformed records ==');
  check('refuses a record whose hash is not the committed set', refusedWith(() => score(rec({}, { label_sha256: 'b'.repeat(64) })), /different label set/), true);
  const altered = clone(set); altered.entries[0].label = otherThan(altered.entries[0].label)[0];
  check('refuses a record scored against a re-labelled set', refusedWith(() => M.scoreResult(altered, rec()), /different label set/), true);
  check('refuses a record without a hash', refusedWith(() => score(rec({}, { label_sha256: undefined })), /label_sha256/), true);
  check('refuses a record with an unknown arm', refusedWith(() => score(rec({}, { arm: 'x' })), /plugin_sha or arm/), true);
  check('refuses a record that is not an object', refusedWith(() => score([]), /not a result record/), true);
  check('refuses a record missing an entry', refusedWith(() => { const r = rec(); delete r.entries[O1.id]; score(r); }, /exactly the set's entries/), true);
  check('refuses a record with an extra entry', refusedWith(() => { const r = rec(); r.entries.Z9 = ['small']; score(r); }, /exactly the set's entries/), true);
  check('refuses a draw outside the three tiers', refusedWith(() => score(rec({ [O1.id]: ['medium', ...Array(4).fill(O1.label)] })), /list of tiers or null/), true);
  check('refuses an entry with no draws', refusedWith(() => score(rec({ [O1.id]: [] })), /list of tiers or null/), true);
  check('refuses entries with different draw counts', refusedWith(() => score(rec({ [O1.id]: Array(4).fill(O1.label) })), /different draw counts/), true);
  const base = rec(); const cand = rec({ [O1.id]: draws(3, O1.label, X1) });
  const side = M.compareResults(set, base, cand);
  check('compares two records of the same set side by side', [side.baseline.bar_met, side.candidate.bar_met, side.candidate.entries.find((x) => x.id === O1.id).pass], [true, false, false]);
  check('refuses a candidate with a different label hash than the baseline', refusedWith(() => M.compareResults(set, base, rec({}, { label_sha256: 'b'.repeat(64) })), /different label sets/), true);
  check('refuses two records that agree with each other but not with the set', refusedWith(() => M.compareResults(set, rec({}, { label_sha256: 'b'.repeat(64) }), rec({}, { label_sha256: 'b'.repeat(64) })), /different label set/), true);

  say('== sizing score: the entry point ==');
  const cli = (...argv) => spawnSync('node', [path.join(path.dirname(modPath), 'sizing-score.mjs'), ...argv], { encoding: 'utf8' });
  const work = fs.mkdtempSync(path.join(tmp, 'c-'));
  const put = (name, v) => { const f = path.join(work, name); fs.writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v)); return f; };
  const met = put('met.json', rec()); const missed = put('missed.json', cand); const wrong = put('wrong.json', rec({}, { label_sha256: 'b'.repeat(64) }));
  const ran = (...a) => { const r = cli(...a); return [r.status, r.stdout.split('\n')[0].slice(0, 22)]; };
  check('exits 0 and says met when the bar is met', ran('--score', met), [0, 'sizing bar met (per-ta']);
  check('exits 3 and names the entry when the bar is missed', [cli('--score', missed).status, cli('--score', missed).stdout.includes(`missed (per-task): disagrees on ${O1.id};`)], [3, true]);
  check('exits 2 on a refusal, not 3 and not 64 or 65', [cli('--score', wrong).status, /different label set/.test(cli('--score', wrong).stderr)], [2, true]);
  check('exits 2 on a record that is not JSON', cli('--score', put('junk.json', 'nope')).status, 2);
  check('exits 2 on a usage error', [cli().status, cli('--score').status, cli('--bogus').status], [2, 2, 2]);
  check('--pooled reads the same record by the pooled bar', [cli('--score', put('at-limit.json', atLimit), '--pooled').status, cli('--score', put('at-limit2.json', atLimit)).status], [0, 3]);
  check('--compare exits 0 on comparable records even when the candidate missed', [cli('--compare', met, missed).status, /^baseline: sizing bar met[^\n]*\ncandidate: sizing bar missed/.test(cli('--compare', met, missed).stdout)], [0, true]);
  check('--compare exits 2 when the label hashes differ', cli('--compare', met, wrong).status, 2);
  const rowsFile = put('rows.jsonl', rowsFor(1).map((r) => JSON.stringify({ status: 'halted', row: null, ...r })).concat(rowsFor(5).map((r) => JSON.stringify({ status: 'done', row: r }))).join('\n'));
  const out = cli('--build', rowsFile, '--plugin-sha', SHA);
  check('--build prints a record that scores as met, ignoring halted draws', [out.status, out.status === 0 && M.scoreResult(set, JSON.parse(out.stdout)).bar_met], [0, true]);
  const err = (r) => [r.status, /^sizing-score: refused: /.test(r.stderr), /^sizing-score: error: /.test(r.stderr)];
  check('a refusal is reported as refused, exit 2', err(cli('--score', wrong)), [2, true, false]);
  const bug = scratch('const needOf = (draws) => Math.ceil((draws * 4) / 5);', "const needOf = () => { throw new TypeError('boom'); };");
  const bugRun = spawnSync('node', [bug.file, '--score', met], { encoding: 'utf8' });
  check('any other exception is an error, exit 1, never a refusal', [bug.applies, ...err(bugRun), /boom/.test(bugRun.stderr)], [true, 1, false, true, true]);
  const badSet = put('bad-set.json', '{"entries": []}');
  check('a set that fails validation is a refusal, exit 2', [...err(cli('--score', met, '--set', badSet)), /sizing set invalid/.test(cli('--score', met, '--set', badSet).stderr)], [2, true, false, true]);
  check('a set file that is missing is a refusal, exit 2', err(cli('--score', met, '--set', path.join(work, 'nope.json'))).slice(0, 2), [2, true]);
  const badRows = put('bad-rows.jsonl', `${JSON.stringify({ status: 'done', row: rowsFor(1)[0] })}\n\n{"status": "done", row\n`);
  const badRun = cli('--build', badRows, '--plugin-sha', SHA);
  check('--build names the line whose JSON does not parse', [badRun.status, /line 3 is not JSON/.test(badRun.stderr)], [2, true]);
  check('--build refuses an empty rows file', [cli('--build', put('empty.jsonl', ''), '--plugin-sha', SHA).status, /at least one/.test(cli('--build', put('empty.jsonl', ''), '--plugin-sha', SHA).stderr)], [2, true]);
  check('--build refuses a finished draw whose entry reason is not probe, and takes one that is', [['timeout', 2], ['probe', 0]].map(([why, code]) => cli('--build', put(`why-${why}.jsonl`, rowsFor(1).map((r) => JSON.stringify({ status: 'done', reason: why, row: { ...r, outcome: 'invalid' } })).join('\n')), '--plugin-sha', SHA).status === code), [true, true]);
  const timeoutFile = (tier) => put(`timeout-${tier}.jsonl`, rowsFor(5).map((r, i) => JSON.stringify({ status: 'done', reason: i === 0 ? 'timeout' : 'probe', row: i === 0 ? { ...r, outcome: 'invalid', tier, tierSource: 'file' } : r })).join('\n'));
  const tFull = cli('--build', timeoutFile('full'), '--plugin-sha', SHA); const tSmall = cli('--build', timeoutFile('small'), '--plugin-sha', SHA);
  const tRows = rowsFor(5).map((r, i) => (i === 0 ? { ...r, outcome: 'invalid', reason: 'timeout', tier: 'full', tierSource: 'file' } : { ...r, outcome: 'invalid', reason: 'probe' }));
  check('--build takes a timed-out full draw, says so on stderr and prints exactly the record (stdout is one JSON document)', [tFull.status, tFull.stderr, tFull.status === 0 && isDeepStrictEqual(JSON.parse(tFull.stdout), M.buildResult(set, tRows, META))],
    [0, 'sizing-score: timed-out full draws taken as answers (tier from the record file): 1\n', true]);
  check('--build refuses a timed-out small draw, exit 2', [tSmall.status, /ended invalid/.test(tSmall.stderr)], [2, true]);
  check('--build says nothing on stderr when it took no timeout', [out.status, out.stderr], [0, '']);
  check('--build refuses a file that is missing', cli('--build', path.join(work, 'nope.jsonl'), '--plugin-sha', SHA).status, 2);
  check('a flag that needs a value and has none is a usage refusal, even last or before another flag', [
    cli('--score', met, '--set'), cli('--build', rowsFile, '--plugin-sha'), cli('--build', rowsFile, '--plugin-sha', SHA, '--arm'), cli('--score', met, '--set', '--pooled'),
  ].map((r) => [...err(r).slice(0, 2), /needs a value/.test(r.stderr)]), Array(4).fill([2, true, true]));
  const pausedFile = put('paused.jsonl', rowsFor(5).map((r, i) => JSON.stringify({ status: 'done', row: i === 0 ? { ...r, outcome: 'paused' } : r })).join('\n'));
  const pausedRun = cli('--build', pausedFile, '--plugin-sha', SHA);
  check('--build refuses a draw that ended paused rather than scoring it', [pausedRun.status, /ended paused/.test(pausedRun.stderr)], [2, true]);
  return { pass, fail };
}

const say = (s) => console.log(s);
const real = await suite(path.join(LIB, 'sizing-score.mjs'), say);

// ---- mutations: each guard broken on a scratch copy of the module; the suite must fail on it ------------------------
say('== sizing score: mutations ==');
const MUTATIONS = [
  ['the share threshold weakened to 3 of 5', 'Math.ceil((draws * 4) / 5)', 'Math.ceil((draws * 3) / 5)'],
  ['the floor rule dropped', 'const need = floor ? draws.length : needOf(draws.length);', 'const need = needOf(draws.length);'],
  ['the label-hash check dropped', 'if (rec.label_sha256 !== labelHash(set))', 'if (false)'],
  // A tie can only change the reported modal tier, never `pass` (a tied top count is below the need); the suite pins the modal.
  ['the empty-rows guard dropped', 'counts.length !== 1 || counts[0] === 0', 'counts.length !== 1'],
  ['the pooled allowance rounded up', 'Math.floor(total / 10)', 'Math.ceil(total / 10)'],
  ['an invalid draw taken as an answer', "(r.outcome === 'invalid' && r.reason !== 'probe' && !isTakenTimeout(r))", 'false'],
  ['a timeout taken whatever its tier', "r.tier === 'full' && r.tierSource === 'file'", "r.tierSource === 'file'"],
  ['a timeout taken whatever its reason', "r.reason === 'timeout' && r.tier === 'full'", "r.tier === 'full'"],
  ['a timeout counted whatever its outcome', "r.outcome === 'invalid' && r.reason === 'timeout'", "r.reason === 'timeout'"],
  ['a timeout taken whatever its tier source', "r.tier === 'full' && r.tierSource === 'file'", "r.tier === 'full'"],
  ['ties resolved to the first tier', 'if (top.length !== 1) return { tier: null, count };', 'if (top.length === 0) return { tier: null, count };'],
];
let mutFail = 0;
for (const [name, from, to] of MUTATIONS) {
  const m = scratch(from, to);
  const r = m.applies ? await suite(m.file, () => {}) : { fail: 0 };
  const red = m.applies && r.fail > 0;
  if (!red) mutFail++;
  say(red ? `  ok   mutation turns the suite red: ${name} (${r.fail} failing)` : `  FAIL mutation ${m.applies ? 'left the suite green' : 'did not apply'}: ${name}`);
}

const failed = real.fail + mutFail;
say(`  ${real.pass} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
