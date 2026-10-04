#!/usr/bin/env bash
# Pins the verdict record, its canonical hash and the hash chain (FR-17, FR-33, FR-38) in
# tests/evals/lib/verdict-record.mjs. Hermetic: pure computation on in-memory records and one temp
# dir for the file round trip; no model, network or credential. Skipped in a published tarball,
# where tests/evals is absent by design.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: verdict record & hash chain =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export TMP

# Child-process probe: patches fs BEFORE importing the module, so a failing call can be injected, and a
# regression that blocks (a FIFO read) fails by timeout instead of hanging npm test.
CHILD=$(cat <<'EOF'
import fs from 'node:fs';
const err = (c, s) => Object.assign(new Error(c), { code: c, syscall: s });
const m = process.env.MODE;
if (m === 'uid') { const real = fs.fstatSync; fs.fstatSync = (fd) => { const st = real(fd); return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { uid: st.uid + 1 }); }; }
if (m === 'fsync') fs.fsyncSync = () => { throw err('EIO', 'fsync'); };
if (m === 'partial' || m === 'stuck') fs.writeFileSync = (fd, d) => { fs.writeSync(fd, d.slice(0, 10)); throw err('ENOSPC', 'write'); };
if (m === 'stuck') fs.ftruncateSync = () => { throw err('EIO', 'ftruncate'); };
const { appendRecord } = await import('./tests/evals/lib/verdict-record.mjs');
console.log(JSON.stringify(appendRecord(process.env.F, JSON.parse(process.env.REC), process.env.OPTS ? JSON.parse(process.env.OPTS) : undefined)));
EOF
)
export CHILD

out=$(node --input-type=module -e "
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { abortedRecord, appendRecord, canonicalJson, recordHash, sealRecord, validateRecord, verifyChain } from './tests/evals/lib/verdict-record.mjs';
import { triage, rerunAllowed, TRIAGE_RESULTS } from './tests/evals/lib/triage.mjs';
const res = [];
const ser = (x) => JSON.stringify(x, (key, v) => (v === undefined ? 'UNDEFINED' : v)); // undefined stays distinct from null
const check = (name, got, want) => res.push([ser(got) === ser(want), name, got, want]);
const safe = (f) => { try { return f(); } catch { return 'THREW'; } };

const arm = (fails = 1, o = {}) => ({ outcomes: [...Array(fails).fill('fail'), ...Array(9 - fails).fill('pass')], cli: Array(9).fill('1.0.0'), models: Array(9).fill('m-a'), digest: 'd1', ...o });
const base = (o = {}) => ({
  schema_version: 1, kind: 'verdict', digest: 'd1', rule: 'pooled-9-4', tasks: [{ id: 't1', hash: 'h1' }, { id: 't2', hash: 'h2' }],
  tier_config: 'tier-a', instrument_digest: 'inst', cli_version: '1.0.0', model_ids: ['m-a'], candidate: arm(), baseline: null,
  cost_candidate_usd: 12.5, cost_baseline_usd: 0, baseline_digest: null, triage_result: 'pass', rerun_of: null, rerun_reason: null,
  prev_record_hash: null, ...o,
});
const chain = (n = 4) => { const out = []; let prev = null; for (let i = 0; i < n; i++) { const r = sealRecord(base({ digest: 'd' + i, prev_record_hash: prev })); out.push(r); prev = r.record_hash; } return out; };
const C = chain();
const genesis = C[0].record_hash;
const head = C[3].record_hash;
const reseal = (list) => { let prev = null; return list.map((r) => { const { record_hash, ...rest } = r; const s = sealRecord({ ...rest, prev_record_hash: prev }); prev = s.record_hash; return s; }); };
const V = (list, o) => verifyChain(list, o);
const okOf = (list, o) => V(list, o)?.ok ?? null;
const clone = (x) => JSON.parse(JSON.stringify(x));
const thrower = new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });

// Chain semantics.
check('a 4-record chain verifies', V(C), { ok: true, length: 4, head });
check('genesis and head anchor both match', okOf(C, { genesisHash: genesis, headAnchor: head }), true);
check('an empty chain passes with nothing supplied, fails against a genesis or an anchor', [okOf([]), okOf([], { genesisHash: genesis }), okOf([], { headAnchor: head })], [true, false, false]);
const noMiddle = [C[0], C[2], C[3]];
check('deleting a middle record fails, naming the link', [V(noMiddle).ok, V(noMiddle).index, V(noMiddle).reason], [false, 1, 'broken link between record 0 and record 1']);
const edited = clone(C); edited[1].cost_candidate_usd = 12.6;
check('editing one field fails at the edited record', [V(edited).ok, V(edited).index], [false, 1]);
const flipped = clone(C); flipped[3].candidate.outcomes[8] = 'fail';
check('editing the last record is caught by its own hash without any anchor', [V(flipped).ok, V(flipped).index], [false, 3]);
check('editing one character of a stored hash fails', okOf(Object.assign(clone(C), { 2: { ...C[2], record_hash: C[2].record_hash.replace(/^./, (c) => (c === 'a' ? 'b' : 'a')) } })), false);
check('reordering fails', [okOf([C[0], C[2], C[1], C[3]]), V([C[1], C[0], C[2], C[3]]).index], [false, 0]);
check('a duplicated record fails at the repeat', [okOf([C[0], C[1], C[1], C[2]]), V([C[0], C[1], C[1], C[2]]).index], [false, 2]);
check('a chain that does not start at null fails', [okOf(C.slice(1)), V(C.slice(1)).index], [false, 0]);
check('a wrong genesis hash fails at record 0', [V(C, { genesisHash: 'f'.repeat(64) }).ok, V(C, { genesisHash: 'f'.repeat(64) }).index], [false, 0]);
check('a mismatched head anchor fails at the last record', [V(C, { headAnchor: 'f'.repeat(64) }).ok, V(C, { headAnchor: 'f'.repeat(64) }).index], [false, 3]);
const trunc = C.slice(0, 3);
check('tail truncation passes without an anchor (documented residual)', okOf(trunc), true);
check('tail truncation fails with the head anchor', [okOf(trunc, { headAnchor: head }), V(trunc, { headAnchor: head }).index], [false, 2]);
const rehashed = clone(C); rehashed[1].cost_candidate_usd = 0;
check('a re-hashed edited chain passes without an anchor (documented residual)', okOf(reseal(rehashed)), true);
check('the same re-hashed chain fails against the original genesis or head anchor', [okOf(reseal(rehashed), { headAnchor: head }), okOf(reseal([{ ...rehashed[0], cost_candidate_usd: 1 }, ...rehashed.slice(1)]), { genesisHash: genesis })], [false, false]);
check('undefined and null anchors mean none supplied', [okOf(C, { genesisHash: null, headAnchor: undefined }), okOf(C, undefined)], [true, true]);
check('a malformed anchor, genesis or option key is null, never a silent skip', [V(C, { headAnchor: 'abc' }), V(C, { genesisHash: 5 }), V(C, { headanchor: head }), V(C, []), V(C, null), V(C, 'x')], Array(6).fill(null));
check('an invalid record inside the chain fails at its index', [V([C[0], { ...C[1], extra: 1 }]).index, V([C[0], null]).index, V([C[0], { ...C[1], schema_version: 2 }]).index], [1, 1, 1]);
check('non-array / sparse / throwing chain input -> null', [V(undefined), V(null), V({}), V('x'), V(new Array(2)), V(Object.assign(C.slice(), { length: 5 })), safe(() => V(thrower))], Array(7).fill(null));
check('a Proxy chain whose length flips is decided on the one copy', safe(() => { let c = 0; return V(new Proxy(C.slice(), { get(t, k) { return k === 'length' ? (c++ === 0 ? 4 : 0) : t[k]; } })); }), { ok: true, length: 4, head });
check('a flipping record getter is read once: verified bytes are the hashed bytes', safe(() => { let c = 0; const r = { ...C[1] }; Object.defineProperty(r, 'cost_candidate_usd', { get() { return c++ === 0 ? C[1].cost_candidate_usd : 99; } }); return okOf([C[0], r]); }), true);
check('a flipping getter that edits after validation is never hashed', safe(() => { let c = 0; const r = { ...C[0] }; Object.defineProperty(r, 'digest', { get() { return c++ === 0 ? 'zzz' : C[0].digest; } }); return okOf([r]); }), false);

// Hash: canonical and exhaustive.
const R = base();
check('recordHash is 64 lowercase hex and deterministic', [/^[0-9a-f]{64}\$/.test(recordHash(R)), recordHash(R) === recordHash(clone(R))], [true, true]);
const reorder = (o) => Object.fromEntries(Object.keys(o).reverse().map((k) => [k, o[k]]));
check('key order does not change the hash (top level, nested arm, task)', [recordHash(reorder(R)) === recordHash(R), recordHash({ ...R, candidate: reorder(R.candidate) }) === recordHash(R), recordHash({ ...R, tasks: R.tasks.map(reorder) }) === recordHash(R)], [true, true, true]);
check('canonicalJson sorts keys, no whitespace, and is injective on key order', [canonicalJson({ b: [1, { d: 2, c: null }], a: 'x' }), canonicalJson({ a: 'x', b: [1, { c: null, d: 2 }] })], ['{\"a\":\"x\",\"b\":[1,{\"c\":null,\"d\":2}]}', '{\"a\":\"x\",\"b\":[1,{\"c\":null,\"d\":2}]}']);
check('canonicalJson: strings are escaped (quote, backslash, control, lone surrogate) and distinct strings stay distinct', [canonicalJson('a\"b\\\\c\\n'), canonicalJson('\\ud800') !== canonicalJson('\\ufffd'), canonicalJson('é') !== canonicalJson('e\\u0301')], ['\"a\\\\\"b\\\\\\\\c\\\\n\"', true, true]);
check('canonicalJson: a key that holds a different structure never collides', canonicalJson({ a: '1,\"b\":2' }) !== canonicalJson({ a: '1', b: 2 }), true);
check('canonicalJson refuses NaN, Infinity, -0, undefined, function, symbol, bigint, Date, Map, sparse, extra array prop, cycle, deep nesting', [NaN, Infinity, -0, undefined, () => 1, Symbol('s'), 1n, new Date(0), new Map(), new Array(2), Object.assign([1], { x: 1 }), (() => { const o = {}; o.o = o; return o; })(), (() => { let o = 1; for (let i = 0; i < 40; i++) o = [o]; return o; })(), { u: undefined }, { [Symbol('k')]: 1 }, thrower].map((v) => safe(() => canonicalJson(v))), Array(16).fill(null));
check('canonicalJson takes a __proto__ own key as plain data', safe(() => canonicalJson(JSON.parse('{\"__proto__\":1,\"a\":2}'))), '{\"__proto__\":1,\"a\":2}');
check('the hash input is the canonical bytes of the record without record_hash (independent recomputation)', createHash('sha256').update(canonicalJson(R), 'utf8').digest('hex'), recordHash(R));
check('record_hash is not part of its own input: sealed and unsealed hash agree', [sealRecord(R).record_hash === recordHash(R), recordHash(sealRecord(R)) === recordHash(R)], [true, true]);
const fields = Object.keys(R);
check('dropping any one field is refused: null, never the hash of the shorter record', fields.map((k) => { const drop = { ...R }; delete drop[k]; return recordHash(drop) !== recordHash(R); }).every(Boolean), true);
const changes = { digest: 'dx', rule: 'r2', tier_config: 'tier-b', instrument_digest: 'i2', cli_version: '2', model_ids: ['m-b'], cost_candidate_usd: 13, cost_baseline_usd: 1, baseline_digest: 'bd', triage_result: 'block', rerun_of: 'x', rerun_reason: 'y', prev_record_hash: 'a'.repeat(64), tasks: [{ id: 't1', hash: 'h9' }], candidate: arm(2), baseline: arm(3), schema_version: 2 };
check('every stored field, edited alone, changes the hash or is refused (the unchanged ones are listed)', Object.keys(changes).filter((k) => { const h = recordHash({ ...R, [k]: changes[k] }); return h === recordHash(R); }), []);
check('rerun_of / rerun_reason edited together change the hash', recordHash({ ...R, rerun_of: 'x', rerun_reason: 'y' }) !== recordHash(R), true);
check('a task id, a task hash, a model id, an arm digest, one cli entry, one outcome each change the hash', [
  recordHash({ ...R, tasks: [{ id: 't9', hash: 'h1' }, R.tasks[1]] }), recordHash({ ...R, tasks: [{ id: 't1', hash: 'h9' }, R.tasks[1]] }), recordHash({ ...R, model_ids: ['m-z'] }),
  recordHash({ ...R, candidate: arm(1, { digest: 'z' }) }), recordHash({ ...R, candidate: arm(1, { cli: ['1.0.1', ...Array(8).fill('1.0.0')] }) }), recordHash({ ...R, candidate: arm(1, { models: ['m-b', ...Array(8).fill('m-a')] }) }), recordHash({ ...R, candidate: arm(2) }),
].every((h) => h !== null && h !== recordHash(R)), true);
check('1, 1.0 and 1e0 are one number; 0.3 and 0.1+0.2 are two, not rounded together', [recordHash({ ...R, cost_candidate_usd: 1 }) === recordHash({ ...R, cost_candidate_usd: 1.0 }), recordHash({ ...R, cost_candidate_usd: 1 }) === recordHash({ ...R, cost_candidate_usd: 1e0 }), recordHash({ ...R, cost_candidate_usd: 0.3 }) !== recordHash({ ...R, cost_candidate_usd: 0.1 + 0.2 })], [true, true, true]);
check('the hash survives a file round trip (stringify, parse, same hash)', recordHash(JSON.parse(JSON.stringify(sealRecord(R)))), recordHash(R));
check('unicode in a string field is hashed as UTF-8 and distinct strings differ', [recordHash({ ...R, rule: 'é' }) !== recordHash({ ...R, rule: 'é' }), recordHash({ ...R, rule: '😀' }) !== null], [true, true]);

// Validation: allowlist, required fields, schema version.
const sealed = sealRecord(R);
check('a sealed record validates and returns an equal plain copy', [validateRecord(sealed), validateRecord(sealed) === sealed], [sealed, false]);
check('an unsealed record fails validateRecord but has a hash', [validateRecord(R), typeof recordHash(R)], [null, 'string']);
check('unknown schema_version (2, 0, \"1\", missing) -> null', [2, 0, '1', undefined].map((v) => validateRecord({ ...sealed, schema_version: v })), Array(4).fill(null));
check('an extra field, secret-like or not, is rejected (also nested)', [validateRecord({ ...sealed, api_key: 'sk-secret' }), validateRecord({ ...sealed, candidate: { ...sealed.candidate, token: 'x' } }), validateRecord({ ...sealed, tasks: [{ id: 't', hash: 'h', path: '/etc' }] }), recordHash({ ...R, password: 'p' }), sealRecord({ ...R, note: 'n' })], Array(5).fill(null));
check('an inherited or __proto__ field is not read as a record field', [validateRecord(Object.create(sealed)), validateRecord(JSON.parse(JSON.stringify(sealed).replace('{', '{\"__proto__\":{\"x\":1},'))), validateRecord(Object.assign(Object.create({ rule: 'r' }), (({ rule, ...x }) => x)(sealed)))], [null, null, null]);
check('a verdict cannot carry candidate_result and an aborted record cannot carry triage_result', [validateRecord({ ...sealed, candidate_result: null }), validateRecord({ ...sealed, kind: 'aborted' })], [null, null]);
const ab = (c, o = {}) => { const { triage_result, ...rest } = R; return sealRecord({ ...rest, kind: 'aborted', candidate_result: c, ...o }); };
const part = (...o) => ({ outcomes: o, cli: o.map(() => '1'), models: o.map(() => 'm'), digest: 'd1' });
const k = (n, f) => part(...Array(f).fill('fail'), ...Array(n - f).fill('pass'));
check('aborted records validate with candidate_result FAIL / pass / null and a partial or null arm', [ab('FAIL', { candidate: arm(4) }), ab('pass'), ab(null, { candidate: k(3, 3) }), ab('FAIL', { candidate: arm(4, { outcomes: ['fail', 'fail', 'fail', 'fail'], cli: Array(4).fill('1'), models: Array(4).fill('m') }) }), ab(null, { candidate: null })].map((r) => r !== null && validateRecord(r) !== null), Array(5).fill(true));
check('aborted: a bad candidate_result (fail, undefined, 1) or mismatched partial lengths -> null', [ab('fail'), ab(undefined), ab(1), ab('pass', { candidate: arm(1, { cli: Array(8).fill('1') }) }), ab('pass', { candidate: arm(1, { outcomes: Array(10).fill('pass') }) })], Array(5).fill(null));
check('verdict: triage_result must be a TRIAGE_RESULTS member, each member accepted', [...TRIAGE_RESULTS.map((t) => sealRecord({ ...R, triage_result: t }) !== null), sealRecord({ ...R, triage_result: 'maybe' }), sealRecord({ ...R, triage_result: undefined })], [...TRIAGE_RESULTS.map(() => true), null, null]);
check('verdict: arms must be complete (9 draws, 9 cli, 9 models); a missing or short candidate is refused', [sealRecord({ ...R, candidate: null }), sealRecord({ ...R, candidate: arm(1, { outcomes: Array(8).fill('pass') }) }), sealRecord({ ...R, candidate: arm(1, { cli: '1.0.0' }) }), sealRecord({ ...R, candidate: arm(1, { models: 'm-a' }) }), sealRecord({ ...R, baseline: arm(1, { cli: Array(8).fill('1') }) }), sealRecord({ ...R, baseline: arm(1) }) !== null], [null, null, null, null, null, true]);
check('verdict arms of 8 draws with 8 cli and 8 models entries (self-consistent but short) -> null; an aborted one of 8 is fine', [sealRecord({ ...R, candidate: arm(1, { outcomes: Array(8).fill('pass'), cli: Array(8).fill('1'), models: Array(8).fill('m') }) }), sealRecord({ ...R, baseline: arm(1, { outcomes: Array(8).fill('pass'), cli: Array(8).fill('1'), models: Array(8).fill('m') }) }), ab('pass', { candidate: arm(1, { outcomes: Array(8).fill('pass'), cli: Array(8).fill('1'), models: Array(8).fill('m') }) }) !== null], [null, null, true]);
check('recordHash hashes the one validated read, not a second read of the input', safe(() => { let c = 0; const o = { ...R }; Object.defineProperty(o, 'cost_candidate_usd', { get() { return c++ === 0 ? 12.5 : 99; } }); return recordHash(o) === recordHash(R); }), true);
check('unknown outcome tokens (invalid, Pass, 1) and empty cli / models entries -> null', [['outcomes', 'invalid'], ['outcomes', 'Pass'], ['outcomes', 1], ['cli', ''], ['models', null]].map(([f, x]) => sealRecord({ ...R, candidate: arm(1, { [f]: [x, ...arm(1)[f].slice(1)] }) })), Array(5).fill(null));
const rr = (o) => sealRecord({ ...R, ...o });
check('rerun_of / rerun_reason: both null or both text; one, empty or typed wrong -> null', [rr({ rerun_of: 'h', rerun_reason: 'why' }) !== null, rr({ rerun_of: 'h' }), rr({ rerun_reason: 'why' }), rr({ rerun_of: '', rerun_reason: '' }), rr({ rerun_of: 5, rerun_reason: 'x' }), rr({ rerun_of: undefined, rerun_reason: undefined })], [true, null, null, null, null, null]);
check('missing or mistyped common fields -> null', fields.map((k) => { const m = { ...R }; delete m[k]; return sealRecord(m); }), Array(fields.length).fill(null));
check('bad scalars: empty text, negative / NaN / Infinity / -0 / string cost, bad prev hash, empty tasks and model_ids -> null', [rr({ digest: '' }), rr({ rule: 5 }), rr({ cost_candidate_usd: -1 }), rr({ cost_baseline_usd: NaN }), rr({ cost_candidate_usd: Infinity }), rr({ cost_candidate_usd: -0 }), rr({ cost_candidate_usd: '1' }), rr({ prev_record_hash: 'xyz' }), rr({ prev_record_hash: 'A'.repeat(64) }), rr({ tasks: [] }), rr({ model_ids: [] }), rr({ model_ids: [''] }), rr({ tasks: [{ id: '', hash: 'h' }] }), rr({ baseline_digest: '' })], Array(14).fill(null));
check('non-object, array, null, throwing and Proxy-throwing input -> null for all four functions', [null, undefined, 5, 'x', [], thrower].flatMap((v) => [safe(() => validateRecord(v)), safe(() => recordHash(v)), safe(() => sealRecord(v))]), Array(18).fill(null));
check('a record getter that flips is read once (validated copy and hash agree)', safe(() => { let c = 0; const o = { ...R }; Object.defineProperty(o, 'rule', { get() { return c++ === 0 ? 'r1' : 5; } }); return sealRecord(o)?.rule; }), 'r1');
check('arrays with a Proxy length that flips are decided on one copy', safe(() => { let c = 0; return sealRecord({ ...R, tasks: new Proxy(R.tasks.slice(), { get(t, k) { return k === 'length' ? (c++ === 0 ? 2 : 0) : t[k]; } }) })?.tasks.length; }), 2);
check('sparse arrays (tasks, model_ids, outcomes, cli, models) -> null', [rr({ tasks: new Array(2) }), rr({ model_ids: new Array(1) }), ...['outcomes', 'cli', 'models'].map((f) => { const a = arm(1); delete a[f][4]; return rr({ candidate: a }); })], Array(5).fill(null));
check('non-array where an array is required -> null', [rr({ tasks: { length: 1, 0: R.tasks[0] } }), rr({ model_ids: 'm-a' }), rr({ candidate: arm(1, { outcomes: 'x'.repeat(9) }) })], [null, null, null]);

// Aborted: candidate_result must agree with the partial candidate arm, on both sides of each boundary.
const acc = (cr, c, o = {}) => ab(cr, { candidate: c, ...o }) !== null;
check('FAIL exactly at 4 failures: 3 of 3 takes null only, 4 of 4 takes FAIL only', [acc('FAIL', part('fail', 'fail', 'fail')), acc(null, part('fail', 'fail', 'fail')), acc('pass', part('fail', 'fail', 'fail')), acc('FAIL', k(4, 4)), acc(null, k(4, 4)), acc('pass', k(4, 4))], [false, true, false, true, false, false]);
check('6 of 6 failed with candidate_result null is refused (a free reroll); over-budget and unexpected-pause count as failures', [acc(null, k(6, 6)), acc('FAIL', k(6, 6)), acc(null, part('over-budget', 'unexpected-pause', 'fail', 'over-budget')), acc('FAIL', part('over-budget', 'unexpected-pause', 'fail', 'over-budget'))], [false, true, false, true]);
check('pass only when failures plus undrawn draws stay below 4 (6 draws: 0 fails pass, 1 fail unknown; 8: 2 pass, 3 unknown; full 9: 3 pass, 4 FAIL)', [acc('pass', k(6, 0)), acc(null, k(6, 0)), acc('pass', k(6, 1)), acc(null, k(6, 1)), acc('pass', k(8, 2)), acc(null, k(8, 2)), acc('pass', k(8, 3)), acc(null, k(8, 3)), acc('pass', k(9, 3)), acc('FAIL', k(9, 3)), acc(null, k(9, 3)), acc('FAIL', k(9, 4)), acc('pass', k(9, 4)), acc(null, k(9, 4))], [true, false, false, true, true, false, false, true, true, false, false, true, false, false]);
check('a null candidate arm takes null only; an aborted arm with 0 draws is refused (candidate or baseline), 1 draw is fine', [acc(null, null), acc('FAIL', null), acc('pass', null), acc(null, part()), acc(null, null, { baseline: part() }), acc(null, null, { baseline: part('fail') })], [true, false, false, false, false, true]);
check('each validator guard rejects its bad value: task hash, arm digest, instrument_digest, record_hash format, cost_baseline_usd range, a sealed input to sealRecord, a 10-entry aborted arm', [rr({ tasks: [{ id: 't1', hash: '' }] }), rr({ candidate: arm(1, { digest: '' }) }), rr({ instrument_digest: '' }), validateRecord({ ...sealed, record_hash: 'xyz' }), rr({ cost_baseline_usd: -1 }), sealRecord(sealed), ab('pass', { candidate: part(...Array(10).fill('pass')) })], Array(7).fill(null));
const unsafeText = ['m\\n', 'a\\u001b[2J', 'x\\u202ey', 'a\\u200bb', 'a\\u2028b', 'a\\u2029b', 'a\\ud800b', 'a\\u0085b', 'a\\u009bb', 'a\\u0000b', 'a\\u200db'];
const inFields = (v) => [rr({ rule: v }), rr({ model_ids: [v] }), rr({ candidate: arm(1, { cli: [v, ...Array(8).fill('1')] }) }), rr({ candidate: arm(1, { models: [v, ...Array(8).fill('m')] }) }), rr({ tasks: [{ id: v, hash: 'h' }] }), rr({ tasks: [{ id: 't', hash: v }] }), rr({ rerun_of: v, rerun_reason: 'w' }), rr({ baseline_digest: v })];
check('text fields refuse newline, ESC, C1, RLO, zero-width space and joiner, U+2028 / U+2029, a lone surrogate and NUL, in every field kind', unsafeText.flatMap(inFields), Array(unsafeText.length * 8).fill(null));
const long = (n) => 'r'.repeat(n);
check('text is 1 to 512 UTF-16 code units: 512 accepted, 513 refused (256 emoji = 512 units accepted, 257 refused), in every field kind; ordinary unicode (accents, emoji, CJK) is accepted', [[...inFields(long(512)), ...inFields('😀'.repeat(256)), ...['é', '😀', '日本語'].flatMap(inFields)].every((r) => r !== null), [...inFields(long(513)), ...inFields('😀'.repeat(257))].every((r) => r === null)], [true, true]);
const blanky = ['a\\ue000', '\\u3164', 'a\\u115f', 'a\\u1160', 'a\\uffa0', 'a\\u2800', ' x', 'x ', ' ', '  ', '\\u00a0x', 'x\\u00a0', '\\u00a0', '\\u3000', 'x\\u3000', '\\u2003x', 'x\\u1680'];
check('text refuses private-use, the Hangul fillers, the blank Braille cell, and leading / trailing / whitespace-only values (ASCII, NBSP, ideographic and other spaces)', blanky.flatMap(inFields), Array(blanky.length * 8).fill(null));
const resid = ['claude-code 2.1.207', 'vendor-model-1-2', 'tier-a', 'a b', 'a\\u00a0b', 'a\\ufe0f', 'a\\u034fb', 'a' + '\\u0301'.repeat(100), 'p\\u0430ypal', 'a\\u0378'];
check('text still accepts real values (interior space) and the documented residuals: variation selector, combining grapheme joiner, stacked combining marks, interior NBSP, homoglyphs, unassigned code points', resid.flatMap(inFields).every((r) => r !== null), true);
check('recordHash ignores a well-formed record_hash and returns null for a malformed one', [recordHash(sealed) === recordHash(R), recordHash({ ...R, record_hash: 'xyz' }), recordHash({ ...R, record_hash: undefined })], [true, null, null]);
check('verifyChain refuses an opts with a foreign prototype (an inherited headAnchor is not ignored); plain and null-prototype opts work', [V(C, Object.create({ headAnchor: 'f'.repeat(64) })), V(C, new (class X {})()), V(C, Object.create(null))?.ok, V(C, { headAnchor: head })?.ok], [null, null, true, true]);

// abortedRecord: derives candidate_result from the candidate arm.
const { triage_result: _t, kind: _k, prev_record_hash: _p, ...AF } = R;
const mk = (o = {}) => abortedRecord({ ...AF, ...o });
const { rerun_of: _a, rerun_reason: _b, ...AFR } = AF;
const mf = abortedRecord({ ...AFR, candidate: k(6, 4) });
check('abortedRecord after an early candidate FAIL (4 failures, arm unfinished; no rerun fields given) carries FAIL, emits null rerun fields, seals and validates', [mf?.kind, mf?.candidate_result, mf?.rerun_of, mf?.rerun_reason, mf != null && 'rerun_of' in mf && 'rerun_reason' in mf, validateRecord(sealRecord(mf)) !== null], ['aborted', 'FAIL', null, null, true, true]);
check('abortedRecord derives candidate_result: 3 of 3 failed -> null, no arm -> null, complete 1-failure arm -> pass, 8 clean draws -> pass', [k(3, 3), null, k(9, 1), k(8, 0)].map((c) => mk({ candidate: c })?.candidate_result), [null, null, 'pass', 'pass']);
const { digest: _d, ...noDigest } = AF;
check('abortedRecord refuses a caller kind / candidate_result / prev_record_hash / record_hash, a missing field, a bad or absent arm, junk input', [mk({ kind: 'aborted' }), mk({ candidate_result: 'FAIL' }), mk({ prev_record_hash: null }), mk({ record_hash: 'a'.repeat(64) }), abortedRecord(noDigest), mk({ candidate: part() }), mk({ candidate: undefined }), abortedRecord(null), safe(() => abortedRecord(thrower))], Array(9).fill(null));
check('abortedRecord: rerun_of and rerun_reason pass through together; one alone -> null', [mk({ rerun_of: 'h', rerun_reason: 'w' })?.rerun_of, mk({ rerun_of: 'h' })], ['h', null]);
check('rerunAllowed counts an early-FAIL abort as used and an undecided abort as not', [rerunAllowed([sealRecord(mf)], 'd1')?.verdict, rerunAllowed([sealRecord(mk({ candidate: k(3, 3) }))], 'd1')?.verdict], ['refused', 'allowed']);

// Compatibility with triage.mjs: every record it needs is accepted, and what it rejects is rejected.
const hist = [sealRecord(R), ab('FAIL', { candidate: arm(4) }), ab('pass'), ab(null, { candidate: null }), sealRecord({ ...R, rerun_of: 'h0', rerun_reason: 'flaky' }), ...TRIAGE_RESULTS.map((t) => sealRecord({ ...R, triage_result: t }))];
const passIn = { candidate: arm(0, { digest: 'cand' }), baseline: null, tagBaselineDigest: null };
check('every record shape triage reads is accepted by validateRecord', hist.map((r) => r !== null && validateRecord(r) !== null), hist.map(() => true));
check('validated records feed triage and rerunAllowed without null', [triage({ ...passIn, history: hist })?.verdict, rerunAllowed(hist, 'd1')?.verdict], ['pass', 'refused']);
check('each record alone is accepted by triage and rerunAllowed', hist.map((r) => triage({ ...passIn, history: [r] }) !== null && rerunAllowed([r], 'd1') !== null), hist.map(() => true));
check('a chain of validated records is accepted by triage as history', triage({ ...passIn, history: C })?.verdict, 'pass');
const mutate = (f) => { const m = { ...sealed }; f(m); return m; };
const rejected = [
  (m) => { delete m.kind; }, (m) => { m.kind = 'other'; }, (m) => { m.digest = ''; }, (m) => { m.triage_result = 'maybe'; }, (m) => { delete m.triage_result; },
  (m) => { delete m.rerun_of; }, (m) => { delete m.rerun_reason; }, (m) => { m.rerun_of = 'h0'; }, (m) => { m.rerun_reason = 'why'; }, (m) => { m.rerun_of = ''; m.rerun_reason = ''; }, (m) => { m.rerun_of = 5; m.rerun_reason = 'x'; },
  (m) => { delete m.kind; m.kind = 'aborted'; m.candidate_result = undefined; delete m.triage_result; }, (m) => { m.kind = 'aborted'; m.candidate_result = 'fail'; delete m.triage_result; }, (m) => { m.kind = 'aborted'; m.candidate_result = 1; delete m.triage_result; },
];
check('every record shape copyHistory rejects is rejected by validateRecord', rejected.map((f) => { const m = mutate(f); return [validateRecord(m), triage({ ...passIn, history: [m] })]; }), rejected.map(() => [null, null]));
check('a record with a per-record (scalar) cli / models instead of 9 per-draw entries is refused', [sealRecord({ ...R, candidate: arm(1, { cli: '1.0.0' }) }), sealRecord({ ...R, candidate: { ...arm(1), models: undefined } })], [null, null]);

// File round trip in a temp dir: what is written is what verifies.
const file = process.env.TMP + '/verdicts.jsonl';
fs.writeFileSync(file, C.map((r) => JSON.stringify(r)).join('\\n') + '\\n');
const read = () => fs.readFileSync(file, 'utf8').trim().split('\\n').map((l) => JSON.parse(l));
check('a JSONL file written from a chain verifies after reading', V(read(), { genesisHash: genesis, headAnchor: head })?.ok, true);
fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('\"cost_candidate_usd\":12.5', '\"cost_candidate_usd\":12.4'));
check('a semantic edit (one number) of the stored file fails the chain', [V(read()).ok, V(read()).index], [false, 0]);
fs.writeFileSync(file, C.filter((_, i) => i !== 1).map((r) => JSON.stringify(r)).join('\\n') + '\\n');
check('deleting a middle line of the stored file fails, naming the link', V(read())?.reason, 'broken link between record 0 and record 1');

// appendRecord: the append-only store, in a temp dir.
const D = process.env.TMP + '/store';
fs.mkdirSync(D);
const af = (n) => D + '/' + n;
const lines = (f) => { try { return fs.readFileSync(f, 'utf8').trim().split('\\n').map((l) => JSON.parse(l)); } catch { return []; } };
const put = (f, content) => { fs.writeFileSync(f, content, { mode: 0o600 }); return f; };
const probe = (mode, f, rec, opts) => safe(() => JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', process.env.CHILD], { timeout: 10000, encoding: 'utf8', env: { ...process.env, MODE: mode, F: f, REC: JSON.stringify(rec), OPTS: opts ? JSON.stringify(opts) : '' } })));
const f1 = af('s.jsonl');
const missing = appendRecord(f1, base());
check('a missing store is refused when create is not requested, and nothing is created', [missing?.ok, missing?.reason, fs.existsSync(f1)], [false, 'store is missing and create was not requested', false]);
const a1 = [0, 1, 2].map((i) => appendRecord(f1, base({ digest: 'a' + i }), i === 0 ? { create: true } : undefined));
const L1 = lines(f1);
check('append x3 (the first with create: true): each ok with a growing length, 3 lines on disk, verifyChain accepts them', [a1.map((a) => a?.ok), a1.map((a) => a?.length), V(L1)?.ok, V(L1)?.head === a1[2]?.record?.record_hash], [[true, true, true], [1, 2, 3], true, true]);
check('first appended record has prev_record_hash null, each later one links to the one before', [L1[0]?.prev_record_hash, L1[1]?.prev_record_hash === L1[0]?.record_hash, L1[2]?.prev_record_hash === L1[1]?.record_hash], [null, true, true]);
check('the returned record is the validated, sealed line that was written', canonicalJson(a1[1]?.record) === canonicalJson(L1[1]), true);
check('a created store is owner-only (0o600)', (fs.statSync(f1).mode & 0o777).toString(8), '600');
const ar = appendRecord(f1, mk({ candidate: k(6, 4) }));
check('an aborted record appends after verdicts, carries FAIL, and the 4-record chain verifies', [ar?.ok, ar?.record?.candidate_result, V(lines(f1))?.length], [true, 'FAIL', 4]);
const good = fs.readFileSync(f1, 'utf8');
let nf = 0;
const refuse = (content, size) => { const f = put(af('c' + nf++ + '.jsonl'), content); if (size) fs.truncateSync(f, size); const before = fs.readFileSync(f); const r = appendRecord(f, base()); return { ok: r?.ok, index: r?.index, reason: r?.reason, same: before.equals(fs.readFileSync(f)) }; };
const edit = refuse(good.replace('\"cost_candidate_usd\":12.5', '\"cost_candidate_usd\":12.4'));
const gone = refuse(good.split('\\n').filter((_, i) => i !== 1).join('\\n'));
check('append to a corrupted store is refused, names the broken record or link, and leaves the file byte-for-byte unchanged', [edit, gone].map((r) => [r.ok, r.index, r.reason, r.same]), [[false, 0, 'record 0 does not match its record_hash (edited)', true], [false, 1, 'broken link between record 0 and record 1', true]]);
const partial = refuse(good + '{\"schema_ver');
const nonl = refuse(good.slice(0, -1));
const crlf = refuse(good.replace(/\\n/g, '\\r\\n'));
const junk = refuse('not json\\n');
const blank = refuse(good + '\\n');
const MAXB = 32 * 1024 * 1024;
const bigJunk = (n) => { const b = Buffer.alloc(n, 'x'); b[n - 1] = 10; return b; };
const huge = refuse('', MAXB + 1);
const atMax = refuse(bigJunk(MAXB));
const overMax = refuse(bigJunk(MAXB + 1));
check('a trailing partial line, a missing final newline, CRLF, a non-JSON line, a blank line and an oversized file are each refused, file unchanged', [partial, nonl, crlf, junk, blank, huge].map((r) => [r.ok, r.index, r.same]), [[false, null, true], [false, null, true], [false, 0, true], [false, 0, true], [false, 4, true], [false, null, true]]);
check('refusal reasons name the cause', [partial.reason, nonl.reason, crlf.reason, junk.reason, huge.reason], ['store ends in a partial line (no final newline)', 'store ends in a partial line (no final newline)', 'record 0 has a carriage return (the store is LF-only)', 'record 0 is not valid JSON', 'store is larger than 33554432 bytes']);
check('the size limit is exact: a junk file of exactly 32 MiB reaches the JSON refusal, one byte more is the size refusal', [atMax.reason, atMax.same, overMax.reason, overMax.same], ['record 0 is not valid JSON', true, 'store is larger than 33554432 bytes', true]);
const target = put(af('target.jsonl'), '');
fs.symlinkSync(target, af('link.jsonl'));
fs.symlinkSync(af('nowhere.jsonl'), af('dangling.jsonl'));
const sl = [af('link.jsonl'), af('dangling.jsonl')].map((f) => appendRecord(f, base(), { create: true }));
check('a symlink at the path (to a file, or dangling) is refused even with create: the target is not written and nothing is created through it', [sl.map((r) => r?.ok), fs.readFileSync(target, 'utf8'), fs.existsSync(af('nowhere.jsonl'))], [[false, false], '', false]);
fs.mkdirSync(af('dir'));
const dr = appendRecord(af('dir'), base());
check('a directory path is refused with a reason, not a throw', [dr?.ok, typeof dr?.reason], [false, 'string']);
safe(() => execFileSync('mkfifo', [af('fifo')]));
check('a FIFO is refused without blocking (probed in a child process with a timeout)', probe('plain', af('fifo'), base()), { ok: false, index: null, reason: 'store is not a regular file' });
check('a missing parent directory is refused even with create, and not created', [appendRecord(af('nodir/x.jsonl'), base(), { create: true })?.ok, fs.existsSync(af('nodir'))], [false, false]);
const hl = put(af('hl.jsonl'), good);
fs.linkSync(hl, af('hl2.jsonl'));
const wide = put(af('wide.jsonl'), good);
fs.chmodSync(wide, 0o666);
const unchanged = (f) => fs.readFileSync(f, 'utf8') === good;
check('a store with a second hard link, or a group/world-writable mode, is refused and unchanged', [appendRecord(hl, base())?.ok, unchanged(hl), appendRecord(wide, base())?.ok, unchanged(wide)], [false, true, false, true]);
const gH = lines(f1)[0].record_hash;
const hH = V(lines(f1)).head;
const anch = (o) => { const r = appendRecord(put(af('an' + nf++ + '.jsonl'), good), base(), o); return [r?.ok, r?.index]; };
check('genesisHash and headAnchor are checked before appending: wrong ones refused at the failing record, right ones accepted', [anch({ genesisHash: 'f'.repeat(64) }), anch({ headAnchor: 'f'.repeat(64) }), anch({ genesisHash: gH, headAnchor: hH })], [[false, 0], [false, 3], [true, undefined]]);
check('opts: an unknown key, a foreign prototype, a bad anchor, a non-boolean create or a non-object -> null, and no file is created', [appendRecord(af('o.jsonl'), base(), { crate: true }), appendRecord(af('o.jsonl'), base(), Object.create({ create: true })), appendRecord(af('o.jsonl'), base(), { create: true, headAnchor: 'abc' }), appendRecord(af('o.jsonl'), base(), { create: 'yes' }), appendRecord(af('o.jsonl'), base(), 'x'), appendRecord(af('o.jsonl'), base(), []), fs.existsSync(af('o.jsonl'))], [null, null, null, null, null, null, false]);
const w = () => put(af('w' + nf++ + '.jsonl'), good);
const wr = (mode) => { const f = w(); const r = probe(mode, f, base()); return [r?.ok, r?.reason, fs.readFileSync(f, 'utf8') === good]; };
check('fsync failing after the write, and a partial write then ENOSPC, are cut back to the verified size and reported as such (a retry cannot duplicate)', [wr('fsync'), wr('partial')], Array(2).fill([false, 'write failed; store truncated back to ' + Buffer.byteLength(good) + ' bytes', true]));
check('when the cut-back itself fails the reason says the store may hold a partial record', wr('stuck').slice(0, 2), [false, 'store may hold a partial record']);
const ovf = w();
const bigTasks = Array.from({ length: 200 }, (_, i) => ({ id: String(i).padEnd(512, 'x'), hash: 'h' }));
const oversize = appendRecord(ovf, base({ tasks: bigTasks }));
check('a sealed line over 64 KiB is refused before writing, store unchanged', [oversize?.ok, oversize?.reason, fs.readFileSync(ovf, 'utf8') === good], [false, 'record line is larger than 65536 bytes', true]);
const tasksFor = (bytes) => { for (let n = 100; n < 140; n++) { const mk1 = (last) => [...Array.from({ length: n }, (_, i) => ({ id: String(i).padEnd(512, 'x'), hash: 'h' })), { id: 'y'.repeat(last), hash: 'h' }]; const len1 = Buffer.byteLength(JSON.stringify(sealRecord(base({ tasks: mk1(1), prev_record_hash: gH }))) + '\\n'); const last = 1 + bytes - len1; if (last >= 1 && last <= 512) return mk1(last); } return null; };
const e65 = w();
const x65 = appendRecord(e65, base({ tasks: tasksFor(65536) }));
const f66 = w();
const x66 = appendRecord(f66, base({ tasks: tasksFor(65537) }));
check('the line limit is exact: a sealed line of 65536 bytes is accepted, 65537 is refused and the store unchanged', [x65?.ok, fs.statSync(e65).size - Buffer.byteLength(good), x66?.ok, x66?.reason, fs.readFileSync(f66, 'utf8') === good], [true, 65536, false, 'record line is larger than 65536 bytes', true]);
const mbTasks = Array.from({ length: 70 }, (_, i) => ({ id: String(i).padStart(2, '0') + 'é'.repeat(510), hash: 'h' }));
const mbChars = JSON.stringify(sealRecord(base({ tasks: mbTasks, prev_record_hash: gH }))).length;
const mbF = w();
const mb = appendRecord(mbF, base({ tasks: mbTasks }));
check('the line limit counts bytes, not characters: a line under 64 K characters but over 64 KiB is refused', [mbChars < 65536, mb?.ok, mb?.reason, fs.readFileSync(mbF, 'utf8') === good], [true, false, 'record line is larger than 65536 bytes', true]);
const gw = w();
fs.chmodSync(gw, 0o620);
const ww = w();
fs.chmodSync(ww, 0o602);
check('a group-writable-only (0620) or world-writable-only (0602) store is refused and unchanged', [appendRecord(gw, base())?.ok, unchanged(gw), appendRecord(ww, base())?.ok, unchanged(ww)], [false, true, false, true]);
const uidF = w();
const ur = probe('uid', uidF, base());
check('a store owned by another user is refused and unchanged (the owner is faked in a child process by patching fstat)', [ur?.ok, ur?.reason, unchanged(uidF)], [false, 'store is owned by another user or is group/world-writable', true]);
const cg = appendRecord(af('new1.jsonl'), base(), { create: true, genesisHash: 'f'.repeat(64) });
const cb = appendRecord(af('new2.jsonl'), base({ tasks: bigTasks }), { create: true });
const cw = probe('partial', af('new3.jsonl'), base(), { create: true });
check('a refusal of a store this call created leaves no file: genesis on a new store, an oversize line, a failed write cut back', [[cg?.ok, fs.existsSync(af('new1.jsonl'))], [cb?.ok, fs.existsSync(af('new2.jsonl'))], [cw?.ok, cw?.reason, fs.existsSync(af('new3.jsonl'))]], [[false, false], [false, false], [false, 'write failed; store truncated back to 0 bytes', false]]);
const em = put(af('empty.jsonl'), '');
const er = appendRecord(em, base());
check('an emptied existing store is refused without create and stays empty', [er?.ok, er?.reason, fs.statSync(em).size], [false, 'store is empty (a new store needs create)', 0]);
const ex = w();
const em2 = put(af('empty2.jsonl'), '');
const c1 = appendRecord(ex, base(), { create: true });
const c2 = appendRecord(em2, base(), { create: true });
check('create is for a new store only: an existing store, even an empty one, is refused, left in place and unchanged', [c1?.ok, c1?.reason, unchanged(ex), c2?.ok, fs.existsSync(em2), fs.statSync(em2).size], [false, 'store already exists (create is for a new store only)', true, false, true, 0]);
const f5 = af('m.jsonl');
check('malformed file or record -> null (non-string, empty or NUL path; null / extra-field / already-sealed / no-arm / bad-triage / malformed-prev / absent-prev record; throwers)', [appendRecord(5, base()), appendRecord('', base()), appendRecord(af('a\0b'), base(), { create: true }), appendRecord(f5, null), appendRecord(f5, { ...base(), extra: 1 }), appendRecord(f5, sealRecord(base())), appendRecord(f5, base({ candidate: null })), appendRecord(f5, base({ triage_result: 'x' })), appendRecord(f5, base({ prev_record_hash: 'xyz' }), { create: true }), appendRecord(f5, (({ prev_record_hash, ...r }) => r)(base()), { create: true }), safe(() => appendRecord(f5, thrower)), safe(() => appendRecord(thrower, base()))], Array(12).fill(null));
check('a refused record leaves no file behind', fs.existsSync(f5), false);
let gc = 0;
const flip = base();
Object.defineProperty(flip, 'rule', { get() { return gc++ === 0 ? 'r1' : 5; } });
const f6 = af('g.jsonl');
check('a record getter that flips is read once: the line holds the validated value and verifies', [appendRecord(f6, flip, { create: true })?.ok, lines(f6)[0]?.rule, V(lines(f6))?.ok, gc], [true, 'r1', true, 1]);
const tail4 = lines(f1)[3]?.record_hash;
const stale = base({ prev_record_hash: 'f'.repeat(64) });
const r7 = appendRecord(f1, stale);
check('a stale non-null prev_record_hash is refused (chain head moved) and the store is unchanged', [r7?.ok, r7?.reason, V(lines(f1))?.length], [false, 'stale prev_record_hash: chain head moved', 4]);
const r8 = appendRecord(f1, base({ prev_record_hash: tail4 }));
check('a non-null prev_record_hash equal to the verified head is accepted', [r8?.ok, r8?.record?.prev_record_hash === tail4, V(lines(f1))?.length], [true, true, 5]);

for (const [ok, name, got, want] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(want) + ', got ' + JSON.stringify(got) + ')'));
" 2>&1) || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"
ran=$((pass + fail))
[ "$ran" -ge 117 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 117 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
