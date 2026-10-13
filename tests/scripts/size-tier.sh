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

echo "== size tier: $pass passed, $fail failed =="
[ "$fail" = 0 ]
