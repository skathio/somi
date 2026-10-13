#!/usr/bin/env bash
# Guards scripts/lib/size-tier.mjs: decideTier(signals) -> {tier, floor?, failed, reasons}.
# Runs the signals -> tier table (tests/scripts/fixtures/size-tier-cases.json), the exported
# thresholds, the never-lower property (an unknown signal can only keep or raise the tier), and
# hostile inputs; then proves the table has teeth: each mutation of a threshold, comparison or
# rule order, applied to a scratch copy of the module, must turn the same suite red.
# Hermetic: pure computation, scratch dir only, no network, no model.
set -uo pipefail
umask 022

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MOD="$ROOT/scripts/lib/size-tier.mjs"
CASES="$ROOT/tests/scripts/fixtures/size-tier-cases.json"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
echo "== size tier: decideTier table =="

cat > "$TMP/run.mjs" <<'JS'
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const m = await import(pathToFileURL(process.argv[2]).href);
const { decideTier, SIGNAL_IDS } = m;
const { base, cases } = JSON.parse(readFileSync(process.argv[3], 'utf8'));
const j = JSON.stringify;
let bad = 0, n = 0;
const check = (name, got, want) => { n++; if (j(got) === j(want)) console.log('  ok   ' + name); else { bad++; console.log('  FAIL ' + name + ' (want ' + j(want) + ', got ' + j(got) + ')'); } };
const safe = (f) => { try { return f(); } catch (e) { return 'THREW ' + e.message; } };
const entry = (v) => ({ value: v, evidence: 'e' });
const rank = { trivial: 0, small: 1, full: 2 };
const build = (c) => {
  const o = {};
  for (const id of Object.keys(base)) o[id] = entry(base[id]);
  for (const [id, v] of Object.entries(c.set || {})) o[id] = v !== null && typeof v === 'object' && 'entry' in v ? v.entry : entry(v);
  for (const id of c.drop || []) delete o[id];
  for (const id of c.noEvidence || []) o[id] = { value: base[id] };
  for (const [id, len] of Object.entries(c.evidenceLength || {})) o[id].evidence = 'x'.repeat(len);
  return o;
};

check('thresholds and ids', [m.MAX_MODULES, m.MAX_FILES, m.MAX_DIFF_LINES, m.TRIVIAL_MAX_FILES, m.TRIVIAL_MAX_MODULES, m.TRIVIAL_MAX_DIFF_LINES, m.MAX_EVIDENCE_CHARS, SIGNAL_IDS.join()],
  [2, 6, 100, 1, 1, 50, 300, 'T1,T2,T3,T4,T5,hard_surface,design_open,open_questions,acceptance_testable,modules_touched,est_files,est_diff_lines,existing_work_item,brief_exists']);

for (const c of cases) {
  const input = 'raw' in c ? c.raw : build(c);
  const ids = (x) => (x === 'ALL' ? [...SIGNAL_IDS] : x || []);
  const unknown = ids(c.expect.unknown), invalid = ids(c.expect.invalid);
  const want = { tier: c.expect.tier, floor: c.expect.floor || null,
    failed: SIGNAL_IDS.filter((id) => unknown.includes(id) || invalid.includes(id)), unknown, invalid, reasons: c.expect.reasons };
  const got = safe(() => decideTier(input));
  const { basis, ...rest } = got;
  check('case: ' + c.name, rest, want);
  if (c.expect.basis) check('basis: ' + c.name, Object.keys(basis), c.expect.basis);
  if ('raw' in c) continue;
  // Never lower: making any one signal unknown keeps or raises the tier, keeps any floor, and names the id.
  const before = decideTier(input);
  let lowered = [];
  for (const id of SIGNAL_IDS) for (const value of ['unknown', 'bogus']) {
    const after = decideTier({ ...input, [id]: { value, evidence: 'e' } });
    if (rank[after.tier] < rank[before.tier] || (before.floor && !after.floor) || !after.failed.includes(id)) lowered.push(id + ':' + value);
  }
  check('unknown or invalid never lowers: ' + c.name, lowered, []);
}

const shapeOk = (r) => j(r) === j({ tier: 'full', floor: 'full', failed: [...SIGNAL_IDS], unknown: [], invalid: [...SIGNAL_IDS], reasons: ['signals_unreadable'], basis: {} });
const good = () => Object.fromEntries(Object.keys(base).map((id) => [id, entry(base[id])]));
let reads = 0;
const getterEntry = Object.defineProperty({ evidence: 'e' }, 'value', { get() { reads++; throw new Error('boom'); }, enumerable: true });
const refused = {
  'throwing proxy as input': new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); }, getOwnPropertyDescriptor() { throw new Error('boom'); }, getPrototypeOf() { throw new Error('boom'); } }),
  'inherited values only': Object.create(good()),
  'class instance': new (class S { constructor() { Object.assign(this, good()); } })(),
  'sparse array': [, , ,],
  'Map': new Map(),
  'Date': new Date(0),
  'function': () => 1,
};
for (const [name, input] of Object.entries(refused)) check('refused with signals_unreadable: ' + name, shapeOk(safe(() => decideTier(input))), true);
const hostile = {
  'throwing getter on value': { ...good(), T1: getterEntry },
  'throwing getter on entry': Object.defineProperty(good(), 'T2', { get() { reads++; throw new Error('boom'); }, enumerable: true }),
  'proxy entry': { ...good(), T3: new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('boom'); } }) },
  'symbol key': { [Symbol('T1')]: entry(true) },
  'NaN count': { ...good(), est_files: entry(NaN) },
  'Infinity count': { ...good(), est_diff_lines: entry(Infinity) },
  'JSON __proto__ key': JSON.parse('{"__proto__": {"T3": {"value": true, "evidence": "x"}}}'),
};
for (const [name, input] of Object.entries(hostile)) {
  const r = safe(() => decideTier(input));
  check('hostile never throws, never reaches trivial: ' + name, typeof r === 'object' && r !== null && r.tier in rank && r.tier !== 'trivial', true);
}
check('a huge evidence string is invalid, not a crash', decideTier({ ...good(), T1: { value: true, evidence: 'x'.repeat(2e6) } }).invalid, ['T1']);
check('hostile getters are never invoked', reads, 0);
check('prototype-key input is the worst case', decideTier(JSON.parse('{"__proto__": {"T3": {"value": true, "evidence": "x"}}}')).invalid.length, SIGNAL_IDS.length);
const frozen = Object.freeze(Object.fromEntries(Object.entries(good()).map(([k, v]) => [k, Object.freeze(v)])));
check('frozen input is read without mutation', safe(() => decideTier(frozen).tier), 'trivial');
const snapshot = j(good());
const probe = good(); decideTier(probe);
check('input is not mutated', j(probe), snapshot);
check('result is plain JSON', j(JSON.parse(j(decideTier(good())))), j(decideTier(good())));

console.log('SUMMARY ' + n + ' ' + bad);
process.exit(bad ? 1 : 0);
JS

out="$(node "$TMP/run.mjs" "$MOD" "$CASES" 2>&1)"; rc=$?
printf '%s\n' "$out" | grep -v '^SUMMARY'
total="$(printf '%s\n' "$out" | awk '/^SUMMARY/{print $2}')"; failed="$(printf '%s\n' "$out" | awk '/^SUMMARY/{print $3}')"
pass=$((${total:-0} - ${failed:-0})); fail=${failed:-1}
[ "$rc" = 0 ] || fail=$((fail > 0 ? fail : 1))
ok()  { pass=$((pass+1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail+1)); printf '  FAIL %s\n' "$1"; }

# The table must be big enough to mean something.
cases_n="$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1])).cases.length)" "$CASES")"
if [ "${cases_n:-0}" -ge 25 ]; then ok "table has $cases_n cases (floor 25)"; else bad "table has only ${cases_n:-0} cases (floor 25)"; fi
if [ "$pass" -ge 150 ]; then ok "check count $pass meets the floor of 150"; else bad "check count $pass is under the floor of 150"; fi

# Mutation proof: the suite must go red on each scratch mutation of the module.
mutate() { # $1 = label, $2 = node expression over `s` (the source) returning the mutated source
  node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const t=($2);if(t===s){process.exit(3)}fs.writeFileSync(process.argv[2],t)" "$MOD" "$TMP/mut.mjs"
  local made=$?
  if [ "$made" != 0 ]; then bad "mutation '$1' did not change the module (stale pattern)"; return; fi
  if node "$TMP/run.mjs" "$TMP/mut.mjs" "$CASES" >/dev/null 2>&1; then bad "mutation '$1' left the suite green"; else ok "mutation '$1' turns the suite red"; fi
}
mutate "diff threshold 100 -> 101" "s.replace('MAX_DIFF_LINES = 100','MAX_DIFF_LINES = 101')"
mutate "file threshold 6 -> 7" "s.replace('MAX_FILES = 6','MAX_FILES = 7')"
mutate "module threshold 2 -> 3" "s.replace('MAX_MODULES = 2','MAX_MODULES = 3')"
mutate "trivial file limit 1 -> 2" "s.replace('TRIVIAL_MAX_FILES = 1','TRIVIAL_MAX_FILES = 2')"
mutate "diff comparison > -> >=" "s.replace('x > MAX_DIFF_LINES','x >= MAX_DIFF_LINES')"
mutate "files comparison > -> >=" "s.replace('x > MAX_FILES','x >= MAX_FILES')"
mutate "trivial comparison <= -> <" "s.replace('v.est_files <= TRIVIAL_MAX_FILES','v.est_files < TRIVIAL_MAX_FILES')"
mutate "trivial diff limit 50 -> 51" "s.replace('TRIVIAL_MAX_DIFF_LINES = 50','TRIVIAL_MAX_DIFF_LINES = 51')"
mutate "trivial diff comparison > -> >=" "s.replace('x > TRIVIAL_MAX_DIFF_LINES','x >= TRIVIAL_MAX_DIFF_LINES')"
mutate "trivial rule ignores the diff limit" "s.replace(' && v.est_diff_lines <= TRIVIAL_MAX_DIFF_LINES','')"
mutate "trivial module limit 1 -> 2" "s.replace('TRIVIAL_MAX_MODULES = 1','TRIVIAL_MAX_MODULES = 2')"
mutate "contradiction check removed" "s.replace(\"read.T1.state === 'ok' && read.T1.value\",'false')"
mutate "evidence cap 300 -> 301" "s.replace('MAX_EVIDENCE_CHARS = 300','MAX_EVIDENCE_CHARS = 301')"
mutate "control characters allowed in evidence" "s.replace('&& !CONTROL_CHARS.test(e)','')"
mutate "count minimum dropped (0 allowed)" "s.replace('modules_touched: 1, est_files: 1, est_diff_lines: 1 }','modules_touched: 0, est_files: 0, est_diff_lines: 0 }')"
mutate "unknown work-item reason suffix removed" "s.replace('? \`\${id}_unknown\` : id','? id : id')"
mutate "basis drops T3" "s.replace(\"(id === 'T3' || decided.tier !== 'full')\",\"decided.tier !== 'full'\")"
mutate "worst case of T3 flipped to true" "s.replace('T3: false, T4','T3: true, T4')"
mutate "floor dropped" "s.replace(\"floor: v.T3 === true ? null : 'full'\",'floor: null')"
# Rules 4 and 5 can never both match (the size caps sit above the trivial caps), so only 1-4 are swapped.
for i in 0 1 2; do
  j=$((i+1))
  mutate "rules $((i+1)) and $((j+1)) swapped" "s.replace('const RULES = [','const RULES_IN_ORDER = [').replace('export function decideTier', 'const RULES = RULES_IN_ORDER.map((_, k, a) => a[k === $i ? $j : k === $j ? $i : k]);\nexport function decideTier')"
done

# ---- CLI: scripts/somi-tier.mjs (resolve, resolve --record) ----
echo "== size tier: somi-tier CLI =="
cat > "$TMP/cli.mjs" <<'JS'
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const [CLI, TMPDIR, mode] = process.argv.slice(2);
const quiet = mode === 'quiet';
const work = fs.mkdtempSync(path.join(TMPDIR, 'w-'));
let n = 0, bad = 0;
// Quiet mode (mutants) stops at the first failure: one red check is all a mutant needs.
const check = (name, got, want) => {
  n++;
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { if (!quiet) console.log('  ok   ' + name); return; }
  bad++; console.log('  FAIL ' + name + ' (want ' + w + ', got ' + g + ')');
  if (quiet) process.exit(1);
};
const run = (args, { input, env = {}, cwd, timeout } = {}) => {
  const e = { ...process.env, ...env };
  if (!('SOMI_SHIP_LOOP_TIER' in env)) delete e.SOMI_SHIP_LOOP_TIER;
  const r = spawnSync(process.execPath, [CLI, ...args], { input, env: e, cwd, encoding: 'utf8', timeout });
  return { rc: r.status, out: r.stdout, err: r.stderr };
};
const json = (s) => { try { return JSON.parse(s); } catch { return 'NOT JSON'; } };
const isAscii = (s) => /^[\x00-\x7f]*$/.test(s);
const BASE = { T1: true, T2: true, T3: true, T4: true, T5: true, hard_surface: false, design_open: false, open_questions: 0,
  acceptance_testable: true, modules_touched: 1, est_files: 1, est_diff_lines: 40, existing_work_item: false, brief_exists: false };
const signals = (over = {}) => Object.fromEntries(Object.entries({ ...BASE, ...over }).map(([k, v]) => [k, { value: v, evidence: 'e' }]));
const write = (name, content) => { const f = path.join(work, name); fs.writeFileSync(f, typeof content === 'string' || Buffer.isBuffer(content) ? content : JSON.stringify(content)); return f; };
const F = {
  trivial: write('trivial.json', signals()),
  small: write('small.json', signals({ T2: false, est_diff_lines: 80 })),
  floor: write('floor.json', signals({ T3: false, hard_surface: true })),
  nofloor: write('nofloor.json', signals({ hard_surface: true })),
};
const KEYS = ['basis', 'effective', 'failed', 'floor', 'invalid', 'reasons', 'source', 'tier', 'unknown'];

// resolve: one result per corpus tier, by file and by stdin
for (const [name, tier, floor] of [['trivial', 'trivial', null], ['small', 'small', null], ['floor', 'full', 'full'], ['nofloor', 'full', null]]) {
  const r = run(['resolve', '--signals', F[name]]);
  const o = json(r.out);
  check(`resolve ${name}: exit 0, tier, floor, source`, [r.rc, o.tier, o.effective, o.floor, o.source], [0, tier, tier, floor, 'computed']);
  check(`resolve ${name}: exact key set, one line`, [Object.keys(o).sort(), r.out.trim().split('\n').length], [KEYS, 1]);
  const s = run(['resolve', '--signals', '-'], { input: fs.readFileSync(F[name]) });
  check(`resolve ${name}: stdin equals file`, s.out, r.out);
}
check('resolve: reasons and failed are echoed', (({ reasons, failed }) => [reasons, failed])(json(run(['resolve', '--signals', F.floor]).out)), [['T3'], []]);

// input errors
const big = write('big.json', ' '.repeat(70000) + '{}');
const exact = write('exact.json', JSON.stringify(signals()) + ' '.repeat(64 * 1024 - JSON.stringify(signals()).length));
const link = path.join(work, 'link.json'); fs.symlinkSync(F.trivial, link);
const fifo = path.join(work, 'fifo.json'); spawnSync('mkfifo', [fifo]);
const deep = (open, close, k) => open.repeat(k) + close.repeat(k);
const badInputs = {
  'oversize file': ['resolve', '--signals', big], 'missing file': ['resolve', '--signals', path.join(work, 'nope.json')],
  'directory': ['resolve', '--signals', work], 'symlink': ['resolve', '--signals', link],
  'JSON parse error': ['resolve', '--signals', write('p.json', '{"T1": ')], 'empty file': ['resolve', '--signals', write('e.json', '')],
  'array': ['resolve', '--signals', write('a.json', '[]')], 'string': ['resolve', '--signals', write('s.json', '"x"')],
  'null': ['resolve', '--signals', write('n.json', 'null')], 'number': ['resolve', '--signals', write('num.json', '5')],
  'deeply nested array': ['resolve', '--signals', write('deep.json', deep('[', ']', 30000))],
  'invalid UTF-8': ['resolve', '--signals', write('u.json', Buffer.from([0x7b, 0xff, 0x7d]))],
  'invalid UTF-8 inside evidence': ['resolve', '--signals', write('ue.json', (() => { const t = JSON.stringify(signals()); const k = t.indexOf('"evidence":"e"') + 12; return Buffer.concat([Buffer.from(t.slice(0, k)), Buffer.from([0xff]), Buffer.from(t.slice(k + 1))]); })())],
  'unknown flag': ['resolve', '--signals', F.trivial, '--bogus', 'x'], 'no --signals': ['resolve'],
  'flag without value': ['resolve', '--signals'], 'empty flag value': ['resolve', '--signals', ''],
  'duplicate flag': ['resolve', '--signals', F.trivial, '--signals', F.trivial], 'no subcommand': [], 'unknown subcommand': ['frobnicate'],
  'the removed record subcommand': ['record', '--slug', 'x', '--tier', 'small', '--source', 'override'],
  '--project-dir without --record': ['resolve', '--signals', F.trivial, '--project-dir', work],
  'prototype-named flag': ['resolve', '--signals', F.trivial, '__proto__', 'x'],
};
for (const [name, args] of Object.entries(badInputs)) {
  const r = run(args);
  check(`resolve rejects ${name}: exit 64, stdout empty`, [r.rc, r.out], [64, '']);
}
const fifoRun = run(['resolve', '--signals', fifo], { timeout: 3000 });
check('a FIFO is refused without hanging', [fifoRun.rc, fifoRun.out], [64, '']);
check('resolve accepts a file of exactly 64 KiB', run(['resolve', '--signals', exact]).rc, 0);
const bigStdin = run(['resolve', '--signals', '-'], { input: ' '.repeat(70000) + '{}' });
check('resolve rejects oversize stdin', [bigStdin.rc, bigStdin.out], [64, '']);
check('resolve rejects empty stdin', run(['resolve', '--signals', '-'], { input: '' }).rc, 64);
const invalid = json(run(['resolve', '--signals', write('empty-obj.json', '{}')]).out);
check('invalid signals resolve normally to the worst case', [invalid.tier, invalid.floor, invalid.invalid.length > 0], ['full', 'full', true]);
const nestedValue = write('nested.json', `{"T1":{"value":${deep('[', ']', 30000)},"evidence":"e"}}`);
const nestedRun = run(['resolve', '--signals', nestedValue, '--record', 'nested', '--project-dir', work]);
check('a deeply nested value is invalid, not a crash, and still recorded', [nestedRun.rc, json(nestedRun.out).invalid.includes('T1'), /^[0-9a-f]{64}$/.test(json(fs.readFileSync(path.join(work, '.somi/somi-state/tier/nested.json'), 'utf8')).signals_sha256)], [0, true, true]);

// no raw input on stderr, no non-ASCII anywhere in the output
const secret = run(['resolve', '--signals', write('secret.json', '{"T1": xSECRETx}')]);
check('a parse error does not echo the input', [secret.rc, /SECRET/.test(secret.err)], [64, false]);
const hostileFlag = run(['resolve', '--signals', F.trivial, '‮--evil\u009b '], {});
check('a hostile argument is quoted and ASCII on stderr', [hostileFlag.rc, isAscii(hostileFlag.err), /\\u202e/.test(hostileFlag.err)], [64, true, true]);
const hostilePath = run(['resolve', '--signals', path.join(work, 'no‮\u009bfile')]);
check('a hostile path is quoted and ASCII on stderr', [hostilePath.rc, isAscii(hostilePath.err), /\\u202e/.test(hostilePath.err)], [64, true, true]);
const hostileSub = run([' ‮']);
check('a hostile subcommand is quoted and ASCII on stderr', [hostileSub.rc, isAscii(hostileSub.err)], [64, true]);
const nasty = 'say "hi" \\ </script> é 中 😀';
const small2 = { ...signals({ T2: false, est_diff_lines: 80 }), T3: { value: true, evidence: nasty } };
const echo = run(['resolve', '--signals', write('nasty.json', small2)]);
check('evidence echoes on one line, ASCII, and decodes back exactly', [json(echo.out).basis?.T3, echo.out.trim().split('\n').length, isAscii(echo.out)], [nasty, 1, true]);
for (const [name, ch] of [['bidi override U+202E', '‮'], ['line separator U+2028', ' '], ['C1 control U+009B', '\u009b']]) {
  const r = run(['resolve', '--signals', write('ctl.json', { ...signals({ T2: false, est_diff_lines: 80 }), T3: { value: true, evidence: `a${ch}b` } })]);
  check(`${name} in evidence is refused as invalid, output stays ASCII`, [r.rc, json(r.out).invalid, isAscii(r.out)], [0, ['T3'], true]);
}

// override
const ov = (file, tier, env) => run(['resolve', '--signals', file, ...(tier ? ['--override', tier] : [])], env !== undefined ? { env: { SOMI_SHIP_LOOP_TIER: env } } : {});
let r = ov(F.floor, 'small');
check('downward override below the floor: exit 65, no stdout, names the floor', [r.rc, r.out, /floor/.test(r.err) && /full/.test(r.err)], [65, '', true]);
r = ov(F.nofloor, 'small');
check('downward override without a floor is allowed', [r.rc, json(r.out).tier, json(r.out).effective, json(r.out).source], [0, 'full', 'small', 'override']);
r = ov(F.small, 'full');
check('upward override small -> full', [r.rc, json(r.out).tier, json(r.out).effective, json(r.out).source], [0, 'small', 'full', 'override']);
r = ov(F.trivial, 'small');
check('upward override trivial -> small', [r.rc, json(r.out).effective], [0, 'small']);
r = ov(F.floor, 'full');
check('override equal to the computed tier is allowed under a floor', [r.rc, json(r.out).effective, json(r.out).source], [0, 'full', 'override']);
for (const bad of ['trivial', 'Small', 'medium']) { r = ov(F.small, bad); check(`override target ${bad} is a usage error`, [r.rc, r.out], [64, '']); }
r = ov(F.small, null, 'full');
check('env override raises the tier, source env', [r.rc, json(r.out).effective, json(r.out).source], [0, 'full', 'env']);
r = ov(F.small, 'small', 'full');
check('the flag wins over the environment', [r.rc, json(r.out).effective, json(r.out).source], [0, 'small', 'override']);
r = ov(F.nofloor, null, 'small');
check('env override may lower when there is no floor', [r.rc, json(r.out).effective, json(r.out).source], [0, 'small', 'env']);
r = ov(F.floor, null, 'small');
check('env override below the floor: exit 65', [r.rc, r.out], [65, '']);
for (const bad of ['trivial', 'FULL', 'x y']) { r = ov(F.small, null, bad); check(`env value ${JSON.stringify(bad)} is a usage error`, [r.rc, r.out], [64, '']); }
r = ov(F.small, null, '');
check('an empty env value counts as unset', [r.rc, json(r.out).source], [0, 'computed']);
r = ov(F.small, 'full', 'bogus');
check('a valid flag does not read an invalid env value', [r.rc, json(r.out).effective], [0, 'full']);
r = run(['resolve', '--signals', F.small], { env: { SOMI_SHIP_LOOP_TIER: '‮' } });
check('a hostile env value leaves stderr ASCII', [r.rc, isAscii(r.err)], [64, true]);

// --record
const proj = path.join(work, 'proj'); fs.mkdirSync(proj);
const tierDir = path.join(proj, '.somi', 'somi-state', 'tier');
const mode9 = (p) => (fs.lstatSync(p).mode & 0o777).toString(8);
const sha = (x) => crypto.createHash('sha256').update(x).digest('hex');
const IDS = Object.keys(BASE);
const hashOf = (file) => { const o = JSON.parse(fs.readFileSync(file, 'utf8')); return sha(JSON.stringify(IDS.map((id) => [id, o[id].value, o[id].evidence]))); };
const rec = (slug, file, extra = [], opts) => run(['resolve', '--signals', file, ...extra, '--record', slug, '--project-dir', proj], opts);
const readRec = (slug) => json(fs.readFileSync(path.join(tierDir, `${slug}.json`), 'utf8'));
r = rec('my-item', F.small);
const file = path.join(tierDir, 'my-item.json');
const doc = readRec('my-item');
check('record: exit 0, stdout gains the relative path, other keys unchanged', [r.rc, json(r.out).recorded, Object.keys(json(r.out)).sort()], [0, '.somi/somi-state/tier/my-item.json', ['recorded', ...KEYS].sort()]);
check('record: modes 0600 file, 0700 directories', [mode9(file), mode9(tierDir), mode9(path.dirname(tierDir)), mode9(path.join(proj, '.somi'))], ['600', '700', '700', '700']);
check('record: content is the computed result', [doc.slug, doc.tier, doc.source, doc.computed_tier, doc.floor, doc.reasons, doc.failed, Object.keys(doc).sort()],
  ['my-item', 'small', 'computed', 'small', null, ['T2', 'est_diff_lines'], [], ['basis', 'computed_tier', 'failed', 'floor', 'reasons', 'recorded_at', 'signals_sha256', 'slug', 'source', 'tier']]);
check('record: timestamp is ISO', new Date(doc.recorded_at).toISOString(), doc.recorded_at);
check('record: sha256 covers the signal entries', doc.signals_sha256, hashOf(F.small));
rec('reordered', write('reordered.json', Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(F.small, 'utf8'))).reverse())));
check('record: the hash ignores key order', readRec('reordered').signals_sha256, doc.signals_sha256);
check('record: no stray temp files', fs.readdirSync(tierDir).filter((x) => x.endsWith('.tmp')), []);
const ino = fs.statSync(file).ino;
r = rec('my-item', F.small, ['--override', 'full']);
check('record: an existing file is replaced atomically, with the effective tier and the computed one', [r.rc, fs.statSync(file).ino !== ino, readRec('my-item').tier, readRec('my-item').computed_tier, readRec('my-item').source, mode9(file)], [0, true, 'full', 'small', 'override', '600']);
rec('env-item', F.small, [], { env: { SOMI_SHIP_LOOP_TIER: 'full' } });
check('record: the env source is recorded only because the env was read', [readRec('env-item').source, readRec('env-item').tier], ['env', 'full']);
r = rec('floor-ok', F.floor, ['--override', 'full']);
check('record: tier full against a floor is allowed', [r.rc, readRec('floor-ok').tier, readRec('floor-ok').floor], [0, 'full', 'full']);
rec('ascii', write('ascii.json', { ...signals({ T2: false, est_diff_lines: 80 }), T3: { value: true, evidence: 'café 中' } }));
check('record: the state file is pure ASCII and decodes back', [isAscii(fs.readFileSync(path.join(tierDir, 'ascii.json'), 'utf8')), readRec('ascii').basis.T3], [true, 'café 中']);
r = run(['resolve', '--signals', F.small, '--record', 'from-cwd'], { cwd: proj });
check('record defaults the project to the current directory', [r.rc, fs.existsSync(path.join(tierDir, 'from-cwd.json'))], [0, true]);
check('record accepts a 64-character slug', rec('a' + '-'.repeat(63), F.small).rc, 0);
const before = fs.readdirSync(tierDir).sort();
for (const slug of ['../x', '/etc/x', 'Upper', 'a'.repeat(65), '', '-lead', 'a/b', 'a.json', 'a b', '..']) {
  r = rec(slug, F.small);
  check(`record rejects slug ${JSON.stringify(slug.length > 20 ? slug.length + ' chars' : slug)}: 64`, [r.rc, r.out], [64, '']);
}
check('rejected slugs wrote nothing, here or above', [fs.readdirSync(tierDir).sort(), fs.existsSync(path.join(proj, '.somi', 'somi-state', 'x.json')), fs.existsSync('/etc/x.json')], [before, false, false]);
r = rec('s3', F.floor, ['--override', 'small']);
check('record below the floor: exit 65, nothing written', [r.rc, r.out, fs.existsSync(path.join(tierDir, 's3.json'))], [65, '', false]);
r = rec('s4', write('bad.json', '[]'));
check('record with unusable signals: 64, nothing written', [r.rc, fs.existsSync(path.join(tierDir, 's4.json'))], [64, false]);
check('record: project dir that does not exist is a usage error', run(['resolve', '--signals', F.small, '--record', 's5', '--project-dir', path.join(work, 'nope')]).rc, 64);

// links are never followed
const outside = path.join(work, 'outside'); fs.mkdirSync(outside);
const p2 = path.join(work, 'proj2'); fs.mkdirSync(path.join(p2, '.somi', 'somi-state'), { recursive: true });
fs.symlinkSync(outside, path.join(p2, '.somi', 'somi-state', 'tier'));
r = run(['resolve', '--signals', F.small, '--record', 'x', '--project-dir', p2]);
check('symlinked tier directory is refused, nothing lands outside', [r.rc, r.out, fs.readdirSync(outside)], [64, '', []]);
const p3 = path.join(work, 'proj3'); fs.mkdirSync(p3); fs.symlinkSync(outside, path.join(p3, '.somi'));
r = run(['resolve', '--signals', F.small, '--record', 'x', '--project-dir', p3]);
check('symlinked .somi is refused, nothing lands outside', [r.rc, fs.readdirSync(outside)], [64, []]);
const victim = path.join(outside, 'victim.txt'); fs.writeFileSync(victim, 'keep');
fs.symlinkSync(victim, path.join(tierDir, 'linked.json'));
r = rec('linked', F.small);
check('a symlink at the final path is replaced, never written through', [r.rc, fs.readFileSync(victim, 'utf8'), fs.lstatSync(path.join(tierDir, 'linked.json')).isFile()], [0, 'keep', true]);

fs.rmSync(work, { recursive: true, force: true });
console.log('SUMMARY ' + n + ' ' + bad);
process.exit(bad ? 1 : 0);
JS

CLI="$ROOT/scripts/somi-tier.mjs"
# The full suite runs beside the mutants (they share the cores) and is collected before the report.
( node "$TMP/cli.mjs" "$CLI" "$TMP" > "$TMP/cli.out" 2>&1; echo $? > "$TMP/cli.rc" ) &

# CLI mutation proof: each mutant is a scratch copy of the CLI (beside a copy of the module) run
# by the quiet, fail-fast suite in its own directory; up to JOBS run at once, results are
# collected and counted serially. kind "holds" marks a mutant that is meant to stay green because
# a second guard covers the same hole.
JOBS="${JOBS:-8}"
mkdir -p "$TMP/cm"
cm_n=0
cmutate() { # $1 = label, $2 = node expression over `s` (the source); $3 = holds (optional)
  cm_n=$((cm_n + 1)); local d="$TMP/cm/$cm_n"
  mkdir -p "$d/lib"; cp "$MOD" "$d/lib/size-tier.mjs"
  printf '%s' "$1" > "$d/label"; printf '%s' "${3:-red}" > "$d/kind"
  (
    node -e "const fs=require('fs');const s=fs.readFileSync(process.argv[1],'utf8');const t=($2);if(t===s){process.exit(3)}fs.writeFileSync(process.argv[2],t)" "$CLI" "$d/somi-tier.mjs" || { echo stale > "$d/rc"; exit 0; }
    node "$TMP/cli.mjs" "$d/somi-tier.mjs" "$TMP" quiet >/dev/null 2>&1; echo $? > "$d/rc"
  ) &
  while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n; done
}
cmutate "floor refusal removed" 's.replace("if (floor && rank(tier) < rank(floor))","if (false)")'
cmutate "resolve ignores the floor" 's.replace("refuseBelowFloor(requested, r.floor,","refuseBelowFloor(requested, null,")'
cmutate "floor refusal exit code 65 -> 64" 's.replace("EXIT_FLOOR = 65","EXIT_FLOOR = 64")'
cmutate "override may target trivial" 's.replace(/OVERRIDE_TARGETS = \[.small., .full.\]/,"OVERRIDE_TARGETS = [\"trivial\", \"small\", \"full\"]")'
cmutate "slug pattern unanchored" 's.replace(/const SLUG = .*/,"const SLUG = /[a-z0-9-]/;")'
cmutate "slug length cap 64 -> 200" 's.replace("{0,63}","{0,199}")'
cmutate "environment wins over the flag" 's.replace("if (!requested && process.env[ENV_OVERRIDE])","if (process.env[ENV_OVERRIDE])")'
cmutate "empty environment value read as a value" 's.replace("!requested && process.env[ENV_OVERRIDE])","!requested && ENV_OVERRIDE in process.env)")'
cmutate "environment value not validated" 's.replace("if (!OVERRIDE_TARGETS.includes(requested)) die(","if (false) die(")'
cmutate "file mode 0600 -> 0666" 's.replace("fs.constants.O_NOFOLLOW, 0o600)","fs.constants.O_NOFOLLOW, 0o666)")'
cmutate "directory mode 0700 -> 0777" 's.replace("{ mode: 0o700 }","{ mode: 0o777 }")'
cmutate "input cap 64 KiB -> 640 KiB" 's.replace("MAX_INPUT_BYTES = 64 * 1024","MAX_INPUT_BYTES = 640 * 1024")'
cmutate "array signals accepted" 's.replace(" || Array.isArray(parsed)","")'
cmutate "state directory links followed (both guards removed)" 's.replace("else if (!st.isDirectory())","else if (false)").replace("if (real !== path.join(root, ...STATE_DIRS))","if (false)")'
cmutate "directory link check alone removed" 's.replace("else if (!st.isDirectory())","else if (false)")'
cmutate "signals symlink followed" 's.replace("fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK","fs.constants.O_RDONLY | fs.constants.O_NONBLOCK")'
cmutate "FIFO opened blocking" 's.replace(" | fs.constants.O_NONBLOCK","")'
cmutate "regular-file check on the descriptor removed" 's.replace("if (!fs.fstatSync(fd).isFile())","if (false)")' holds
cmutate "output not ASCII-escaped" 's.replace("[\\u007f-\\uffff]","[\\uffff]")'
cmutate "parse error echoes the engine message" 's.replace("signals are not valid UTF-8 JSON${","signals are not valid UTF-8 JSON ${String(e.message)}${")'
cmutate "arguments echoed raw" 's.replace("const quote = (x) => ascii(String(x));","const quote = (x) => String(x);")'
wait
for d in "$TMP"/cm/*/; do
  label="$(cat "$d/label")"; kind="$(cat "$d/kind")"; rc="$(cat "$d/rc" 2>/dev/null || echo missing)"
  if [ "$rc" = stale ] || [ "$rc" = missing ]; then bad "CLI mutation '$label' did not apply (stale pattern)"
  elif [ "$kind" = holds ]; then
    if [ "$rc" = 0 ]; then ok "CLI mutation '$label' is still caught by a second guard"; else bad "CLI mutation '$label' went red but a second guard should hold"; fi
  elif [ "$rc" = 0 ]; then bad "CLI mutation '$label' left the suite green"
  else ok "CLI mutation '$label' turns the suite red"; fi
done
cli_rc="$(cat "$TMP/cli.rc" 2>/dev/null || echo 1)"
cli_out="$(cat "$TMP/cli.out")"
printf '%s\n' "$cli_out" | grep -v '^SUMMARY'
cli_total="$(printf '%s\n' "$cli_out" | awk '/^SUMMARY/{print $2}')"; cli_failed="$(printf '%s\n' "$cli_out" | awk '/^SUMMARY/{print $3}')"
pass=$((pass + ${cli_total:-0} - ${cli_failed:-0})); fail=$((fail + ${cli_failed:-0}))
[ "$cli_rc" = 0 ] || { [ "${cli_failed:-0}" -gt 0 ] || bad "CLI suite crashed"; }
if [ "${cli_total:-0}" -ge 95 ]; then ok "CLI check count ${cli_total} meets the floor of 95"; else bad "CLI check count ${cli_total:-0} is under the floor of 95"; fi
# The widened evidence filter is part of the module, so its mutants run against the table.
mutate "C1 controls allowed in evidence" "s.replace('\\\\u007f-\\\\u009f','\\\\u007f')"
mutate "bidi and separator characters allowed in evidence" "s.replace('\\\\u2028-\\\\u202e','')"
mutate "zero-width and mark characters allowed in evidence" "s.replace('\\\\u200b-\\\\u200f','')"

echo "== size tier: $pass passed, $fail failed =="
[ "$fail" = 0 ]
