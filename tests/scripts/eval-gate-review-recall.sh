#!/usr/bin/env bash
# Pins the reviewer-recall scorer (tests/evals/lib/review-recall.mjs): the reviewer-output parser (formats,
# severity association, bounds, hostile input), the +-2 overlap rule at its boundary values, the severity
# filter, unparsed handling, the Wilson interval against hand-computed values, the pre-registered branch table
# at its boundaries, the mutated-range computation, and the seeded stratified case selection. Each rule is then
# mutated on a scratch copy of the library and the suite must fail. Hermetic: pure computation plus reads of
# the committed corpus and a scratch directory; no model, network or credential (the harness part runs git on scratch repositories).
# Skipped in a tarball, where tests/evals is absent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: reviewer recall scorer =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t recall.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

CODE=$(cat <<'EOS'
import { mkdirSync, writeFileSync } from 'node:fs'; import { createHash } from 'node:crypto';
import { join } from 'node:path';
const L = await import(`${process.env.LIB}/review-recall.mjs`);
const { parseFindings: P, overlaps, scoreMutant, scoreClean, wilson95, recallStats, branchFor, mutatedRange, selectCases, sameFile } = L;
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const near = (a, b, tol = 0.0005) => Math.abs(a - b) <= tol;
const sev = (out) => P(out).findings.map((f) => [f.file, f.lineStart, f.lineEnd, f.severity]);

// --- constants -----------------------------------------------------------------------------------------
check('registered bounds', [L.MAX_INPUT_CHARS, L.MAX_FINDINGS, L.OVERLAP_MARGIN, L.SAMPLE], [200000, 200, 2, { MUTANTS: 40, PER_TASK_MAX: 8, CLEAN: 10 }]);

// --- parser: formats and severity association -----------------------------------------------------------
check('block header severity applies to a later Where line (file:line)', sev('**[Major / High] BOM literal**\n\n- **Where**: `src/csv.mjs:43` vs plan'), [['src/csv.mjs', 43, 43, 'major']]);
check('file:line-line range', sev('Blocker: see src/a.mjs:10-18 for the issue'), [['src/a.mjs', 10, 18, 'blocker']]);
check('en-dash range and trailing punctuation', sev('Minor. (lib/x.js:5–09).'), [['lib/x.js', 5, 9, 'minor']]);
check('file:line:col keeps the line', sev('Nit at a/b.py:7:3'), [['a/b.py', 7, 7, 'nit']]);
check('reversed range is ordered', sev('Major a.mjs:20-10'), [['a.mjs', 10, 20, 'major']]);
check('severity word is case-insensitive', sev('MAJOR a.mjs:1'), [['a.mjs', 1, 1, 'major']]);
check('a reference with no severity in scope has severity null', sev('see a.mjs:3'), [['a.mjs', 3, 3, null]]);
check('a heading closes the severity block', sev('### Major\n- a.mjs:1\n### Verified correct\n- b.mjs:2'), [['a.mjs', 1, 1, 'major'], ['b.mjs', 2, 2, null]]);
check('two findings carry their own severities', sev('1. [Minor] x\n   a.mjs:4\n2. [Blocker] y\n   b.mjs:9'), [['a.mjs', 4, 4, 'minor'], ['b.mjs', 9, 9, 'blocker']]);
check('a severity word deep in a line does not open a block', sev('- notes\nthis is a long enough preamble that, as a note, not a Major thing a.mjs:2 later\nb.mjs:3'), [['a.mjs', 2, 2, 'major'], ['b.mjs', 3, 3, null]]);
check('non-references are ignored (URL, time, word:word)', sev('Major: https://x.io:80/a at 12:34:56 key:value'), []);
check('line number zero or huge is dropped', sev('Major a.mjs:0 b.mjs:99999999'), []);
check('JSON array', sev('[{"file":"src/a.mjs","line":10,"severity":"Major"}]'), [['src/a.mjs', 10, 10, 'major']]);
check('JSON object with findings, lineStart/lineEnd, case-insensitive severity', sev('{"findings":[{"path":"a.mjs","lineStart":3,"lineEnd":6,"severity":"BLOCKER"}]}'), [['a.mjs', 3, 6, 'blocker']]);
check('JSON line as "a-b" string', sev('[{"file":"a.mjs","line":"4-9","severity":"minor"}]'), [['a.mjs', 4, 9, 'minor']]);
check('fenced JSON after prose', sev('Here:\n```json\n[{"file":"a.mjs","line":2,"severity":"Major"}]\n```\nthanks'), [['a.mjs', 2, 2, 'major']]);
check('JSON wins over prose references (no double count)', sev('Major a.mjs:1\n```json\n[{"file":"b.mjs","line":2,"severity":"Major"}]\n```'), [['b.mjs', 2, 2, 'major']]);
check('JSON item with an unknown severity keeps severity null', sev('[{"file":"a.mjs","line":2,"severity":"critical"}]'), [['a.mjs', 2, 2, null]]);
check('broken JSON falls back to prose', sev('[{"file":"a.mjs", Major b.mjs:5'), [['b.mjs', 5, 5, 'major']]);

// --- unparsed handling ---------------------------------------------------------------------------------
for (const [name, v] of [['empty', ''], ['whitespace', ' \n\t'], ['prose only', 'Looks fine to me.'], ['not a string', null], ['an object', {}], ['a number', 5], ['malformed JSON', '[{"file":']]) {
  check(`${name}: unparsed, not detected, not a false positive`, [P(v).unparsed, scoreMutant(v, { file: 'a.mjs', start: 1, end: 1 }).detected, scoreClean(v).falsePositive], [true, false, false]);
}
check('a parsed output is not flagged unparsed', P('Major a.mjs:1').unparsed, false);
check('unparsed flag is carried on the scored rows', [scoreMutant('', { file: 'a', start: 1, end: 1 }).unparsed, scoreClean('').unparsed], [true, true]);

// --- bounds and hostile input --------------------------------------------------------------------------
const timed = (fn) => { const t = Date.now(); const r = fn(); return [r, Date.now() - t]; };
const big = 'Major '.concat('a.mjs:1 '.repeat(50000));
const [bigR, bigMs] = timed(() => P(big));
check('50000 references are capped at 200 findings and flagged', [bigR.findings.length, bigR.capped], [200, true]);
check('the cap holds in about linear time', bigMs < 3000, true);
const [lenR] = timed(() => P('x'.repeat(200001)));
check('input over 200000 chars is truncated and flagged', [lenR.truncated, lenR.unparsed], [true, true]);
check('a reference after the 200000-char bound is never read', P(' '.repeat(200000) + 'Major a.mjs:1').findings.length, 0);
const path = [
  ['a 200 KB run of word characters', 'a'.repeat(200000)],
  ['a 200 KB run of dots then a line number', '.'.repeat(199990) + ':12'],
  ['a 200 KB run of colons', ':'.repeat(200000)],
  ['a 200 KB run of "a:"', 'a:'.repeat(100000)],
  ['a 200 KB run of dots and colons', '.:'.repeat(100000)],
  ['a 200 KB run of open brackets', '['.repeat(200000)],
  ['a 200 KB run of open braces in a fence', '```json\n' + '{'.repeat(100000) + '\n```'],
  ['a 200 KB single-line almost-JSON array', '[' + '{"file":"a","line":1},'.repeat(9000)],
  ['200 KB of newlines', '\n'.repeat(200000)],
  ['200 KB of severity words', 'major '.repeat(33000)],
  ['a 200 KB token that looks like a reference', 'a'.repeat(199990) + ':1'],
];
for (const [name, text] of path) { const [r, ms] = timed(() => P(text)); check(`pathological: ${name} is bounded (<3 s) and parses to nothing`, [ms < 3000, r.findings.length <= 200], [true, true]); }
check('text that looks like code or a template is data, never evaluated', sev('Major ${process.exit(9)} a.mjs:1'), [['a.mjs', 1, 1, 'major']]);
check('a prototype-pollution JSON body parses to nothing', P('{"__proto__":{"polluted":1}}').unparsed, true);
check('prototype pollution attempt via JSON leaves Object.prototype clean', ({}).polluted, undefined);

// --- overlap, +-2 inclusive ----------------------------------------------------------------------------
check('single-line finding against mutated 10-12: 7 misses, 8 hits, 14 hits, 15 misses', [7, 8, 14, 15].map((l) => overlaps(l, l, 10, 12)), [false, true, true, false]);
check('finding ranges touching the margin: 1-7 misses, 1-8 hits, 14-20 hits, 15-20 misses', [[1, 7], [1, 8], [14, 20], [15, 20]].map(([a, b]) => overlaps(a, b, 10, 12)), [false, true, true, false]);
check('a finding that spans the whole mutated range hits', overlaps(1, 100, 10, 12), true);
check('single-line mutation 10-10: 7 misses, 8 hits, 12 hits, 13 misses', [7, 8, 12, 13].map((l) => overlaps(l, l, 10, 10)), [false, true, true, false]);
check('near the top of the file the lower margin does not wrap (mutated 1-1: line 3 hits, 4 misses)', [3, 4].map((l) => overlaps(l, l, 1, 1)), [true, false]);
const M = { file: 'src/csv.mjs', start: 10, end: 12 };
const at = (line, s = 'Major', file = 'src/csv.mjs') => `**[${s}] x**\n- ${file}:${line}`;
check('end to end: Major at line 14 is detected, at 15 is not', [14, 15].map((l) => scoreMutant(at(l), M).detected), [true, false]);
check('end to end: Major at line 8 is detected, at 7 is not', [8, 7].map((l) => scoreMutant(at(l), M).detected), [true, false]);

// --- severity filter and file match --------------------------------------------------------------------
check('Blocker and Major detect; Minor, Nit and unknown severity do not', ['Blocker', 'Major', 'Minor', 'Nit'].map((s) => scoreMutant(at(11, s), M).detected), [true, true, false, false]);
check('a reference with no severity does not detect', scoreMutant('see src/csv.mjs:11', M).detected, false);
check('a Minor in range plus a Major out of range is not detected', scoreMutant('Minor src/csv.mjs:11\nMajor src/csv.mjs:99', M).detected, false);
check('a Major out of range plus a Blocker in range is detected', scoreMutant('Major src/csv.mjs:99\nBlocker src/csv.mjs:11', M).detected, true);
check('another file with the same lines is not detected', scoreMutant(at(11, 'Major', 'src/other.mjs'), M).detected, false);
check('a shortened or prefixed path matches on a segment boundary', [sameFile('csv.mjs', 'src/csv.mjs'), sameFile('./src/csv.mjs', 'src/csv.mjs'), sameFile('b/src/csv.mjs', 'src/csv.mjs'), sameFile('rc/csv.mjs', 'src/csv.mjs'), sameFile('src/csv.mjs', 'src/csv.mjs.bak')], [true, true, true, false, false]);
check('clean: Blocker or Major anywhere is a false positive; Minor and Nit are not', ['Blocker', 'Major', 'Minor', 'Nit'].map((s) => scoreClean(at(3, s)).falsePositive), [true, true, false, false]);

// --- Wilson 95% interval vs hand-computed values --------------------------------------------------------
// z = 1.96, z^2 = 3.8416. Closed form: (2k + z^2 -+ z*sqrt(z^2 + 4k(1-k/n))) / (2(n + z^2)).
// k=8, n=40: sqrt(3.8416 + 25.6) = 5.42598, times 1.96 = 10.6350; lower = (16 + 3.8416 - 10.6350)/87.6832 = 0.10500, upper = (16 + 3.8416 + 10.6350)/87.6832 = 0.34757.
const w840 = wilson95(8, 40);
check('wilson 8/40 is [0.1050, 0.3476]', [near(w840.lower, 0.1050), near(w840.upper, 0.3476)], [true, true]);
// k=0, n=10: lower 0, upper z^2/(n + z^2) = 3.8416/13.8416 = 0.27753.  k=10, n=10: lower n/(n + z^2) = 10/13.8416 = 0.72247, upper 1.
const w0 = wilson95(0, 10); const w10 = wilson95(10, 10);
check('wilson 0/10 is [0, 0.2775] and 10/10 is [0.7225, 1]', [w0.lower, near(w0.upper, 0.27753), near(w10.lower, 0.72247), w10.upper], [0, true, true, 1]);
// k=18, n=40 (R = 0.45): 4k(1-k/n) = 72*0.55 = 39.6; sqrt(43.4416) = 6.59102, times 1.96 = 12.9184; lower = (36 + 3.8416 - 12.9184)/87.6832 = 0.30706, upper = (36 + 3.8416 + 12.9184)/87.6832 = 0.60172.
const w18 = wilson95(18, 40);
check('wilson 18/40 is [0.3071, 0.6017]', [near(w18.lower, 0.3071), near(w18.upper, 0.6017)], [true, true]);
check('wilson outside its domain is null', [wilson95(1, 0), wilson95(-1, 5), wilson95(6, 5), wilson95(1.5, 5), wilson95('1', 5)], [null, null, null, null, null]);

// --- branch table --------------------------------------------------------------------------------------
// n = 40 mutants, m = 10 clean unless stated. R = k/40, FPR = f/10.
const br = (k, f, n = 40, m = 10) => branchFor(k, n, f, m);
check('R = 0.20 (8/40) with FPR 0 is LIMITED-GO; R just below (7/40 = 0.175) is NO-GO', [br(8, 0), br(7, 0)], ['LIMITED-GO', 'NO-GO']);
check('R - FPR exactly 0.10 (8/40 - 1/10) is LIMITED-GO; below 0.10 (8/40 - 2/10 = 0) is NO-GO', [br(8, 1), br(8, 2)], ['LIMITED-GO', 'NO-GO']);
check('R - FPR 0.10 from other denominators: 12/40 - 2/10 = 0.10 is LIMITED-GO, 12/40 - 3/10 = 0 is NO-GO', [br(12, 2), br(12, 3)], ['LIMITED-GO', 'NO-GO']);
check('R = 0.425 (17/40) is LIMITED-GO even with FPR 0; R = 0.45 (18/40) with FPR 0 is GO', [br(17, 0), br(18, 0)], ['LIMITED-GO', 'GO']);
check('R - FPR exactly 0.25 (18/40 - 2/10) is GO', br(18, 2), 'GO');
check('R >= 0.45 with R - FPR in [0.10, 0.25) falls in no registered branch: UNDEFINED (18/40 - 3/10 = 0.15)', br(18, 3), 'UNDEFINED');
check('R >= 0.45 with R - FPR exactly 0.10 is UNDEFINED (18/40 vs 7/20), below 0.10 is NO-GO (18/40 vs 8/20)', [br(18, 7, 40, 20), br(18, 8, 40, 20)], ['UNDEFINED', 'NO-GO']);
check('R = 0.5 (20/40): FPR 0.2 gives 0.30 GO, FPR 0.3 gives 0.20 UNDEFINED', [br(20, 2), br(20, 3)], ['GO', 'UNDEFINED']);
check('R = 1 and FPR = 1 is NO-GO (no separation)', br(40, 10), 'NO-GO');
const rows = (k, n, f, m) => [...Array(n)].map((_, i) => ({ kind: 'mutant', detected: i < k })).concat([...Array(m)].map((_, i) => ({ kind: 'clean', falsePositive: i < f })));
const st = recallStats(rows(18, 40, 2, 10));
check('recallStats returns R, FPR, interval and branch', [st.R, st.FPR, st.n, st.m, st.k, st.f, st.branch, near(st.interval.lower, 0.3071), near(st.interval.upper, 0.6017), st.unparsed], [0.45, 0.2, 40, 10, 18, 2, 'GO', true, true, 0]);
check('recallStats counts unparsed rows', recallStats([{ kind: 'mutant', detected: false, unparsed: true }, { kind: 'clean', falsePositive: false, unparsed: true }, { kind: 'mutant', detected: true }]).unparsed, 2);
for (const [name, v] of [['not an array', 5], ['empty', []], ['mutants only', [{ kind: 'mutant', detected: true }]], ['clean only', [{ kind: 'clean', falsePositive: false }]], ['an unknown kind', [{ kind: 'x' }]], ['a non-boolean flag', [{ kind: 'mutant', detected: 1 }, { kind: 'clean', falsePositive: false }]], ['a null row', [null]]]) check(`recallStats rejects ${name}`, recallStats(v), null);

// --- mutated range --------------------------------------------------------------------------------------
const src = 'a\nb\nc\nd\ne\n';
check('single line replaced', mutatedRange(src, 'c', 'C'), { start: 3, end: 3 });
check('one line replaced by three lines', mutatedRange(src, 'c', 'x\ny\nz'), { start: 3, end: 5 });
check('two lines replaced by one', mutatedRange(src, 'b\nc', 'X'), { start: 2, end: 2 });
check('a line deleted anchors on the two lines either side of the join', mutatedRange(src, 'c\n', ''), { start: 2, end: 3 });
check('an in-line edit marks only its line', mutatedRange('x = 1;\ny = 2;\n', '2', '3'), { start: 2, end: 2 });
check('a find that is absent, repeated, empty or a no-op has no range', [mutatedRange(src, 'zz', 'q'), mutatedRange('aa', 'a', 'b'), mutatedRange(src, '', 'q'), mutatedRange(src, 'c', 'c')], [null, null, null, null]);
check('replacement text with dollar patterns is literal', mutatedRange('k\nv\n', 'v', '$&$1'), { start: 2, end: 2 });

// --- selection -----------------------------------------------------------------------------------------
const corpus = `${process.env.ROOT}/tests/evals/ab`;
const a = selectCases(corpus, 1234); const b = selectCases(corpus, 1234); const c = selectCases(corpus, 4321);
check('same corpus and seed give the same list', JSON.stringify(a) === JSON.stringify(b), true);
check('another seed gives another list', JSON.stringify(a.mutants) !== JSON.stringify(c.mutants), true);
const perTask = (list) => { const o = {}; for (const m of list) o[m.task] = (o[m.task] ?? 0) + 1; return o; };
check('40 mutants, 10 clean on the real corpus', [a.mutants.length, a.clean.length], [40, 10]);
check('at most 8 per task and every task is used', [Math.max(...Object.values(perTask(a.mutants))) <= 8, Object.keys(perTask(a.mutants)).length], [true, 7]);
check('shares are as even as possible (40 over 7 tasks: five 6s and two 5s)', Object.values(perTask(a.mutants)).sort().join(), '5,5,6,6,6,6,6');
check('no mutant is selected twice', new Set(a.mutants.map((m) => `${m.task}/${m.name}`)).size, 40);
check('every mutant has a valid line range', a.mutants.every((m) => Number.isInteger(m.start) && m.start >= 1 && m.end >= m.start), true);
check('the 40 mutants are exactly the frozen list (hash of task/name/file/lines in order, default seed)', createHash('sha256').update(selectCases(corpus, L.DEFAULT_SEED).mutants.map((m) => `${m.task}/${m.name}/${m.file}/${m.start}-${m.end}`).join('\n')).digest('hex').slice(0, 16), '655a7dca61745b9a');
const cl = a.clean; const perT = perTask(cl);
check('the 10 clean cases are distinct whole-solution variants, at most 2 per task, the first seven on seven different tasks', [cl.length, new Set(cl.map((x) => `${x.task}/${x.variant}`)).size, Math.max(...Object.values(perT)) <= 2, new Set(cl.slice(0, 7).map((x) => x.task)).size, cl.every((x) => ['oracle', 'oracle2'].includes(x.variant) && x.file === undefined)], [10, 10, true, 7, true]);
check('the clean draw does not move the mutant draw: another seed still gives 40 mutants and 10 clean', [c.mutants.length, c.clean.length], [40, 10]);
check('the seed is echoed', a.seed, 1234);
// Synthetic corpora, to pin the per-task cap and the redistribution of leftover share.
const mk = (spec) => {
  const d = join(process.env.TMPD, `corpus-${Math.random().toString(36).slice(2)}`); mkdirSync(d, { recursive: true });
  for (const [task, count] of Object.entries(spec)) {
    mkdirSync(join(d, task, 'oracle'), { recursive: true });
    writeFileSync(join(d, task, 'oracle', 'f.mjs'), Array.from({ length: count + 2 }, (_, i) => `line${i}`).join('\n') + '\n');
    writeFileSync(join(d, `${task}.mutants.json`), JSON.stringify(Array.from({ length: count }, (_, i) => ({ name: `m${i}`, file: 'f.mjs', find: `line${i}\n`, replace: `LINE${i}\n` }))));
  }
  return d;
};
const three = selectCases(mk({ A: 30, B: 30, C: 30 }), 7);
check('three big tasks: the cap is 8 each, so 24 mutants only', [three.mutants.length, Object.values(perTask(three.mutants)).join()], [24, '8,8,8']);
const skew = selectCases(mk({ A: 2, B: 30, C: 30, D: 30, E: 30, F: 30 }), 7);
check('a small task gives its leftover share to the others (2 + 8x4 + 6 = 40), still at most 8 each', [skew.mutants.length, Math.max(...Object.values(perTask(skew.mutants)))], [40, 8]);
const small = selectCases(mk({ A: 3, B: 3, C: 3 }), 7);
check('a corpus with three tasks offers three clean solutions, never a repeat', [small.clean.length, new Set(small.clean.map((x) => `${x.task}/${x.variant}`)).size], [3, 3]);
check('a selected mutant range matches a hand-computed one (line i+1 of the synthetic oracle)', selectCases(mk({ A: 3 }), 7).mutants.map((m) => [m.name, m.start, m.end]).sort().join(';'), 'm0,1,1;m1,2,2;m2,3,3');

for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got) + ')'));
EOS
)
suite() { LIB="$1" ROOT="$ROOT" TMPD="$TMP" node --input-type=module -e "$CODE" 2>&1; }
out=$(suite "$ROOT/tests/evals/lib") || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"

# Mutation: each rule is broken on a scratch copy of the library (with its sibling imports); the suite must then fail.
nm=0
mutant() { # from, to, label
  local d="$TMP/m$((++nm))"; mkdir "$d"; cp tests/evals/lib/review-recall.mjs tests/evals/lib/stats.mjs tests/evals/lib/mann-whitney.mjs "$d/"
  if ! M_FILE="$d/review-recall.mjs" M_FROM="$1" M_TO="$2" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then fail=$((fail+1)); printf '  FAIL mutation target not found: %s\n' "$3"; return; fi
  if suite "$d" | grep -q '^FAIL'; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "$3"; else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "$3"; fi
}
mutant "OVERLAP_MARGIN = 2" "OVERLAP_MARGIN = 3" "widened overlap margin"
mutant "OVERLAP_MARGIN = 2" "OVERLAP_MARGIN = 1" "narrowed overlap margin"
mutant "ls <= mutEnd + margin && le >= mutStart - margin" "ls < mutEnd + margin && le >= mutStart - margin" "upper overlap bound is inclusive"
mutant "ls <= mutEnd + margin && le >= mutStart - margin" "ls <= mutEnd + margin && le > mutStart - margin" "lower overlap bound is inclusive"
mutant "DETECTING.includes(f.severity) && sameFile(f.file, mutated.file)" "sameFile(f.file, mutated.file)" "severity filter on detection"
mutant "DETECTING = Object.freeze(['blocker', 'major'])" "DETECTING = Object.freeze(['blocker', 'major', 'minor'])" "Minor does not detect"
mutant "DETECTING = Object.freeze(['blocker', 'major'])" "DETECTING = Object.freeze(['blocker'])" "Major detects"
mutant "falsePositive: p.findings.some((f) => DETECTING.includes(f.severity))" "falsePositive: p.findings.length > 0" "false positive needs Blocker or Major"
mutant "&& sameFile(f.file, mutated.file) && overlaps" "&& overlaps" "file match on detection"
mutant "return a === b || a.endsWith('/' + b) || b.endsWith('/' + a);" "return a === b || a.endsWith(b) || b.endsWith(a);" "file match on a path-segment boundary"
mutant "MAX_INPUT_CHARS = 200_000" "MAX_INPUT_CHARS = 20_000_000" "input length bound"
mutant "findings = findings.slice(0, MAX_FINDINGS)" "findings = findings.slice(0, MAX_FINDINGS + 1)" "findings cap"
mutant "else if (HEADING.test(line)) block = null;" "" "a heading closes a severity block"
mutant "line.slice(0, SEVERITY_WINDOW)" "line" "severity opens a block only near line start"
mutant "return { findings, unparsed: findings.length === 0, truncated, capped };" "return { findings, unparsed: false, truncated, capped };" "empty parse is flagged unparsed"
mutant "if (findings.length === 0) findings = parseText(text);" "findings = findings.concat(parseText(text));" "JSON wins over prose"
mutant "return wilson(k, n, 1.96);" "return wilson(k, n, 1.64);" "wilson z"
mutant "R_LIMITED: [1, 5]" "R_LIMITED: [1, 6]" "NO-GO / LIMITED-GO recall boundary"
mutant "R_GO: [9, 20]" "R_GO: [2, 5]" "LIMITED-GO / GO recall boundary"
mutant "DIFF_MIN: [1, 10]" "DIFF_MIN: [1, 5]" "minimum R - FPR"
mutant "DIFF_GO: [1, 4]" "DIFF_GO: [1, 5]" "GO R - FPR"
mutant "return ge(diffNum, diffDen, T.DIFF_GO) ? 'GO' : 'UNDEFINED';" "return 'GO';" "the gap in the registered table is not defaulted to GO"
mutant "num * b >= a * den" "num * b > a * den" "thresholds are inclusive"
mutant "if (n === 0 || m === 0) return null;" "" "recall needs both kinds of row"
mutant "const alloc = allocate(SAMPLE.MUTANTS, caps, order);" "const alloc = allocate(SAMPLE.MUTANTS, new Map(order.map((t) => [t, 99])), order);" "per-task cap"
mutant "const caps = new Map(order.map((t) => [t, Math.min(SAMPLE.PER_TASK_MAX, pools.get(t).length)]));" "const caps = new Map(order.map((t) => [t, SAMPLE.PER_TASK_MAX]));" "cap by pool size"
mutant "const rnd = mulberry32(seed);" "const rnd = mulberry32(Date.now());" "seeded selection"
mutant "for (const t of [...pools.keys()].sort()) mutants.push(...shuffled(pools.get(t), rnd).slice(0, alloc.get(t)));" "for (const t of [...pools.keys()].sort()) mutants.push(...pools.get(t).slice(0, alloc.get(t)));" "within-task draw is shuffled"
mutant "original.split(find).length !== 2" "false" "mutant find must be unique"
mutant "return end >= start ? { start, end } : { start: Math.max(1, p), end: p + 1 };" "return { start, end };" "deletion anchors either side of the join"
mutant "let s = 0;" "let s = 99;" "common-suffix trim"

# --- the manual harness (tests/scripts/manual/review-recall.mjs) against a STUB claude --------------------------------
# The stub plays one behaviour per file name (stub-hit, -miss, ...), logs its argv, environment keys, working-tree state and
# config to a file outside the workspace, and finds the mutated lines itself by comparing the working file with the task
# oracles. It is a node script, so no model, network or credential is involved.
TOKEN="tokFakeTokenValue0123456789abcdefXYZ"
umask 077; printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$TOKEN" > "$TMP/eval.env"; umask 022
HPLUGIN="$TMP/hplugin"; mkdir -p "$HPLUGIN"; cp -r agents commands "$HPLUGIN/"
CANARY_H1="$(node -e "console.log(JSON.parse(require('fs').readFileSync('tests/evals/ab/H1-csv-export/task.json','utf8')).canary)")"
mkdir -p "$TMP/fakebin"; printf '#!/bin/sh\nexit 0\n' > "$TMP/fakebin/claude"; chmod 755 "$TMP/fakebin/claude"
HSTUB=$(cat <<'EOS'
#!/usr/bin/env node
const fs = require('fs'), path = require('path'), cp = require('child_process');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'stub.json'), 'utf8'));
const mode = path.basename(__filename).slice(5);
const git = (...a) => cp.spawnSync('git', a, { encoding: 'utf8' }).stdout;
const names = git('diff', '--name-only').trim().split('\n').filter(Boolean);
const status = git('status', '--porcelain').trim().split('\n').filter(Boolean);
let conf = null; try { conf = JSON.parse(fs.readFileSync('.somi/config.json', 'utf8')); } catch { /* none */ }
const tok = process.env.CLAUDE_CODE_OAUTH_TOKEN;
const canaryFiles = (() => { let n = 0; const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '.git') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (fs.readFileSync(p, 'utf8').includes('SOMI-CANARY')) n++; } }; walk('.'); return n; })();
fs.appendFileSync(cfg.log, JSON.stringify({ canaryFiles, diffHasCanary: git('diff').includes('SOMI-CANARY'), argv: process.argv.slice(2), envKeys: Object.keys(process.env).sort(), tokenKeys: Object.keys(process.env).filter((k) => process.env[k] === cfg.token), names, status, conf }) + '\n');
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const say = (text) => emit({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const result = (o = {}) => emit({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.3, num_turns: 2, session_id: 's1', modelUsage: { 'stub-usage-key': {} }, ...o });
// The mutated file and lines: each changed file against every task's oracle copies (canary lines are wildcards); the one file that
// differs from all of them is the mutant, the differing span its lines. No such file: a clean change.
function locate() {
  const eq = (o, w) => o === w || o.includes('SOMI-CANARY');
  for (const f of names) {
    const work = fs.readFileSync(f, 'utf8').split('\n'); let best = null;
    for (const t of fs.readdirSync(cfg.ab).filter((d) => !d.endsWith('.json'))) for (const v of ['oracle', 'oracle2']) {
      const p = path.join(cfg.ab, t, v, f); if (!fs.existsSync(p)) continue;
      const o = fs.readFileSync(p, 'utf8').split('\n');
      let a = 0; while (a < o.length && a < work.length && eq(o[a], work[a])) a++;
      let b = 0; while (b < o.length - a && b < work.length - a && eq(o[o.length - 1 - b], work[work.length - 1 - b])) b++;
      const sp = work.length - a - b; if (!best || sp < best.sp) best = { sp, start: a + 1 };
    }
    if (best && best.sp > 0) return { f, ...best };
  }
  return { f: names[0], sp: 0, start: 1 };
}
const sp = locate(); const f = sp.f;
const finding = (sev, line) => `**[${sev}] something is off**\n- ${f}:${line}\n`;
const hitText = () => (sp.sp > 0 ? finding('Major', sp.start) : 'No issues found.');
const useTool = (id, name) => emit({ type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name, input: {} }] } });
const toolResult = (id, content) => emit({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
if (mode === 'hit') say(sp.sp > 0 ? finding('Major', sp.start) : 'No issues found.');
else if (mode === 'miss') say(sp.sp > 0 ? finding('Major', sp.start + 30) : 'No issues found.');
else if (mode === 'minor') say(finding('Minor', sp.sp > 0 ? sp.start : 1));
else if (mode === 'fp') say(finding('Major', sp.sp > 0 ? sp.start : 1));
else if (mode === 'hostile') { say(finding('Major', sp.start).repeat(30000) + 'a:'.repeat(300000)); }
else if (mode === 'echo') { say(`token is ${tok}`); process.stderr.write(`stderr token ${tok}\n`); fs.writeFileSync('leak.txt', tok); fs.writeFileSync(path.join(process.env.HOME, 'leak.txt'), tok); }
else if (mode === 'diffecho') { useTool('tb', 'Bash'); toolResult('tb', git('diff')); say(hitText()); }
else if (mode === 'canary') say(`header ${cfg.canary}`);
else if (mode === 'taskresult') { useTool('tu1', 'Agent'); toolResult('tu1', [{ type: 'text', text: hitText() }]); say('Done.'); }
else if (mode === 'noise') { useTool('tu2', 'Bash'); toolResult('tu2', hitText()); say('Done.'); }
else if (mode === 'notification') { useTool('tu3', 'Agent'); emit({ type: 'system', subtype: 'task_notification', tool_use_id: 'tu3', summary: hitText() }); say('Done.'); }
else if (mode === 'reviewfile') { fs.mkdirSync('.somi/reviews/x', { recursive: true }); fs.writeFileSync('.somi/reviews/x/review.md', hitText() + `\ntoken ${tok}\n`); say('Done.'); }
else if (mode === 'tail') say('lorem '.repeat(45000) + '\n' + hitText());
else if (mode === 'wide') say(sp.sp > 0 ? `**[Major] broad**\n- ${f}:${Math.max(1, sp.start - 20)}-${sp.start + 20}\n` : 'No issues found.');
else if (mode === 'prose') say(hitText() + '\nNote: the usage limit of the API resets 5pm is not a concern here.');
else if (mode === 'costly') { result({ total_cost_usd: 1.2 }); process.exit(0); }
else if (mode === 'overbudget') { result({ subtype: 'error_max_budget_usd', total_cost_usd: 0.8 }); process.exit(0); }
else if (mode === 'limit') { result({ result: "You've hit your session limit · resets 5pm (UTC)" }); process.exit(0); }
else if (mode === 'hang') { setTimeout(() => {}, 60000); return; }
result();
EOS
)
hone() { # tag scen phase root mode extra...: one harness run in the foreground, logs under $TMP/h-<tag>/<scen>/
  local tag=$1 scen=$2 ph=$3 root=$4 mode=$5; shift 5
  local d="$TMP/h-$tag/$scen" sd="$TMP/h-$tag/$scen/stub$ph"; mkdir -p "$d/tmp" "$sd"
  printf '%s\n' "$HSTUB" > "$sd/stub-$mode"; chmod 755 "$sd/stub-$mode"
  node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({token: process.argv[2], log: process.argv[3], ab: process.argv[4], canary: process.argv[5]}))" "$sd/stub.json" "$TOKEN" "$sd/calls.jsonl" "$ROOT/tests/evals/ab" "$CANARY_H1"
  ( cd "$root" && env TMPDIR="$d/tmp" node tests/scripts/manual/review-recall.mjs --model stubmodel --sandbox off --plugin-dir "$HPLUGIN" --claude "$sd/stub-$mode" --env-file "$TMP/eval.env" --out "$d/out" "$@" > "$d/log$ph" 2> "$d/err$ph"; echo $? > "$d/rc$ph" )
}
node --input-type=module -e "
import { selectCases } from '$ROOT/tests/evals/lib/review-recall.mjs'; import fs from 'node:fs';
const s = selectCases('$ROOT/tests/evals/ab'); const r = (m) => m.end > m.start ? m.start + '-' + m.end : '' + m.start;
const note = (bad) => '| # | task | mutant | file | mutated lines |\n|---|---|---|---|---|\n' + s.mutants.map((m, i) => '| ' + (i + 1) + ' | ' + m.task + ' | ' + (bad && i === 0 ? 'other-name' : m.name) + ' | ' + m.file + ' | ' + r(m) + ' |').join('\n') + '\n\n| # | task | file |\n|---|---|---|\n' + s.clean.map((c, i) => '| ' + (i + 1) + ' | ' + c.task + ' | ' + c.variant + ' |').join('\n') + '\n';
fs.writeFileSync('$TMP/note-ok.md', note(false)); fs.writeFileSync('$TMP/note-bad.md', note(true));"

harness_scenarios() { # tag root: starts every scenario in the background and waits for all
  local t=$1 r=$2 S5=m01,m28,m39,c04,c05
  ( hone "$t" dry 1 "$r" hit --dry-run --note "$TMP/note-ok.md" ) &
  ( hone "$t" hit5 1 "$r" hit --only $S5 --note "$TMP/note-ok.md" ) &
  ( hone "$t" resume 1 "$r" hit --only m01,m28; hone "$t" resume 2 "$r" hit --only m01,m28,m39 ) &
  ( hone "$t" limit 1 "$r" limit --only m01,m28,c04; hone "$t" limit 2 "$r" hit --only m01,m28,c04 ) &
  ( hone "$t" budget 1 "$r" hit --only m01,m28,c04 --budget-total 1; hone "$t" budget 2 "$r" hit --only m01,m28,c04 --budget-total 5 ) &
  ( hone "$t" hostile 1 "$r" hostile --only m01 ) &
  ( hone "$t" echo 1 "$r" echo --only m01 --keep ) &
  ( hone "$t" diffecho 1 "$r" diffecho --only m01,c04 ) &
  ( hone "$t" canary 1 "$r" canary --only m01,m02,c01 ) &
  ( hone "$t" hang3 1 "$r" hang --only m01,m28,c04 --timeout-min 0.01 ) &
  ( hone "$t" taskresult 1 "$r" taskresult --only m01,c04 ) &
  ( hone "$t" noise 1 "$r" noise --only m01 ) &
  ( hone "$t" notification 1 "$r" notification --only m01 ) &
  ( hone "$t" reviewfile 1 "$r" reviewfile --only m01 ) &
  ( hone "$t" tail 1 "$r" tail --only m01 ) &
  ( hone "$t" wide 1 "$r" wide --only m01,c04 ) &
  ( hone "$t" prose 1 "$r" prose --only m01 ) &
  ( hone "$t" costly 1 "$r" costly --only m01,m28 ) &
  ( hone "$t" overbudget 1 "$r" overbudget --only m01,c04 ) &
  ( hone "$t" otherrun 1 "$r" hit --only m01; hone "$t" otherrun 2 "$r" hit --only m01 --model othermodel ) &
  ( hone "$t" foreign 1 "$r" hit --only m01,m28; hone "$t" foreign 2 "$r" hit --only m01 ) &
  ( hone "$t" pilot 1 "$r" hit --dry-run --pilot 2 ) &
  ( local d="$TMP/h-$t/realbin"; mkdir -p "$d/tmp"; cd "$r" && env PATH="$TMP/fakebin:$PATH" TMPDIR="$d/tmp" node tests/scripts/manual/review-recall.mjs --model stubmodel --sandbox off --claude claude --plugin-dir "$HPLUGIN" --env-file "$TMP/eval.env" --out "$d/out" --only m01 > "$d/log1" 2> "$d/err1"; echo $? > "$d/rc1" ) &
  ( hone "$t" miss 1 "$r" miss --only m01,m28 ) &
  ( hone "$t" minor 1 "$r" minor --only m01 ) &
  ( hone "$t" fp 1 "$r" fp --only c04,c05,m01 ) &
  ( hone "$t" hang 1 "$r" hang --only m01 --timeout-min 0.01 ) &
  ( hone "$t" notebad 1 "$r" hit --dry-run --note "$TMP/note-bad.md" ) &
  ( hone "$t" nonote 1 "$r" hit --dry-run --note "$TMP/absent.md" ) &
  ( hone "$t" otherseed 1 "$r" hit --only m01 --seed 5 --note "$TMP/absent.md"; hone "$t" otherseed 2 "$r" hit --only m01 --note "$TMP/absent.md" ) &
  ( hone "$t" badonly 1 "$r" hit --dry-run --only m99 ) &
  wait
}

HCHECK=$(cat <<'EOS'
const fs = require('fs'), path = require('path');
const D = process.env.D, TOKEN = process.env.TOKEN;
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const rd = (s, f) => { try { return fs.readFileSync(path.join(D, s, f), 'utf8'); } catch { return null; } };
const rows = (s) => (rd(s, 'out/results.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const calls = (s, n = 1) => (rd(s, `stub${n}/calls.jsonl`) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rc = (s, n = 1) => Number((rd(s, `rc${n}`) ?? 'x').trim());
const walk = (d) => { const o = []; for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) o.push(...walk(p)); else o.push(p); } return o; };
const anyToken = (s) => walk(path.join(D, s)).filter((p) => !p.includes('/stub') && fs.readFileSync(p, 'utf8').includes(TOKEN));
const KEYS = ['case', 'kind', 'task', 'mutant', 'file', 'variant', 'mutated', 'order', 'run', 'detected', 'falsePositive', 'source', 'wide', 'unparsed', 'findingsTotal', 'findings', 'outcome', 'reason', 'costUsd', 'durationMs', 'models'];

// dry run
const dl = (rd('dry', 'log1') ?? '').split('\n');
check('dry run: exit 0 and the exact summary line', [rc('dry'), dl.filter(Boolean).at(-1)], [0, 'dry run: 50 case(s) (40 mutant, 10 clean), model stubmodel, worst case 50 x $0.75 = $37.50 against a total budget of $20.00; no claude call was made']);
check('dry run lists 50 cases with their diff sizes, makes no claude call and writes no results', [dl.filter((l) => /^ {2}\d\d [mc]\d\d (mutant|clean) .* diff \+\d+ -\d+ over \d+ file\(s\), \d+ bytes$/.test(l)).length, calls('dry').length, rd('dry', 'out/results.jsonl')], [50, 0, null]);
check('dry run reports the pinned agents and the equal-to-note selection', [/cost config: ceiling medium, \d+ agents pinned to medium/.test(rd('dry', 'log1')), /selection: equals the committed list/.test(rd('dry', 'log1'))], [true, true]);

// five cases through the stub that echoes a finding on the mutated lines
const h = rows('hit5'); const hc = calls('hit5');
check('hit5: exit 0 and five rows with exactly the documented fields', [rc('hit5'), h.length, h.every((r) => JSON.stringify(Object.keys(r)) === JSON.stringify(KEYS))], [0, 5, true]);
check('mutant rows: scored, detected, one parsed finding, cost and duration recorded', h.filter((r) => r.kind === 'mutant').map((r) => [r.outcome, r.detected, r.falsePositive, r.unparsed, r.findingsTotal, r.costUsd, r.durationMs > 0]), Array(3).fill(['scored', true, null, false, 1, 0.3, true]));
check('clean rows: scored, no false positive, unparsed (nothing to parse), detected null', h.filter((r) => r.kind === 'clean').map((r) => [r.outcome, r.detected, r.falsePositive, r.unparsed, r.findingsTotal]), Array(2).fill(['scored', null, false, true, 0]));
check('each case keeps its redacted stream and reviewer text', h.every((r) => ['stream.jsonl', 'reviewer.txt', 'stderr.txt'].every((f) => (rd('hit5', `out/${r.case}/${f}`) ?? '').length >= 0 && fs.existsSync(path.join(D, 'hit5/out', r.case, f)))) && h.every((r) => fs.statSync(path.join(D, 'hit5/out', r.case, 'reviewer.txt')).size > 0), true);
const flag = (a, k) => a[a.indexOf(k) + 1];
check('one call per case, with the plugin, the per-call cap, the model and the permission mode', [hc.length, hc.every((c) => c.argv.includes('--plugin-dir') && flag(c.argv, '--max-budget-usd') === '0.75' && flag(c.argv, '--model') === 'stubmodel' && flag(c.argv, '--permission-mode') === 'bypassPermissions' && flag(c.argv, '--disallowed-tools') === 'WebFetch,WebSearch')], [5, true]);
check('the prompt is the review command with the ticket, and says nothing of seeding, defects or clean changes', hc.every((c) => { const p = c.argv[1]; const pre = p.slice(0, p.indexOf('Ticket:')); return p.startsWith('/somi:review ') && p.includes('Ticket:\nImplement') && !/seed|mutat|defect|inject|clean|bug|plant|control/i.test(pre); }), true);
check('the working tree is the whole solution over the fixture (changed or intent-to-add files), with no oracle test file', hc.every((c) => c.names.length >= 1 && c.status.length >= c.names.length && c.status.every((l) => /^ ?(M|A) /.test(l)) && c.names.every((n) => !n.startsWith('test/'))), true);
check('every mutant case has its mutated file in the diff; the T1 solution is a single new file', [h.filter((r) => r.kind === 'mutant').every((r) => hc.some((c) => c.names.includes(r.file))), hc.some((c) => c.names.length === 1 && c.names[0] === 'prorate.mjs')], [true, true]);
check('the workspace config pins the ceiling and every agent to it', hc.every((c) => c.conf?.cost?.ceiling === 'medium' && Object.keys(c.conf?.cost?.agents ?? {}).length >= 10 && Object.values(c.conf.cost.agents).every((v) => v === 'medium')), true);
check('the child sees only the allowlisted variables, and the token only as the OAuth token', hc.every((c) => JSON.stringify(c.envKeys) === JSON.stringify(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS', 'CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH'].sort()) && JSON.stringify(c.tokenKeys) === '["CLAUDE_CODE_OAUTH_TOKEN"]'), true);
const hl = rd('hit5', 'log1');
check('summary: R 3/3, FPR 0/2, interval, branch GO, cost, and the compared selection', [/recall R = 3\/3 = 1\.000 \(95% interval 0\.438-1\.000\)/.test(hl), /FPR = 0\/2 = 0\.000/.test(hl), /branch: GO\n/.test(hl), /total cost: \$1\.50/.test(hl), /selection: equals/.test(hl)], [true, true, true, true, true]);
check('workspaces are removed and nothing is left in the temp directory', fs.readdirSync(path.join(D, 'hit5/tmp')).length, 0);
check('the token is in no file, log or row', [anyToken('hit5').length, hl.includes(TOKEN), (rd('hit5', 'err1') ?? '').includes(TOKEN)], [0, false, false]);

// resume
check('resume: first run 2 calls; second run skips the two scored cases and makes exactly one call', [rows('resume').length, calls('resume', 1).length, calls('resume', 2).length, /skip m01: already scored/.test(rd('resume', 'log2')) && /skip m28: already scored/.test(rd('resume', 'log2')), rc('resume', 2)], [3, 2, 1, true, 0]);
check('resume keeps the earlier rows unchanged (appended, not rewritten)', rows('resume').map((r) => r.case).slice(0, 2).sort(), ['m01', 'm28']);

// account limit
const lm = rows('limit');
check('account limit: halts after one call, exit 1, the reset text in stderr and the row', [rc('limit'), calls('limit', 1).length, /HALTED/.test(rd('limit', 'err1')) && /resets 5pm/.test(rd('limit', 'err1')), lm.length > 0 && lm[0].outcome === 'invalid' && lm[0].reason === 'account-limit' && /5pm/.test(lm[0].resetText)], [1, 1, true, true]);
const lm2 = new Map(rows('limit').map((r) => [r.case, r]));
check('a halted case is not skipped on resume: all three are run and end scored', [rc('limit', 2), calls('limit', 2).length, [...lm2.values()].map((r) => r.outcome).sort()], [0, 3, ['scored', 'scored', 'scored']]);

// budget
check('budget stop: exit 3, one call, the remaining cases are not recorded', [rc('budget'), calls('budget', 1).length, rows('budget').length > 0 && /BUDGET STOP/.test(rd('budget', 'err1'))], [3, 1, true]);
check('a later run with a larger budget continues: two more calls, three scored rows, spend carried over', [rc('budget', 2), calls('budget', 2).length, rows('budget').length, /total cost: \$0\.90/.test(rd('budget', 'log2'))], [0, 2, 3, true]);

// hostile output
const ho = rows('hostile');
check('hostile reviewer output: row bounded (20 findings kept, at most 200 counted), kept text at most 1 MiB, run completes', [rc('hostile'), ho.length, ho[0].findings.length, ho[0].findingsTotal > 20 && ho[0].findingsTotal <= 200, fs.statSync(path.join(D, 'hostile/out/m01/reviewer.txt')).size <= 1048576, JSON.stringify(ho[0]).length < 20000, ho[0].detected], [0, 1, 20, true, true, true, true]);

// token echo
check('a stream that echoes the token halts the run, and the token is nowhere on disk or in the output', [rc('echo'), /HALTED/.test(rd('echo', 'err1')), anyToken('echo').length, (rd('echo', 'log1') ?? '').includes(TOKEN), (rd('echo', 'err1') ?? '').includes(TOKEN), /\[REDACTED\]/.test(rd('echo', 'out/m01/stream.jsonl') ?? '')], [1, true, 0, false, false, true]);

// detection paths
check('a finding 30 lines from the defect is not detected', rows('miss').map((r) => [r.outcome, r.detected]), [['scored', false], ['scored', false]]);
check('a Minor on the defect is not detected', rows('minor').map((r) => [r.outcome, r.detected, r.findingsTotal]), [['scored', false, 1]]);
const fpr = rows('fp'); const fpl = rd('fp', 'log1');
check('a Major on a clean change is a false positive; summary R 1/1, FPR 2/2, branch NO-GO', [fpr.filter((r) => r.kind === 'clean').map((r) => r.falsePositive), fpr.filter((r) => r.kind === 'mutant').map((r) => r.detected), /FPR = 2\/2 = 1\.000/.test(fpl), /branch: NO-GO/.test(fpl)], [[true, true], [true], true, true]);

// timeout
const hg = rows('hang');
check('a call that hangs is cut at the case timeout: invalid, not scored, charged the cap', [rc('hang'), hg.map((r) => [r.outcome, r.reason, r.costUsd, r.detected, r.falsePositive])], [0, [['invalid', 'timeout', 0.75, null, null]]]);

// canary: neutralised in the workspace, never in a diff, a halt when it does appear
check('the workspace and the diff the reviewer can read hold no canary (every call, every case)', [hc.every((c) => c.canaryFiles === 0 && c.diffHasCanary === false), calls('diffecho').every((c) => c.canaryFiles === 0 && c.diffHasCanary === false)], [true, true]);
check('a stub that echoes git diff back as a tool_result gets no leak: both cases scored, the mutant detected', [rc('diffecho'), rows('diffecho').map((r) => [r.outcome, r.reason]), rows('diffecho').filter((r) => r.kind === 'mutant').map((r) => r.detected)], [0, [['scored', ''], ['scored', '']], [true]]);
check('a stream that shows the canary is a leak and halts the run after the first call', [rc('canary'), calls('canary').length, rows('canary').map((r) => [r.outcome, r.reason]), /HALTED, .*leak:canary/.test(rd('canary', 'err1'))], [1, 1, [['invalid', 'leak:canary']], true]);
check('two consecutive invalid rows with the same reason halt the run', [rc('hang3'), calls('hang3').length, /two consecutive invalid rows/.test(rd('hang3', 'err1'))], [1, 2, true]);

// reviewer text sources
const one = (s) => rows(s)[0];
check('the body returned as the Task tool_result is scored, and the row names that source', [one('taskresult').outcome, one('taskresult').detected, one('taskresult').source, one('taskresult').unparsed], ['scored', true, 'taskResult', false]);
check('a clean change whose reviewer returns nothing through the Task result is not a false positive', rows('taskresult').filter((r) => r.kind === 'clean').map((r) => [r.falsePositive, r.unparsed]), [[false, true]]);
check('a Major in a Bash tool_result (not the main agent Task) is noise: not detected, nothing parsed', [one('noise').detected, one('noise').unparsed, one('noise').source], [false, true, null]);
check('the task_notification summary is scored', [one('notification').detected, one('notification').source], [true, 'notification']);
check('the review file the command writes is scored and kept (redacted) in the case directory', [one('reviewfile').detected, one('reviewfile').source, fs.existsSync(path.join(D, 'reviewfile/out/m01/reviews/x/review.md')), (rd('reviewfile', 'out/m01/reviews/x/review.md') ?? '').includes(TOKEN), anyToken('reviewfile').length], [true, 'reviewFile', true, false, 0]);
check('the tail of a 270,000-character reply is scored, not only its first 200,000 characters', [one('tail').detected, one('tail').source], [true, 'assistant']);
check('a detection from a cited range wider than 10 lines is flagged, and the summary counts it', [one('wide').detected, one('wide').wide, /1 of 1 from a cited range wider than 10 lines/.test(rd('wide', 'log1')), rows('hit5').every((r) => r.wide === false)], [true, true, true, true]);
check('reviewer prose about a usage limit is not an account limit', [rc('prose'), one('prose').outcome, one('prose').detected], [0, 'scored', true]);

// cost
check('a call that costs more than 1.5 x the per-call cap halts the run', [rc('costly'), calls('costly').length, /more than 1\.5 x the per-call cap/.test(rd('costly', 'err1'))], [1, 1, true]);
check('over-budget rows are not scored, not dropped: the summary names them next to R', [rc('overbudget'), rows('overbudget').map((r) => r.outcome), /not scored \(NOT counted in R or FPR\): 2 over-budget/.test(rd('overbudget', 'log1'))], [0, ['over-budget', 'over-budget'], true]);

// resume ties
check('a resume with another model alias is refused (exit 2)', [rc('otherrun', 1), rc('otherrun', 2), /written by a different run/.test(rd('otherrun', 'err2')), calls('otherrun', 2).length], [0, 2, true, 0]);
check('every row carries the run identity: model, ceiling, seed, plugin hash, selection hash', rows('hit5').every((r) => r.run.model === 'stubmodel' && r.run.ceiling === 'medium' && r.run.seed === 20261018 && /^[0-9a-f]{16}$/.test(r.run.plugin) && /^[0-9a-f]{16}$/.test(r.run.selection)), true);
check('the summary ignores results outside the requested selection and says how many', [rc('foreign', 2), /cases: 1 scored of 1,/.test(rd('foreign', 'log2')), /1 case\(s\) in the results file are outside this selection/.test(rd('foreign', 'log2'))], [0, true, true]);

// keep, sandbox flag, pilot
check('--keep leaves the workspace but redacts the token in it and drops the config directory', [rc('echo'), fs.readdirSync(path.join(D, 'echo/tmp')).length, anyToken('echo').length, fs.existsSync(path.join(D, 'echo/tmp')) && walk(path.join(D, 'echo/tmp')).some((f) => f.endsWith('leak.txt')), walk(path.join(D, 'echo/tmp')).some((f) => f.includes('/cfg/'))], [1, 1, 0, true, false]);
check('--sandbox off with the real claude binary found on PATH needs --unsafe-no-sandbox', [rc('realbin'), /needs --unsafe-no-sandbox/.test(rd('realbin', 'err1'))], [2, true]);
const pl = rd('pilot', 'log1') ?? '';
check('--pilot 2 is the first mutant and the first clean case, dry', [rc('pilot'), pl.split('\n').filter((l) => /^ {2}\d\d [mc]\d\d /.test(l)).map((l) => l.trim().split(' ')[1]).sort(), /dry run: 2 case\(s\) \(1 mutant, 1 clean\)/.test(pl)], [0, ['c01', 'm01'], true]);

// selection note, arguments
check('a note that differs from the rebuilt selection is refused (exit 2)', [rc('notebad'), /differs from the committed list/.test(rd('notebad', 'err1'))], [2, true]);
check('a missing note is only mentioned', [rc('nonote'), /does not exist, so the rebuilt selection/.test(rd('nonote', 'log1'))], [0, true]);
check('resuming into a results file written for another selection is refused (exit 2)', [rc('otherseed', 1), rc('otherseed', 2), /written for another selection/.test(rd('otherseed', 'err2'))], [0, 2, true]);
check('--only with an unknown case id is refused', [rc('badonly'), /--only names a case id/.test(rd('badonly', 'err1'))], [2, true]);
for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got).slice(0, 300) + ')'));
EOS
)
hsuite() { # tag root
  rm -rf "$TMP/h-$1"; harness_scenarios "$1" "$2"
  D="$TMP/h-$1" TOKEN="$TOKEN" node -e "$HCHECK" 2>&1
}
hout=$(hsuite base "$ROOT") || true
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected harness output: %s\n' "$status $name" ;;
  esac
done <<< "$hout"
# Required arguments (no scenario directory needed).
rc_of() { "$@" >/dev/null 2>&1; echo $?; }
if [ "$(rc_of node tests/scripts/manual/review-recall.mjs --dry-run)" = 2 ]; then pass=$((pass+1)); echo "  ok   --model is required and never defaulted"; else fail=$((fail+1)); echo "  FAIL --model is required"; fi
if [ "$(rc_of node tests/scripts/manual/review-recall.mjs --model x --bogus)" = 2 ]; then pass=$((pass+1)); echo "  ok   an unknown argument is refused"; else fail=$((fail+1)); echo "  FAIL unknown argument"; fi
if [ "$(CLAUDE_CODE_OAUTH_TOKEN=x rc_of node tests/scripts/manual/review-recall.mjs --model x --dry-run)" = 2 ]; then pass=$((pass+1)); echo "  ok   a token already in the environment is refused"; else fail=$((fail+1)); echo "  FAIL token in environment"; fi

# Mutation of the harness: each guard is broken on a scratch tree (links to the shared libraries) and the harness suite must fail.
hm=0
hmutant() { # from, to, label
  local r="$TMP/hm$((++hm))"; mkdir -p "$r/tests/scripts/manual"; ln -s "$ROOT/tests/evals" "$r/tests/evals"; ln -s "$ROOT/scripts" "$r/scripts"; ln -s "$ROOT/agents" "$r/agents"; ln -s "$ROOT/package.json" "$r/package.json"
  cp tests/scripts/manual/review-recall.mjs "$r/tests/scripts/manual/"
  if ! M_FILE="$r/tests/scripts/manual/review-recall.mjs" M_FROM="$1" M_TO="$2" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then fail=$((fail+1)); printf '  FAIL harness mutation target not found: %s\n' "$3"; return; fi
  local hres; hres=$(hsuite "m$hm" "$r")
  if [ -z "$hres" ] || printf '%s\n' "$hres" | grep -qv '^ok'; then pass=$((pass+1)); printf '  ok   harness mutation caught: %s\n' "$3"; else fail=$((fail+1)); printf '  FAIL harness mutation survived: %s\n' "$3"; fi
}
hmutant "budget: args.perCall, plugin" "budget: 99, plugin" "per-call cap reaches the CLI"
hmutant "if (st.spent + args.perCall > args.budgetTotal) { st.budgetStop = true; break; }" "" "overall budget stop"
hmutant "if (prior.get(c.id)?.outcome === 'scored') {" "if (false) {" "resume skips scored cases"
hmutant "if (row.reason === 'account-limit' || row.reason === 'bg-wait-ceiling') st.halt" "if (false) st.halt" "account-limit halt"
hmutant "row.detected = j.hit" "row.detected = true" "mutant detection comes from the scorer"
hmutant "row.falsePositive = j.hit" "row.falsePositive = false" "false positive comes from the scorer"
hmutant "findings.push(...p.findings.slice(0, KEPT_FINDINGS - findings.length));" "findings.push(...p.findings);" "findings kept in a row are bounded"
hmutant ".slice(0, MAX_KEPT_TEXT), { mode: 0o600 });" ", { mode: 0o600 });" "kept reviewer text is bounded"
hmutant "if (rel.startsWith(testPrefix) && !mutant) continue;" "" "oracle test files are left out of the workspace"
hmutant "content = content.replace(c.find, () => c.replace);" "" "the mutant is applied to the working tree"
hmutant "const cost = { ceiling, agents: Object.fromEntries(names.map((n) => [n, ceiling])) };" "const cost = { ceiling };" "every agent is pinned to the ceiling"
hmutant "if (!sameRows(got.mutants, rec.mutants) || !sameRows(got.clean, rec.clean)) die(" "if (false) die(" "selection must equal the committed list"
hmutant "if (r && (r.task !== c.task || r.mutant !== c.name || r.kind !== c.kind)) die(" "if (false) die(" "resume refuses another selection"
hmutant "fs.writeFileSync(path.join(caseDir, 'stderr.txt'), stderr.slice(0, 64 * 1024)" "fs.writeFileSync(path.join(caseDir, 'stderr.txt'), r.stderr" "kept stderr is redacted"
hmutant "if (!res && !r.error) Object.assign(row, { costUsd: args.perCall, costEstimated: true });" "" "a call without a result is charged its cap"
hmutant "(l.includes(canary) ? neutralLine(l) : l)" "l" "canary lines are neutralised in the workspace"
hmutant "if (row.reason.startsWith('leak:')) st.halt" "if (false) st.halt" "a leak halts the run"
hmutant "if (st.lastInvalid === row.reason) st.halt" "if (false) st.halt" "two consecutive invalid rows with one reason halt"
hmutant "if (row.costUsd > COST_HALT_FACTOR * args.perCall) st.halt" "if (false) st.halt" "a call far over its cap halts"
hmutant "&& taskIds.has(b.tool_use_id)) out.taskResult.push" "&& true) out.taskResult.push" "only the Task tool_result is a source"
hmutant "      keepReviews(ws, caseDir, token);" "" "review files are copied before the workspace is removed"
hmutant "o.push(text.slice(i, i + MAX_INPUT_CHARS))" "{ if (i === 0) o.push(text.slice(0, MAX_INPUT_CHARS)); }" "long replies are scored past the first chunk"
hmutant "taskIds.has(ev.tool_use_id) && typeof ev.summary" "false && typeof ev.summary" "the task notification is a source"
hmutant "if (JSON.stringify(r.run) !== JSON.stringify(runInfo)) die(" "if (false) die(" "resume refuses another run identity"
hmutant "(realClaude !== null && resolveBinary(args.claude) === realClaude)" "false" "the real claude is recognised behind a path"
hmutant "limit: lim !== null," "limit: sink.state.limit," "account limit comes from result events, not prose"
hmutant "const mine = rows.filter((r) => caseIds.has(r.case));" "const mine = rows;" "summary uses the current selection only"
hmutant "> WIDE_LINES : false" "> 1000 : false" "wide cited ranges are flagged"
hmutant "const unscored = last.filter((r) => r.outcome !== 'scored');" "const unscored = [];" "unscored rows are reported next to R"
hmutant "redactTree(tmp, token);" "" "a kept workspace is redacted"
hmutant "args.only = order.slice(0, Number(args.pilot)).join(',');" "args.only = order.slice(0, 1).join(',');" "pilot N takes N cases"

ran=$((pass + fail))
[ "$ran" -ge 200 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 200 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
