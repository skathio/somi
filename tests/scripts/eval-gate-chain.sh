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

out=$(node --input-type=module -e "
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { canonicalJson, recordHash, sealRecord, validateRecord, verifyChain } from './tests/evals/lib/verdict-record.mjs';
import { triage, rerunAllowed, TRIAGE_RESULTS } from './tests/evals/lib/triage.mjs';
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
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
check('dropping, changing or adding ANY field changes the hash or is refused', fields.map((k) => { const drop = { ...R }; delete drop[k]; return recordHash(drop) !== recordHash(R); }).every(Boolean), true);
const changes = { digest: 'dx', rule: 'r2', tier_config: 'tier-b', instrument_digest: 'i2', cli_version: '2', model_ids: ['m-b'], cost_candidate_usd: 13, cost_baseline_usd: 1, baseline_digest: 'bd', triage_result: 'block', rerun_of: 'x', rerun_reason: 'y', prev_record_hash: 'a'.repeat(64), tasks: [{ id: 't1', hash: 'h9' }], candidate: arm(2), baseline: arm(3), schema_version: 2 };
check('every stored field, edited alone, changes the hash or is refused (the unchanged ones are listed)', Object.keys(changes).filter((k) => { const h = recordHash({ ...R, [k]: changes[k] }); return h === recordHash(R); }), []);
check('rerun_of / rerun_reason edited together change the hash', recordHash({ ...R, rerun_of: 'x', rerun_reason: 'y' }) !== recordHash(R), true);
check('a task id, a task hash, a model id, an arm digest, one cli entry, one outcome each change the hash', [
  recordHash({ ...R, tasks: [{ id: 't9', hash: 'h1' }, R.tasks[1]] }), recordHash({ ...R, tasks: [{ id: 't1', hash: 'h9' }, R.tasks[1]] }), recordHash({ ...R, model_ids: ['m-z'] }),
  recordHash({ ...R, candidate: arm(1, { digest: 'z' }) }), recordHash({ ...R, candidate: arm(1, { cli: ['1.0.1', ...Array(8).fill('1.0.0')] }) }), recordHash({ ...R, candidate: arm(1, { models: ['m-b', ...Array(8).fill('m-a')] }) }), recordHash({ ...R, candidate: arm(2) }),
].every((h) => h !== null && h !== recordHash(R)), true);
check('1 vs 1.0 vs 1e0 and 0.1+0.2 are the numbers they are, not rounded together', [recordHash({ ...R, cost_candidate_usd: 1 }) === recordHash({ ...R, cost_candidate_usd: 1.0 }), recordHash({ ...R, cost_candidate_usd: 0.3 }) !== recordHash({ ...R, cost_candidate_usd: 0.1 + 0.2 })], [true, true]);
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
check('aborted records validate with candidate_result FAIL / pass / null and a partial or null arm', [ab('FAIL'), ab('pass'), ab(null), ab('FAIL', { candidate: arm(4, { outcomes: ['fail', 'fail', 'fail', 'fail'], cli: Array(4).fill('1'), models: Array(4).fill('m') }) }), ab(null, { candidate: null })].map((r) => r !== null && validateRecord(r) !== null), Array(5).fill(true));
check('aborted: a bad candidate_result (fail, undefined, 1) or mismatched partial lengths -> null', [ab('fail'), ab(undefined), ab(1), ab('FAIL', { candidate: arm(1, { cli: Array(8).fill('1') }) }), ab('FAIL', { candidate: arm(1, { outcomes: Array(10).fill('pass') }) })], Array(5).fill(null));
check('verdict: triage_result must be a TRIAGE_RESULTS member, each member accepted', [...TRIAGE_RESULTS.map((t) => sealRecord({ ...R, triage_result: t }) !== null), sealRecord({ ...R, triage_result: 'maybe' }), sealRecord({ ...R, triage_result: undefined })], [...TRIAGE_RESULTS.map(() => true), null, null]);
check('verdict: arms must be complete (9 draws, 9 cli, 9 models); a missing or short candidate is refused', [sealRecord({ ...R, candidate: null }), sealRecord({ ...R, candidate: arm(1, { outcomes: Array(8).fill('pass') }) }), sealRecord({ ...R, candidate: arm(1, { cli: '1.0.0' }) }), sealRecord({ ...R, candidate: arm(1, { models: 'm-a' }) }), sealRecord({ ...R, baseline: arm(1, { cli: Array(8).fill('1') }) }), sealRecord({ ...R, baseline: arm(1) }) !== null], [null, null, null, null, null, true]);
check('verdict arms of 8 draws with 8 cli and 8 models entries (self-consistent but short) -> null; an aborted one of 8 is fine', [sealRecord({ ...R, candidate: arm(1, { outcomes: Array(8).fill('pass'), cli: Array(8).fill('1'), models: Array(8).fill('m') }) }), sealRecord({ ...R, baseline: arm(1, { outcomes: Array(8).fill('pass'), cli: Array(8).fill('1'), models: Array(8).fill('m') }) }), ab('FAIL', { candidate: arm(1, { outcomes: Array(8).fill('pass'), cli: Array(8).fill('1'), models: Array(8).fill('m') }) }) !== null], [null, null, true]);
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

// Compatibility with triage.mjs: every record it needs is accepted, and what it rejects is rejected.
const hist = [sealRecord(R), ab('FAIL'), ab('pass'), ab(null), sealRecord({ ...R, rerun_of: 'h0', rerun_reason: 'flaky' }), ...TRIAGE_RESULTS.map((t) => sealRecord({ ...R, triage_result: t }))];
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
check('editing one byte of the stored file fails the chain', [V(read()).ok, V(read()).index], [false, 0]);
fs.writeFileSync(file, C.filter((_, i) => i !== 1).map((r) => JSON.stringify(r)).join('\\n') + '\\n');
check('deleting a middle line of the stored file fails, naming the link', V(read())?.reason, 'broken link between record 0 and record 1');

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
[ "$ran" -ge 69 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 69 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
