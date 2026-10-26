#!/usr/bin/env bash
# Pins the A/B draw driver (tests/scripts/manual/ab-experiment.mjs, tests/evals/lib/ab-{draw,stream,report}.mjs) with a STUB
# claude: a node script that plays one behaviour per run (solve, silent copy, over-budget, leak, hang, setsid stray, pause,
# token echo, folded token and transcripts, auth failure, task change, fd token, ...) and dumps the argv and environment it
# was given. Checks outcomes and scoring on the T1 task, the allowlisted environment, the arm flags, the pause and resume
# mechanics, redaction on disk, the leak scan, process cleanup, the budget and halt guards, SIGINT and the report; then
# mutates each guard on a scratch copy of the driver and requires its group to fail. One test runs the real bubblewrap
# sandbox when it works here and says so when it is skipped. Hermetic: temp directories, no model, no network.
# Skipped in a tarball.
set -uo pipefail
umask 022

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: A/B draw driver =="
if [ ! -d tests/evals ] || [ ! -f tests/scripts/manual/ab-experiment.mjs ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t abd.XXXXXX)"
# Everything the suite started has the temp directory in its environment (HOME of a draw): find leftovers that way.
cleanup() { for e in /proc/[0-9]*/environ; do if grep -qaF "$TMP" "$e" 2>/dev/null; then p="${e#/proc/}"; p="${p%/environ}"; [ "$p" != "$$" ] && [ "$p" != "$PPID" ] && kill -9 "$p" 2>/dev/null; fi; done; chmod -R u+rwx "$TMP" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
TOKEN="tokFakeTokenValue0123456789abcdefXYZ"
umask 077; printf 'CLAUDE_CODE_OAUTH_TOKEN=%s\n' "$TOKEN" > "$TMP/eval.env"; umask 022
cp "$TMP/eval.env" "$TMP/eval644.env"; chmod 644 "$TMP/eval644.env"
ln -s "$TMP/eval.env" "$TMP/eval-link.env"
CANARY="$(node -e "console.log(JSON.parse(require('fs').readFileSync('tests/evals/ab/T1-proration/task.json','utf8')).canary)")"
PLUGIN="$TMP/plugin-run/plugin"; mkdir "$TMP/plugin-run"
node --input-type=module -e "const L=await import('$ROOT/tests/evals/lib/ab-draw.mjs');console.log(L.buildPlugin({repoRoot:'$ROOT',runTmp:'$TMP/plugin-run'}))" > "$TMP/plugin.log" 2>&1 || { echo "  FAIL the plugin could not be packed: $(head -c 300 "$TMP/plugin.log")"; exit 1; }

STUB=$(cat <<'EOS'
#!/usr/bin/env node
const fs = require('fs'), path = require('path'), cp = require('child_process');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'stub.json'), 'utf8'));
const mode = path.basename(__filename).slice(5);
const argv = process.argv.slice(2), home = process.env.HOME;
fs.appendFileSync(path.join(home, 'argv.jsonl'), JSON.stringify(argv) + '\n');
fs.writeFileSync(path.join(home, 'env.json'), JSON.stringify(Object.fromEntries(Object.entries(process.env).map(([k, v]) => [k, v === cfg.token ? '<TOKEN>' : v]))));
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const say = (text) => emit({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const result = (o = {}) => emit({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.5, num_turns: 3, duration_ms: 1000, session_id: 'sess-1', modelUsage: { 'stub-usage-key': {} }, ...o });
const oracle = fs.readFileSync(cfg.oracle, 'utf8');
const solve = () => fs.writeFileSync('prorate.mjs', oracle.split(cfg.canary).join(''));
emit({ type: 'system', subtype: 'init', session_id: 'sess-1', note: 'tests/evals/ab is only a system event here' });
if (mode === 'solve') { say('Implemented.'); solve(); result(); }
else if (mode === 'fd') { const t = fs.readFileSync(3, 'utf8'); fs.writeFileSync(path.join(home, 'fd.json'), JSON.stringify({ fdVar: process.env.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR, match: t === cfg.token })); solve(); result(); }
else if (mode === 'silent-copy') { fs.writeFileSync('prorate.mjs', oracle); result(); }
else if (mode === 'over-budget') result({ subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 0.1, result: '' });
else if (mode === 'leak') { emit({ type: 'user', message: { content: [{ type: 'tool_result', content: 'cat /x/tests/evals/ab/T1-proration/oracle2/prorate.mjs /y/T1-proration/hidden/z.mjs // ' + cfg.canary }] } }); solve(); result(); }
else if (mode === 'hang') { cp.spawn('sleep', [String(cfg.sleep)], { stdio: 'ignore' }); setInterval(() => {}, 1000); }
else if (mode === 'setsid') { cp.spawn('setsid', ['sleep', String(cfg.sleep)], { stdio: ['ignore', 'inherit', 'ignore'], detached: true }).unref(); solve(); result(); }
else if (mode === 'pause') { if (argv.includes('--resume')) { say('All done.'); solve(); result({ result: 'All done.' }); } else { say('Shall I proceed with this plan?'); result({ result: 'Shall I proceed with this plan?', session_id: 'sess-p' }); } }
else if (mode === 'pause-forever') { say('Please review the design. Shall I proceed?'); result({ result: 'Please review the design. Shall I proceed?', session_id: 'sess-p' }); }
else if (mode === 'pause-costly') { say('Shall I continue?'); result({ result: 'Shall I continue?', session_id: 'sess-p', total_cost_usd: 7.95 }); }
else if (mode === 'slowpause') setTimeout(() => { say('Shall I continue?'); result({ result: 'Shall I continue?', session_id: 'sess-p', total_cost_usd: 0.2 }); }, 4000);
else if (mode === 'token-echo') { emit({ type: 'user', message: { content: [{ type: 'tool_result', content: 'env says ' + process.env.CLAUDE_CODE_OAUTH_TOKEN }] } }); solve(); result(); }
else if (mode === 'fold') {
  const t = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  emit({ type: 'user', message: { content: [{ type: 'tool_result', content: 'env | fold -w 20:\n' + t.slice(0, 20) + '\n' + t.slice(20) }] } });
  fs.mkdirSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'x'), { recursive: true });
  fs.writeFileSync(path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', 'x', 'sess.jsonl'), JSON.stringify({ content: 'token ' + t }) + '\n');
  fs.writeFileSync('notes.txt', 'CLAUDE_CODE_OAUTH_TOKEN=' + t + '\n'); solve(); result();
}
else if (mode === 'limit-event') { emit({ type: 'rate_limit_event', rate_limit_info: { status: 'rejected', rateLimitType: 'five_hour' } }); say('Shall I proceed?'); result({ result: 'Shall I proceed?', session_id: 'sess-l' }); }
else if (mode === 'limit-text') { say('working'); result({ result: "You've hit your session limit · resets 1:50am (Europe/Vilnius)", session_id: 'sess-l' }); }
else if (mode === 'bg-ceiling') { process.stderr.write('Background tasks still running after 600s; terminating.\n'); say('planning'); result({ result: 'Planning started.' }); }
else if (mode === 'auth-fail') { process.stderr.write('401 Unauthorized\n'); result({ is_error: true, result: 'Invalid API key. Please run /login', total_cost_usd: 0 }); process.exitCode = 1; }
else if (mode === 'auth-text') { say('done'); result({ is_error: true, subtype: 'error_during_execution', result: 'the server returned 401 for the test', total_cost_usd: 0.1 }); }
else if (mode === 'task-changed') { fs.appendFileSync(path.join(cfg.taskDir, 'fixture', 'package.json'), ' '); solve(); result(); }
EOS
)
mkstub() { # name mode sleep [taskDir] -> prints the stub path (one directory per run: the sleep number is how a stray is found)
  local d="$TMP/stubs-$1"; mkdir -p "$d"; printf '%s\n' "$STUB" > "$d/stub-$2"; chmod 755 "$d/stub-$2"
  node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({token: process.argv[2], canary: process.argv[3], oracle: process.argv[4], sleep: Number(process.argv[5]), taskDir: process.argv[6] || ''}))" "$d/stub.json" "$TOKEN" "$CANARY" "$ROOT/tests/evals/ab/T1-proration/oracle/prorate.mjs" "$3" "${4:-}"
  echo "$d/stub-$2"
}
JOBS="${JOBS:-8}"
cli() { # name root stub env-file extra... (runs in the background, at most JOBS at once)
  local name=$1 root=$2 stub=$3 envf=$4; shift 4
  while [ "$(jobs -rp | wc -l)" -ge "$JOBS" ]; do wait -n; done
  mkdir -p "$TMP/t-$name"
  ( cd "$root" && env HOST_SENTINEL=leak-me TMPDIR="$TMP/t-$name" node tests/scripts/manual/ab-experiment.mjs --out "$TMP/o-$name" --model test-model --sandbox off --plugin-dir "$PLUGIN" --claude "$stub" --env-file "$envf" --tasks T1-proration --only T1-proration:bare,T1-proration:somi --concurrency 2 "$@" > "$TMP/o-$name.log" 2> "$TMP/o-$name.err"; echo $? > "$TMP/o-$name.rc" ) &
}
scratch() { # name -> a copy of the driver, its libraries and the T1 task under $TMP/<name>
  local d="$TMP/$1"; mkdir -p "$d/tests/evals/lib" "$d/tests/scripts/manual" "$d/tests/evals/ab" "$d/scripts/lib"; cp scripts/lib/{cost-config,cost-model}.mjs "$d/scripts/lib/"
  cp tests/evals/lib/{ab-draw,ab-stream,ab-report,admit,score-hidden,task-store,manifest,compare}.mjs "$d/tests/evals/lib/"; cp tests/scripts/manual/ab-experiment.mjs "$d/tests/scripts/manual/"; cp -r tests/evals/ab/T1-proration "$d/tests/evals/ab/"
}

# SIGINT driver: start the CLI, wait until both draws have started, send SIGINT, record the exit code.
cat > "$TMP/sigint.mjs" <<'EOS'
import fs from 'node:fs';
import { spawn } from 'node:child_process';
const [root, out, stub, envf, tmpdir, plugin, rcFile] = process.argv.slice(2);
const c = spawn(process.execPath, ['tests/scripts/manual/ab-experiment.mjs', '--out', out, '--model', 'test-model', '--sandbox', 'off', '--plugin-dir', plugin, '--claude', stub, '--env-file', envf, '--tasks', 'T1-proration', '--only', 'T1-proration:bare,T1-proration:somi', '--concurrency', '2'], { cwd: root, env: { ...process.env, TMPDIR: tmpdir }, stdio: ['ignore', 'pipe', 'ignore'] });
let buf = ''; let sent = false;
c.stdout.on('data', (d) => { buf += d; if (!sent && (buf.match(/^start /gm) ?? []).length >= 2) { sent = true; setTimeout(() => c.kill('SIGINT'), 1500); } });
c.on('close', (code) => fs.writeFileSync(rcFile, String(code)));
EOS
cli_sigint() { # name stub root
  mkdir -p "$TMP/t-$1"
  ( node "$TMP/sigint.mjs" "$3" "$TMP/o-$1" "$2" "$TMP/eval.env" "$TMP/t-$1" "$PLUGIN" "$TMP/o-$1.rc" > /dev/null 2>&1 ) &
}

# Verifier: prints "ok<TAB>name" or "FAIL<TAB>name" per check. Usage: verify.mjs <mode> <run name>
cat > "$TMP/verify.mjs" <<'EOS'
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const [mode, name] = process.argv.slice(2);
const { TMP, TOKEN, CANARY, LIB, PLUGIN, ROOT } = process.env;
const out = [];
const check = (n, ok) => out.push(`${ok ? 'ok' : 'FAIL'}\t${mode}: ${n}`);
const rf = `${TMP}/o-${name}/results.jsonl`;
const wins = (t) => Array.from({ length: TOKEN.length - 11 }, (_, i) => TOKEN.slice(i, i + 12));
const hasWindow = (text) => wins().some((w) => text.includes(w));
const walk = (d) => { const r = []; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) r.push(...walk(p)); else if (e.isFile()) r.push(p); } return r; };
const wsConfigs = (n) => { const d = `${TMP}/t-${n}`; return fs.readdirSync(d).filter((e) => e.startsWith('ab-draw-')).map((e) => path.join(d, e, 'ws/.somi/config.json')).filter((f) => fs.existsSync(f)).map((f) => fs.readFileSync(f, 'utf8')); };
const rows = () => fs.readFileSync(rf, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
try {
if (mode === 'ceil' || mode === 'ceildef') {
  const cfgs = wsConfigs(name); const pinned = mode === 'ceil'; const tier = pinned ? 'low' : 'medium';
  const agents = fs.readdirSync(`${PLUGIN}/agents`).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
  check('both arms\' workspaces carry a config, identical in content', cfgs.length === 2 && cfgs[0] === cfgs[1]);
  const cost = cfgs.length ? JSON.parse(cfgs[0]).cost : {};
  check(`the workspace ceiling is ${tier}`, cost.ceiling === tier);
  check(pinned ? 'every agent in the plugin directory is pinned to the ceiling tier, and nothing else' : 'no agents are pinned by default', pinned ? JSON.stringify(Object.keys(cost.agents ?? {}).sort()) === JSON.stringify(agents) && Object.values(cost.agents).every((v) => v === tier) : cost.agents === undefined);
  const rs = rows();
  check('every results row records ceilingSomi and pinAll', rs.length === 2 && rs.every((x) => x.ceilingSomi === tier && x.pinAll === pinned));
  if (pinned) check('the driver printed the effective ceiling and the pin count', fs.readFileSync(`${TMP}/o-${name}.log`, 'utf8').includes(`cost config (both arms, same content): ceiling low, pin-all on (${agents.length} agents pinned to low)`));
}
if (mode === 'unit') {
  const L = await import(`${LIB}/ab-draw.mjs`); const S = await import(`${LIB}/ab-stream.mjs`); const R = await import(`${LIB}/ab-report.mjs`);
  const task = { statements: ['one', 'two'], source: ['a.mjs', 'src/'], test_dir: 'test', root_files: ['package.json'] };
  const text = L.taskText(task);
  check('task text: preface, statements, scope sentence, nothing else', text === 'Implement the following in this repository.\none\ntwo\nDeclared scope: you may change files under a.mjs, src/, test/ and package.json only.');
  check('the SoMi prompt is the same text behind the ship-loop command', L.armPrompt('somi', text) === `/somi:ship-loop ${text}` && L.armPrompt('bare', text) === text);
  const base = ['--print', 'P', '--output-format', 'stream-json', '--verbose', '--model', 'test-model', '--max-budget-usd', '7.99', '--permission-mode', 'bypassPermissions', '--disallowed-tools', 'WebFetch,WebSearch'];
  check('bare argv has no plugin, disables the web tools, rounds the budget down', JSON.stringify(L.claudeArgv({ model: 'test-model', arm: 'bare', prompt: 'P', budget: 7.999, plugin: '/p' })) === JSON.stringify(base));
  check('SoMi argv adds only the plugin dir; a resume adds the session', JSON.stringify(L.claudeArgv({ model: 'test-model', arm: 'somi', prompt: 'P', budget: 7.999, plugin: '/p', resume: 's' })) === JSON.stringify([...base, '--plugin-dir', '/p', '--resume', 's']));
  check('childEnv has exactly the six allowlisted keys; the fd variant swaps the token for the descriptor', JSON.stringify(Object.keys(L.childEnv({ token: 't', tmp: '/x' })).sort()) === JSON.stringify(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS', 'CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']) && JSON.stringify(Object.keys(L.childEnv({ token: 't', tmp: '/x', tokenFd: true })).sort()) === JSON.stringify(['CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR', 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS', 'CLAUDE_CONFIG_DIR', 'HOME', 'LANG', 'PATH']));
  check('pause heuristic: questions, the checkpoint menu and explicit requests pause', [['Shall I proceed?', 1], ['It surfaced exactly one decision that needs your verdict before it writes the spec.\n- Option A recommended', 1], ['Checkpoint: approve / revise / abort', 1], ['Reply approve to continue.', 1], ['I am waiting for your approval', 1], ['Should I also add tests? Let me know.', 1], ['What a day?" ', 1], ['Sized as `small`.\n\n**Reply to continue:**\n- `approve` to run it as `small`.\n- `small` or `full` to change the tier.\n- `abort` to stop with `sized-aborted`.', 1]].every(([t, w]) => L.looksPaused(t) === Boolean(w)));
  check('pause heuristic: status reports that mention approve, confirmed or proceeded are NOT pauses', ['Done. /code-loop exited on approve; all 12 tests pass.', 'Iteration 1.1 closed. Reviewer verdict: approve (no Blocker/Major).', 'I confirmed the boundary is inclusive and committed the change.', 'Implemented and proceeded to the review stage; shipped.', 'All tests pass.', 'I fixed it. Is it ok? Yes, shipped.', 'The operator replied approve; the loop ran to completion and did not abort.'].every((t) => L.looksPaused(t) === false));
  const d = fs.mkdtempSync(`${TMP}/unit-`);
  const w = (n, c, m) => { fs.writeFileSync(`${d}/${n}`, c, { mode: m }); fs.chmodSync(`${d}/${n}`, m); return `${d}/${n}`; };
  check('env file: accepted with mode 0600 (export and matching quotes allowed)', L.readEnvFile(w('a', 'export CLAUDE_CODE_OAUTH_TOKEN="abcdefghijklmnopqrst"\n', 0o600)).token === 'abcdefghijklmnopqrst');
  check('env file: group-readable, another key, a second line, a short token, a symbol, mismatched quotes are refused without echoing content', ['a=1', 'CLAUDE_CODE_OAUTH_TOKEN=abcdefghijklmnopqrst\nFOO=barbarbarbarbarbar', 'CLAUDE_CODE_OAUTH_TOKEN=short', 'CLAUDE_CODE_OAUTH_TOKEN=abcdefghijklmnop+qrst', 'CLAUDE_CODE_OAUTH_TOKEN="abcdefghijklmnopqrst\''].every((c, i) => { const r = L.readEnvFile(w(`b${i}`, c, 0o600)); return r.ok === false && !JSON.stringify(r).includes('abcdefghij'); }) && L.readEnvFile(w('c', 'CLAUDE_CODE_OAUTH_TOKEN=abcdefghijklmnopqrst', 0o640)).ok === false);
  check('env file: a symlink and a missing file are refused', L.readEnvFile(`${TMP}/eval-link.env`).ok === false && L.readEnvFile(`${d}/none`).ok === false);
  const a = L.seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 1); const b = L.seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 1);
  check('seeded shuffle: same seed same order, a permutation, another seed differs', JSON.stringify(a) === JSON.stringify(b) && [...a].sort().join() === '1,2,3,4,5,6,7,8' && JSON.stringify(a) !== JSON.stringify(L.seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], 2)));
  const T = 'tok_SECRETSECRETSECRETxyz';
  const folded = S.redactToken(`a ${T.slice(0, 14)}\n${T.slice(14)} b ${T}`, T);
  check('redaction: a token cut across a line break and a whole token both lose every 12-character window', !S.tokenHit(folded, T) && folded.startsWith('a ') && !folded.includes('SECRETSECRET'));
  const sinkFile = `${d}/s.jsonl`; const sink = S.createSink(sinkFile, { token: T, canary: 'CANARY1234567890ab', task: 'T1-proration', ownTmp: '/tmp/ab-draw-own' });
  const lines = [{ type: 'system', note: 'tests/evals/ab /tmp/ab-draw-zzz' }, { type: 'user', message: `x ${T} y` }, { type: 'assistant', message: { content: [{ type: 'text', text: 'see sk-ant-api03-ZZZZZZZZ' }] } }].map((o) => `${JSON.stringify(o)}\n`).join('');
  for (let i = 0; i < lines.length; i += 7) sink.feed(Buffer.from(lines.slice(i, i + 7)));
  sink.end(); const saved = fs.readFileSync(sinkFile, 'utf8');
  check('sink: a token split across chunks is flagged and redacted on disk; a prefix secret is redacted; a system event is not path-scanned', JSON.stringify([...sink.state.leaks].sort()) === JSON.stringify(['sk-ant-', 'token']) && !saved.includes('SECRETSECRET') && !saved.includes('ZZZZZZZZ') && saved.includes('[REDACTED]'));
  const s2 = S.createSink(`${d}/s2.jsonl`, { token: T, canary: 'CANARY1234567890ab', task: 'T1-proration', absAb: '/r/tests/evals/ab', ownTmp: '/tmp/ab-draw-own' });
  const ev = (t) => `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: t }] } })}\n`;
  s2.feed(Buffer.from(ev('ls /tmp/ab-draw-own/ws /usr/share/hidden/ and ./hidden/x ok'))); s2.feed(Buffer.from(ev('Did you mean to import "./ab-draw-own/ws/a.mjs"?'))); const fine = [...s2.state.leaks].length === 0;
  s2.feed(Buffer.from(ev('cat T1-proration/hidden/a.mjs'))); s2.feed(Buffer.from(ev('ls /tmp/ab-draw-other/ws'))); s2.feed(Buffer.from(ev('Did you mean "./ab-draw-other/ws/a.mjs"?'))); s2.feed(Buffer.from(ev('cat /r/tests/evals/ab/x')));
  check('path patterns: a bare hidden directory, the own temp directory and its relative spelling are fine; the task hidden path, another draw and the repository path are leaks', fine && JSON.stringify([...s2.state.leaks].sort()) === JSON.stringify(['ab-path', 'other-draw', 'task-hidden']));
  const s3 = S.createSink(`${d}/s3.jsonl`, { token: T, canary: 'CANARY1234567890ab', task: 'T1-proration' });
  s3.feed(Buffer.from(`{"type":"user","message":"${T}`)); s3.turn(); s3.feed(Buffer.from('\n'));
  check('an unterminated last line is processed before the next invocation starts', s3.state.leaks.has('token') && !fs.readFileSync(`${d}/s3.jsonl`, 'utf8').includes('SECRETSECRET'));
  const s4 = S.createSink(`${d}/s4.jsonl`, { token: T, canary: 'CANARY1234567890ab', task: 'T1-proration' });
  const r4 = (c, n) => `{"type":"result","total_cost_usd":${c},"num_turns":${n}}\n`;
  s4.feed(Buffer.from(r4(0.2, 12) + r4(0.2, 2) + r4(0.3, 7))); const t4 = s4.state.turns; const c4 = s4.state.result.total_cost_usd; s4.turn(); s4.feed(Buffer.from(r4(0.7, 4)));
  check('turns add over every result event of a call (one per background wait) and restart with the next call; the last event carries the cost', t4 === 21 && c4 === 0.3 && s4.state.turns === 4);
  const cap = S.createSink(`${d}/c.jsonl`, { token: 't', canary: 'CANARY1234567890ab', task: 'x', maxBytes: 10 }); cap.feed(Buffer.alloc(11, 97));
  check('sink: output over the cap is flagged', cap.state.capped === true);
  const C = (run, arm = 'somi') => L.classify({ run: { cost: 1, resumes: 0, leaks: [], stderr: '', text: '', ...run }, arm, budget: 8 });
  const ok = { subtype: 'success', is_error: false };
  check('classify: scored, over-budget (subtype and cost), paused, auth, timeout, no result, spawn error, leak, cap', JSON.stringify([C({ result: ok }), C({ result: { subtype: 'error_max_budget_usd' } }), C({ result: ok, cost: 9 }), C({ result: ok, text: 'Ok?' }), C({ result: ok, text: 'Ok?' }, 'bare'), C({ result: { ...ok, is_error: true, result: 'Please run /login' } }), C({ timedOut: true }), C({}), C({ error: 'ENOENT' }), C({ result: ok, leaks: ['canary'] }), C({ result: ok, capped: true })].map((c) => `${c.outcome}/${c.reason.split(' ')[0]}`)) === JSON.stringify(['scored/', 'over-budget/budget', 'over-budget/budget', 'paused/still', 'scored/', 'invalid/auth', 'invalid/timeout', 'invalid/no-result', 'invalid/spawn-error:ENOENT', 'invalid/leak:canary', 'invalid/output-cap']));
  check('classify: arbitrary result text mentioning 401 is not an auth failure; the stderr is', C({ result: { subtype: 'error_during_execution', is_error: true, result: 'the page returned 401' } }).outcome === 'scored' && C({ result: { subtype: 'error_during_execution', is_error: true, result: 'x' }, stderr: '401 Unauthorized' }).reason === 'auth');
  const fr = (sc) => { const row = { draw: 'd', outcome: 'scored', reason: '', green: 0 }; return [L.foldScore(row, sc), row.outcome, row.reason]; };
  const good = { ok: true, green: 3, failed: [], timedOut: false, crashed: false, integrity: false, tampered: false, taskChanged: false, truncated: false };
  check('scorer results: ok:false, taskChanged and tampered are invalid AND halt the run; a normal score does not', JSON.stringify([fr({ ok: false, reason: 'r' }), fr({ ...good, taskChanged: true }), fr({ ...good, tampered: true }), fr(good)]) === JSON.stringify([['d: r', 'invalid', 'scorer-fault: r'], ['d: the task changed during the run', 'invalid', 'task-changed'], ['d: the scoring harness was tampered with', 'invalid', 'tampered'], [null, 'scored', '']]));
  const row = (task, arm, g, o = 'scored', order = 0, x = {}) => ({ draw: `${task}-${arm}`, task, arm, noise: false, order, outcome: o, reason: '', green: g, total: 10, costUsd: 1, durationMs: 2000, resumes: 0, scope: { ok: true }, ...x });
  const rows = [row('T1-proration', 'bare', 10), row('T1-proration', 'somi', 10), row('H1-csv-export', 'bare', 5, 'scored', 1), row('H1-csv-export', 'somi', 7, 'scored', 1), row('H4-static-files', 'bare', 4, 'scored', 2), row('H4-static-files', 'somi', 9, 'scored', 2), row('H2-ledger-migration', 'bare', 3, 'scored', 3), row('H2-ledger-migration', 'somi', 8, 'paused', 3), { ...row('T1-proration', 'bare', 9), noise: true }, { ...row('T1-proration', 'bare', 2, 'invalid'), noise: true }];
  const rep = R.buildReport(rows);
  check('report: side task labelled and left out of the pool; controls excluded in a second verdict; noise spread over scored draws only; caveats present', rep.includes('H4-static-files [side]') && /Pooled \(all tasks except the side result H4-static-files\): 3 complete pair\(s\) of 3 task\(s\)/.test(rep) && /excluding controls[^\n]*: 2 complete pair\(s\) of 2 task/.test(rep) && rep.includes('spread 1') && rep.includes('Caveats:') && rep.includes('classed over-budget'));
  check('report: a paused row shows the scorer green next to it', rep.includes('paused (scorer green 8/10)'));
  const pk = fs.readdirSync(PLUGIN).sort(); const pf = walk(PLUGIN).map((p) => path.relative(PLUGIN, p));
  check('the packed plugin has the plugin manifest and hooks but no evals, no manual scripts, no .somi; it is read-only', pk.includes('.claude-plugin') && pk.includes('hooks') && !pf.some((p) => p.startsWith('tests/evals/') || p.startsWith('.somi/') || p.includes('/manual/')) && (fs.statSync(PLUGIN).mode & 0o222) === 0 && (fs.statSync(`${PLUGIN}/package.json`).mode & 0o222) === 0);
} else if (mode === 'disk') {
  const bad = process.env.DIRS.split(':').filter(Boolean).flatMap((d) => walk(d)).filter((f) => { try { return hasWindow(fs.readFileSync(f, 'latin1')); } catch { return false; } });
  check('no 12-character window of the token is in any output, log, stream, workspace or temp file of any run', bad.length === 0);
} else if (mode === 'sandbox') {
  const L = await import(`${LIB}/ab-draw.mjs`);
  const claudeReal = L.resolveBinary('claude') ?? process.execPath; const node = process.execPath;
  const draw = fs.mkdtempSync('/tmp/ab-draw-'); const sib = fs.mkdtempSync('/tmp/ab-draw-'); fs.writeFileSync(`${sib}/f`, 'x');
  fs.writeFileSync(`${draw}/probe.js`, `const fs=require('fs'),cp=require('child_process');const e=process.env;const ex=(p)=>fs.existsSync(p);const wr=(p)=>{try{fs.writeFileSync(p,'1');return true}catch{return false}};
cp.spawn('setsid',['sleep',e.SLEEP],{stdio:'ignore',detached:true}).unref();
console.log(JSON.stringify({repo:ex(e.REPO+'/package.json'),dotclaude:ex(e.REAL_HOME+'/.claude'),ssh:ex(e.REAL_HOME+'/.ssh'),sib:ex(e.SIB+'/f'),draw:wr(e.DRAW+'/w'),plugin:ex(e.PLUGIN+'/package.json'),pluginWritable:wr(e.PLUGIN+'/w'),git:cp.spawnSync('git',['--version']).status,claude:ex(e.CB),home:wr(e.REAL_HOME+'/zz')}));`);
  const spec = L.sandboxSpec({ home: process.env.HOME, repoRoot: ROOT, claudeReal, plugin: PLUGIN }); spec.ro.push(path.dirname(fs.realpathSync(node)));
  const sleep = `47${process.pid % 1000 + 100}`;
  const r = spawnSync('bwrap', L.sandboxArgs({ ...spec, rw: [draw] }, node, [`${draw}/probe.js`]), { encoding: 'utf8', env: { PATH: process.env.PATH, REAL_HOME: process.env.HOME, REPO: ROOT, SIB: sib, DRAW: draw, PLUGIN, CB: claudeReal, SLEEP: sleep } });
  const j = JSON.parse(r.stdout.trim().split('\n').pop() || '{}');
  check('inside the sandbox the repository, ~/.claude, ~/.ssh and another draw directory are not visible', j.repo === false && j.dotclaude === false && j.ssh === false && j.sib === false);
  check('inside the sandbox the draw directory is writable, the plugin readable but not writable, node, git and the claude binary resolve', j.draw === true && j.plugin === true && j.pluginWritable === false && j.git === 0 && j.claude === true);
  check('a process the agent leaves behind (new session) dies with the sandbox leader', spawnSync('pgrep', ['-f', `sleep ${sleep}`]).status === 1);
  fs.rmSync(draw, { recursive: true, force: true }); fs.rmSync(sib, { recursive: true, force: true });
} else {
  const rc = Number(fs.readFileSync(`${TMP}/o-${name}.rc`, 'utf8'));
  const log = () => fs.readFileSync(`${TMP}/o-${name}.log`, 'utf8');
  if (mode === 'envmode') { check('a group-readable env file is refused before any draw (exit 2, no results)', rc === 2 && !fs.existsSync(rf) && /group or others/.test(fs.readFileSync(`${TMP}/o-${name}.err`, 'utf8'))); }
  else {
    const rows = fs.readFileSync(rf, 'utf8').trim().split('\n').map(JSON.parse);
    const bare = rows.find((r) => r.arm === 'bare'); const somi = rows.find((r) => r.arm === 'somi');
    const calls = (r) => fs.readFileSync(`${r.tmp}/argv.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
    const both = (f) => [bare, somi].every(f);
    check('one row per arm, no token anywhere in results.jsonl', rows.length === 2 && bare && somi && !fs.readFileSync(rf, 'utf8').includes(TOKEN));
    if (mode === 'budget-stop') check('after the first draw the next one would not fit the total: it is recorded as budget-stop, not run', rows.filter((r) => r.outcome === 'budget-stop').length === 1 && rows.filter((r) => r.outcome === 'scored').length === 1 && /not run \(budget stop\) 1/.test(log()));
    else if (mode === 'task-changed') check('a task that changed since admission is a scorer fault: the draw is invalid, the run halts (exit 1) and the next draw is not run', rc === 1 && rows.filter((r) => /^scorer-fault/.test(r.reason)).length === 1 && rows.filter((r) => r.outcome === 'budget-stop' && r.reason === 'halted').length === 1);
    else if (mode === 'solve') {
      check('a correct solution (canary stripped) scores every hidden test in both arms, in scope, cost and time recorded', both((r) => r.outcome === 'scored' && r.green === r.total && r.total > 0 && r.scope.ok === true && r.costUsd === 0.5 && r.durationMs > 0 && r.turns === 3 && r.models.join() === 'stub-usage-key'));
      const [b0] = calls(bare); const [s0] = calls(somi);
      check('bare argv: the task text only, the fixed flags, the web tools disabled, no plugin', b0.slice(2).join(' ') === '--output-format stream-json --verbose --model test-model --max-budget-usd 8.00 --permission-mode bypassPermissions --disallowed-tools WebFetch,WebSearch' && !b0.includes('--plugin-dir') && b0[1].startsWith('Implement the following in this repository.\n') && b0[1].includes('Declared scope: you may change files under prorate.mjs, test/ and package.json only.'));
      check('SoMi argv: the same text behind /somi:ship-loop, the same flags, the packed plugin (not the checkout) only here', s0[1] === `/somi:ship-loop ${b0[1]}` && s0.slice(2, 13).join(' ') === b0.slice(2).join(' ') && s0.slice(13).join('|') === `--plugin-dir|${PLUGIN}` && PLUGIN !== ROOT);
      check('the prompt carries neither the canary nor a hidden or oracle path', ![b0[1], s0[1]].some((p) => p.includes(CANARY) || /hidden|oracle|tests\/evals/.test(p)));
      const env = JSON.parse(fs.readFileSync(`${bare.tmp}/env.json`, 'utf8')); const envS = JSON.parse(fs.readFileSync(`${somi.tmp}/env.json`, 'utf8'));
      check('child env: exactly the allowlisted keys, no host variable, the token only as CLAUDE_CODE_OAUTH_TOKEN', both((r) => { const e = r === bare ? env : envS; return Object.keys(e).sort().join() === 'CLAUDE_CODE_OAUTH_TOKEN,CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS,CLAUDE_CONFIG_DIR,HOME,LANG,PATH' && e.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS === '0' && e.HOME === r.tmp && e.CLAUDE_CONFIG_DIR === `${r.tmp}/cfg` && e.CLAUDE_CODE_OAUTH_TOKEN === '<TOKEN>' && !JSON.stringify(e).includes('leak-me') && Object.values(e).filter((v) => v === '<TOKEN>').length === 1; }));
      const cfgOf = (r) => fs.readFileSync(`${r.tmp}/ws/.somi/config.json`, 'utf8');
      check('both workspaces are identical git repos with the ceiling config and one commit', both((r) => cfgOf(r) === '{"cost":{"ceiling":"medium"}}\n' && spawnSync('git', ['-C', `${r.tmp}/ws`, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).stdout.trim() === '1' && !fs.existsSync(`${r.tmp}/ws/.git/hooks`) && fs.readdirSync(`${r.tmp}/ws`).sort().join() === '.git,.somi,package.json,prorate.mjs'));
      const st = (p) => (fs.statSync(p).mode & 0o777).toString(8);
      check('stream file 0600, draw directory 0700, workspace outside the output directory, the session directory emptied', both((r) => st(`${TMP}/o-${name}/${r.draw}/stream.jsonl`) === '600' && st(`${TMP}/o-${name}/${r.draw}`) === '700' && !r.tmp.startsWith(`${TMP}/o-`) && !fs.existsSync(`${r.tmp}/cfg/projects`)));
      check('the report renders from the results file', /Pooled \(all tasks except the side result[^\n]*1 complete pair\(s\)/.test(log()) && /Caveats:/.test(fs.readFileSync(`${TMP}/o-${name}/report.txt`, 'utf8')));
      check('the plan states the hard time bound and the sandbox status', /hard bound/.test(log()) && /sandbox/i.test(log()));
    } else if (mode === 'fd') {
      const e = JSON.parse(fs.readFileSync(`${somi.tmp}/env.json`, 'utf8')); const f = JSON.parse(fs.readFileSync(`${somi.tmp}/fd.json`, 'utf8'));
      check('--token-fd: the token reaches the child only through descriptor 3, the environment holds the descriptor variable and no token', both((r) => r.outcome === 'scored') && Object.keys(e).sort().join() === 'CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR,CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS,CLAUDE_CONFIG_DIR,HOME,LANG,PATH' && e.CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR === '3' && !Object.values(e).includes('<TOKEN>') && f.match === true);
    } else if (mode === 'limit-event' || mode === 'limit-text') {
      const hit = rows.find((r) => r.reason === 'account-limit'); const stop = rows.find((r) => r.outcome === 'budget-stop');
      check('an exhausted usage window (rejected event, or only the success text) is invalid account-limit, never resumed, halts the run, the other draw is not run', rc === 1 && hit && hit.outcome === 'invalid' && stop && stop.reason === 'account-limit' && calls(hit).length === 1 && hit.resumes === 0 && (mode === 'limit-event' || /1:50am/.test(hit.resetText ?? '')));
      check('the report says when to re-run', /account-limit: re-run after/.test(log()) && (mode === 'limit-event' || log().includes('re-run after 1:50am')));
    } else if (mode === 'bg-ceiling') {
      const hit = rows.find((r) => r.reason === 'bg-wait-ceiling'); const stop = rows.find((r) => r.outcome === 'budget-stop');
      check('a session ended by the CLI background-wait ceiling is invalid bg-wait-ceiling (not scored), halts the run, the other draw is not run, the report says so', rc === 1 && hit && hit.outcome === 'invalid' && stop && stop.reason === 'bg-wait-ceiling' && /bg-wait-ceiling: the CLI ended the session/.test(log()));
    } else if (mode === 'perarm') {
      const cs = calls(somi); const cb = calls(bare); const cap = (c) => c[c.indexOf('--max-budget-usd') + 1];
      check('per-arm cap: the bare arm keeps --budget-per-draw, the SoMi first call and its resume use --budget-somi (cap minus spend)', cap(cb[0]) === '8.00' && cap(cs[0]) === '5.00' && cap(cs[1]) === '4.50' && /2 draw|bare x \$8 \+ 1 SoMi x \$5 = \$13\.00/.test(log()) && bare.outcome === 'scored' && somi.outcome === 'scored');
    } else if (mode === 'perarm-time') check('per-arm time: only the SoMi deadline (--timeout-somi-min) cuts the SoMi draw; the bare arm keeps --timeout-min', somi.outcome === 'invalid' && somi.reason === 'timeout' && bare.outcome === 'scored');
    else if (mode === 'over-budget') check('subtype error_max_budget_usd is over-budget in both arms and still scored', both((r) => r.outcome === 'over-budget' && r.green < r.total));
    else if (mode === 'leak') check('a canary, an oracle path, a hidden path and tests/evals/ab in a tool result make the draw invalid and name the patterns', both((r) => r.outcome === 'invalid' && /^leak:/.test(r.reason) && ['canary', 'task-oracle', 'task-hidden', 'ab-path'].every((p) => r.reason.includes(p))) && !somi.reason.includes(CANARY));
    else if (mode === 'silent-copy') check('an oracle file copied with its canary intact is a leak even though the stream is clean', both((r) => r.outcome === 'invalid' && r.reason === 'leak:canary-in-file'));
    else if (mode === 'hang') {
      check('a hung draw is invalid with reason timeout in both arms, charged its whole cap as an estimate', both((r) => r.outcome === 'invalid' && r.reason === 'timeout' && r.costUsd === 8 && r.costEstimated === true));
      check('no process of the draw survives (the sleep the stub started is gone)', spawnSync('pgrep', ['-f', `sleep ${process.env.SLEEP}`]).status === 1);
    } else if (mode === 'setsid') {
      check('a stray that left the process group and holds stdout neither hangs the driver nor survives; the draw is scored', both((r) => r.outcome === 'scored' && r.green === r.total) && spawnSync('pgrep', ['-f', `sleep ${process.env.SLEEP}`]).status === 1);
    } else if (mode === 'sigint') {
      check('SIGINT: exit 130, every in-flight draw is recorded as interrupted, no process survives', rc === 130 && both((r) => r.outcome === 'invalid' && r.reason === 'interrupted') && spawnSync('pgrep', ['-f', `sleep ${process.env.SLEEP}`]).status === 1);
    } else if (mode === 'slowpause') check('one deadline covers all turns of a draw: the resumed turn is cut off (timeout) although each call alone fits', somi.outcome === 'invalid' && somi.reason === 'timeout' && somi.resumes === 1 && bare.outcome === 'scored');
    else if (mode === 'pause') {
      check('SoMi: one question, one resume, then the solution scores; bare is never resumed', somi.outcome === 'scored' && somi.resumes === 1 && somi.green === somi.total && bare.resumes === 0 && bare.outcome === 'scored' && bare.green < bare.total);
      const c = calls(somi);
      check('the resume uses --resume with the session, the approval text, the remaining budget and the same flags', c.length === 2 && c[1][1] === 'Approved. Continue to completion without further questions.' && c[1].includes('--resume') && c[1][c[1].indexOf('--resume') + 1] === 'sess-p' && c[1][c[1].indexOf('--max-budget-usd') + 1] === '7.50' && c[1].includes('--plugin-dir') && c[1].includes('--disallowed-tools') && somi.costUsd === 1 && calls(bare).length === 1);
    } else if (mode === 'pause-forever') check('a SoMi arm that keeps asking is paused after exactly 4 resumes (5 calls) and the scorer green is kept; the bare arm is scored', somi.outcome === 'paused' && somi.resumes === 4 && calls(somi).length === 5 && Number.isInteger(somi.green) && bare.outcome === 'scored' && bare.resumes === 0);
    else if (mode === 'pause-costly') check('when too little budget is left to resume, the draw is over-budget and no resume is made', somi.outcome === 'over-budget' && somi.resumes === 0 && calls(somi).length === 1 && bare.outcome === 'scored');
    else if (mode === 'token-echo') {
      const s = fs.readFileSync(`${TMP}/o-${name}/${somi.draw}/stream.jsonl`, 'utf8');
      check('a token printed by the agent flags the draw and is redacted in the saved stream', both((r) => r.outcome === 'invalid' && r.reason === 'leak:token') && !s.includes(TOKEN) && s.includes('[REDACTED]'));
    } else if (mode === 'fold') {
      const all = [`${TMP}/o-${name}`, `${TMP}/t-${name}`].flatMap(walk);
      check('a token folded across lines, written into a session transcript and into a workspace file is flagged, and no window of it is left on disk', both((r) => r.outcome === 'invalid' && r.reason === 'leak:token') && !all.some((f) => hasWindow(fs.readFileSync(f, 'latin1'))));
      check('the session directory is deleted and a redacted transcript copy is kept; the workspace file is redacted in place', both((r) => !fs.existsSync(`${r.tmp}/cfg/projects`) && fs.readFileSync(`${TMP}/o-${name}/${r.draw}/transcripts/1.jsonl`, 'utf8').includes('[REDACTED]') && fs.readFileSync(`${r.tmp}/ws/notes.txt`, 'utf8').includes('[REDACTED]')));
    } else if (mode === 'auth-fail') check('an authentication failure is invalid with reason auth', both((r) => r.outcome === 'invalid' && r.reason === 'auth'));
    else if (mode === 'auth-text') check('a failed call whose result text merely mentions 401 is not an auth failure', both((r) => r.outcome === 'scored'));
    else if (mode === 'spawn-error') check('a claude binary that cannot start is invalid with a spawn-error reason and costs nothing', both((r) => r.outcome === 'invalid' && /^spawn-error:ENOENT$/.test(r.reason) && r.costUsd === 0));
  }
}
} catch (e) { out.push(`FAIL\t${mode}: verifier error ${String(e?.message ?? e).slice(0, 160)}`); }
console.log(out.join('\n'));
EOS
verify() { TMP="$TMP" TOKEN="$TOKEN" CANARY="$CANARY" LIB="$1/tests/evals/lib" PLUGIN="$PLUGIN" ROOT="$ROOT" SLEEP="${4:-}" DIRS="${5:-}" node "$TMP/verify.mjs" "$2" "$3" 2>&1; }

# ---- normal runs ------------------------------------------------------------------------------------------------
MODES="solve over-budget leak silent-copy hang setsid pause pause-forever pause-costly token-echo fold auth-fail auth-text"
for m in $MODES; do
  extra=(); case "$m" in hang|setsid) extra=(--timeout-min 0.1) ;; esac
  [ "$m" = hang ] && extra=(--timeout-min 0.03)
  cli "$m" "$ROOT" "$(mkstub "$m" "$m" 41001)" "$TMP/eval.env" "${extra[@]}"
done
cli ceil "$ROOT" "$(mkstub ceil solve 0)" "$TMP/eval.env" --ceiling-somi low --pin-all
cli slowpause "$ROOT" "$(mkstub slowpause slowpause 0)" "$TMP/eval.env" --timeout-min 0.1
cli limit-event "$ROOT" "$(mkstub limit-event limit-event 0)" "$TMP/eval.env" --concurrency 1
cli limit-text "$ROOT" "$(mkstub limit-text limit-text 0)" "$TMP/eval.env" --concurrency 1
cli bg-ceiling "$ROOT" "$(mkstub bg-ceiling bg-ceiling 0)" "$TMP/eval.env" --concurrency 1
cli perarm "$ROOT" "$(mkstub perarm pause 0)" "$TMP/eval.env" --budget-somi 5
cli perarm-time "$ROOT" "$(mkstub perarm-time slowpause 0)" "$TMP/eval.env" --timeout-min 5 --timeout-somi-min 0.1
cli fd "$ROOT" "$(mkstub fd fd 0)" "$TMP/eval.env" --token-fd
cli spawn-error "$ROOT" "$TMP/no-such-claude" "$TMP/eval.env"
cli envmode "$ROOT" "$(mkstub envmode solve 0)" "$TMP/eval644.env"
cli envlink "$ROOT" "$(mkstub envlink solve 0)" "$TMP/eval-link.env"
cli budget-stop "$ROOT" "$(mkstub budget-stop solve 0)" "$TMP/eval.env" --budget-total 8.2 --force-budget --concurrency 1
scratch halt; cli task-changed "$TMP/halt" "$(mkstub task-changed task-changed 0 "$TMP/halt/tests/evals/ab/T1-proration")" "$TMP/eval.env" --force-budget --concurrency 1
cli_sigint sigint "$(mkstub sigint hang 41002)" "$ROOT"
# ---- mutants: each guard broken on a scratch copy; its mode's checks must then fail ------------------------------------
nm=0; mnames=(); mmodes=(); mlabels=()
apply() { M_FILE="$1" M_FROM="$2" M_TO="$3" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; }
mutant() { # mode file from to label [from2 to2]
  local n="mu$((++nm))"; scratch "$n"; local d="$TMP/$n"
  if ! apply "$d/$2" "$3" "$4" || { [ -n "${6:-}" ] && ! apply "$d/$2" "$6" "$7"; }; then mnames+=("$n"); mmodes+=(BAD); mlabels+=("$5"); return; fi
  mnames+=("$n"); mmodes+=("$1"); mlabels+=("$5")
  local extra=() envf="$TMP/eval.env" sm="$1" sl="41$((100 + nm))"
  case "$1" in ceil) sm=solve; extra=(--ceiling-somi low --pin-all) ;; hang) extra=(--timeout-min 0.03) ;; setsid) extra=(--timeout-min 0.1) ;; slowpause) extra=(--timeout-min 0.1) ;; envmode) envf="$TMP/eval644.env"; sm=solve ;; esac
  [ "$1" = fd ] && extra=(--token-fd)
  if [ "$1" = sigint ]; then cli_sigint "$n" "$(mkstub "$n" hang "$sl")" "$d"; else cli "$n" "$d" "$(mkstub "$n" "$sm" "$sl")" "$envf" "${extra[@]}"; fi
}
DR=tests/evals/lib/ab-draw.mjs; ST=tests/evals/lib/ab-stream.mjs
mutant leak $ST "['ab-path', 'tests/evals/ab'], " "" "the tests/evals/ab path pattern"
mutant leak $ST "if (raw.includes(canary)) s.leaks.add('canary');" "" "the canary pattern"
mutant leak $ST '['"'"'task-oracle'"'"', `${task}/oracle`], ' "" "the task oracle path pattern"
mutant leak $ST '['"'"'task-hidden'"'"', `${task}/hidden`], ' "" "the task hidden path pattern"
mutant token-echo $ST "if (tokenHit(raw, token)) s.leaks.add('token');" "" "the token scan"
mutant token-echo $ST "fs.writeSync(fd, \`\${redactToken(raw, token)}\\n\`);" "fs.writeSync(fd, \`\${raw}\\n\`);" "stream redaction"
mutant fold $ST "const WIN = 12;" "const WIN = 40;" "window redaction (folded token)"
mutant fold $ST "for (const f of list) if (redactInPlace(f, token)) leaks.add('token');" "" "in-place redaction of workspace and config files"
mutant fold $ST "fs.rmSync(proj, { recursive: true, force: true });" "" "the session transcripts are deleted"
mutant silent-copy $ST "else if (b.includes(canary)) leaks.add('canary-in-file');" "" "the canary search in workspace files"
mutant setsid $ST "if (Buffer.concat([Buffer.from('\\0'), fs.readFileSync(\`/proc/\${pid}/environ\`)]).includes(needle)) { process.kill(Number(pid), 'SIGKILL'); killed++; }" "" "the sweep of leftover processes"
mutant setsid $DR "timers.push(setTimeout(release, 2000));" "" "a held pipe is released after the leader exits"
mutant hang $DR "try { process.kill(-child.pid, 'SIGKILL'); }" "try { child.kill('SIGKILL'); }" "the process group is killed (sweep also off)" "await sweepProcesses(" "void ("
mutant hang $DR "if (run.timedOut) return inv('timeout');" "" "timeout is invalid"
mutant slowpause $DR "timeoutMs: deadline - Date.now()" "timeoutMs" "one deadline for all turns"
mutant fd $DR "return tokenFd ? { ...base" "return false ? { ...base" "the fd variant leaves the token out of the environment"
mutant solve $DR "PATH: process.env.PATH ?? '', LANG" "...process.env, PATH: process.env.PATH ?? '', LANG" "the environment allowlist"
mutant solve $DR "...(arm === 'somi' ? ['--plugin-dir', plugin] : [])" "'--plugin-dir', plugin" "the plugin flag is SoMi-only"
mutant solve $DR "'--disallowed-tools', 'WebFetch,WebSearch', " "" "the web tools are disabled"
mutant solve $DR "(arm === 'somi' ? \`/somi:ship-loop \${text}\` : text)" "text" "the ship-loop prefix"
mutant over-budget $DR "r.subtype === 'error_max_budget_usd' || " "" "over-budget from the result subtype"
mutant pause-forever $DR "run.resumes >= maxResumes" "false" "the resume cap"
mutant pause $DR "|| !looksPaused(sink.state.text) ||" "|| true ||" "a pause is resumed"
mutant pause $DR "budget: budget - run.cost" "budget: budget" "the resume gets the remaining budget"
mutant pause-costly $DR "if (budget - run.cost < MIN_REMAINING_USD)" "if (false)" "no resume without budget left"
mutant auth-fail $DR "if (r.is_error && (AUTH_STDERR.test(run.stderr)" "if (false && (AUTH_STDERR.test(run.stderr)" "auth failure is invalid"
mutant auth-text $DR "|| /please run \\/login/i.test(String(r.result ?? '')))) return inv('auth');" "|| true)) return inv('auth');" "auth is not read from arbitrary result text"
mutant envmode $DR "(l.mode & 0o077) !== 0" "false" "the env file mode check"
mutant task-changed tests/scripts/manual/ab-experiment.mjs "if (halt) st.halt = halt;" "" "a scorer halt stops the run"
mutant task-changed $DR "return \`\${row.draw}: \${sc.reason}\`; }" "return null; }" "a scorer fault halts"
mutant fd $DR "fdToken: tokenFd ? token : null" "fdToken: null" "the token fd is written"
mutant hang tests/scripts/manual/ab-experiment.mjs "if (!run.result && !run.error) Object.assign(row, { costUsd: capOf(d.arm), costEstimated: true });" "" "a draw without a result is charged its cap"
mutant limit-event $DR "if (run.limit) return inv('account-limit');" "" "an exhausted usage window is invalid"
mutant limit-event $DR "if (sink.state.limit || arm" "if (arm" "no resume on an exhausted window"
mutant limit-event $ST "test(raw)) s.limit = true;" "test(raw)) s.limit = false;" "the rejected rate-limit event"
mutant limit-text $ST "if (typeof t === 'string' && LIMIT_TEXT.test(t))" "if (false)" "the limit text"
mutant limit-text tests/scripts/manual/ab-experiment.mjs "st.stopReason = row.reason; st.halt = " "st.halt = " "an exhausted window halts the run"
mutant bg-ceiling $DR "if (/Background tasks still running after/.test(run.stderr)) return inv('bg-wait-ceiling');" "" "the background-wait ceiling is invalid"
mutant bg-ceiling tests/scripts/manual/ab-experiment.mjs "row.reason === 'account-limit' || row.reason === 'bg-wait-ceiling')" "row.reason === 'account-limit')" "the background-wait ceiling halts the run"
mutant solve $DR ", CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' };" " };" "the background-wait ceiling is lifted in the child environment"
mutant perarm tests/scripts/manual/ab-experiment.mjs "arm === 'somi' ? args.budgetSomi : args.budgetPerDraw" "args.budgetPerDraw" "the SoMi arm's own dollar cap"
mutant perarm-time tests/scripts/manual/ab-experiment.mjs "arm === 'somi' ? args.timeoutSomiMin : args.timeoutMin" "args.timeoutMin" "the SoMi arm's own time limit"
mutant ceil tests/scripts/manual/ab-experiment.mjs "cost.agents = Object.fromEntries(names.map((n) => [n, ceiling]));" "" "--pin-all writes the agent pins"
mutant ceil tests/scripts/manual/ab-experiment.mjs "prepareWorkspace({ taskDir: t.dir, tmp, cost })" "prepareWorkspace({ taskDir: t.dir, tmp })" "the workspace carries the chosen ceiling"
mutant sigint tests/scripts/manual/ab-experiment.mjs "for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'])" "for (const sig of ['SIGTERM'])" "SIGINT is handled"

wait
pass=0; fail=0
tally() { while IFS=$'\t' read -r status name; do case "$status" in ok) pass=$((pass+1)); printf '  ok   %s\n' "$name" ;; FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;; *) [ -n "$status" ] && { fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name"; } ;; esac; done; }
tally < <(verify "$ROOT" unit unit)
tally < <(verify "$ROOT" ceil ceil)
tally < <(verify "$ROOT" ceildef solve)
for m in $MODES bg-ceiling limit-event limit-text perarm perarm-time fd slowpause spawn-error envmode budget-stop task-changed; do tally < <(verify "$ROOT" "$m" "$m" 41001); done
tally < <(verify "$ROOT" sigint sigint 41002)
real=(); for p in "$TMP"/o-* "$TMP"/t-*; do case "${p##*/}" in ?-mu[0-9]*|*.log|*.err|*.rc) ;; *) [ -d "$p" ] && real+=("$p") ;; esac; done
tally < <(verify "$ROOT" disk disk 0 "$(IFS=:; echo "${real[*]}")")
if command -v bwrap > /dev/null && bwrap --ro-bind / / --unshare-pid --die-with-parent -- true 2> /dev/null; then tally < <(verify "$ROOT" sandbox sandbox); else echo "  skip sandbox test: bubblewrap is not usable on this host (the driver would refuse a live run here)"; fi

# ---- plan, dry run and CLI refusals (no draw is started) -----------------------------------------------------------------
G="node tests/scripts/manual/ab-experiment.mjs"
mkdir -p "$TMP/badagents/agents"; : > "$TMP/badagents/agents/Bad_Name.md"
refuse() { # label expected-text args...  -> exit 2, the text on stderr, nothing started
  local label=$1 want=$2; shift 2
  "$@" > "$TMP/r.log" 2> "$TMP/r.err"; rc=$?
  if [ "$rc" -eq 2 ] && grep -q -- "$want" "$TMP/r.err"; then pass=$((pass+1)); echo "  ok   $label"; else fail=$((fail+1)); echo "  FAIL $label (rc $rc: $(head -c 200 "$TMP/r.err"))"; fi
}
refuse "a run without --model is refused" "--model <alias> is required" $G --dry-run
refuse "a model value starting with a dash or holding a symbol is refused" "needs a value" $G --model --dry-run
refuse "a model alias with a shell symbol is refused" "--model <alias> is required" $G --model 'a;b' --dry-run
refuse "a flag value that looks like a flag is refused" "needs a value" $G --model test-model --out --dry-run
refuse "an unknown flag is refused" "unknown argument" $G --model test-model --bogus
refuse "a duplicate task name is refused" "each task once" $G --model test-model --tasks T1-proration,T1-proration --dry-run
mkdir -p "$TMP/o-full"; echo x > "$TMP/o-full/f"
refuse "a non-empty --out is refused" "is not empty" $G --model test-model --out "$TMP/o-full" --tasks T1-proration --only T1-proration:bare --env-file "$TMP/eval.env" --sandbox off --claude "$TMP/no-such-claude" --plugin-dir "$PLUGIN"
refuse "the real claude without a sandbox is refused unless --unsafe-no-sandbox" "needs --unsafe-no-sandbox" $G --model test-model --out "$TMP/o-nosb" --tasks T1-proration --only T1-proration:bare --env-file "$TMP/eval.env" --sandbox off
refuse "a plan over the total budget is refused before anything starts (worst case printed)" "exceeds --budget-total" $G --model test-model --out "$TMP/o-plan" --budget-total 50 --env-file "$TMP/eval.env"
grep -Eq 'worst case: [0-9]+ bare x [$]8 [+] [0-9]+ SoMi x [$]8 = ' "$TMP/r.log" 2>/dev/null; [ ! -e "$TMP/o-plan" ] && { pass=$((pass+1)); echo "  ok   the worst case was printed and no output directory was made"; } || { fail=$((fail+1)); echo "  FAIL plan output"; }
refuse "a token already in the driver's own environment is refused" "already in the environment" env CLAUDE_CODE_OAUTH_TOKEN="$TOKEN" $G --model test-model --dry-run
mkdir "$TMP/t-dry"; TMPDIR="$TMP/t-dry" $G --model test-model --dry-run --force-budget --budget-total 50 --tasks T1-proration,H4-static-files --out "$TMP/o-dry" --claude "$TMP/no-such-claude" > "$TMP/dry.log" 2>&1; rc=$?
if [ "$rc" -eq 0 ] && grep -q "prepared H4-static-files-somi: " "$TMP/dry.log" && grep -q "dry run: no claude call" "$TMP/dry.log" && [ ! -e "$TMP/o-dry" ] && [ -z "$(ls -A "$TMP/t-dry")" ]; then pass=$((pass+1)); echo "  ok   dry run: workspaces (setup included) are prepared and removed, no claude call, no results"; else fail=$((fail+1)); echo "  FAIL dry run (rc $rc)"; fi
$G --model test-model --dry-run --tasks H1-csv-export,H7-wikilinks --budget-per-draw 8 --budget-somi 24 --timeout-somi-min 60 > "$TMP/dry2.log" 2>&1; rc=$?
if [ "$rc" -eq 0 ] && grep -q 'worst case: 2 bare x \$8 + 2 SoMi x \$24 = \$64.00' "$TMP/dry2.log" && grep -q 'SoMi draw 60 min' "$TMP/dry2.log" && ! grep -q noise "$TMP/dry2.log"; then pass=$((pass+1)); echo "  ok   per-arm limits are accepted and summed in the plan; no noise draws when --tasks is given"; else fail=$((fail+1)); echo "  FAIL per-arm plan (rc $rc)"; fi
# ---- --ceiling-somi / --pin-all: validation, plan output, tolerance of old rows (no draw is started) ------------------------
refuse "a ceiling tier outside low|medium|high is refused" "--ceiling-somi must be one of" $G --model test-model --dry-run --ceiling-somi turbo
refuse "--ceiling-somi without a value is refused" "needs a value" $G --model test-model --dry-run --ceiling-somi
refuse "an agent file name outside the shared agent-name pattern is refused under --pin-all" "cost config is not valid" $G --model test-model --dry-run --tasks T1-proration --pin-all --plugin-dir "$TMP/badagents"
$G --model test-model --dry-run --tasks T1-proration > "$TMP/dc1.log" 2>&1; rc1=$?
$G --model test-model --dry-run --tasks T1-proration --ceiling-somi low --pin-all > "$TMP/dc2.log" 2>&1; rc2=$?
nag="$(ls agents/*.md | wc -l)"
if [ "$rc1" -eq 0 ] && [ "$rc2" -eq 0 ] \
  && grep -qxF 'cost config (both arms, same content): ceiling medium, pin-all off (0 agents pinned)' "$TMP/dc1.log" \
  && grep -qxF "cost config (both arms, same content): ceiling low, pin-all on ($nag agents pinned to low)" "$TMP/dc2.log"; then pass=$((pass+1)); echo "  ok   dry run prints the effective ceiling and the number of pinned agents (default medium / off)"; else fail=$((fail+1)); echo "  FAIL dry-run cost line ($rc1/$rc2: $(grep 'cost config' "$TMP/dc1.log" "$TMP/dc2.log"))"; fi
  # The names come from the shipped mapping, so this test holds no model name of its own.
  MODEL_RE="$(node -e 'import("./scripts/lib/cost-model.mjs").then(m=>console.log(Object.values(m.HOST_MODELS).flatMap(Object.values).join("|")))')"
  if [ -n "$MODEL_RE" ] && ! grep -qiE "$MODEL_RE" "$TMP/dc1.log" "$TMP/dc2.log" tests/scripts/manual/ab-experiment.mjs tests/evals/lib/ab-draw.mjs; then pass=$((pass+1)); echo "  ok   the driver and its output name no model"; else fail=$((fail+1)); echo "  FAIL a model name appears in the driver or its output"; fi
mkdir -p "$TMP/pd/agents" && : > "$TMP/pd/agents/alpha.md" && : > "$TMP/pd/agents/beta-two.md" && : > "$TMP/pd/agents/notes.txt"
$G --model test-model --dry-run --tasks T1-proration --ceiling-somi high --pin-all --plugin-dir "$TMP/pd" > "$TMP/dc3.log" 2>&1
grep -qxF 'cost config (both arms, same content): ceiling high, pin-all on (2 agents pinned to high)' "$TMP/dc3.log" && { pass=$((pass+1)); echo "  ok   the pinned names come from the plugin directory in use"; } || { fail=$((fail+1)); echo "  FAIL pins from --plugin-dir: $(grep 'cost config' "$TMP/dc3.log")"; }
# Rows written before the two fields existed still report, and so do rows that carry them.
printf '%s\n' '{"draw":"T1-proration-bare","task":"T1-proration","arm":"bare","noise":false,"order":0,"outcome":"scored","reason":"","green":3,"total":3,"costUsd":1,"durationMs":1000,"scope":{"ok":true}}' > "$TMP/old.jsonl"
sed 's/"order":0/"order":0,"ceilingSomi":"low","pinAll":true/' "$TMP/old.jsonl" > "$TMP/new.jsonl"
$G --report-only "$TMP/old.jsonl" > "$TMP/ro1.log" 2>&1; r1=$?; $G --report-only "$TMP/new.jsonl" > "$TMP/ro2.log" 2>&1; r2=$?
if [ "$r1" -eq 0 ] && [ "$r2" -eq 0 ] && cmp -s "$TMP/ro1.log" "$TMP/ro2.log"; then pass=$((pass+1)); echo "  ok   a results file without ceilingSomi/pinAll reports, and identically to one that has them"; else fail=$((fail+1)); echo "  FAIL report on old/new rows ($r1/$r2)"; fi

if [ "$(cat "$TMP/o-envlink.rc" 2>/dev/null)" = 2 ] && [ ! -e "$TMP/o-envlink/results.jsonl" ]; then pass=$((pass+1)); echo "  ok   an env file that is a symlink is refused"; else fail=$((fail+1)); echo "  FAIL symlinked env file"; fi
if node -e "const r=require('fs').readFileSync(process.argv[1],'utf8').split('\n').filter(Boolean).map(JSON.parse);process.exit(r.length===2&&r.every((x)=>x.phase==='experiment')&&r.find((x)=>x.arm==='somi').computedTier===null?0:1)" "$TMP/o-solve/results.jsonl"; then pass=$((pass+1)); echo "  ok   an old-corpus run defaults to the experiment phase on every row"; else fail=$((fail+1)); echo "  FAIL old-corpus default phase"; fi
git check-ignore -q .somi/ab-results/x && { pass=$((pass+1)); echo "  ok   the default results directory is gitignored"; } || { fail=$((fail+1)); echo "  FAIL default output directory is not ignored"; }
grep -q '^scripts/manual/' tests/.npmignore && { pass=$((pass+1)); echo "  ok   tests/scripts/manual/ is excluded from the package"; } || { fail=$((fail+1)); echo "  FAIL manual/ is not in tests/.npmignore"; }

for i in "${!mnames[@]}"; do
  if [ "${mmodes[$i]}" = BAD ]; then fail=$((fail+1)); printf '  FAIL mutation did not apply: %s\n' "${mlabels[$i]}"; continue; fi
  n="${mnames[$i]}"; r=$(verify "$ROOT" "${mmodes[$i]}" "$n" "41$((100 + ${n#mu}))" | grep -c '^FAIL')
  if [ "$r" -gt 0 ]; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "${mlabels[$i]}"; else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "${mlabels[$i]}"; fi
done
# ---- --corpus, --sizing-probe, tier recording, --phase (a stub claude on a scratch micro corpus) ---------------------------------
MSTUB=$(cat <<'EOS'
#!/usr/bin/env node
const fs = require('fs'), path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'stub.json'), 'utf8'));
const mode = path.basename(__filename).slice(5);
fs.appendFileSync(path.join(process.env.HOME, 'argv.jsonl'), JSON.stringify(process.argv.slice(2)) + '\n');
const emit = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const say = (text) => emit({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
const result = (o = {}) => emit({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.1, num_turns: 2, session_id: 'sess-1', modelUsage: { 'stub-usage-key': {} }, ...o });
const DIR = '.somi/somi-state/tier';
const put = (name, text) => { fs.mkdirSync(DIR, { recursive: true }); fs.writeFileSync(path.join(DIR, name), text); };
const tool = (text) => emit({ type: 'user', message: { content: [{ type: 'tool_result', content: text }] } });
emit({ type: 'system', subtype: 'init', session_id: 'sess-1' });
const gate = () => { say('Shall I proceed with this plan?'); result({ result: 'Shall I proceed with this plan?', session_id: 'sess-p' }); };
if (mode === 'small') { put('x-task.json', '{"tier":"small","computed_tier":"small"}'); say('Done.'); result(); }
else if (mode === 'gate') { put('x-task.json', '{"tier":"small"}'); gate(); }
else if (mode === 'gate-full') { put('x-task.json', '{"tier":"full","computed_tier":"small","source":"override"}'); gate(); }
else if (mode === 'many') { for (let i = 0; i < 17; i++) put(`a${String(i).padStart(2, '0')}-task.json`, '{"tier":"small"}'); say('Done.'); result(); }
else if (mode === 'decoys') { for (let i = 0; i < 16; i++) put(`a${String(i).padStart(2, '0')}-task.json`, '{not json'); put('z-real.json', '{"tier":"small"}'); say('Done.'); result(); }
else if (mode === 'corrupt') { put('x-task.json', '{not json'); tool('{"tier":"small","effective":"small"}'); say('Done.'); result(); }
else if (mode === 'mixed') { put('a-task.json', '{"tier":"small"}'); put('b-task.json', '{not json'); say('Done.'); result(); }
else if (mode === 'stream-fake') { emit({ type: 'assistant', message: { content: [{ type: 'tool_result', content: '{"effective":"small"}' }] } }); say('Done.'); result(); }
else if (mode === 'symlink') { fs.mkdirSync(DIR, { recursive: true }); fs.symlinkSync(cfg.lure, path.join(DIR, 'x-task.json')); say('Done.'); result(); }
else if (mode === 'big') { put('x-task.json', '{"tier":"small"}' + ' '.repeat(10 * 1024 * 1024)); say('Done.'); result(); }
else if (mode === 'garbled') { put('x-task.json', '{not json SECRET-MARK'); say('Done.'); result(); }
else if (mode === 'inject') { put('x-task.json', '{"tier":"full; rm -rf SECRET-MARK"}'); say('Done.'); result(); }
else if (mode === 'upper') { put('x-task.json', '{"tier":"FULL"}'); say('Done.'); result(); }
else if (mode === 'object') { put('x-task.json', '{"tier":{"a":"SECRET-MARK"}}'); say('Done.'); result(); }
else if (mode === 'conflict') { put('a-task.json', '{"tier":"small"}'); put('b-task.json', '{"tier":"full"}'); say('Done.'); result(); }
else if (mode === 'dirlink') { fs.mkdirSync('.somi/somi-state', { recursive: true }); fs.mkdirSync(cfg.outside, { recursive: true }); fs.writeFileSync(path.join(cfg.outside, 'x-task.json'), '{"tier":"small"}'); fs.symlinkSync(cfg.outside, DIR); say('Done.'); result(); }
else if (mode === 'stream') { tool('{"tier":"small","effective":"small","source":"computed","floor":"small"}'); say('Done.'); result(); }
else if (mode === 'stream-text') { say('{"tier":"small","effective":"small"}'); say('Done.'); result(); }
else if (mode === 'stream-bad') { tool('{"effective":"full; SECRET-MARK"} and {"effective":"FULL"}'); say('Done.'); result(); }
else { say('Done.'); result(); }
EOS
)
mscratch() { # tag -> a scratch repository root with the driver, its libraries and the micro example under tests/evals/ab-micro
  local d="$TMP/ms-$1"; rm -rf "$d"; mkdir -p "$d/tests/evals/lib" "$d/tests/scripts/manual" "$d/tests/evals/ab-micro" "$d/scripts/lib"; cp scripts/lib/{cost-config,cost-model}.mjs "$d/scripts/lib/"
  cp tests/evals/lib/{ab-draw,ab-stream,ab-report,admit,score-hidden,task-store,manifest,compare}.mjs "$d/tests/evals/lib/"; cp tests/scripts/manual/ab-experiment.mjs "$d/tests/scripts/manual/"; cp -r tests/evals/ab-micro-template/EXAMPLE "$d/tests/evals/ab-micro/"
  mkdir -p "$d/tests/evals/ab"; ln -s ab-micro "$d/tests/evals/linkc"; ln -s . "$d/tests/evals/linkd"; : > "$d/tests/evals/ab-micro/task.json"; : > "$d/tests/evals/task.json"
}
mrun() { # tag scen mode extra...: the driver on the scratch corpus of <tag>, in the foreground; logs under $TMP/m2-<tag>-<scen>
  local tag=$1 scen=$2 mode=$3; shift 3
  local d="$TMP/m2-$tag-$scen" root="$TMP/ms-$tag" ph=(--phase sizing); [ -n "${NOPHASE:-}" ] && ph=(); mkdir -p "$d/tmp" "$d/stub"
  printf '%s\n' "$MSTUB" > "$d/stub/stub-$mode"; chmod 755 "$d/stub/stub-$mode"
  printf '{"tier":"small","note":"SECRET-MARK"}' > "$d/lure.json"
  node -e "require('fs').writeFileSync(process.argv[1], JSON.stringify({lure: process.argv[2], outside: process.argv[3]}))" "$d/stub/stub.json" "$d/lure.json" "$d/outside"
  ( cd "$root" && env TMPDIR="$d/tmp" node tests/scripts/manual/ab-experiment.mjs --model test-model --sandbox off --plugin-dir "$PLUGIN" --claude "$d/stub/stub-$mode" --env-file "$TMP/eval.env" --out "$d/out" "${ph[@]}" "$@" > "$d/log" 2> "$d/err"; echo $? > "$d/rc" )
}
micro_scenarios() { # tag: every scenario in the background (on the scratch root of <tag>), then wait
  local t=$1 row='{"draw":"T1-proration-bare","task":"T1-proration","arm":"bare","noise":false,"order":0,"outcome":"scored","reason":"","green":3,"total":3,"costUsd":1,"durationMs":1000,"scope":{"ok":true}'
  printf '%s,"phase":"calibration"}\n' "$row" > "$TMP/rp-cal.jsonl"
  { printf '%s,"phase":"experiment"}\n' "$row"; printf '%s,"phase":"sizing"}\n' "$row"; } > "$TMP/rp-mix.jsonl"
  printf '%s}\n' "$row" > "$TMP/rp-leg.jsonl"; printf '%s,"phase":"experiment"}\n' "$row" > "$TMP/rp-exp.jsonl"
  ( mrun "$t" run small --corpus tests/evals/ab-micro --phase calibration ) &
  ( NOPHASE=1 mrun "$t" nophasec small --corpus tests/evals/ab-micro --dry-run ) &
  ( NOPHASE=1 mrun "$t" nophasep small --corpus tests/evals/ab-micro --sizing-probe --dry-run ) &
  ( mrun "$t" dotname small --corpus tests/evals/ab-micro --tasks . --dry-run ) &
  ( mrun "$t" dotname2 small --corpus tests/evals/ab-micro --tasks .. --dry-run ) &
  for r in cal mix leg exp; do ( mrun "$t" "rep-$r" small --report-only "$TMP/rp-$r.jsonl" ) & done
  ( mrun "$t" probe gate --corpus tests/evals/ab-micro --sizing-probe ) &
  ( mrun "$t" probefull gate-full --corpus tests/evals/ab-micro --sizing-probe --phase calibration --budget-probe 0.3 --timeout-probe-min 2 ) &
  ( mrun "$t" refuse small --corpus tests/evals/ab-micro --sizing-probe --phase experiment --dry-run ) &
  for m in symlink big garbled inject upper object conflict dirlink stream stream-bad stream-text many decoys corrupt mixed stream-fake; do ( mrun "$t" "h-$m" "$m" --corpus tests/evals/ab-micro --sizing-probe ) & done
  ( mrun "$t" outside small --corpus /tmp --dry-run ) &
  ( mrun "$t" linkc small --corpus tests/evals/linkc --dry-run ) &
  ( mrun "$t" linkmid small --corpus tests/evals/linkd/ab-micro --dry-run ) &
  ( mrun "$t" missing small --corpus tests/evals/nope --dry-run ) &
  ( mrun "$t" dotdot small --corpus tests/evals/ab-micro/../ab-micro --dry-run ) &
  ( mrun "$t" afile small --corpus tests/evals/ab-micro/EXAMPLE/task.json --dry-run ) &
  ( mrun "$t" root small --corpus tests/evals --dry-run ) &
  ( mrun "$t" dry small --corpus tests/evals/ab-micro --dry-run ) &
  wait
}
M2CHECK=$(cat <<'EOS'
const fs = require('fs');
const { TMP, TAG } = process.env;
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const D = (s) => `${TMP}/m2-${TAG}-${s}`;
const rd = (s, f) => { try { return fs.readFileSync(`${D(s)}/${f}`, 'utf8'); } catch { return null; } };
const rows = (s) => (rd(s, 'out/results.jsonl') ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const rc = (s) => Number((rd(s, 'rc') ?? 'x').trim());
const argvs = (row) => (row.tmp && fs.existsSync(`${row.tmp}/argv.jsonl`) ? fs.readFileSync(`${row.tmp}/argv.jsonl`, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const cap = (a) => a?.[a.indexOf('--max-budget-usd') + 1];

const run = rows('run');
check('--corpus: the micro corpus is used, no noise draws, one bare and one SoMi row, exit 0', [rc('run'), run.map((r) => [r.task, r.arm, r.noise]).sort()], [0, [['EXAMPLE', 'bare', false], ['EXAMPLE', 'somi', false]]]);
check('--phase is recorded on every row', run.map((r) => r.phase), ['calibration', 'calibration']);
const somi = run.find((r) => r.arm === 'somi') ?? {}; const bare = run.find((r) => r.arm === 'bare') ?? {};
check('the SoMi row records the tier, the computed tier and where it came from; the bare row records none', [somi.tier, somi.computedTier, somi.tierSource, bare.tier, bare.tierSource, bare.computedTier], ['small', 'small', 'file', null, 'none', null]);
check('a normal draw on the micro corpus is scored by the hidden suite (0 of 16 here: the stub writes no code)', run.map((r) => [r.outcome, r.green, r.total]), [['scored', 0, 16], ['scored', 0, 16]]);
check('the old-corpus report text does not apply: a count summary, no caveats, side tasks or controls', [/results: 2 row\(s\)/.test(rd('run', 'log') ?? ''), /Caveats|side result|controls|H4-static-files|T1-proration/.test(rd('run', 'log') ?? '')], [true, false]);
check('--corpus without --phase, and --sizing-probe without --phase, are refused (exit 2) naming the flag', [rc('nophasec'), /--phase .* is required with --corpus/.test(rd('nophasec', 'err') ?? ''), rc('nophasep'), /--phase .* is required with --corpus and --sizing-probe/.test(rd('nophasep', 'err') ?? '')], [2, true, 2, true]);
const rep = (s) => [rc('rep-' + s), (rd('rep-' + s, 'err') ?? '').replace(/\s+/g, ' ').slice(0, 200), (rd('rep-' + s, 'log') ?? '').split('\n')[0]];
check('the old-corpus report refuses rows of the calibration phase and rows that mix phases, with the reason', [rep('cal')[0], /cannot report: .*phase calibration, not experiment/.test(rep('cal')[1]), rep('mix')[0], /cannot report: .*mix phases \(experiment, sizing\)/.test(rep('mix')[1])], [2, true, 2, true]);
check('legacy rows without a phase are reported and the report names them; experiment rows are reported with no such note', [rep('leg')[0], /note: 1 legacy row\(s\) without a phase field/.test(rep('leg')[2]), rep('exp')[0], /legacy/.test(rd('rep-exp', 'log') ?? '')], [0, true, 0, false]);
check('a task name of . or .. is refused even when a task.json sits there, and the error names the active corpus directory', [rc('dotname'), rc('dotname2'), /--tasks names a directory under tests\/evals\/ab-micro that has no task.json/.test(rd('dotname', 'err') ?? '')], [2, 2, true]);

const probe = rows('probe');
check('--sizing-probe: exactly one row, SoMi arm, outcome probe, tier recorded, phase sizing, never scored', [rc('probe'), probe.length, probe[0]?.arm, probe[0]?.outcome, probe[0]?.tier, probe[0]?.tierSource, probe[0]?.phase, probe[0]?.green, probe[0]?.failedNames, probe[0]?.scope], [0, 1, 'somi', 'probe', 'small', 'file', 'sizing', 0, [], { ok: false, reason: 'not checked (sizing probe)' }]);
const pa = argvs(probe[0] ?? {});
check('the probe made exactly one claude call (the stub ends at the gate with a question) and never resumed; per-probe cap 0.50', [pa.length, pa.flat().includes('--resume'), cap(pa[0]), probe[0]?.resumes], [1, false, '0.50', 0]);
const pf = rows('probefull');
check('a probe that chose the full tier records full and the computed small (an override); its own cap and phase flags apply', [pf[0]?.tier, pf[0]?.computedTier, pf[0]?.outcome, pf[0]?.phase, cap(argvs(pf[0] ?? {})[0])], ['full', 'small', 'probe', 'calibration', '0.30']);
check('the worst-case line of a probe run prints the probe cap and timeout', [/worst case: 1 sizing probe\(s\) x \$0\.5 \(cap per probe, one call, no resume\) = \$0\.50 .* cut off after 5 min/.test(rd('probe', 'log') ?? ''), /x \$0\.3 .* cut off after 2 min/.test(rd('probefull', 'log') ?? '')], [true, true]);
check('--sizing-probe with --phase experiment is refused (exit 2) before anything starts', [rc('refuse'), /cannot run in the experiment phase/.test(rd('refuse', 'err') ?? ''), rd('refuse', 'out/results.jsonl')], [2, true, null]);

const hostile = ['symlink', 'big', 'garbled', 'inject', 'upper', 'object', 'conflict', 'dirlink', 'stream-bad', 'stream-text', 'many', 'decoys', 'corrupt', 'mixed', 'stream-fake'];
for (const m of hostile) {
  const r = rows('h-' + m);
  // Any entry named like a record, or a link where the directory belongs, makes the answer unknown from the file: the stream is not consulted.
  const want = ['stream-bad', 'stream-text', 'stream-fake'].includes(m) ? ['unknown', 'none'] : ['unknown', 'file'];
  // A link anywhere in the workspace makes the draw invalid (the leak scan does not follow links); the tier is still unknown.
  const outcome = m === 'symlink' || m === 'dirlink' ? 'invalid' : 'probe';
  check(`hostile tier data (${m}): exit 0, one ${outcome} row, tier unknown, ${want[1]} source`, [rc('h-' + m), r.length, r[0]?.outcome, r[0]?.tier, r[0]?.tierSource], [0, 1, outcome, ...want]);
}
check('no content of a hostile tier file or tool result is echoed into a row, the log or stderr', hostile.every((m) => ['out/results.jsonl', 'log', 'err'].every((f) => !/SECRET-MARK|rm -rf/.test(rd('h-' + m, f) ?? ''))), true);
const st = rows('h-stream');
check('with no usable record the CLI result line in the stream is the fallback, and the source says so', [st[0]?.tier, st[0]?.tierSource], ['small', 'stream']);

for (const [s, what] of [['outside', 'a directory outside tests/evals'], ['linkc', 'a symbolic link'], ['linkmid', 'a path through a symbolic link directory'], ['missing', 'a missing directory'], ['dotdot', 'a path with ..'], ['afile', 'a file'], ['root', 'tests/evals itself']]) {
  check(`a bad --corpus (${what}) is refused with exit 2 and starts nothing`, [rc(s), /--corpus must/.test(rd(s, 'err') ?? ''), rd(s, 'out/results.jsonl')], [2, true, null]);
}
const dry = rd('dry', 'log') ?? '';
check('a dry run on the corpus plans its tasks, no noise, and names no old-corpus task', [rc('dry'), /prepared EXAMPLE-bare/.test(dry), /noise|T1-proration|H4-static-files/.test(dry)], [0, true, false]);
for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got).slice(0, 300) + ')'));
EOS
)
m2suite() { local t=$1; rm -rf "$TMP"/m2-"$t"-*; micro_scenarios "$t"; TMP="$TMP" TAG="$t" node -e "$M2CHECK" 2>&1; }
mscratch base
tally < <(m2suite base)
m2nm=0
m2mutant() { # file from to label
  local t="x$((++m2nm))"; mscratch "$t"
  if ! apply "$TMP/ms-$t/$1" "$2" "$3"; then fail=$((fail+1)); printf '  FAIL mutation target not found: %s\n' "$4"; return; fi
  local res; res=$(m2suite "$t")
  if [ -z "$res" ] || printf '%s\n' "$res" | grep -qv '^ok'; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "$4"; else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "$4"; fi
}
AD=tests/evals/lib/ab-draw.mjs; EX=tests/scripts/manual/ab-experiment.mjs
m2mutant $AD "if (!st.isFile() || st.size > TIER_MAX_BYTES) return null;" "if (!st.isFile()) return null;" "the tier file size cap"
m2mutant $AD "fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st" "fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const st" "the tier file is opened without following a link"
m2mutant $AD "|| typeof v.tier !== 'string' || !TIERS.includes(v.tier)) return null;" "|| typeof v.tier !== 'string') return null;" "only the three tiers are accepted"
m2mutant $AD "st = fs.lstatSync(dir);" "st = fs.statSync(dir);" "no directory on the way to the tier file may be a link"
m2mutant $AD "|| new Set(recs.map((r) => r.tier)).size !== 1" "" "disagreeing tier records are unknown"
m2mutant $AD "tierSource: 'stream', computedTier" "tierSource: 'file', computedTier" "the tier source says stream"
m2mutant $AD '/"effective":\s*"(small|trivial|full)"/' '/"effective":\s*"([^"]*)"/' "the stream fallback accepts the three tiers only"
m2mutant $AD "if (ev?.type !== 'user' || " "if (" "the stream fallback reads user events only"
m2mutant $AD "if (names.length > TIER_MAX_FILES) return unknown;" "" "more than 16 record-like entries are decoys"
m2mutant $AD "names.map((n) => recordTier(path.join(dir, n)));" "names.map((n) => recordTier(path.join(dir, n))).filter((r) => r !== null);" "every record-like entry must be valid"
m2mutant $AD "if (rec !== null) return { tier: rec.tier," "if (rec !== null && rec.tier !== 'unknown') return { tier: rec.tier," "the stream is consulted only when there are no records"
m2mutant $AD "computedTier: computed.size === 1 ? [...computed][0] : null" "computedTier: null" "the computed tier is recorded"
m2mutant $EX "(a.corpus !== undefined || a['sizing-probe']) && a.phase === undefined" "false" "--phase is required with --corpus or --sizing-probe"
m2mutant tests/evals/lib/ab-report.mjs "if (phases.size === 1 && !phases.has('experiment'))" "if (false)" "the old-corpus report refuses other phases"
m2mutant tests/evals/lib/ab-report.mjs "if (phases.size > 1)" "if (false)" "the old-corpus report refuses mixed phases"
m2mutant $EX "const NAME = /^(?!\\.{1,2}\$)[A-Za-z0-9._-]{1,64}\$/;" "const NAME = /^[A-Za-z0-9._-]{1,64}\$/;" "task names . and .. are refused"
m2mutant $EX "x \$\${args.budgetProbe} (cap per probe" "x \$\${args.budgetPerDraw} (cap per probe" "the probe worst-case line prints the probe cap"
m2mutant $EX "maxResumes: args.sizingProbe ? 0 : undefined" "maxResumes: undefined" "a probe never resumes"
m2mutant $EX "if (args.sizingProbe) row.scope = " "if (false) row.scope = " "a probe is never scored"
m2mutant $EX "args.only || args.tasks || args.corpus || args.sizingProbe" "args.only || args.tasks || args.sizingProbe" "no noise draws on another corpus"
m2mutant $EX "rel.startsWith('..')" "false" "a corpus outside tests/evals is refused"
m2mutant $EX "fs.realpathSync(abs) !== path.join(fs.realpathSync(root), rel)" "false" "a corpus behind a link is refused"
m2mutant $EX "if (a['sizing-probe'] && a.phase === 'experiment') die(" "if (false) die(" "a probe is never an experiment draw"
m2mutant $EX "if (d.arm === 'somi') Object.assign(row, resolveTier(" "if (false) Object.assign(row, resolveTier(" "every SoMi row records its tier"
m2mutant $EX "if (args.sizingProbe && (row.outcome === 'scored'" "if (false && (row.outcome === 'scored'" "a finished probe is outcome probe"
m2mutant $EX "args.sizingProbe ? args.budgetProbe :" "false ? args.budgetProbe :" "the per-probe cap"
m2mutant $EX "pinAll: args.pinAll, phase: args.phase, tier: null," "pinAll: args.pinAll, tier: null," "the phase is on every row"
ran=$((pass + fail))
[ "$ran" -ge 150 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 150 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
