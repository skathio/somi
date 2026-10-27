#!/usr/bin/env bash
# Admits every micro task under tests/evals/ab-micro/ (admitTask, repeats 3: oracle, oracle2, nop, every mutant, stability) and
# checks the mutant spread (tests/evals/lib/mutant-spread.mjs) of each; the same two checks run on the template's EXAMPLE task
# copied into a scratch ab-micro/ so they are exercised even while the corpus is empty. The spread rule itself is pinned
# with hand-made rows (every boundary value, an equivalent mutant, too few mutants, a missing band) and with a task whose
# mutants all fail everything; each rule is then mutated on a scratch copy and the suite must fail. Hermetic: temp
# directories, no model, network or git. Skipped in a tarball, where tests/evals is absent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: micro tasks (admission and mutant spread) =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t mtasks.XXXXXX)"
trap 'chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

CODE=$(cat <<'EOS'
import fs from 'node:fs';
const S = await import(`${process.env.LIB}/mutant-spread.mjs`);
const { admitTask } = await import(`${process.env.ROOT}/tests/evals/lib/admit.mjs`);
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const row = (name, failed, total = 100) => ({ name, failed, total });
const six = (extra = []) => [row('a', 10), row('b', 30), row('c', 50), row('d', 12), row('e', 33), row('f', 55), ...extra];
const reasons = (rows) => S.evaluateSpread(rows).reasons;

// --- the registered numbers -----------------------------------------------------------------------------
check('the rule: at least 6 mutants, 5% to 90%', [S.SPREAD.MIN_MUTANTS, S.SPREAD.MIN_FRACTION, S.SPREAD.MAX_FRACTION, S.BANDS.map((b) => b.name)], [6, 0.05, 0.9, ['5-20%', '20-40%', '40-60%', '60-90%']]);
// --- bands at every boundary (of 100 cases, so a count is a percent) -------------------------------------------------
const band = (k) => S.evaluateSpread([row('x', k)]).table[0].band;
check('boundary values: 0 equivalent, 4 and 5, 19 and 20, 39 and 40, 60 and 61, 90 and 91', [0, 4, 5, 19, 20, 39, 40, 60, 61, 90, 91, 100].map(band), ['equivalent', 'out of range', '5-20%', '5-20%', '20-40%', '20-40%', '40-60%', '40-60%', '60-90%', '60-90%', 'out of range', 'out of range']);
check('bandOf agrees on the same boundaries', [0.04, 0.05, 0.19, 0.2, 0.39, 0.4, 0.6, 0.61, 0.9, 0.91].map(S.bandOf), ['out of range', '5-20%', '5-20%', '20-40%', '20-40%', '40-60%', '40-60%', '60-90%', '60-90%', 'out of range']);
check('a fraction of exactly 1/20 of 20 cases is in the first band (integer arithmetic, no rounding)', S.evaluateSpread([row('x', 1, 20)]).table[0].band, '5-20%');
check('a good spread passes with an empty reason list and a table of six', [S.evaluateSpread(six()).ok, S.evaluateSpread(six()).reasons, S.evaluateSpread(six()).table.length], [true, [], 6]);
check('a mutant between 60% and 90% is allowed', S.evaluateSpread(six([row('g', 75)])).ok, true);
// --- refusals -------------------------------------------------------------------------------------------------------------
check('every mutant failing more than 90% is refused, each named', reasons([...Array(6)].map((_, i) => row('m' + i, 95 + (i % 5)))).filter((r) => /outside 5% to 90%/.test(r)).length, 6);
check('every mutant failing less than 5% is refused, each named', reasons([...Array(6)].map((_, i) => row('m' + i, 1 + (i % 4)))).filter((r) => /outside 5% to 90%/.test(r)).length, 6);
check('an equivalent mutant (fails no case) is reported by name', reasons(six([row('same-as-oracle', 0)])), ['same-as-oracle fails no case (an equivalent mutant: change it or drop it)']);
check('five mutants are too few', reasons([row('a', 10), row('b', 30), row('c', 50), row('d', 12), row('e', 33)]), ['5 mutants, at least 6 are needed']);
check('a missing band is named', reasons([row('a', 10), row('b', 12), row('c', 15), row('d', 33), row('e', 55), row('f', 58)]).filter((r) => /band/.test(r)), []);
check('no mutant in the 20-40% band is named', reasons([row('a', 10), row('b', 12), row('c', 15), row('d', 50), row('e', 55), row('f', 58)]), ['no mutant in the 20-40% band']);
check('no mutant in the 5-20% band and none in the 40-60% band are both named', reasons([row('a', 25), row('b', 30), row('c', 35), row('d', 22), row('e', 33), row('f', 38)]), ['no mutant in the 5-20% band', 'no mutant in the 40-60% band']);
check('malformed rows are refused, never thrown on', [null, [null], [row('a', 5, 0)], [row('a', 101)], [{ name: 5, failed: 1, total: 2 }], [row('a', -1)], [row('a', 1.5)]].map((r) => S.evaluateSpread(r).ok), Array(7).fill(false));
check('an admission that was refused is a failed spread carrying the reason', [S.spreadFromAdmission({ ok: false, reason: 'oracle: scores 3/4' }).ok, S.spreadFromAdmission({ ok: false, reason: 'oracle: scores 3/4' }).reasons, S.spreadFromAdmission(null).ok], [false, ['admission refused: oracle: scores 3/4'], false]);
check('spreadFromAdmission reads the killed mutants and the total', S.spreadFromAdmission({ ok: true, total: 100, mutantsKilled: [{ name: 'a', failed: new Array(10).fill('t') }] }).table, [{ name: 'a', failed: 10, total: 100, fraction: 0.1, band: '5-20%' }]);
check('the printed table names the task, the verdict, each mutant and each reason', S.formatSpread('T', S.evaluateSpread([row('only', 0)])).split('\n').map((l) => l.trim().slice(0, 14)), ['spread T: FAIL', 'only          ', '! 1 mutants, a', '! only fails n', '! no mutant in', '! no mutant in', '! no mutant in']);

// --- real tasks ----------------------------------------------------------------------------------------------------------------
const ab = `${process.env.ROOT}/tests/evals/ab-micro`;
const dirs = fs.existsSync(ab) ? fs.readdirSync(ab, { withFileTypes: true }).filter((e) => e.isDirectory() && fs.existsSync(`${ab}/${e.name}/task.json`)).map((e) => e.name).sort() : [];
if (dirs.length === 0) console.log('ok\tno micro tasks under tests/evals/ab-micro/ yet: corpus admission and spread have nothing to check');
const mutantsOf = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : []);
const verify = (label, dir, mutants) => {
  const adm = admitTask(dir, { mutants, repeats: 3 });
  check(`${label}: admitTask with repeats 3 passes${adm.ok ? ` (${adm.total} cases, ${mutants.length} mutants)` : ''}`, adm.ok ? true : adm.reason, true);
  const sp = S.spreadFromAdmission(adm);
  console.log('#\t' + S.formatSpread(label, sp).replace(/\n/g, '\n#\t'));
  check(`${label}: the mutant spread holds`, sp.ok ? true : sp.reasons, true);
  return adm;
};
for (const d of dirs) verify(d, `${ab}/${d}`, mutantsOf(`${ab}/${d}.mutants.json`));
const T = `${process.env.ROOT}/tests/evals/ab-micro-template`;
const scratch = `${process.env.TMPD}/ab-micro`; fs.cpSync(`${T}/EXAMPLE`, `${scratch}/EXAMPLE`, { recursive: true });
const exampleMutants = mutantsOf(`${T}/EXAMPLE.mutants.json`);
const adm = verify('EXAMPLE (template copied under ab-micro/)', `${scratch}/EXAMPLE`, exampleMutants);
check('the example has at least 6 mutants and one in each required band', [exampleMutants.length >= 6, S.BANDS.filter((b) => b.required).every((b) => S.spreadFromAdmission(adm).table.some((t) => t.band === b.name))], [true, true]);

// --- a task whose mutants all fail everything is refused (through the real scorer) -----------------------------------------
const wreck = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'].map((name, i) => ({ name, file: 'clamp.mjs', find: 'export function clamp(value, low, high) {', replace: `export function clamp() { return 'wrong${i}'; }\nfunction unused(value, low, high) {` }));
const wrecked = S.mutantSpread(`${scratch}/EXAMPLE`, wreck);
check('mutants that all fail every case: refused, six times, and no band is covered', [wrecked.ok, wrecked.reasons.filter((r) => /outside 5% to 90%/.test(r)).length, wrecked.table.map((t) => t.band)], [false, 6, Array(6).fill('out of range')]);
const equiv = S.mutantSpread(`${scratch}/EXAMPLE`, [{ name: 'same', file: 'clamp.mjs', find: 'const finite = ', replace: 'const finite =  ' }, ...exampleMutants]);
check('an equivalent mutant is refused by the scorer path with its name in the reason', [equiv.ok, /same survives/.test(equiv.reasons[0])], [false, true]);

for (const l of res) console.log((l[0] ? 'ok' : 'FAIL') + '\t' + l[1] + (l[0] ? '' : ' (want ' + JSON.stringify(l[3]) + ', got ' + JSON.stringify(l[2]).slice(0, 400) + ')'));
EOS
)
suite() { LIB="$1" ROOT="$ROOT" TMPD="$2" node --input-type=module -e "$CODE" 2>&1; }

# The base run and each mutation run below are independent full runs of the suite (every real task admitted again),
# so they run concurrently: each writes its own output file, and the verdicts are read afterwards in the same order.
mkdir -p "$TMP/base"; suite "$ROOT/tests/evals/lib" "$TMP/base" > "$TMP/base.out" &
nm=0; labels=()
mutant() { # from, to, label
  local d="$TMP/m$((++nm))"; mkdir -p "$d"; cp tests/evals/lib/*.mjs "$d/"; labels+=("$3")
  if ! M_FILE="$d/mutant-spread.mjs" M_FROM="$1" M_TO="$2" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then echo NOT-FOUND > "$d.out"; return; fi
  while [ "$(jobs -rp | wc -l)" -ge 4 ]; do wait -n; done   # four at a time: each admits every task, CPU-bound
  mkdir -p "$d/t"; suite "$d" "$d/t" > "$d.out" &
}
# Mutation: each rule is broken on a scratch copy of the library (with its admit sibling); the suite must then fail.
mutant "MIN_MUTANTS: 6" "MIN_MUTANTS: 1" "minimum mutant count"
mutant "if (!exact(r, 5, 100)) return 'out of range';" "if (false) return 'out of range';" "fractions under 5% are refused"
mutant "return r.failed * 100 <= r.total * 90 ? '60-90%' : 'out of range';" "return '60-90%';" "fractions over 90% are refused"
mutant "if (r.failed === 0) return 'equivalent';" "" "an equivalent mutant is reported"
mutant "if (!exact(r, 20, 100)) return '5-20%';" "if (!exact(r, 21, 100)) return '5-20%';" "20% belongs to the second band"
mutant "r.failed * 100 <= r.total * 60" "r.failed * 100 < r.total * 60" "60% belongs to the third band"
mutant "for (const b of BANDS.filter((x) => x.required))" "for (const b of [])" "every required band needs a mutant"
mutant "if (admission === null || typeof admission !== 'object' || admission.ok !== true) return" "if (false) return" "a refused admission is a failed spread"
wait
out="$(cat "$TMP/base.out")"

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    '#')  printf '    %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"

for i in "${!labels[@]}"; do
  res="$(cat "$TMP/m$((i + 1)).out")"; label="${labels[$i]}"
  if [ "$res" = NOT-FOUND ]; then fail=$((fail+1)); printf '  FAIL mutation target not found: %s\n' "$label"
  elif [ -z "$res" ] || printf '%s\n' "$res" | grep -qv '^\(ok\|#\)'; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "$label"
  else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "$label"; fi
done
ran=$((pass + fail))
[ "$ran" -ge 25 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 25 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
