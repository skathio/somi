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
import { execFileSync, spawnSync } from 'node:child_process';
import { MAPPING, checkVerdicts, readRecordsFile } from './tests/evals/lib/gate-check.mjs';
import { clean } from './tests/evals/gate-check.mjs';
import { assertCleanTree, baselineTagDigest, definitionSetDigest } from './tests/evals/lib/definition-set.mjs';
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

// The entrypoint, run as a child process against temp stores and temp git repositories.
const ENTRY = path.resolve('tests/evals/gate-check.mjs');
const cli = (args, env = {}) => { const r = spawnSync(process.execPath, [ENTRY, ...args], { encoding: 'utf8', env: { ...process.env, ...env } }); return { code: r.status, first: r.stdout.split('\n')[0], lines: r.stdout.split('\n').length - 1, err: r.stderr }; };
const store = (name, list) => { const p = path.join(dir, name); fs.writeFileSync(p, lines(list), { mode: 0o600 }); return p; };
const pure = (specs, extra = ['--baseline-tag', 'none']) => cli(['--records', store('c' + Math.random(), mk(specs)), '--digest', D, ...extra]);
// Fixture git: no user, system or environment configuration reaches it (a developer's tag.gpgSign cannot crash the suite).
const GENV = { PATH: process.env.PATH, HOME: process.env.HOME, LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const gx = (cwd, ...a) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'init.defaultBranch=main', '-c', 'core.hooksPath=/dev/null', '-c', 'tag.gpgSign=false', '-c', 'commit.gpgSign=false', ...a], { cwd, encoding: 'utf8', env: GENV, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
const repo = () => { const r = fs.mkdtempSync(path.join(process.env.TMP, 'repo-')); gx(r, 'init', '-q'); fs.mkdirSync(path.join(r, 'commands')); return r; };
const commit = (r, text, ...tags) => { fs.writeFileSync(path.join(r, 'commands', 'a.md'), text); gx(r, 'add', '-A'); gx(r, 'commit', '-q', '-m', text); for (const t of tags) gx(r, 'tag', t); return definitionSetDigest(r, 'HEAD'); };

check('CLI: ready exits 0, stdout carries a stable first line, the override line and the instrument digest, stderr is empty', [pure([pass()]).code, pure([pass()]).first.startsWith('ready: pass'), pure([pass()]).lines, pure([pass()]).err], [0, true, 3, '']);
check('CLI: not-ready (block) exits 1 with a first line that starts not-ready: block', [pure([block()], ['--baseline-tag', T]).code, pure([block()], ['--baseline-tag', T]).first.startsWith('not-ready: block')], [1, true]);
const cutRun = cli(['--records', store('cut', [mid[0], mid[2]]), '--digest', D, '--baseline-tag', 'none']);
check('CLI: a deleted middle record exits 1 with invalid: broken chain at 1', [cutRun.code, cutRun.first.startsWith('invalid: broken chain at 1')], [1, true]);
const junk = path.join(dir, 'junk'); fs.writeFileSync(junk, 'not json\n', { mode: 0o600 });
const junkRuns = [cli(['--records', junk, '--digest', D, '--baseline-tag', 'none']), cli(['--records', path.join(dir, 'missing'), '--digest', D, '--baseline-tag', 'none'])];
check('CLI: a malformed or missing store exits 2 with invalid, never 0', junkRuns.map((r) => [r.code, r.first.startsWith('invalid')]), [[2, true], [2, true]]);
const g = store('good', R0);
const usage = [[], ['--digest', D], ['--records', g, '--bogus', 'x'], ['--records', g, '--records', g], ['--records'], ['--records', g, '--digest'], ['--records', '--digest', D], ['--records', g, '--digest', '--genesis'], ['--records', g, 'extra'], ['--records', g, '--digest', 'abc'], ['--records', g, '--genesis', D.toUpperCase()], ['--records', g, '--head-anchor', 'x'], ['--records', g, '--baseline-tag', 'NONE'], ['--records', g, '--help'], ['--help', 'x'], ['-h'], ['--records', g, '--repo', '-x'], ...['--records', '--digest', '--baseline-tag', '--genesis', '--head-anchor', '--repo'].map((f) => (f === '--records' ? ['--records', ''] : ['--records', g, f, '']))].map((a) => cli(a));
check('CLI: every usage error (none, unknown, duplicate, valueless, empty or flag-like value, positional, bad hash, --help mixed) exits 2 with invalid', usage.map((r) => [r.code, r.first.startsWith('invalid: usage error')]), usage.map(() => [2, true]));
const help = cli(['--help']);
check('CLI: --help exits 0 and prints usage', [help.code, help.first.startsWith('usage:')], [0, true]);
const bl2 = (tag) => pure([inc()], ['--baseline-tag', tag]);
check('CLI: a record baseline equal to the given tag is ready; another tag, or none, is exit 1 not-ready', [bl2(T).code, bl2(F).code, bl2(F).first.startsWith('not-ready: baseline is not the latest v* tag'), bl2('none').code, bl2('none').first.startsWith('not-ready: baseline is not')], [0, 1, true, 1, true]);

// Tag selection in real repositories: v1.10.0 sorts after v1.9.0, and a tag on the candidate's own tree is never the baseline.
const S = repo();
const dA = commit(S, 'a', 'v1.9.0'); const c1 = gx(S, 'rev-parse', 'HEAD');
const dB = commit(S, 'b', 'v1.10.0');
const dC = commit(S, 'c', 'v1.11.0');
const tagsDir = path.join(S, '.git', 'refs', 'tags');
const hostile = ['v99.0.0-$(touch PWNED)', 'v-x', 'v--help', 'v98.0 sp', 'v97.0\nx', 'v96.0.0;x'];
for (const h of hostile) fs.writeFileSync(path.join(tagsDir, h), c1 + '\n');
gx(S, 'tag', 'v50.0.0', gx(S, 'rev-parse', 'HEAD:commands/a.md'));
gx(S, 'checkout', '-q', '--orphan', 'orph'); fs.writeFileSync(path.join(S, 'commands', 'a.md'), 'orphan'); gx(S, 'add', '-A'); gx(S, 'commit', '-q', '-m', 'orphan'); gx(S, 'tag', 'v999999999.0.0'); gx(S, 'checkout', '-q', '-f', 'main');
const sel = baselineTagDigest(S, dC);
check('the baseline is the latest merged differing release by version order; an unmerged orphan tag, the own-tree tag, hostile names and a blob tag are skipped', [sel, fs.existsSync(path.join(S, 'PWNED')), fs.existsSync(path.join(process.cwd(), 'PWNED'))], [{ ok: true, digest: dB }, false, false]);
check('a clean tree on the candidate tag and an older tag as the record baseline: ready; the oldest tag as baseline: not-ready', [cli(['--records', store('s1', mk([inc({ digest: dC, candidate: arm(5, { digest: dC }), baseline: arm(5, { digest: dB }), baseline_digest: dB })])), '--repo', S]).code, cli(['--records', store('s2', mk([inc({ digest: dC, candidate: arm(5, { digest: dC }), baseline: arm(5, { digest: dA }), baseline_digest: dA })])), '--repo', S]).code], [0, 1]);
const O = repo(); const dO = commit(O, 'only', 'v1.0.0');
const own = cli(['--records', store('o1', mk([pass({ digest: dO, candidate: arm(1, { digest: dO }) })])), '--repo', O]);
const ownB = cli(['--records', store('o2', mk([inc({ digest: dO, candidate: arm(5, { digest: dO }), baseline: arm(5, { digest: dO }), baseline_digest: dO })])), '--repo', O]);
check('only the candidate\'s own release tag: the baseline is none (a baseline-free pass is ready; a record claiming that tag as baseline is not)', [baselineTagDigest(O, dO), own.code, ownB.code, ownB.first.startsWith('not-ready: baseline is not')], [{ ok: true, digest: null }, 0, 1, true]);
const N = repo(); const dN = commit(N, 'none');
check('no v* tag: none, a record that claims a baseline is exit 1, a baseline-free pass is exit 0', [baselineTagDigest(N, dN), cli(['--records', store('n1', mk([inc({ digest: dN, candidate: arm(5, { digest: dN }), baseline: arm(5, { digest: F }), baseline_digest: F })])), '--repo', N]).code, cli(['--records', store('n2', mk([pass({ digest: dN, candidate: arm(1, { digest: dN }) })])), '--repo', N]).code], [{ ok: true, digest: null }, 1, 0]);
const P = repo(); commit(P, 'p1', 'v1.0.0'); commit(P, 'p2', 'v1.1.0-rc1'); const dP2 = commit(P, 'p3', 'v1.1.0-rc2');
const dP1 = definitionSetDigest(P, 'v1.0.0'); const Q = repo(); commit(Q, 'q1', 'v1.0.0-rc1'); const dQ = commit(Q, 'q2');
check('a pre-release is never a baseline: the candidate on rc2 with rc1 present selects v1.0.0; only pre-releases give none', [baselineTagDigest(P, dP2), baselineTagDigest(Q, dQ)], [{ ok: true, digest: dP1 }, { ok: true, digest: null }]);
const W = repo(); commit(W, 'w1', 'v1.0.0'); const dW2 = commit(W, 'w2'); gx(W, 'tag', '-a', 'v1.5.0', '-m', 'one', 'HEAD'); gx(W, 'tag', '-a', 'v2.0.0', '-m', 'two', 'v1.5.0^{tag}'); const dW = commit(W, 'w3');
check('a tag that points at an annotated tag (nested) peels to its commit and is selected, not skipped', [gx(W, 'cat-file', '-t', gx(W, 'cat-file', '-p', 'v2.0.0').split('\n')[0].slice(7)), baselineTagDigest(W, dW)], ['tag', { ok: true, digest: dW2 }]);
const fakeBin = path.join(dir, 'fakebin'); fs.mkdirSync(fakeBin); fs.writeFileSync(path.join(fakeBin, 'git'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
const noGit = (extra) => cli(['--records', store('ng' + Math.random(), mk([pass()])), ...extra], { PATH: fakeBin });
const failed = [noGit(['--digest', D]), noGit(['--digest', D, '--repo', N]), cli(['--records', g, '--repo', path.join(dir, 'nope')]), cli(['--records', g, '--digest', D, '--repo', dir])];
check('a git failure or a non-repository is exit 1 not-ready and never none or ready, even for a record that is ready under none', [failed.map((r) => r.code), failed.map((r) => r.first.startsWith('not-ready: '))], [[1, 1, 1, 1], Array(4).fill(true)]);
check('the helper refuses on git failure and a non-repo, and is null for malformed arguments', [[dir, path.join(dir, 'nope')].map((r) => baselineTagDigest(r, dN)?.ok), [5, '', undefined].map((r) => baselineTagDigest(r, dN)), baselineTagDigest(N, 'abc')], [[false, false], [null, null, null], null]);
fs.writeFileSync(path.join(N, 'commands', 'dirty.md'), 'x');
const dirty = cli(['--records', store('d1', mk([pass({ digest: dN, candidate: arm(1, { digest: dN }) })])), '--repo', N]);
check('a dirty tree is exit 1 not-ready naming the path, and --digest skips that check', [dirty.code, dirty.first.startsWith('not-ready: dirty definition-set path "commands/dirty.md"'), assertCleanTree(N).ok, cli(['--records', store('d2', mk([pass({ digest: dN, candidate: arm(1, { digest: dN }) })])), '--repo', N, '--digest', dN, '--baseline-tag', 'none']).code], [1, true, false, 0]);

// Fail-closed tag branches: a missing commit object, a tree git cannot digest, an exhausted tag budget.
const X = repo(); commit(X, 'x1', 'v1.0.0'); const x1 = gx(X, 'rev-parse', 'HEAD'); const dX = commit(X, 'x2');
fs.rmSync(path.join(X, '.git', 'objects', x1.slice(0, 2), x1.slice(2)));
const Y = repo(); fs.mkdirSync(path.join(Y, 'commands'), { recursive: true }); fs.symlinkSync('a.md', path.join(Y, 'commands', 'ln')); commit(Y, 'y1', 'v1.0.0'); fs.rmSync(path.join(Y, 'commands', 'ln')); const dY = commit(Y, 'y2');
const Z = repo(); const dZ = commit(Z, 'z'); const zc = gx(Z, 'rev-parse', 'HEAD');
for (let i = 1; i <= 65; i++) fs.writeFileSync(path.join(Z, '.git', 'refs', 'tags', `v1.0.${i}`), zc + '\n');
const refused = [baselineTagDigest(X, dX), baselineTagDigest(Y, dY), baselineTagDigest(Z, dZ)];
check('a tag whose commit object is gone, a tag whose tree has a symlink, and 65 tags on the own tree each refuse (ok:false), never none', [refused.map((r) => r.ok), refused[1].reason, refused[2].reason?.includes('no baseline among')], [[false, false, false], 'could not digest the tree of tag v1.0.0', true]);
check('the same three through the CLI are exit 1 not-ready', [[X, dX], [Y, dY], [Z, dZ]].map(([r, d]) => cli(['--records', store('rf' + Math.random(), mk([pass({ digest: d, candidate: arm(1, { digest: d }) })])), '--repo', r, '--digest', d]).code), [1, 1, 1]);

// An annotated tag whose commit is gone hides behind its intact tag object, and --merged=HEAD then drops it
// without an error: v1.9.0 (intact maintenance branch) must not become the baseline. Run with and without a commit-graph.
const gone = (graph) => {
  const R = repo(); commit(R, 'g1'); gx(R, 'checkout', '-q', '-b', 'maint'); fs.writeFileSync(path.join(R, 'commands', 'm.md'), 'maint'); gx(R, 'add', '-A'); gx(R, 'commit', '-q', '-m', 'maint'); gx(R, 'tag', 'v1.9.0');
  gx(R, 'checkout', '-q', 'main'); commit(R, 'g2'); gx(R, 'tag', '-a', 'v2.0.0', '-m', 'two'); gx(R, 'merge', '-q', '--no-edit', 'maint'); const d = commit(R, 'g3');
  const c = gx(R, 'rev-parse', 'v2.0.0^{commit}'); if (graph) gx(R, 'commit-graph', 'write', '--reachable');
  fs.rmSync(path.join(R, '.git', 'objects', c.slice(0, 2), c.slice(2)));
  let walks = true; try { gx(R, 'rev-list', 'HEAD'); } catch { walks = false; }
  return [walks, baselineTagDigest(R, d), cli(['--records', store('gn' + graph, mk([pass({ digest: d, candidate: arm(1, { digest: d }) })])), '--repo', R, '--digest', d]).code];
};
check('an annotated tag with its commit deleted (with and without a commit-graph): git cannot walk HEAD, the helper refuses with ok:false and the CLI exits 1', [gone(false), gone(true)].map(([w, r, c]) => [w, r.ok, r.reason?.startsWith('the object store is incomplete'), c]), Array(2).fill([false, false, true, 1]));
const V = repo(); commit(V, 'v1', 'v2'); const dV2 = commit(V, 'v2', 'v2.0.0'); const dVc = commit(V, 'v3');
check('equal versions are ordered by name: v2.0.0 wins over v2', baselineTagDigest(V, dVc), { ok: true, digest: dV2 });

// HEAD moving between the two digests is refused: a git wrapper makes a commit right after the first ls-tree.
const H = repo(); const dH = commit(H, 'h1'); const realGit = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
const cnt = path.join(dir, 'cnt');
fs.writeFileSync(path.join(fakeBin, 'git'), `#!/bin/sh\nif [ "$(echo " $* " | grep -c ' ls-tree ')" = 1 ] && [ ! -e ${cnt} ]; then : > ${cnt}; ${realGit} "$@"; r=$?; echo h2 > ${H}/commands/a.md; ${realGit} -C ${H} add -A; ${realGit} -C ${H} -c user.name=t -c user.email=t@t -c commit.gpgSign=false commit -q -m h2; exit $r; fi\nexec ${realGit} "$@"\n`, { mode: 0o755 });
const moved = cli(['--records', store('hm', mk([pass({ digest: dH, candidate: arm(1, { digest: dH }) })])), '--repo', H, '--baseline-tag', 'none'], { PATH: fakeBin + ':' + process.env.PATH });
check('a HEAD that moves between the two digests is not-ready: HEAD moved, never ready', [moved.code, moved.first, definitionSetDigest(H, 'HEAD') === dH], [1, 'not-ready: HEAD moved while the check ran', false]);
fs.writeFileSync(path.join(fakeBin, 'git'), `#!/bin/sh\ncase " $* " in *" cat-file "*) exit 1;; esac\nexec ${realGit} "$@"\n`, { mode: 0o755 });
const noType = cli(['--records', g, '--repo', S, '--digest', dC], { PATH: fakeBin + ':' + process.env.PATH });
check('a git failure while resolving one tag is exit 1 naming the tag, never a skipped tag', [noType.code, noType.first.startsWith('not-ready: git could not resolve tag v')], [1, true]);
const undecided = spawnSync(process.execPath, ['--input-type=module', '-e', `process.argv[1] = '/nonexistent/gate-check-main'; await import(${JSON.stringify(ENTRY)});`], { encoding: 'utf8' });
check('a main-module test that cannot be decided still runs the check: usage output and exit 2, not a silent 0', [undecided.status, undecided.stdout.split('\n')[0]], [2, 'invalid: usage error']);

// Overrides are named on a ready result; the neutraliser and its cap.
check('a ready result with --digest, --baseline-tag and --repo prints override: with each one used, in order', [pure([pass()]).lines, cli(['--records', store('ov', mk([pass()])), '--digest', D, '--baseline-tag', 'none']).first, execFileSync(process.execPath, [ENTRY, '--records', store('ov2', mk([pass()])), '--digest', D, '--baseline-tag', 'none', '--repo', N], { encoding: 'utf8' }).split('\n')[1]], [3, 'ready: pass: candidate arm passes (candidate 1/9 failures)', 'override: digest,baseline-tag,repo']);
check('clean() maps every control, bidi and non-ASCII character to ?, and caps a line at 300 characters', [clean('a\tb‮\x1b[31mé\r\n'), clean('x'.repeat(1000)).length, clean(undefined)], ['a?b??[31m???', 300, 'undefined']);

// The main guard: a symlinked directory or file must still run the check (a silent exit 0 would be a pass).
const tl = fs.mkdtempSync(path.join(process.env.TMP, 'lnk-'));
fs.symlinkSync(path.resolve('tests/evals'), path.join(tl, 'evals')); fs.symlinkSync(ENTRY, path.join(tl, 'gc.mjs'));
const viaLinks = [['evals', 'gate-check.mjs'], ['gc.mjs']].map((p) => path.join(tl, ...p)).flatMap((e) => [[], ['--records', '/nonexistent']].map((a) => { const r = spawnSync(process.execPath, [e, ...a], { encoding: 'utf8' }); return [r.status, r.stdout.split('\n')[0]]; }));
check('through a symlinked directory and a symlinked file: no arguments is exit 2 with the usage line, a missing store is exit 2 invalid', viaLinks, [[2, 'invalid: usage error'], [2, 'invalid: unreadable record store'], [2, 'invalid: usage error'], [2, 'invalid: unreadable record store']]);
const watch = () => fs.readdirSync(dir).join();
const before2 = watch(); cli(['--records', g, '--digest', D, '--baseline-tag', 'none']);
check('the entrypoint writes nothing into the store directory', watch(), before2);

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
[ "$ran" -ge 89 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 89 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
