#!/usr/bin/env bash
# Pins the micro-task lint (tests/evals/lib/micro-lint.mjs) and the template under tests/evals/ab-micro-template/: the lint passes
# the worked example and fails each injected violation (banned word, statement count and length, a destructive SQL phrase,
# a drifted shared file, a bad case table); its word list is checked against the routing skill's own wording so it cannot
# drift silently; the example is admitted by admitTask with its mutants; and the shared runner keeps a throwing case and a
# hanging family contained. Each lint rule is then mutated on a scratch copy and the suite must fail. Hermetic: temp
# directories, no model, network or git. Skipped in a tarball, where tests/evals is absent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: micro-task lint and template =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t mlint.XXXXXX)"
trap 'chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"' EXIT

CODE=$(cat <<'EOS'
import fs from 'node:fs';
import path from 'node:path';
const L = await import(`${process.env.LIB}/micro-lint.mjs`);
const { admitTask } = await import(`${process.env.ROOT}/tests/evals/lib/admit.mjs`);
const { scoreHidden } = await import(`${process.env.ROOT}/tests/evals/lib/score-hidden.mjs`);
const { canaryCheck } = await import(`${process.env.ROOT}/tests/evals/lib/task-store.mjs`);
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const T = `${process.env.ROOT}/tests/evals/ab-micro-template`;
const EX = `${T}/EXAMPLE`;
const rules = (list) => [...new Set(list.map((f) => f.rule))].sort();
let n = 0;
const copy = () => { const d = `${process.env.TMPD}/c${n++}`; fs.cpSync(EX, `${d}/EXAMPLE`, { recursive: true }); return `${d}/EXAMPLE`; };
const editJson = (dir, fn) => { const f = `${dir}/task.json`; const t = JSON.parse(fs.readFileSync(f, 'utf8')); fn(t); fs.writeFileSync(f, JSON.stringify(t, null, 2) + '\n'); };
const loose = { minCases: 1, maxCases: 1000 };

// --- the template passes; the corpus root exists and holds no task yet --------------------------------------
check('the worked example passes every rule (case count bounds relaxed: it has 16 cases)', L.formatFindings(L.lintTask(EX, T, loose)), '');
check('with the real bounds (60 to 120 cases) the example is flagged only for its case count', rules(L.lintTask(EX, T)), ['case-count']);
check('the corpus root exists and the lint over it finds nothing (no real task yet)', [fs.existsSync(`${process.env.ROOT}/tests/evals/ab-micro/README.md`), L.lintCorpus(`${process.env.ROOT}/tests/evals/ab-micro`, T)], [true, []]);
check('lintCorpus covers every task directory under a root', rules(L.lintCorpus(`${T}`, T, loose)), []);
const e = L.lintTask(EX, T, loose);
check('the registered limits', [L.LIMITS.MIN_STATEMENTS, L.LIMITS.MAX_STATEMENTS, L.LIMITS.MAX_STATEMENT_CHARS, L.LIMITS.MIN_CASES, L.LIMITS.MAX_CASES], [5, 8, 400, 60, 120]);

// --- injected violations ----------------------------------------------------------------------------------------
for (const [name, count, ok] of [['4 statements', 4, false], ['5 statements', 5, true], ['8 statements', 8, true], ['9 statements', 9, false]]) {
  const d = copy(); editJson(d, (t) => { const base = t.statements; t.statements = Array.from({ length: count }, (_, i) => base[i % base.length] + ' '.repeat(0) + (i >= base.length ? ` (${i})` : '')); });
  check(`${name}: ${ok ? 'accepted' : 'refused with statement-count'}`, rules(L.lintTask(d, T, loose)).includes('statement-count'), !ok);
}
for (const b of L.BANNED) {
  const d = copy(); editJson(d, (t) => { t.statements[1] += ` Mention ${b.probe} here.`; });
  const f = L.lintTask(d, T, loose).filter((x) => x.rule === 'banned-word');
  check(`a statement containing "${b.probe}" is refused (${b.term}) and the finding names the file and the statement`, [f.length, f[0]?.file, /statement 2/.test(f[0]?.message ?? '')], [1, 'EXAMPLE/task.json', true]);
}
{ const d = copy(); editJson(d, (t) => { t.brief += ' Use a password.'; });
  check('a banned word in the brief is refused', L.lintTask(d, T, loose).filter((x) => x.rule === 'banned-word').map((x) => /brief/.test(x.message)), [true]); }
check('ordinary words stay fine: "author" and a plain sentence are not banned', [/\bauth\b/i.test('the author wrote it'), L.BANNED.some((b) => b.re.test('computes a rolling window of readings'))], [false, false]);
{ const d = copy(); editJson(d, (t) => { t.statements[2] = 'x'.repeat(401); });
  check('a 401-character statement is refused, 400 is fine', [rules(L.lintTask(d, T, loose)).includes('statement-length'), (() => { const d2 = copy(); editJson(d2, (t) => { t.statements[2] = 'x'.repeat(400); }); return rules(L.lintTask(d2, T, loose)).includes('statement-length'); })()], [true, false]); }
{ const d = copy(); editJson(d, (t) => { t.statements[0] = '1. ' + t.statements[0]; });
  check('a statement that carries its own number is refused', rules(L.lintTask(d, T, loose)), ['statement-numbering']); }
{ const d = copy(); editJson(d, (t) => { t.source = ['clamp.mjs', 'other.mjs']; });
  check('two declared source files are refused', rules(L.lintTask(d, T, loose)), ['source-count']); }
{ const d = copy(); editJson(d, (t) => { t.brief = 'b'.repeat(1201); });
  check('a 1201-character brief is refused', rules(L.lintTask(d, T, loose)), ['brief-length']); }
{ const sql = ['DR', 'OP TA', 'BLE users'].join(''); const d = copy(); fs.appendFileSync(`${d}/oracle/clamp.mjs`, `// ${sql}\n`);
  const f = L.lintTask(d, T, loose);
  check('a destructive SQL phrase in any file of the task is refused and the finding names the file', [rules(f), f[0]?.file], [['destructive-sql'], 'EXAMPLE/oracle/clamp.mjs']);
  const d2 = copy(); editJson(d2, (t) => { t.statements[3] += ' ' + ['de', 'lete fr', 'om rows'].join(''); });
  check('the same phrase in a statement is refused too', rules(L.lintTask(d2, T, loose)).includes('destructive-sql'), true); }
for (const file of L.SHARED_FILES) {
  const d = copy(); fs.appendFileSync(`${d}/hidden/${file}`, '// an edit\n');
  const f = L.lintTask(d, T, loose);
  check(`a drifted ${file} is refused`, [rules(f), f[0]?.file], [['runner-drift'], `EXAMPLE/hidden/${file}`]);
  const d2 = copy(); fs.rmSync(`${d2}/hidden/${file}`);
  check(`a missing ${file} is refused`, rules(L.lintTask(d2, T, loose)).includes('runner-missing'), true);
  const d3 = copy(); const t = fs.readFileSync(`${d3}/hidden/${file}`, 'utf8'); fs.writeFileSync(`${d3}/hidden/${file}`, t.replace(/^.*\n/, '// SOMI-CANARY-ANOTHER-0123456789abcdef\n'));
  check(`a copy that differs from the template only in the canary line passes`, rules(L.lintTask(d3, T, loose)), []);
}
{ const d = copy(); const f = `${d}/hidden/cases.json`; const t = JSON.parse(fs.readFileSync(f, 'utf8')); t.families[1].cases[0].id = t.families[0].cases[0].id; t.families[1].cases[0].ac = t.families[0].cases[0].ac; t.families[1].name = t.families[0].name; fs.writeFileSync(f, JSON.stringify(t));
  check('a duplicate test name in the case table is refused', L.lintTask(d, T, loose).filter((x) => x.rule === 'case-table').map((x) => /duplicate test name/.test(x.message)), [true]); }
{ const d = copy(); const f = `${d}/hidden/cases.json`; const t = JSON.parse(fs.readFileSync(f, 'utf8')); t.families[0].cases[0].ac = 99; fs.writeFileSync(f, JSON.stringify(t));
  check('a case citing a statement that does not exist is refused', rules(L.lintTask(d, T, loose)), ['case-table']); }
{ const d = copy(); fs.writeFileSync(`${d}/hidden/cases.json`, '{ not json');
  check('an unreadable case table is refused', rules(L.lintTask(d, T, loose)), ['case-table']); }
{ const d = copy(); fs.rmSync(`${d}/task.json`);
  check('a task without task.json is refused', rules(L.lintTask(d, T, loose)), ['task-json']); }
check('findings print as file: rule: message', L.formatFindings([{ file: 'a/b', rule: 'r', message: 'm' }]), 'a/b: r: m');
{ const dir = `${process.env.TMPD}/corpus`; fs.mkdirSync(dir); fs.cpSync(EX, `${dir}/AAA`, { recursive: true }); fs.cpSync(EX, `${dir}/BBB`, { recursive: true }); editJson(`${dir}/BBB`, (t) => { t.statements.push('x', 'y', 'z', 'w'); });
  check('lintCorpus walks every task directory and names the offender', [...new Set(L.lintCorpus(dir, T, loose).map((x) => x.file.split('/')[0]))], ['BBB']); }
check('a hostile statement is data: a huge or odd value never throws', (() => { try { return L.lintStatements({ statements: [null, 5, 'a'.repeat(1e6), { toString() { throw new Error('x'); } }, 'q', 'r'], brief: 7, source: 'x' }).length > 0; } catch { return 'threw'; } })(), true);

// --- the word list against the routing skill ------------------------------------------------------------------------
const skill = fs.readFileSync(`${process.env.ROOT}/skills/somi-routing/SKILL.md`, 'utf8');
const line = skill.split('\n').find((l) => l.startsWith('3. **Not security-sensitive**')) ?? '';
const listed = (/touches no (.+?) boundary/.exec(line)?.[1] ?? '').split(/,\s*(?:or\s+)?/).map((s) => s.replace(/^or\s+/, '').trim()).filter(Boolean);
const key = (s) => (/untrusted/i.test(s) ? 'untrusted-input' : /^secret/i.test(s) ? 'secrets' : s);
check('the routing skill still lists the terms this lint was written against', listed.map(key), ['auth', 'crypto', 'secrets', 'PII', 'untrusted-input']);
for (const t of listed.map(key)) {
  const b = L.BANNED.find((x) => x.term === t);
  check(`the routing term "${t}" has a banned pattern that matches its probe`, [b !== undefined, b ? b.re.test(b.probe) : false], [true, true]);
}
check('every banned entry names one of the routing terms', L.BANNED.every((b) => listed.map(key).includes(b.term)), true);

// --- the example is a real task: admission, and the runner keeps failures contained ---------------------------------------
const muts = JSON.parse(fs.readFileSync(`${T}/EXAMPLE.mutants.json`, 'utf8'));
check('the example has at least 6 mutants', muts.length >= 6, true);
{ const root = `${process.env.TMPD}/ab-micro`; fs.cpSync(EX, `${root}/EXAMPLE`, { recursive: true });
  const a = admitTask(`${root}/EXAMPLE`, { mutants: muts, repeats: 3 });
  check('the example copied under ab-micro/ passes admitTask (oracle, oracle2, nop, every mutant killed, stable x3)', [a.ok, a.total, a.mutantsKilled?.length, a.names?.[0]], [true, 16, muts.length, 'AC4 [functional] case-01']);
  check('test names carry the statement number and the family tag, one per case', a.names.every((x) => /^AC\d \[(functional|boundary|safety)\] case-\d\d$/.test(x)) && new Set(a.names).size === a.names.length, true); }
const score = (patch) => {
  const task = `${process.env.TMPD}/s${n++}`; fs.cpSync(EX, task, { recursive: true });
  const cf = `${task}/hidden/cases.json`; const t = JSON.parse(fs.readFileSync(cf, 'utf8')); t.timeoutMs = 1500; fs.writeFileSync(cf, JSON.stringify(t));
  const ws = `${process.env.TMPD}/w${n++}`; fs.cpSync(`${EX}/fixture`, ws, { recursive: true });
  const src = fs.readFileSync(`${EX}/oracle/clamp.mjs`, 'utf8'); fs.writeFileSync(`${ws}/clamp.mjs`, patch(src));
  const c = canaryCheck(task);
  return scoreHidden({ workspace: ws, taskDir: task, admittedHash: c.hash, timeoutMs: 60000 });
};
{ const base = score((s) => s);
  check('the unmodified oracle scores 16 of 16 through the scorer', [base.ok, base.green, base.total], [true, 16, 16]);
  const thrower = score((s) => s.replace('export function clamp(value, low, high) {', 'export function clamp(value, low, high) {\n  if (value === 2.5) throw new Error("boom");'));
  check('a case that throws fails only itself', [thrower.ok, thrower.green, thrower.failed], [true, 15, ['AC4 [functional] case-04']]);
  const hang = score((s) => s.replace('export function clamp(value, low, high) {', 'export function clamp(value, low, high) {\n  if (value === 3 && low === 3) for (;;);'));
  check('a hang in one family fails that whole family and no other (boundary has 6 cases, the rest pass)', [hang.ok, hang.green, hang.failed.every((x) => x.includes('[boundary]')), hang.failed.length], [true, 10, true, 6]);
  const exit = score((s) => s.replace('export function clamp(value, low, high) {', 'export function clamp(value, low, high) {\n  if (value === "5") process.exit(0);'));
  check('a candidate that exits the runner fails its family only', [exit.ok, exit.green, exit.failed.every((x) => x.includes('[safety]'))], [true, 10, true]);
  const noModule = (() => { const task = `${process.env.TMPD}/nm`; fs.cpSync(EX, task, { recursive: true }); const ws = `${process.env.TMPD}/nmw`; fs.cpSync(`${EX}/fixture`, ws, { recursive: true }); return scoreHidden({ workspace: ws, taskDir: task, admittedHash: canaryCheck(task).hash, timeoutMs: 60000 }); })();
  check('with no candidate file every case fails (the nop scores 0 of 16)', [noModule.ok, noModule.green], [true, 0]); }

for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got).slice(0, 300) + ')'));
EOS
)
suite() { LIB="$1" ROOT="$ROOT" TMPD="$2" node --input-type=module -e "$CODE" 2>&1; }
mkdir -p "$TMP/base"; out=$(suite "$ROOT/tests/evals/lib" "$TMP/base") || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"

# Mutation: each lint rule is broken on a scratch copy of the library; the suite must then fail.
nm=0
mutant() { # from, to, label
  local d="$TMP/m$((++nm))"; mkdir -p "$d"; cp tests/evals/lib/micro-lint.mjs "$d/"
  if ! M_FILE="$d/micro-lint.mjs" M_FROM="$1" M_TO="$2" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then fail=$((fail+1)); printf '  FAIL mutation target not found: %s\n' "$3"; return; fi
  mkdir -p "$d/t"; local res; res=$(suite "$d" "$d/t")
  if [ -z "$res" ] || printf '%s\n' "$res" | grep -qv '^ok'; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "$3"; else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "$3"; fi
}
mutant "st.length < LIMITS.MIN_STATEMENTS || st.length > LIMITS.MAX_STATEMENTS" "false" "statement count bounds"
mutant "MAX_STATEMENT_CHARS: 400" "MAX_STATEMENT_CHARS: 4000" "statement length bound"
mutant "const m = b.re.exec(text); if (m)" "const m = null; if (m)" "banned words"
mutant "DESTRUCTIVE_SQL.test(text)" "false" "destructive SQL phrase"
mutant "withoutCanary(copy) !== withoutCanary(shared)" "false" "runner drift"
mutant "!CANARY_LINE.test(l)" "true" "the canary line is the only allowed difference"
mutant "if (copy === null) out.push" "if (false) out.push" "missing shared file"
mutant "task.source.length !== 1" "task.source.length < 1" "one source file"
mutant "/^\\s*\\d+[.)]\\s/.test(s)" "false" "own number in a statement"
mutant "total < minCases || total > maxCases" "false" "case count bounds"
mutant "if (names.has(name))" "if (false)" "duplicate test names"
mutant "c.ac > statementCount" "c.ac > 1000" "statement number in range"
mutant "task.brief.length > LIMITS.MAX_BRIEF_CHARS" "task.brief.length > 1e9" "brief length"

ran=$((pass + fail))
[ "$ran" -ge 60 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 60 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
