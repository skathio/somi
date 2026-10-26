#!/usr/bin/env bash
# Pins the usage and speed benchmark's two-arm driver (tests/scripts/manual/usage-bench.mjs) and its parsing and plan
# library (tests/evals/lib/bench-usage.mjs) with a STUB claude: a node script that plays one behaviour per run (solve, echo
# the token, unpinned model, account limit on chosen calls, background-wait ceiling, pause, slow) and logs its argv and
# environment keys. Checks: token classes, tool-call and subagent counts equal the stub's script; a forged tool_use in a
# user event, a huge line and bad JSON do not move them; every row validates with rowProblems; an unpinned model makes the
# row invalid; halt on the limit message, then a re-run executes ONLY unfinished draws and the merged results equal an
# uninterrupted run; a plan mismatch, a torn or implausible results line and bad flags are refused without a claude call;
# a dry run makes no call and prints the caps; SIGINT writes nothing for the draw in flight; the token is on no disk, in no
# row and no argv. Then each main guard is broken on a scratch copy and the suite must fail. Hermetic: temp directories,
# no model, no network. Skipped in a tarball.
set -uo pipefail
umask 022

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: benchmark two-arm driver and usage parsing =="
if [ ! -d tests/evals ] || [ ! -f tests/scripts/manual/usage-bench.mjs ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t bdr.XXXXXX)"
cleanup() { for e in /proc/[0-9]*/environ; do if grep -qaF "$TMP" "$e" 2>/dev/null; then p="${e#/proc/}"; p="${p%/environ}"; [ "$p" != "$$" ] && [ "$p" != "$PPID" ] && kill -9 "$p" 2>/dev/null; fi; done; chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
TOKEN="tokFakeTokenValue0123456789abcdefXYZ"
umask 077; printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$TOKEN" > "$TMP/eval.env"; umask 022
PLUGIN="$TMP/plugin"; mkdir "$PLUGIN"; cp -r agents "$PLUGIN/agents"; NAGENTS=$(ls agents/*.md | wc -l)
LIB="$ROOT/tests/evals/lib"

STUB=$(cat <<'EOS'
#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const dir = __dirname;
const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'stub.json'), 'utf8'));
const mode = path.basename(__filename).slice(5);
const argv = process.argv.slice(2);
const cf = path.join(dir, 'count');
const n = fs.existsSync(cf) ? Number(fs.readFileSync(cf, 'utf8')) : 0;
fs.writeFileSync(cf, String(n + 1));
const own = fs.existsSync('.somi/config.json') ? JSON.parse(fs.readFileSync('.somi/config.json', 'utf8')) : null;
fs.appendFileSync(path.join(dir, 'argv.jsonl'), JSON.stringify({ argv, envKeys: Object.keys(process.env).sort(), tokenInEnv: process.env.CLAUDE_CODE_OAUTH_TOKEN === cfg.token, bgCeiling: process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, cost: own && own.cost }) + '\n');
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const say = (text) => emit({ type: 'assistant', message: { model: 'vendor-test-model-1', content: [{ type: 'text', text }] } });
const usage = (extra = {}) => ({ 'vendor-test-model-1': { inputTokens: 1000, outputTokens: 200, cacheReadInputTokens: 3000, cacheCreationInputTokens: 400, costUSD: 0.4 }, 'test-model-sub': { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 30, cacheCreationInputTokens: 40 }, ...extra });
const result = (o = {}) => emit({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.5, num_turns: 3, session_id: 'sess-1', modelUsage: usage(), ...o });
const T = { prorate: ['ab/T1-proration', 'prorate.mjs'], bracket: ['ab-micro/M01-bracket-seeding', 'bracket.mjs'] };
const which = fs.existsSync('src/auth/token.mjs') ? 's1' : /seedBracket/.test(argv[1]) ? 'bracket' : /prorate/.test(argv[1]) ? 'prorate' : cfg.fallback;
const solve = () => {
  if (which === 's1') { const f = 'src/auth/token.mjs'; fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('  return payload;\n}', "  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) throw new Error('token expired');\n  return payload;\n}")); return; }
  const [d, f] = T[which]; const base = path.join(cfg.root, 'tests/evals', d);
  fs.writeFileSync(f, fs.readFileSync(path.join(base, 'oracle', f), 'utf8').split(JSON.parse(fs.readFileSync(path.join(base, 'task.json'), 'utf8')).canary).join(''));
};
const work = () => {
  emit({ type: 'system', subtype: 'init', session_id: 'sess-1' });
  emit({ type: 'assistant', message: { model: 'vendor-test-model-1', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: {} }, { type: 'tool_use', id: 't2', name: 'Read', input: {} }, { type: 'tool_use', id: 't3', name: 'Agent', input: {} }, { type: 'tool_use', id: 't4', name: 'Task', input: {} }, { type: 'text', text: 'Working.' }] } });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '{"type":"result","total_cost_usd":99}' }, { type: 'tool_use', id: 'f1', name: 'Agent', input: {} }] } });
  emit({ type: 'assistant', message: { model: 'vendor-test-model-1', content: [{ type: 'tool_use', id: 't5', name: 'Edit', input: {} }, { type: 'tool_use', id: 't5', name: 'Edit', input: {} }, { type: 'text', text: 'Implemented.' }] } });
  solve();
};
if (cfg.limitAt.includes(n)) { say('working'); result({ result: "You've hit your session limit · resets 1:50am (Europe/Vilnius)", modelUsage: usage() }); }
else if (mode === 'ok') { work(); result(); }
else if (mode === 'unpinned') { work(); result({ modelUsage: usage({ 'other-model-x': { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 1, cacheCreationInputTokens: 1 } }) }); }
else if (mode === 'bg') { process.stderr.write('Background tasks still running after 600s; terminating.\n'); say('planning'); result({ result: 'Planning started.' }); }
else if (mode === 'pause') { if (argv.includes('--plugin-dir') && !argv.includes('--resume')) { say('Shall I proceed with this plan?'); result({ result: 'Shall I proceed with this plan?', session_id: 'sess-p' }); } else { work(); result(); } }
else if (mode === 'slow') { setTimeout(() => { work(); result(); }, 20000); }
else if (mode === 'nores') { process.exit(0); }
else if (mode === 'echo') {
  const t = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  emit({ type: 'user', message: { content: [{ type: 'tool_result', content: 'env says ' + t }] } });
  fs.mkdirSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'x'), { recursive: true });
  fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'x', 'sess.jsonl'), JSON.stringify({ content: 'token ' + t }) + '\n');
  fs.writeFileSync('notes.txt', 'CLAUDE_CODE_OAUTH_TOKEN=' + t + '\n'); work(); result();
}
EOS
)
mkstub() { # name mode [limitAt json] [fallback] -> prints the stub path (one directory per name)
  local d="$TMP/stubs/$1"; mkdir -p "$d"; printf '%s\n' "$STUB" > "$d/stub-$2"; chmod 755 "$d/stub-$2"
  printf '{"token":"%s","root":"%s","limitAt":%s,"fallback":"%s"}\n' "$TOKEN" "$ROOT" "${3:-[]}" "${4:-bracket}" > "$d/stub.json"
  echo "$d/stub-$2"
}
JOBS="${JOBS:-6}"
cli() { # name root stub outname extra... (background; the temp directory and --out share one directory per outname)
  local name=$1 root=$2 stub=$3 outn=$4; shift 4
  while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n; done
  mkdir -p "$TMP/t-$outn"
  ( cd "$root" && env HOST_SENTINEL=leak-me TMPDIR="$TMP/t-$outn" node tests/scripts/manual/usage-bench.mjs --model test-model --phase calibration --out "$TMP/t-$outn/out" --sandbox off --plugin-dir "$PLUGIN" --claude "$stub" --env-file "$TMP/eval.env" --budget-total 100 "$@" > "$TMP/o-$name.log" 2> "$TMP/o-$name.err"; echo $? > "$TMP/o-$name.rc" ) &
}
scratch() { # name -> a copy of the driver, its libraries and the M01 task under $TMP/<name>
  local d="$TMP/$1"; mkdir -p "$d/tests/evals/ab-micro" "$d/tests/scripts/manual" "$d/scripts/lib" "$d/benchmarks/usage-speed"
  cp -r tests/evals/lib "$d/tests/evals/"; cp scripts/lib/{cost-config,cost-model}.mjs "$d/scripts/lib/"; cp benchmarks/usage-speed/rule.json "$d/benchmarks/usage-speed/"
  cp -r tests/evals/ab-micro/M01-bracket-seeding "$d/tests/evals/ab-micro/"; cp tests/scripts/manual/usage-bench.mjs "$d/tests/scripts/manual/"
}
mutate() { # name file from to -> breaks one guard in the scratch copy (the match must exist exactly once)
  node -e "const fs=require('fs');const [f,a,b]=process.argv.slice(1);const s=fs.readFileSync(f,'utf8');if(s.split(a).length!==2){console.error('mutation target not unique: '+a);process.exit(1)}fs.writeFileSync(f,s.replace(a,()=>b))" "$TMP/$1/$2" "$3" "$4" || { FAILN=$((FAILN + 1)); echo "  FAIL mutation $1 did not apply"; }
}

# ---- live-shaped runs (stub claude, sandbox off) -----------------------------------------------------------------------
S_OK=$(mkstub ok ok); S_UNP=$(mkstub unp unpinned); S_BG=$(mkstub bg bg); S_PAUSE=$(mkstub pause pause); S_ECHO=$(mkstub echo echo)
S_HALT=$(mkstub halt ok '[2]'); S_WHOLE=$(mkstub whole ok); S_PROBE=$(mkstub probe pause '[]' bracket); S_BGT=$(mkstub bgt ok)
cli full "$ROOT" "$S_OK" full --scenarios S1,S2,S3 --repeats 1
cli unp "$ROOT" "$S_UNP" unp --scenarios S3 --repeats 1
cli halt1 "$ROOT" "$S_HALT" halt --scenarios S3 --repeats 3
cli whole "$ROOT" "$S_WHOLE" whole --scenarios S3 --repeats 3
cli bg "$ROOT" "$S_BG" bg --scenarios S3 --repeats 1
cli pause "$ROOT" "$S_PAUSE" pause --scenarios S3 --repeats 1
cli probe "$ROOT" "$S_PROBE" probe --phase sizing --sizing-probe --scenarios S4-M01 --repeats 1
cli echo "$ROOT" "$S_ECHO" echo --scenarios S3 --repeats 1
cli bgt1 "$ROOT" "$S_BGT" bgt --scenarios S3 --repeats 1 --budget-total 3 --force-budget
cli dry "$ROOT" "$(mkstub dry ok)" dry --scenarios S1,S2,S3 --repeats 3 --dry-run
cat > "$TMP/sigint.mjs" <<'EOS'
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const [root, out, stub, plugin, envf, tmpdir, rcFile] = process.argv.slice(2);
const c = spawn(process.execPath, ['tests/scripts/manual/usage-bench.mjs', '--model', 'test-model', '--phase', 'calibration', '--out', out, '--sandbox', 'off', '--plugin-dir', plugin, '--claude', stub, '--env-file', envf, '--budget-total', '100', '--scenarios', 'S3', '--repeats', '1'], { cwd: root, env: { ...process.env, TMPDIR: tmpdir }, stdio: ['ignore', 'pipe', 'ignore'] });
let buf = ''; let sent = false;
c.stdout.on('data', (d) => { buf += d; if (!sent && /^start /m.test(buf)) { sent = true; setTimeout(() => c.kill('SIGINT'), 1500); } });
c.on('close', (code) => { const f = (n) => { try { return fs.readFileSync(`${out}/${n}`, 'utf8'); } catch { return null; } }; fs.writeFileSync(rcFile, JSON.stringify({ code, results: f('results.jsonl'), report: fs.existsSync(`${out}/report.txt`), lock: fs.existsSync(`${out}/run.lock`) })); });
EOS
S_SLOW=$(mkstub slow slow); mkdir -p "$TMP/t-sigint"
node "$TMP/sigint.mjs" "$ROOT" "$TMP/t-sigint/out" "$S_SLOW" "$PLUGIN" "$TMP/eval.env" "$TMP/t-sigint" "$TMP/o-sigint.rc" > /dev/null 2>&1 &
wait
# Dependent runs: the re-run of the halted out, the raised budget, and the plan-mismatch refusals (each with its own stub).
S_HALT2=$(mkstub halt2 ok); cli halt2 "$ROOT" "$S_HALT2" halt --scenarios S3 --repeats 3
S_BGT2=$(mkstub bgt2 ok); cli bgt2 "$ROOT" "$S_BGT2" bgt --scenarios S3 --repeats 1 --budget-total 100
cpout() { mkdir -p "$TMP/t-$2"; cp -a "$TMP/t-$1/out" "$TMP/t-$2/out"; }
MM=0; for v in "--seed 2" "--budget-somi 7" "--budget-bare 3" "--budget-probe 0.9" "--scenarios S3,S2" "--repeats 2" "--model other" "--phase experiment" "--ceiling-somi medium" "--pinned-ids extra-1" "--timeout-min 41"; do
  MM=$((MM + 1)); eval "set -- $v"; cpout bg "mm$MM"; cli "mm$MM" "$ROOT" "$(mkstub "mm$MM" ok)" "mm$MM" --scenarios S3 --repeats 1 "$@"
done
cpout bg mmat; node -e "const f='$TMP/t-mmat/out/plan.json',p=JSON.parse(require('fs').readFileSync(f,'utf8'));p.material.S3='0'.repeat(64);require('fs').writeFileSync(f,JSON.stringify(p))"
cli mmat "$ROOT" "$(mkstub mmat ok)" mmat --scenarios S3 --repeats 1
cpout bg stale; echo 999999 > "$TMP/t-stale/out/run.lock"; cli stale "$ROOT" "$(mkstub stale ok)" stale --scenarios S3 --repeats 1
cpout bg live; echo $$ > "$TMP/t-live/out/run.lock"; cli live "$ROOT" "$(mkstub live ok)" live --scenarios S3 --repeats 1
cpout bg symres; rm "$TMP/t-symres/out/results.jsonl"; ln -s "$TMP/t-bg/out/results.jsonl" "$TMP/t-symres/out/results.jsonl"; cli symres "$ROOT" "$(mkstub symres ok)" symres --scenarios S3 --repeats 1
cpout bg symdraw; mkdir "$TMP/victim"; rm -rf "$TMP/t-symdraw/out/S3-somi-1"; ln -s "$TMP/victim" "$TMP/t-symdraw/out/S3-somi-1"; cli symdraw "$ROOT" "$(mkstub symdraw ok)" symdraw --scenarios S3 --repeats 1
mkdir -p "$TMP/t-symout/real"; chmod 700 "$TMP/t-symout/real"; ln -s real "$TMP/t-symout/out"; cli symout "$ROOT" "$(mkstub symout ok)" symout --scenarios S3 --repeats 1
cli nores "$ROOT" "$(mkstub nores nores)" nores --scenarios S3 --repeats 1
S_SIG2=$(mkstub sig2 ok); cli sig2 "$ROOT" "$S_SIG2" sigint --scenarios S3 --repeats 1
mkdir -p "$TMP/t-mmplug"; cp -r "$PLUGIN" "$TMP/t-mmplug/plugin"; echo "extra" >> "$TMP/t-mmplug/plugin/agents/$(ls agents | head -1)"
( cd "$ROOT" && env TMPDIR="$TMP/t-bg" node tests/scripts/manual/usage-bench.mjs --model test-model --phase calibration --out "$TMP/t-bg/out" --sandbox off --plugin-dir "$TMP/t-mmplug/plugin" --claude "$(mkstub mmplug ok)" --env-file "$TMP/eval.env" --budget-total 100 --scenarios S3 --repeats 1 > "$TMP/o-mmplug.log" 2> "$TMP/o-mmplug.err"; echo $? > "$TMP/o-mmplug.rc" ) &
# Tampered copies of a finished out: a torn last line, a garbled line, an unknown draw, an extra key, a halted entry with a row, a done entry after done.
node --input-type=module -e "
import fs from 'node:fs'; import { execFileSync } from 'node:child_process';
const src = '$TMP/t-whole/out'; const lines = fs.readFileSync(src + '/results.jsonl', 'utf8').split('\n').filter(Boolean);
const mk = (name, f) => { const d = '$TMP/t-' + name; fs.mkdirSync(d); execFileSync('cp', ['-a', src, d + '/out']); fs.writeFileSync(d + '/out/results.jsonl', f(lines.map((l) => JSON.parse(l)))); };
const join = (es) => es.map((e) => JSON.stringify(e)).join('\n') + '\n';
mk('torn1', () => lines.join('\n').slice(0, -8));
mk('torn2', () => lines.join('\n') + '\n{\"draw\"');
mk('torn3', () => lines.map((l, i) => (i === 1 ? l.slice(0, 40) : l)).join('\n') + '\n');
mk('torn4', (es) => join(es.map((e, i) => (i === 0 ? { ...e, draw: 'nope-somi-9' } : e))));
mk('torn5', (es) => join(es.map((e, i) => (i === 0 ? { ...e, extra: 1 } : e))));
mk('torn6', (es) => join(es.map((e, i) => (i === 0 ? { ...e, status: 'halted', reason: 'account-limit' } : e))));
mk('torn7', (es) => join([...es, es[0]]));
mk('torn8', (es) => join(es.map((e, i) => (i === 0 ? { ...e, row: { ...e.row, phase: 'experiment' } } : e))));
" || echo "FAIL	could not build the tampered copies"
for n in 1 2 3 4 5 6 7 8; do cli "torn$n" "$ROOT" "$(mkstub "torn$n" ok)" "torn$n" --scenarios S3 --repeats 3; done
wait

# Guard refusals that need no stub run (each dies before any claude call).
REFSTUB=$(mkstub ref ok); mkdir -p "$TMP/t-ref" "$TMP/t-ref/open"; chmod 755 "$TMP/t-ref/open"
refuses() { # name regex args...
  local name=$1 re=$2; shift 2
  local msg rc; msg=$(cd "$ROOT" && env TMPDIR="$TMP/t-ref" node tests/scripts/manual/usage-bench.mjs --model test-model "$@" 2>&1 >/dev/null); rc=$?
  if [ "$rc" -eq 2 ] && grep -qE -- "$re" <<<"$msg"; then echo "ok	refusal: $name"; else echo "FAIL	refusal: $name (rc $rc: $(head -c 120 <<<"$msg"))"; fi
}
BASE=(--sandbox off --plugin-dir "$PLUGIN" --claude "$REFSTUB" --env-file "$TMP/eval.env" --scenarios S3 --budget-total 100)
{
  refuses 'no phase' '--phase' "${BASE[@]}" --out "$TMP/t-ref/o1"
  refuses 'sizing phase without a probe' 'sizing phase is for' "${BASE[@]}" --phase sizing --out "$TMP/t-ref/o1"
  refuses 'a probe in the experiment phase' 'experiment phase' "${BASE[@]}" --phase experiment --sizing-probe --out "$TMP/t-ref/o1"
  refuses 'a probe scenario without --sizing-probe' 'need --sizing-probe' --sandbox off --phase calibration --scenarios S4-M01 --out "$TMP/t-ref/o1" --budget-total 1
  refuses 'a normal scenario with --sizing-probe' 'at most once' --sandbox off --phase sizing --sizing-probe --scenarios S1 --out "$TMP/t-ref/o1" --budget-total 1
  refuses '--out outside HOME, the repository and the temp directory' 'under HOME' "${BASE[@]}" --phase calibration --out /var/tmp/bench-refusal-out
  if VT=$(mktemp -d -p /var/tmp bdrvt.XXXXXX 2>/dev/null); then refuses 'a temp directory outside /tmp is not an --out root' 'under HOME' "${BASE[@]}" --phase calibration --out "$VT/out"; rmdir "$VT" 2>/dev/null; fi
  refuses '--out with group access' 'mode 0700' "${BASE[@]}" --phase calibration --out "$TMP/t-ref/open"
  refuses 'no --out or --budget-total' 'are required' --sandbox off --phase calibration
  refuses 'an unknown flag' 'unknown argument' --frobnicate
  refuses 'the real claude without a sandbox' 'unsafe-no-sandbox' --sandbox off --plugin-dir "$PLUGIN" --env-file "$TMP/eval.env" --budget-total 100 --scenarios S3 --phase calibration --out "$TMP/t-ref/o2"
  refuses 'a worst case over the total budget' 'exceeds --budget-total' "${BASE[@]}" --phase calibration --out "$TMP/t-ref/o3" --budget-total 5
} > "$TMP/refusals.txt"
( cd "$ROOT" && env TMPDIR="$TMP/t-ref" CLAUDE_CODE_OAUTH_TOKEN=x node tests/scripts/manual/usage-bench.mjs --model test-model --phase calibration --out "$TMP/t-ref/o4" --budget-total 1 > /dev/null 2> "$TMP/o-envtok.err"; echo $? > "$TMP/o-envtok.rc" )

# ---- verifier ---------------------------------------------------------------------------------------------------------
cat > "$TMP/verify.mjs" <<'EOS'
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [mode] = process.argv.slice(2);
const { TMP, TOKEN, LIB, ROOT, NAGENTS } = process.env;
const out = [];
const check = (n, ok) => out.push(`${ok ? 'ok' : 'FAIL'}\t${mode}: ${n}`);
const U = await import(`${LIB}/bench-usage.mjs`); const Sc = await import(`${LIB}/bench-schema.mjs`);
const read = (f) => fs.readFileSync(f, 'utf8');
const rc = (n) => Number(read(`${TMP}/o-${n}.rc`).trim());
const entries = (outn) => read(`${TMP}/t-${outn}/out/results.jsonl`).split('\n').filter(Boolean).map((l) => JSON.parse(l));
const stubLog = (n) => { try { return read(`${TMP}/stubs/${n}/argv.jsonl`).split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const calls = (n) => { try { return Number(read(`${TMP}/stubs/${n}/count`)); } catch { return 0; } };
const wins = Array.from({ length: TOKEN.length - 11 }, (_, i) => TOKEN.slice(i, i + 12));
const hasWindow = (t) => wins.some((w) => t.includes(w));
const walk = (d) => { const r = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) r.push(...walk(p)); else if (e.isFile()) r.push(p); } return r; };
const strip = (e) => (e.row ? { ...e, row: { ...e.row, durationMs: 0 } } : e);
const TOK = { 'vendor-test-model-1': { input: 1000, output: 200, cacheRead: 3000, cacheCreation: 400 }, 'test-model-sub': { input: 10, output: 20, cacheRead: 30, cacheCreation: 40 } };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
try {
if (mode === 'unit') {
  const dir = fs.mkdtempSync(`${TMP}/unit-`);
  const ev = (o) => JSON.stringify(o);
  const asst = (...blocks) => ev({ type: 'assistant', message: { model: 'm-1', content: blocks } });
  const tu = (id, name) => ({ type: 'tool_use', id, name, input: {} });
  const res = (o = {}) => ev({ type: 'result', total_cost_usd: 0.25, num_turns: 2, modelUsage: { 'm-1': { inputTokens: 5, outputTokens: 6, cacheReadInputTokens: 7, cacheCreationInputTokens: 8 } }, ...o });
  const stream = (name, lines) => { const f = `${dir}/${name}`; fs.writeFileSync(f, lines.join('\n') + '\n'); return f; };
  const good = U.parseStream(stream('good', [asst(tu('a', 'Bash'), tu('b', 'Agent')), asst(tu('c', 'Task'), tu('a', 'Bash')), ev({ type: 'user', message: { content: [tu('u1', 'Agent'), { type: 'tool_result', content: 'x' }] } }), res(), res({ total_cost_usd: 0.5, num_turns: 3 })]));
  check('tool calls count assistant tool_use blocks once per id; a user-event tool_use is not counted', good.toolCalls === 3 && good.subagents === 2);
  check('adjacent result lines are one call: its last line carries the cumulative tokens and cost, turns add up', eq(good.tokens, { 'm-1': { input: 5, output: 6, cacheRead: 7, cacheCreation: 8 } }) && good.costUsd === 0.5 && good.turns === 5 && good.results === 2);
  const u = (n) => ({ 'm-1': { inputTokens: n, outputTokens: 10 * n, cacheReadInputTokens: 100 * n, cacheCreationInputTokens: 1000 * n } });
  const twoCalls = U.parseStream(stream('two-calls', [asst(tu('a', 'Agent')), res({ total_cost_usd: 0.2, num_turns: 12, modelUsage: u(1) }), res({ total_cost_usd: 0.2, num_turns: 2, modelUsage: u(1) }), res({ total_cost_usd: 0.3, num_turns: 7, modelUsage: u(3) }),
    ev({ type: 'system', subtype: 'init' }), asst(tu('b', 'Bash')), res({ total_cost_usd: 0.7, num_turns: 4, modelUsage: u(5) }), res({ total_cost_usd: 0.7, num_turns: 3, modelUsage: u(5) })]));
  check('a resume is another call: per-call totals add, a call\'s repeated cumulative totals are not re-counted (the recorded 4.0.0 S2 shape)', eq(twoCalls.tokens, { 'm-1': { input: 8, output: 80, cacheRead: 800, cacheCreation: 8000 } }) && Math.abs(twoCalls.costUsd - 1.0) < 1e-9 && twoCalls.turns === 28 && twoCalls.results === 5);
  const hostile = U.parseStream(stream('hostile', ['not json', '[1,2]', '"result"', '{"__proto__":{"type":"result"}}', ev({ type: 'assistant', message: null }), ev({ type: 'assistant', message: { content: 'x' } }), asst({ type: 'tool_use', name: 5 }, 'junk', null, tu('z', 'Bash')),
    ev({ type: 'user', message: { content: [{ type: 'tool_result', content: '{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Agent"}]}}' }] } }),
    '{"type":"result","total_cost_usd":-1,"num_turns":1.5,"modelUsage":{"m-2":{"inputTokens":-5,"outputTokens":"7","cacheReadInputTokens":1.5,"cacheCreationInputTokens":2},"__proto__":{"inputTokens":9}}}']));
  check('hostile lines (bad JSON, arrays, forged type via __proto__, wrong shapes, a tool_use quoted inside a result string) change nothing', hostile !== null && hostile.toolCalls === 1 && hostile.subagents === 0 && hostile.skipped === 1 && hostile.costUsd === 0 && hostile.turns === 0);
  check('negative, fractional and string token values count as 0; a __proto__ key is a model seen but never a token key', eq(hostile.tokens, { 'm-2': { input: 0, output: 0, cacheRead: 0, cacheCreation: 2 } }) && hostile.modelsSeen.includes('__proto__') && Object.getPrototypeOf(hostile.tokens) === Object.prototype);
  const bigFile = `${dir}/big`; fs.writeFileSync(bigFile, `${ev({ type: 'assistant', pad: 'x'.repeat(17 << 20), message: { content: [tu('big', 'Bash')] } })}\n${asst(tu('after', 'Bash'))}\n${res()}\n`);
  const big = U.parseStream(bigFile);
  check('a line over the 16 MiB cap is skipped (counted), the lines around it still parse', big !== null && big.skipped === 1 && big.toolCalls === 1 && big.results === 1);
  check('unusable streams give null: no result line, empty file, missing file, directory, link, over the size cap', [U.parseStream(stream('nores', [asst(tu('a', 'Bash'))])), U.parseStream(stream('empty', [])), U.parseStream(`${dir}/none`), U.parseStream(dir), (fs.symlinkSync(`${dir}/good`, `${dir}/lnk`), U.parseStream(`${dir}/lnk`)), U.parseStream(`${dir}/good`, { maxBytes: 10 })].every((x) => x === null));
  const trunc = U.parseStream(stream('trunc', [res({ modelUsage: { ['m'.repeat(130)]: {}, 'm-1': {} } })]));
  check('a model id over 120 characters sets modelsTruncated, and toRow then fails the row closed', trunc.modelsTruncated === true && U.toRow({ scenario: 'S3', arm: 'somi', phase: 'experiment', outcome: 'scored', reason: '', costUsd: 1, durationMs: 1, model: 'm' }, trunc, { green: 1, total: 1 }, null).reason === 'models-truncated' && good.modelsTruncated === false);
  const P = [['vendor-test-model-1', 'test-model', true], ['test-model', 'test-model', true], ['xtest-model', 'test-model', false], ['test-modelx', 'test-model', false], ['vendor-zed-4-5-2025', 'zed', true], ['', 'x', false], ['other', 'test-model', false]];
  check('isPinned: the alias as a whole word, an extra id, nothing else', P.every(([id, a, w]) => U.isPinned(id, a) === w) && U.isPinned('zz', 'test-model', ['zz']) && !U.isPinned(5, 'a'));
  const draw = (o = {}) => ({ scenario: 'S3', arm: 'somi', phase: 'experiment', outcome: 'scored', reason: '', costUsd: 1.5, durationMs: 1234.7, model: 'm', ...o });
  const parsedOk = { ...good, modelsSeen: ['m-1'] };
  const mk = (d, p, s, t = { tier: 'small', tierSource: 'file' }) => U.toRow(d, p, s, t);
  const ok = mk(draw(), parsedOk, { green: 3, total: 4 });
  check('a scored row validates, carries the parsed counts and a pinned model', Sc.rowProblems(ok.row).length === 0 && ok.row.outcome === 'scored' && ok.row.toolCalls === 3 && ok.row.green === 3 && ok.row.models[0] === 'm-1' && ok.row.paused === false);
  const unp = mk(draw(), { ...parsedOk, modelsSeen: ['m-1', 'other-model'] }, { green: 3, total: 4 });
  check('a model outside the pinned set makes the row invalid with reason unpinned-model', unp.row.outcome === 'invalid' && unp.reason === 'unpinned-model' && Sc.rowProblems(unp.row).length === 0);
  const probe = mk(draw({ outcome: 'invalid', reason: 'probe' }), { ...parsedOk, modelsSeen: ['x-1'] }, null);
  check('a sizing probe is checked for pinning too; an already invalid draw keeps its first cause', probe.reason === 'unpinned-model' && mk(draw({ outcome: 'invalid', reason: 'timeout' }), { ...parsedOk, modelsSeen: ['x-1'] }, null).reason === 'timeout');
  check('no model information, or no usable stream, is invalid rather than assumed pinned', mk(draw(), { ...parsedOk, modelsSeen: [] }, { green: 1, total: 1 }).reason === 'models-unknown' && mk(draw(), null, { green: 1, total: 1 }).reason === 'unusable-stream');
  check('a scored outcome without a hidden-suite score is invalid; a paused row keeps its score and sets paused', mk(draw(), parsedOk, null).reason === 'unscored' && (() => { const p = mk(draw({ outcome: 'paused' }), parsedOk, { green: 2, total: 4 }).row; return p.paused === true && p.green === 2 && Sc.rowProblems(p).length === 0; })());
  const junk = mk(draw({ costUsd: NaN, durationMs: -5, turns: 'x' }), { ...parsedOk, tokens: { 'm-1': { input: 1.5 } } }, { green: 9, total: 4 });
  check('whatever goes in, the row that comes out validates (garbled input falls back to a zero invalid row)', Sc.rowProblems(junk.row).length === 0 && junk.row.outcome === 'invalid');
  check('a reason with control or non-ASCII characters is made printable, so the results file can always be read back', /^[\x20-\x7e]*$/.test(mk(draw({ outcome: 'scored', reason: 'a\nb\u0001\u00e9' }), parsedOk, { green: 1, total: 1 }).reason));
  const pl = (o = {}) => U.buildPlan({ phase: 'calibration', seed: 1, model: 'm', pinnedExtra: [], ceilingSomi: 'low', pinAll: true, probe: false, repeats: 3, scenarios: ['S1', 'S2', 'S3'].map((id) => ({ id, arms: ['somi', 'bare'] })), caps: { somi: 6, bare: 2, probe: 1 }, limits: { timeoutMin: 40, timeoutProbeMin: 8 }, ruleHash: 'r', gitSha: 'g', pluginHash: 'p', ...o });
  const plan = pl();
  check('plan: the same flags give the same plan; another seed another order', eq(plan, pl()) && !eq(plan.draws.map((d) => d.id), pl({ seed: 2 }).draws.map((d) => d.id)));
  check('plan: every round of 6 holds each scenario and arm once, orders are 0..17, ids are unique', [0, 6, 12].every((s) => new Set(plan.draws.slice(s, s + 6).map((d) => `${d.scenario}${d.arm}`)).size === 6 && plan.draws.slice(s, s + 6).every((d) => d.repeat === s / 6 + 1)) && plan.draws.every((d, i) => d.order === i) && new Set(plan.draws.map((d) => d.id)).size === 18);
  check('plan: the two arms of a scenario run back to back (arms interleave), so any prefix is balanced', plan.draws.every((d, i) => i % 2 === 1 || (plan.draws[i + 1].scenario === d.scenario && plan.draws[i + 1].arm !== d.arm)) && new Set(plan.draws.slice(0, 6).map((d) => d.arm + d.scenario)).size === 6);
  check('planMismatch names the differing field; the git sha never counts; an ignored field is ignored', eq(U.planMismatch(plan, pl({ seed: 2 })), ['seed', 'draws']) && U.planMismatch(plan, pl({ gitSha: 'other' })).length === 0 && eq(U.planMismatch(plan, pl({ caps: { somi: 7, bare: 2, probe: 1 } })), ['caps']) && U.planMismatch(plan, pl({ pluginHash: null }), ['pluginHash']).length === 0 && eq(U.planMismatch(plan, pl({ pluginHash: null })), ['pluginHash']) && eq(U.planMismatch(null, plan), ['plan']));
  const okRow = (d) => U.toRow({ scenario: d.scenario, arm: d.arm, phase: 'calibration', outcome: 'scored', reason: '', costUsd: 1, durationMs: 1, model: 'm' }, parsedOk, { green: 1, total: 1 }, { tier: null, tierSource: 'none' }).row;
  const line = (d, status = 'done', o = {}) => JSON.stringify({ schema: 1, draw: d.id, status, reason: status === 'done' ? '' : 'account-limit', costUsd: 1, resumes: 0, computedTier: null, resetText: null, row: status === 'done' ? okRow(d) : null, ...o });
  const [d0, d1, d2] = plan.draws;
  const txt = (...ls) => `${ls.join('\n')}\n`;
  const parsed = U.parseResults(txt(line(d0), line(d1, 'halted')), plan);
  check('parseResults accepts valid entries; pendingDraws skips terminal draws and re-runs a halted one', parsed.ok && parsed.entries.length === 2 && U.pendingDraws(plan, parsed.entries).length === 17 && U.pendingDraws(plan, parsed.entries)[0].id === d1.id && U.spentUsd(parsed.entries) === 2);
  check('a halted draw later done is fine; after a terminal entry any further entry for it is refused', U.parseResults(txt(line(d1, 'halted'), line(d1)), plan).ok && !U.parseResults(txt(line(d1), line(d1, 'halted')), plan).ok && !U.parseResults(txt(line(d1), line(d1)), plan).ok);
  const bad = [txt(line(d0)).slice(0, -1), txt(line(d0), '{"draw"'), txt(line(d0), line(d1).slice(0, 30) + '#'), txt(line(d0, 'done', { draw: 'x-somi-1' })), txt(line(d0, 'done', { extra: 1 })), txt(line(d0, 'halted', { row: okRow(d0) })), txt(line(d0, 'halted', { reason: 'because' })),
    txt(line(d0, 'done', { costUsd: -1 })), txt(line(d0, 'done', { resetText: 5 })), txt(line(d0, 'done', { row: { ...okRow(d0), phase: 'experiment' } })), txt(line(d0, 'done', { row: { ...okRow(d0), arm: d0.arm === 'somi' ? 'bare' : 'somi' } })), txt(line(d0, 'done', { schema: 2 })), txt('[1]'), txt('null')];
  check('every torn, unparsable, mismatched or implausible results text is refused whole', bad.every((t) => U.parseResults(t, plan).ok === false) && U.parseResults('', plan).ok);
  const rep = U.buildBenchReport(plan, parsed.entries, null);
  check('the report counts and takes medians but carries no verdict', rep.includes('1 of 18') && /median cost/.test(rep) && !/\b(better|worse)\b/.test(rep));
} else if (mode === 'full') {
  const es = entries('full'); const plan = JSON.parse(read(`${TMP}/t-full/out/plan.json`));
  check('exit 0, six draws, every entry done with a row that validates', rc('full') === 0 && es.length === 6 && es.every((e) => e.status === 'done' && Sc.rowProblems(e.row).length === 0 && e.schema === 1));
  check('entries follow the plan order, one at a time', eq(es.map((e) => e.draw), plan.draws.map((d) => d.id)));
  check('every row is scored with the stub\'s hidden-suite result (all tests green, total >= 1)', es.every((e) => e.row.outcome === 'scored' && e.row.total >= 1 && e.row.green === e.row.total));
  check('S1 is scored by its 9 built-in checks in both arms', es.filter((e) => e.row.scenario === 'S1').every((e) => e.row.total === 9));
  check('token classes per model equal the stub\'s script', es.every((e) => eq(e.row.tokens, TOK)));
  check('tool calls (5, a repeated id once, a user-event tool_use never), subagents (2), turns, cost, models equal the script', es.every((e) => e.row.toolCalls === 5 && e.row.subagents === 2 && e.row.turns === 3 && e.row.costUsd === 0.5 && eq(e.row.models, ['test-model-sub', 'vendor-test-model-1'])));
  check('rows carry phase calibration, arm and tier: SoMi unknown/none (no record), bare null/none', es.every((e) => e.row.phase === 'calibration' && (e.row.arm === 'somi' ? e.row.tier === 'unknown' && e.row.tierSource === 'none' : e.row.tier === null)) && es.every((e) => e.computedTier === null && e.resumes === 0));
  check('plan.json: phase, seed, caps, pinned ceiling, rule and plugin hashes, git sha', plan.phase === 'calibration' && plan.seed === 1 && eq(plan.caps, { somi: 6, bare: 2, probe: 1 }) && plan.pinAll === true && plan.ceilingSomi === 'low' && /^[0-9a-f]{64}$/.test(plan.ruleHash) && /^[0-9a-f]{64}$/.test(plan.pluginHash) && /^[0-9a-f]{40}$/.test(plan.gitSha) && plan.draws.length === 6);
  const log = stubLog('ok'); const keys = ['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS', 'CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH'];
  const arg = (l, k) => l.argv[l.argv.indexOf(k) + 1];
  check('the child sees exactly the six allowlisted variables, the token only there, the bg ceiling 0; no host variable', log.length === 6 && log.every((l) => eq(l.envKeys, keys) && l.tokenInEnv && l.bgCeiling === '0'));
  check('SoMi argv: plugin dir, the ship-loop / code-loop command, cap $6.00; bare argv: no plugin, the plain text, cap $2.00', log.filter((l) => l.argv.includes('--plugin-dir')).length === 3 && log.every((l) => (l.argv.includes('--plugin-dir') ? arg(l, '--max-budget-usd') === '6.00' && (arg(l, '--print').startsWith('/somi:ship-loop ') || arg(l, '--print') === '/somi:code-loop expired-token phase 1, iteration 1.1') : arg(l, '--max-budget-usd') === '2.00' && !arg(l, '--print').startsWith('/')) && arg(l, '--model') === 'test-model'));
  check('the bare S1 prompt is the fixture author\'s spec and phase text', log.some((l) => !l.argv.includes('--plugin-dir') && arg(l, '--print').includes('verifyToken') && arg(l, '--print').includes('--- phase ---') && arg(l, '--print').includes('export surface')));
  check('both arms\' workspaces carry the low ceiling with every agent pinned to it', log.every((l) => l.cost && l.cost.ceiling === 'low' && Object.keys(l.cost.agents).length === Number(NAGENTS) && Object.values(l.cost.agents).every((v) => v === 'low')));
  const rep = read(`${TMP}/t-full/out/report.txt`);
  check('report.txt has per-scenario lines and spend, and no verdict word', /S1 somi/.test(rep) && /S3 bare/.test(rep) && /spend \$3\.00/.test(rep) && !/\b(better|worse)\b/.test(rep) && fs.existsSync(`${TMP}/t-full/out/S1-somi-1/stream.jsonl`));
  check('the draws\' temp workspaces are gone and the lock is released', !fs.readdirSync(`${TMP}/t-full`).some((n) => n.startsWith('ab-draw-')) && !fs.existsSync(`${TMP}/t-full/out/run.lock`));
} else if (mode === 'unp') {
  const es = entries('unp');
  check('both arms\' rows are invalid with reason unpinned-model and still validate', rc('unp') === 0 && es.length === 2 && es.every((e) => e.status === 'done' && e.row.outcome === 'invalid' && e.reason === 'unpinned-model' && Sc.rowProblems(e.row).length === 0 && e.row.models.includes('other-model-x')));
} else if (mode === 'halt') {
  const h1 = entries('halt'); const whole = entries('whole');
  const first = h1.slice(0, 3);
  check('the limit message halts the run: exit 1, two done entries, then a halted account-limit entry with the reset text and no row', rc('halt1') === 1 && first.length === 3 && first.slice(0, 2).every((e) => e.status === 'done') && first[2].status === 'halted' && first[2].reason === 'account-limit' && first[2].resetText === '1:50am (Europe/Vilnius)' && first[2].row === null && calls('halt') === 3);
  check('the halted run says why on stderr, with the reset text', /HALTED, S3-[a-z]+-\d: account-limit, resets 1:50am \(Europe\/Vilnius\)/.test(read(`${TMP}/o-halt1.err`)));
  const plan = JSON.parse(read(`${TMP}/t-halt/out/plan.json`));
  check('the re-run executes only the four unfinished draws (the halted one included): 4 stub calls, exit 0', rc('halt2') === 0 && calls('halt2') === 4 && h1.length === 7 && h1.slice(3).every((e) => e.status === 'done') && eq(h1.slice(3).map((e) => e.draw), plan.draws.slice(2).map((d) => d.id)));
  const last = (es) => Object.fromEntries(es.map((e) => [e.draw, strip(e)]));
  const a = last(h1.filter((e) => e.status === 'done')); const b = last(whole);
  check('the merged results hold the same draws and rows as an uninterrupted run (timing aside)', whole.length === 6 && eq(Object.keys(a).sort(), Object.keys(b).sort()) && Object.keys(a).every((k) => eq(a[k], b[k])));
  check('the halted attempt\'s draw directory is kept aside (.halted-1), not deleted', fs.readdirSync(`${TMP}/t-halt/out`).filter((n) => /\.halted-1$/.test(n)).length === 1);
  check('the interrupted-then-resumed out has every planned draw done exactly once', U.pendingDraws(plan, U.parseResults(read(`${TMP}/t-halt/out/results.jsonl`), plan).entries).length === 0);
} else if (mode === 'bg') {
  const es = entries('bg');
  check('the background-wait ceiling halts the run after one draw: exit 1, one halted entry, no row, one stub call', rc('bg') === 1 && es.length === 1 && es[0].status === 'halted' && es[0].reason === 'bg-wait-ceiling' && es[0].row === null && es[0].resetText === null && calls('bg') === 1);
} else if (mode === 'budget') {
  const es = entries('bgt');
  check('a total budget below the next cap stops the run with a halted budget-stop entry (no row, exit 1)', rc('bgt1') === 1 && es.some((e) => e.status === 'halted' && e.reason === 'budget-stop' && e.row === null));
  check('a re-run with more budget runs the rest: two done draws, each run exactly once across both stubs', rc('bgt2') === 0 && es.filter((e) => e.status === 'done').length === 2 && calls('bgt') + calls('bgt2') === 2);
} else if (mode === 'pause') {
  const es = entries('pause'); const s = es.find((e) => e.row.arm === 'somi'); const b = es.find((e) => e.row.arm === 'bare');
  check('a SoMi pause is answered once (resumes 1, scored); the bare arm is never resumed', rc('pause') === 0 && s.resumes === 1 && s.row.outcome === 'scored' && b.resumes === 0 && calls('pause') === 3);
  check('the resume turn adds a second result line to the sums (turns 6, cost 1.0, tokens doubled)', s.row.turns === 6 && s.row.costUsd === 1 && s.row.tokens['vendor-test-model-1'].input === 2000);
} else if (mode === 'probe') {
  const es = entries('probe'); const log = stubLog('probe');
  check('a sizing probe is one SoMi call, zero resumes, cap $1.00, phase sizing, outcome invalid with reason probe, never scored', rc('probe') === 0 && es.length === 1 && es[0].row.phase === 'sizing' && es[0].row.arm === 'somi' && es[0].row.outcome === 'invalid' && es[0].reason === 'probe' && es[0].row.total === 0 && es[0].resumes === 0 && log.length === 1 && log[0].argv[log[0].argv.indexOf('--max-budget-usd') + 1] === '1.00');
  check('the probe row validates and its plan is flagged probe with the probe cap', Sc.rowProblems(es[0].row).length === 0 && JSON.parse(read(`${TMP}/t-probe/out/plan.json`)).probe === true);
} else if (mode === 'echo') {
  const es = entries('echo');
  check('a draw that echoes the token is invalid with a leak reason in both arms; the stream on disk is redacted', rc('echo') === 0 && es.every((e) => e.row.outcome === 'invalid' && /^leak:/.test(e.reason) && e.reason.includes('token')) && read(`${TMP}/t-echo/out/${es[0].draw}/stream.jsonl`).includes('[REDACTED]'));
} else if (mode === 'dry') {
  const log = read(`${TMP}/o-dry.log`);
  check('a dry run prints the plan, the caps, the worst case and the pinned cost config, makes no claude call and writes nothing', rc('dry') === 0 && /18 draw\(s\)/.test(log) && /cap \$6/.test(log) && /cap \$2/.test(log) && /worst case[^\n]*\$72\.00/.test(log) && /pin-all on \(\d+ agents pinned to low\)/.test(log) && calls('dry') === 0 && !fs.existsSync(`${TMP}/t-dry/out`));
  const first = log.split('\n').filter((l) => /^\s+\d+ S\d-/.test(l)).slice(0, 6);
  check('the printed order is the plan order: ids with their caps', first.length === 6 && first.every((l) => /\(cap \$[62], 40 min\)/.test(l)));
} else if (mode === 'sigint') {
  const snap = JSON.parse(read(`${TMP}/o-sigint.rc`)); const first = (snap.results ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l)); const es = entries('sigint');
  check('SIGINT: exit 130, exactly one entry, halted `interrupted` with no row, charged the draw cap; no report; the lock released', snap.code === 130 && first.length === 1 && first[0].status === 'halted' && first[0].reason === 'interrupted' && first[0].row === null && [2, 6].includes(first[0].costUsd) && snap.report === false && snap.lock === false);
  check('the re-run after the interrupt finishes both draws, the interrupted one included, and the spend includes the interrupt', rc('sig2') === 0 && es.length === 3 && es.filter((e) => e.status === 'done').length === 2 && calls('sig2') === 2 && fs.readdirSync(`${TMP}/t-sigint/out`).some((n) => /\.halted-1$/.test(n)));
} else if (mode === 'refuse') {
  const mm = Number(process.env.MMCOUNT); const want = ['seed', 'caps', 'caps', 'caps', 'scenarios', 'repeats', 'model', 'phase', 'ceilingSomi', 'pinnedExtra', 'limits'];
  check('a changed task, fixture or S1 suite hash (material) against the stored plan is refused', rc('mmat') === 1 && read(`${TMP}/o-mmat.err`).includes('material') && calls('mmat') === 0);
  for (let i = 1; i <= mm; i++) check(`a changed ${want[i - 1]} against the stored plan is refused (exit 1, named, no claude call)`, rc(`mm${i}`) === 1 && read(`${TMP}/o-mm${i}.err`).includes('plan.json differs') && read(`${TMP}/o-mm${i}.err`).includes(want[i - 1]) && calls(`mm${i}`) === 0);
  check('a different plugin build against the stored plan is refused', rc('mmplug') === 1 && read(`${TMP}/o-mmplug.err`).includes('pluginHash') && calls('mmplug') === 0);
  const why = ['torn', 'wrong keys|not JSON|torn', 'not JSON', 'not in the plan', 'wrong keys', 'halt reason', 'after its terminal', 'does not validate'];
  const kinds = ['a missing line end', 'a dangling partial line', 'a garbled middle line', 'an unknown draw', 'an extra key', 'a halted entry holding a row', 'a draw entered twice after done', 'a row of another phase'];
  for (let i = 1; i <= 8; i++) check(`results.jsonl with ${kinds[i - 1]} is refused whole (exit 1) and nothing runs`, rc(`torn${i}`) === 1 && /results\.jsonl refused/.test(read(`${TMP}/o-torn${i}.err`)) && new RegExp(why[i - 1]).test(read(`${TMP}/o-torn${i}.err`)) && calls(`torn${i}`) === 0);
  check('a stale lock (dead pid) is replaced and the run completes; a live lock is refused with no claude call', rc('stale') === 0 && calls('stale') === 2 && rc('live') === 2 && /another run is using/.test(read(`${TMP}/o-live.err`)) && calls('live') === 0);
  check('results.jsonl that is a link is refused (opened without following)', rc('symres') === 1 && /regular file/.test(read(`${TMP}/o-symres.err`)) && calls('symres') === 0);
  check('a draw directory planted as a link is moved aside, never written through: the target stays empty and the run completes', rc('symdraw') === 0 && fs.readdirSync(`${TMP}/victim`).length === 0 && fs.lstatSync(`${TMP}/t-symdraw/out/S3-somi-1`).isDirectory() && fs.readdirSync(`${TMP}/t-symdraw/out`).some((n) => n.startsWith('S3-somi-1.halted-')));
  check('--out that is a link is refused', rc('symout') === 2 && /real directory/.test(read(`${TMP}/o-symout.err`)) && calls('symout') === 0);
  check('a call that ends with no result halts (no row, charged the cap, re-run later)', rc('nores') === 1 && entries('nores')[0].reason === 'no-result' && entries('nores')[0].row === null && [2, 6].includes(entries('nores')[0].costUsd));
  check('CLAUDE_CODE_OAUTH_TOKEN already in the environment is refused', Number(read(`${TMP}/o-envtok.rc`).trim()) === 2 && read(`${TMP}/o-envtok.err`).includes('already in the environment'));
} else if (mode === 'disk') {
  const dirs = process.env.DIRS.split(':').filter(Boolean); const files = dirs.flatMap((d) => walk(d)).filter((f) => !f.endsWith('/stub.json') && !f.endsWith('/eval.env'));
  const bad = files.filter((f) => { try { return hasWindow(fs.readFileSync(f, 'latin1')); } catch { return false; } });
  check(`no 12-character window of the token is in any of ${files.length} file(s): rows, plans, reports, streams, stderr, transcripts, workspaces, logs, stub argv`, bad.length === 0 && files.length > 30);
  check('every row of every results file validates and holds no token-like string or home path', dirs.filter((d) => !/torn|mut/.test(d) && fs.existsSync(`${d}/out/results.jsonl`)).every((d) => read(`${d}/out/results.jsonl`).split('\n').filter(Boolean).every((l) => { const e = JSON.parse(l); return e.row === null || (Sc.rowProblems(e.row).length === 0 && Sc.findLeaks(e.row).length === 0); })));
}
} catch (e) { out.push(`FAIL\t${mode}: threw ${String(e?.stack ?? e).slice(0, 300)}`); }
console.log(out.join('\n'));
EOS

PASS=0; FAILN=0
tally() { while IFS=$'\t' read -r st name; do [ -z "$st" ] && continue; if [ "$st" = ok ]; then PASS=$((PASS + 1)); else FAILN=$((FAILN + 1)); echo "  FAIL $name"; fi; done; }
vfy() { env TMP="$TMP" TOKEN="$TOKEN" LIB="${LIBDIR:-$LIB}" ROOT="$ROOT" NAGENTS="$NAGENTS" MMCOUNT="$MM" DIRS="${DIRS:-}" node "$TMP/verify.mjs" "$1"; }
for m in unit full unp halt bg budget pause probe echo dry sigint refuse; do tally < <(vfy "$m"); done
tally < <(grep -E '^(ok|FAIL)' "$TMP/refusals.txt")
DIRS=""; for d in "$TMP"/t-*/; do DIRS="$DIRS:$d"; done; DIRS="$DIRS:$TMP/stubs"; export DIRS
for f in "$TMP"/o-*.log "$TMP"/o-*.err; do cp "$f" "$TMP/t-full/$(basename "$f")" 2>/dev/null; done
tally < <(vfy disk)

# ---- red proofs: break one guard on a scratch copy; the group that pins it must fail ------------------------------
red_unit() { # name file from to
  scratch "$1"; mutate "$1" "$2" "$3" "$4"
  local n; n=$(LIBDIR="$TMP/$1/tests/evals/lib" vfy unit | grep -c '^FAIL')
  if [ "$n" -gt 0 ]; then PASS=$((PASS + 1)); else FAILN=$((FAILN + 1)); echo "  FAIL red proof: '$1' was not caught by the unit group"; fi
}
red_unit mut-unpinned tests/evals/lib/bench-usage.mjs "else if (!seen.every((m) => isPinned(m, draw.model, draw.pinnedExtra))) fail('unpinned-model');" "else if (false) fail('unpinned-model');"
red_unit mut-refinish tests/evals/lib/bench-usage.mjs "filter((e) => e.status === 'done').map((e) => e.draw))" "filter((e) => e.status === 'never').map((e) => e.draw))"
red_unit mut-forged tests/evals/lib/bench-usage.mjs "      if (type === 'assistant') {" "      if (type === 'assistant' || type === 'user') {"
red_unit mut-cumulative tests/evals/lib/bench-usage.mjs "call.cost = cost;" "call.cost += cost;"
red_unit mut-haltedrow tests/evals/lib/bench-usage.mjs "if (e.status === 'halted') { if (e.row !== null" "if (e.status === 'halted') { if (false && e.row !== null"
red_unit mut-mismatch tests/evals/lib/bench-usage.mjs "canon(stored[k]) !== canon(fresh[k])" "false"
red_unit mut-skipbad tests/evals/lib/bench-usage.mjs 'catch { return { ok: false, reason: `${at} is not JSON` }; }' 'catch { continue; }'
red_unit mut-dedupe tests/evals/lib/bench-usage.mjs "if (ids.has(id) || ids.size >= MAX_IDS) continue; ids.add(id);" "ids.add(id);"
# Driver-level proofs: a copy of the driver with one guard removed must behave wrongly in a small run.
scratch mut-plan; mutate mut-plan tests/scripts/manual/usage-bench.mjs "if (diff.length > 0) die(" "if (false) die("
scratch mut-halt; mutate mut-halt tests/scripts/manual/usage-bench.mjs "if (cls.outcome === 'invalid' && halting) return" "if (false) return"
scratch mut-redact; mutate mut-redact tests/evals/lib/ab-stream.mjs 'fs.writeSync(fd, `${redactToken(raw, token)}\n`);' 'fs.writeSync(fd, `${raw}\n`);'
cp -a "$TMP/t-bg" "$TMP/t-mutplan"
scratch mut-lock; mutate mut-lock tests/scripts/manual/usage-bench.mjs "if (alive) { fs.rmSync(mine" "if (false) { fs.rmSync(mine"
scratch mut-follow; mutate mut-follow tests/scripts/manual/usage-bench.mjs "fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);" "fs.constants.O_RDONLY);"
scratch mut-owndir; mutate mut-owndir tests/scripts/manual/usage-bench.mjs "if (!l || !l.isDirectory() || l.isSymbolicLink() || l.uid !== process.getuid() || (l.mode & 0o077) !== 0) die(" "if (!l) die("
cpout live mutlive; cpout symres mutsymres; mkdir -p "$TMP/t-mutsymout/real"; chmod 700 "$TMP/t-mutsymout/real"; ln -s real "$TMP/t-mutsymout/out"
cli mutlive "$TMP/mut-lock" "$(mkstub mutlive ok)" mutlive --scenarios S3 --repeats 1
cli mutsymres "$TMP/mut-follow" "$(mkstub mutsymres ok)" mutsymres --scenarios S3 --repeats 1
cli mutsymout "$TMP/mut-owndir" "$(mkstub mutsymout ok)" mutsymout --scenarios S3 --repeats 1
cli mutplan "$TMP/mut-plan" "$(mkstub mutplan ok)" mutplan --scenarios S3 --repeats 1 --seed 2
cli muthalt "$TMP/mut-halt" "$(mkstub muthalt bg)" muthalt --scenarios S3 --repeats 1
cli mutredact "$TMP/mut-redact" "$(mkstub mutredact echo)" mutredact --scenarios S3 --repeats 1
wait
res() { if [ "$1" = 1 ]; then PASS=$((PASS + 1)); else FAILN=$((FAILN + 1)); echo "  FAIL red proof: $2"; fi; }
res "$([ "$(cat "$TMP/o-mutplan.rc")" != 1 ] && echo 1 || echo 0)" "a driver that accepts a plan mismatch was not caught (it must run instead of refusing)"
res "$([ "$(cat "$TMP/o-muthalt.rc")" = 0 ] && echo 1 || echo 0)" "a driver that records a halted draw as done was not caught (the run no longer halts)"
res "$([ "$(cat "$TMP/o-mutlive.rc")" = 0 ] && echo 1 || echo 0)" "a driver that ignores a live lock was not caught"
res "$(grep -q 'regular file' "$TMP/o-mutsymres.err" && echo 0 || echo 1)" "a driver that follows a results.jsonl link was not caught"
res "$([ "$(cat "$TMP/o-mutsymout.rc")" = 0 ] && echo 1 || echo 0)" "a driver that accepts an --out link was not caught"
res "$(grep -rqF -- "$TOKEN" "$TMP/t-mutredact" && echo 1 || echo 0)" "a sink that writes the token unredacted was not caught by the disk scan"

echo "  $PASS passed, $FAILN failed"
[ "$FAILN" -eq 0 ]
