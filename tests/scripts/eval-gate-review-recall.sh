#!/usr/bin/env bash
# Pins the reviewer-recall scorer (tests/evals/lib/review-recall.mjs): the reviewer-output parser (formats,
# severity association, bounds, hostile input), the +-2 overlap rule at its boundary values, the severity
# filter, unparsed handling, the Wilson interval against hand-computed values, the pre-registered branch table
# at its boundaries, the mutated-range computation, and the seeded stratified case selection. Each rule is then
# mutated on a scratch copy of the library and the suite must fail. Hermetic: pure computation plus reads of
# the committed corpus and a scratch directory; no model, network, git or credential.
# Skipped in a tarball, where tests/evals is absent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: reviewer recall scorer =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t recall.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

CODE=$(cat <<'EOS'
import { mkdirSync, writeFileSync } from 'node:fs';
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
check('the first seven clean cases are on seven different tasks, none repeats a file within a task', [new Set(a.clean.slice(0, 7).map((x) => x.task)).size, new Set(a.clean.map((x) => `${x.task}/${x.file}`)).size], [7, 10]);
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

ran=$((pass + fail))
[ "$ran" -ge 130 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 130 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
