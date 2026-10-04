#!/usr/bin/env bash
# Pins the release verdict check (FR-16, FR-33, FR-34, FR-35) in tests/evals/lib/gate-check.mjs.
# Hermetic: pure computation on in-memory sealed chains and temp dirs for the read-side cases; no
# model, network or credential. Skipped in a published tarball, where tests/evals is absent by design.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: verdict check =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
export TMP

JS=$(cat <<'EOF'
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { MAPPING, checkVerdicts, readRecordsFile } from './tests/evals/lib/gate-check.mjs';
import { TRIAGE_RESULTS } from './tests/evals/lib/triage.mjs';
import { abortedRecord, sealRecord } from './tests/evals/lib/verdict-record.mjs';
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const safe = (f) => { try { return f(); } catch { return 'THREW'; } };
const hx = (s) => createHash('sha256').update(s).digest('hex');
const D = hx('D'), E = hx('E'), F = hx('F'), T = hx('tag');
const INC = 'inconclusive: instrument-or-environment';
const mixed = Array(9).fill('1.0.0').fill('1.0.1', 0, 1);

const arm = (fails, o = {}) => ({ outcomes: [...Array(fails).fill('fail'), ...Array(9 - fails).fill('pass')], cli: Array(9).fill('1.0.0'), models: Array(9).fill('m-a'), digest: D, ...o });
const spec = (o = {}) => ({
  schema_version: 1, kind: 'verdict', digest: D, rule: 'pooled-9-4', tasks: [{ id: 't1', hash: 'h1' }], tier_config: 'tier-a', instrument_digest: hx('inst'),
  cli_version: '1.0.0', model_ids: ['m-a'], candidate: arm(1), baseline: null, cost_candidate_usd: 1, cost_baseline_usd: 0, baseline_digest: null,
  triage_result: 'pass', rerun_of: null, rerun_reason: null, ...o,
});
const pass = (o) => spec(o);
const block = (o) => spec({ candidate: arm(5), baseline: arm(1, { digest: T }), baseline_digest: T, triage_result: 'block', ...o });
const inc = (o) => spec({ candidate: arm(5), baseline: arm(5, { digest: T }), baseline_digest: T, triage_result: INC, ...o });
const nobase = (o) => spec({ candidate: arm(5), triage_result: 'refused: no-baseline', ...o });
const rr = { rerun_of: 'earlier-run', rerun_reason: 'runner flake' };
const abort = (o = {}) => { const { kind, triage_result, prev_record_hash, ...f } = spec(); return abortedRecord({ ...f, candidate: { outcomes: Array(4).fill('fail'), cli: Array(4).fill('1.0.0'), models: Array(4).fill('m-a'), digest: D }, ...o }); };
const mk = (specs) => { let prev = null; return specs.map((s) => { const r = sealRecord({ ...s, prev_record_hash: prev }); if (!r) throw new Error('bad spec'); prev = r.record_hash; return r; }); };
const reseal = (list) => { let prev = null; return list.map((r) => { const { record_hash, ...rest } = r; const s = sealRecord({ ...rest, prev_record_hash: prev }); prev = s.record_hash; return s; }); };
const clone = (x) => JSON.parse(JSON.stringify(x));
const K = (a) => checkVerdicts({ baselineTag: T, ...a });
const C = (specs, digest = D, o) => K({ records: mk(specs), digest, ...o });
const is = (r, verdict, code) => [r?.verdict, r?.code].join('|') === verdict + '|' + code;
const never = (r) => r === null || r.verdict !== 'ready';

// Verdict mapping: one case per row.
const ok = C([pass()]);
check('pass -> ready, the reason says it once', is(ok, 'ready', 'pass') && ok.inconclusive === false && ok.record === 0 && ok.arms.candidate === 'pass' && ok.reason.split('candidate arm passes').length === 2, true);
const i1 = C([inc()]);
check('single inconclusive -> ready, flagged, reason names it', is(i1, 'ready', 'inconclusive') && i1.inconclusive === true && i1.reason.startsWith('inconclusive:'), true);
check('user-decision-required -> not-ready with no exception', is(C([inc({ digest: E }), inc({ triage_result: 'user-decision-required' })]), 'not-ready', 'user-decision-required'), true);
check('block -> not-ready', is(C([block()]), 'not-ready', 'block'), true);
check('refused: drift -> not-ready', is(C([spec({ candidate: arm(5, { cli: mixed }), triage_result: 'refused: drift' })]), 'not-ready', 'refused: drift'), true);
check('refused: no-baseline -> not-ready', is(C([nobase()], D, { baselineTag: null }), 'not-ready', 'refused: no-baseline'), true);
check('aborted latest -> not-ready', is(C([abort()]), 'not-ready', 'aborted'), true);
check('no verdict for the digest (wrong digest) -> not-ready', [C([pass()], E).reason.startsWith('no verdict'), C([pass()], E).verdict], [true, 'not-ready']);
check('an empty records array -> not-ready, never ready', [C([]).verdict, C([]).reason.includes('no records')], ['not-ready', true]);

const R0 = mk([pass()]);
// Arm digests, the required baseline tag, the CLI version and the aborted-FAIL rerun.
check('an arm not drawn on the claimed digest -> not-ready: digest mismatch (foreign candidate, foreign or unclaimed baseline)', [C([pass({ candidate: arm(1, { digest: E }) })]), C([inc({ baseline: arm(5, { digest: F }) })]), C([inc({ baseline: arm(5, { digest: F }), baseline_digest: null })])].map((r) => [r.verdict, r.code]), Array(3).fill(['not-ready', 'digest mismatch']));
const bl = (x) => inc({ baseline: arm(5, { digest: x }), baseline_digest: x });
check('a baseline drawn on another failing digest or on the candidate itself (also when the tag is on the candidate) is not the tag; a prior tag still works', [C([bl(F)]), C([bl(D)]), C([bl(F)], D, { baselineTag: null }), C([bl(D)], D, { baselineTag: D })].map((r) => [r.verdict, r.code]).concat([C([inc()]).code]), [...Array(4).fill(['not-ready', 'baseline is not the latest v* tag']), 'inconclusive']);
check('a passing candidate with no baseline is ready whatever the tag is; a FAIL that claims no baseline while a tag exists is not evaluable', [C([pass()], D, { baselineTag: null }).verdict, C([pass()], D, { baselineTag: F }).verdict, C([nobase()]).code], ['ready', 'ready', 'invalid']);
check('baselineTag is required: missing, undefined, non-hex, uppercase or a number -> null', [undefined, 'abc', T.toUpperCase(), 5].map((t) => checkVerdicts({ records: R0, digest: D, baselineTag: t })).concat(checkVerdicts({ records: R0, digest: D })), Array(5).fill(null));
check('[aborted FAIL, unmarked verdict] for one digest -> rerun-policy', is(C([abort(), pass()]), 'not-ready', 'rerun-policy'), true);
check('a ready record whose draws used another CLI than cli_version -> not-ready: cli mismatch', is(C([pass({ cli_version: '9.9.9' })]), 'not-ready', 'cli mismatch'), true);
check('MAPPING covers exactly the triage verdicts', [Object.keys(MAPPING).sort(), Object.isFrozen(MAPPING)], [[...TRIAGE_RESULTS].sort(), true]);

// Chain, recompute and latest-for-digest selection.
const mid = mk([pass({ digest: E }), block({ digest: F }), pass()]);
const cut = K({ records: [mid[0], mid[2]], digest: D });
check('deleting a middle FAIL record -> invalid: broken chain at 1', [cut.verdict, cut.reason.startsWith('broken chain at 1')], ['invalid', true]);
const raw = clone(mk([block()])); raw[0].candidate.outcomes.fill('pass');
check('FAIL flipped to pass in a stored draw is caught first by the hash chain', [is(K({ records: raw, digest: D }), 'invalid', 'broken chain'), K({ records: raw, digest: D }).reason.includes('record_hash')], [true, true]);
const fl = clone(mk([block()])); fl[0].candidate.outcomes.fill('pass');
check('the same flip, re-hashed: recompute mismatch, not ready', is(K({ records: reseal(fl), digest: D }), 'not-ready', 'recompute mismatch'), true);
const fp = clone(mk([pass()])); fp[0].candidate.outcomes.fill('fail', 0, 5);
check('a stored pass whose draws FAIL, re-hashed: mismatch', is(K({ records: reseal(fp), digest: D, baselineTag: null }), 'not-ready', 'recompute mismatch'), true);
check('a record triage cannot evaluate (FAIL, tag, no baseline arm) -> not-ready: invalid', is(C([spec({ candidate: arm(5), baseline_digest: T, triage_result: 'block' })]), 'not-ready', 'invalid'), true);
check('a later record for another digest does not mask this digest', [C([pass(), block({ digest: E })]).verdict, C([block(), pass({ digest: E })]).code], ['ready', 'block']);
check('a later aborted run for the digest masks an earlier pass', is(C([pass(), abort()]), 'not-ready', 'aborted'), true);
check('a rerun supersedes the earlier verdict for its digest', [C([block(), pass(rr)]).verdict, C([pass(), block(rr)]).code], ['ready', 'block']);
check('malformed records are invalid, never ready', [[{}], [null], [5], [{ ...mk([pass()])[0], extra: 1 }], [mk([pass()])[0], 'x']].map((l) => K({ records: l, digest: D }).verdict), Array(5).fill('invalid'));

// History recompute and the rerun policy.
const second = C([inc({ digest: E }), inc()]);
check('a stored inconclusive that is a second consecutive one -> mismatch, not ready', [is(second, 'not-ready', 'recompute mismatch'), second.reason.includes('user-decision-required')], [true, true]);
check('the streak skips aborted and refused records', [is(C([inc({ digest: E }), abort({ digest: F }), inc()]), 'not-ready', 'recompute mismatch'), is(C([inc({ digest: E }), nobase({ digest: F }), inc()]), 'not-ready', 'recompute mismatch')], [true, true]);
check('a block or pass in between ends the streak: still ready', [C([inc({ digest: E }), block({ digest: F }), inc()]).verdict, C([inc({ digest: E }), pass({ digest: F }), inc()]).inconclusive], ['ready', true]);
const noReason = clone(mk([block(), pass(rr)])); noReason[1].rerun_reason = null;
check('a rerun without rerun_reason is invalid (chain validation), never ready', [K({ records: noReason, digest: D }).verdict, never(K({ records: noReason, digest: D }))], ['invalid', true]);
check('two reruns for one digest, the second passes -> rerun-policy', is(C([block(), block(rr), pass(rr)]), 'not-ready', 'rerun-policy'), true);
check('two reruns interleaved with another digest -> rerun-policy', is(C([block(), pass({ digest: E }), block(rr), pass(rr)]), 'not-ready', 'rerun-policy'), true);
check('an aborted FAIL plus a marked rerun is two uses -> rerun-policy', is(C([abort(), pass(rr)]), 'not-ready', 'rerun-policy'), true);
const rep = C([block(), pass()]);
check('an unmarked repeat verdict -> rerun-policy, naming it', [is(rep, 'not-ready', 'rerun-policy'), rep.reason.includes('not marked')], [true, true]);
check('one legitimate marked rerun after a verdict is evaluated normally', [C([block(), block(rr)]).code, C([block(), pass(rr)]).code], ['block', 'pass']);

// Anchors and the tail residual.
const A = mk([pass(), block(rr)]);
check('genesisHash and headAnchor pass through (right ones agree)', K({ records: A, digest: D, genesisHash: A[0].record_hash, headAnchor: A[1].record_hash }).code, 'block');
check('a wrong genesisHash or headAnchor -> invalid', [K({ records: A, digest: D, genesisHash: F }).verdict, K({ records: A, digest: D, headAnchor: F }).verdict], ['invalid', 'invalid']);
check('a malformed anchor -> null, never a silent skip', [K({ records: A, digest: D, headAnchor: 'abc' }), K({ records: A, digest: D, genesisHash: 5 })], [null, null]);
check('tail truncation without an anchor reads ready (documented residual); with the anchor it is invalid', [K({ records: A.slice(0, 1), digest: D }).verdict, K({ records: A.slice(0, 1), digest: D, headAnchor: A[1].record_hash }).verdict], ['ready', 'invalid']);

// Hostile inputs.
const R = mk([pass()]);
const flip = (target, key, a, b) => { let c = 0; return Object.defineProperty(target, key, { enumerable: true, get() { return c++ === 0 ? a : b; } }); };
check('non-object / array / unknown-key / symbol-key arguments -> null', [undefined, null, [], 'x', 5, { records: R, digest: D, baselineTag: T, extra: 1 }, { records: R, digest: D, baselineTag: T, [Symbol('s')]: 1 }].map((a) => safe(() => checkVerdicts(a))), Array(7).fill(null));
check('digest not 64 lowercase hex, or records not a dense array -> null', [{ records: R }, { records: R, digest: 'abc' }, { records: R, digest: D.toUpperCase() }, { records: R, digest: 5 }, { records: {}, digest: D }, { records: 'x', digest: D }, { digest: D }, { records: new Array(1), digest: D }].map((a) => K(a)), Array(8).fill(null));
check('a throwing Proxy argument or records -> null', [safe(() => checkVerdicts(new Proxy({}, { ownKeys() { throw new Error('boom'); } }))), safe(() => K({ records: new Proxy([], { get() { throw new Error('boom'); } }), digest: D }))], [null, null]);
check('a Proxy length that flips is decided on one copy', safe(() => { let c = 0; return K({ records: new Proxy(R.slice(), { get(t, k) { return k === 'length' ? (c++ === 0 ? 1 : 0) : t[k]; } }), digest: D }).code; }), 'pass');
check('a flipping digest getter is read once', safe(() => checkVerdicts(flip({ records: R, baselineTag: T }, 'digest', D, E)).code), 'pass');
check('a flipping record field is read once: the hashed bytes are the decided bytes', safe(() => { const r = { ...R[0] }; flip(r, 'triage_result', 'pass', 'block'); return K({ records: [r], digest: D }).code; }), 'pass');
check('a record that is not a plain object -> invalid, never ready', [new Map(), Object.create(R[0]), [R[0]]].map((r) => K({ records: [r], digest: D }).verdict), Array(3).fill('invalid'));

// Structural pin: the library's import closure reaches no network or child-process module.
// A regression pin against honest drift, not an adversarial boundary (a computed specifier gets past it).
const BAD = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:node:)?(?:net|http|https|http2|child_process|tls|dgram|worker_threads|vm)['"]|\bfetch\s*\(|getBuiltinModule|createRequire|process\.binding|\beval\s*\(|\bFunction\s*\(/;
const closure = (entry, seen = new Set()) => { if (seen.has(entry)) return seen; seen.add(entry); for (const m of fs.readFileSync(entry, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) closure(path.resolve(path.dirname(entry), m[1]), seen); return seen; };
const bad = (entry) => [...closure(entry)].filter((f) => BAD.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f));
const lib = path.resolve('tests/evals/lib/gate-check.mjs');
check('the library closure imports no net, http, https or child_process', bad(lib), []);
check('the closure excludes the digest module (the only git user)', [...closure(lib)].map((f) => path.basename(f)).includes('definition-set.mjs'), false);
const sd = fs.mkdtempSync(path.join(process.env.TMP, 'scan-'));
fs.writeFileSync(path.join(sd, 'a.mjs'), "import './b.mjs';\n"); fs.writeFileSync(path.join(sd, 'b.mjs'), "import cp from 'node:child_process';\n");
fs.writeFileSync(path.join(sd, 'c.mjs'), "import h from 'http';\n");
fs.writeFileSync(path.join(sd, 'd.mjs'), "await import('./e.mjs');\n"); fs.writeFileSync(path.join(sd, 'e.mjs'), "process.getBuiltinModule('node:child_process');\n");
check('the scanner finds a transitive child_process import and a bare http one (positive control)', [bad(path.join(sd, 'a.mjs')), bad(path.join(sd, 'c.mjs'))], [['b.mjs'], ['c.mjs']]);
check('the scanner follows a relative dynamic import and flags each other pattern', [bad(path.join(sd, 'd.mjs')), ["fetch('u')", 'createRequire(x)', 'process.binding(1)', "from 'node:vm'", "import('worker_threads')", 'eval(s)', 'new Function(s)'].map((t) => BAD.test(t))], [['e.mjs'], Array(7).fill(true)]);

// readRecordsFile (read-only).
const L0 = JSON.stringify(R0[0]) + '\n';
const dir = fs.mkdtempSync(path.join(process.env.TMP, 'rd-'));
const put = (name, text) => { const p = path.join(dir, name); fs.writeFileSync(p, text, { mode: 0o600 }); return p; };
const lines = (list) => list.map((r) => JSON.stringify(r) + '\n').join('');
const good = put('good.jsonl', lines(A));
const before = [fs.readFileSync(good, 'utf8'), fs.statSync(good).mtimeMs, fs.readdirSync(dir).join()];
check('a stored chain round-trips and is then checked', [JSON.stringify(readRecordsFile(good)) === JSON.stringify(A), K({ records: readRecordsFile(good), digest: D }).code], [true, 'block']);
check('reading writes nothing: content, mtime and directory entries are unchanged', [fs.readFileSync(good, 'utf8'), fs.statSync(good).mtimeMs, fs.readdirSync(dir).join()], before);
check('a store with a middle record deleted still parses; the chain check catches it', K({ records: readRecordsFile(put('cut.jsonl', lines([mid[0], mid[2]]))), digest: D }).verdict, 'invalid');
check('an empty file is [] and not-ready; a missing file, directory or non-string path is null', [readRecordsFile(put('empty.jsonl', '')), K({ records: readRecordsFile(path.join(dir, 'empty.jsonl')), digest: D }).verdict, readRecordsFile(path.join(dir, 'nope')), readRecordsFile(dir), readRecordsFile(''), readRecordsFile(5), readRecordsFile(undefined)], [[], 'not-ready', null, null, null, null, null]);
fs.symlinkSync(good, path.join(dir, 'link.jsonl'));
execFileSync('mkfifo', ['-m', '600', path.join(dir, 'fifo')]);
check('a store writable by group, by others or by both is refused (a sealed record is no secret, so write access is the boundary)', [0o666, 0o620, 0o602].map((m) => { fs.chmodSync(put('wr' + m, L0), m); return readRecordsFile(path.join(dir, 'wr' + m)); }).concat(readRecordsFile(put('ok', L0))?.length), [null, null, null, 1]);
check('a store owned by another user is refused (fstat patched in a child process)', JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', "import fs from 'node:fs'; const r = fs.fstatSync; fs.fstatSync = (fd) => { const s = r(fd); return Object.assign(Object.create(Object.getPrototypeOf(s)), s, { uid: s.uid + 1 }); }; const { readRecordsFile } = await import('./tests/evals/lib/gate-check.mjs'); console.log(JSON.stringify(readRecordsFile(process.env.P)));"], { env: { ...process.env, P: path.join(dir, 'ok') }, encoding: 'utf8' })), null);
check('a symlink and a FIFO are refused', [readRecordsFile(path.join(dir, 'link.jsonl')), readRecordsFile(path.join(dir, 'fifo'))], [null, null]);
const L = JSON.stringify(A[0]);
check('CRLF, a blank line, a trailing blank line and a partial last line -> null', [put('crlf', L + '\r\n'), put('blank', L + '\n\n' + L + '\n'), put('trail', L + '\n\n'), put('partial', L + '\n' + L)].map(readRecordsFile), Array(4).fill(null));
check('a non-JSON line, a non-object line and a BOM -> null', [put('junk', L + '\nnot json\n'), put('num', '5\n'), put('arr', '[]\n'), put('nul', 'null\n'), put('bom', '\ufeff' + L + '\n')].map(readRecordsFile), [null, null, null, null, null]);
const bin = path.join(dir, 'bin'); put('bin', Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xff]), Buffer.from('"}\n')]));
check('invalid UTF-8 bytes -> null', readRecordsFile(bin), null);
check('a padded line and a duplicate key are refused (lines must be canonical)', [put('pad', L + ' \n'), put('dup', L.replace('{"schema_version":1,', '{"schema_version":1,"schema_version":1,') + '\n')].map(readRecordsFile), [null, null]);
check('a __proto__ key, raw or escaped -> null', [put('p1', '{"__proto__":{"x":1}}\n'), put('p2', '{"\\u005f_proto__":{"x":1}}\n'), put('p3', '{"a":{"__proto__":1}}\n')].map(readRecordsFile), [null, null, null]);
const big = put('big', L0.repeat(Math.ceil((32 * 1024 * 1024 + 1) / L0.length)));
check('a file over the 32 MiB cap is refused (valid lines, so only the size guards refuse it)', readRecordsFile(big), null);

for (const [ok, name, got, want] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(want) + ', got ' + JSON.stringify(got) + ')'));
EOF
)
out=$(node --input-type=module -e "$JS" 2>&1) || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"
ran=$((pass + fail))
[ "$ran" -ge 62 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 62 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
