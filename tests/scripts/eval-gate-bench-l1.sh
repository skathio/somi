#!/usr/bin/env bash
# Pins the usage and speed benchmark's L1 latency harness (tests/evals/lib/bench-l1.mjs), its host fingerprint
# (tests/evals/lib/bench-host.mjs) and the CLI that wires them to the plugin's hooks and scripts
# (tests/scripts/manual/usage-l1.mjs): exact medians, p90 and extremes from an injected clock, the discarded warm-up,
# the run-count floor from the rule, sequential execution, the timeout, the environment allowlist, the throwaway
# project dir and audit log, the six-key fingerprint with no host, user or path text, and that every hook in
# hooks/hooks.json is an event. Each rule is then broken on a scratch copy and the suite must fail.
# Wall time is never asserted: the clock is injected. The only real runs are two bounded mini-runs (30 repeats of one
# cheap hook, and the CLI on two cheap events). Skipped in a tarball, where tests/evals is absent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: benchmark L1 latency harness and host fingerprint =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t bl1.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

CODE=$(cat <<'EOS'
const L = await import(`${process.env.LIB}/bench-l1.mjs`);
const H = await import(`${process.env.LIB}/bench-host.mjs`);
const Sc = await import(`${process.env.LIB}/bench-schema.mjs`);
const St = await import(`${process.env.LIB}/bench-stats.mjs`);
const R = await import(`${process.env.LIB}/bench-rule.mjs`);
const fs = await import('node:fs');
const os = await import('node:os');
const path = await import('node:path');
const { spawnSync } = await import('node:child_process');
const ROOT = process.env.ROOT;
const FULL = process.env.FULL === '1';
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const rule = R.loadRule(`${ROOT}/benchmarks/usage-speed/rule.json`);
const noop = async () => {};
const ev = (id) => ({ id, command: ['x'] });
// Clock whose elapsed time for run k (counting every run of every event) is durs[k]; its absolute readings differ.
const mkClock = (durs) => { let call = 0; let base = 0; return () => { const c = call++; if (c % 2 === 0) { base += 1000; return base; } return base + durs[(c - 1) / 2]; }; };
const refuses = async (f) => { try { await f(); return 'accepted'; } catch (e) { return e.constructor.name; } };
const hung = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r('HUNG'), 3000))]);

// ---- statistics from an injected clock ----
const kept = [17, 3, 29, 8, 24, 1, 12, 30, 5, 21, 14, 9, 26, 2, 19, 11, 27, 6, 23, 15, 4, 28, 10, 20, 7, 25, 13, 18, 22, 16];
const durs = [999999, ...kept];
const out1 = await L.measureEvents({ events: [ev('a')], rule, runner: noop, clock: mkClock(durs) });
check('known samples: the 30 kept values in run order, warm-up (999999) discarded', out1.a.samples, kept);
check('median of 1..30 is 15.5', out1.a.median, 15.5);
check('p90 is nearest rank: sorted[26] = 27', out1.a.p90, 27);
check('min and max exclude the warm-up', [out1.a.min, out1.a.max], [1, 30]);
check('summarize: even count median, odd count, p90 of 10 is the 9th', [L.summarize([4, 1, 3, 2]).median, L.summarize([9, 1, 5]).median, L.summarize([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).p90], [2.5, 5, 9]);
check('summarize: one sample', L.summarize([7]), { samples: [7], median: 7, p90: 7, min: 7, max: 7 });
check('summarize: empty is an error', await refuses(async () => L.summarize([])), 'Error');
check('toBaselineL1 is { events: { id: samples } }', L.toBaselineL1(out1), { events: { a: kept } });

// ---- run count: floor from the rule, default is the floor ----
let calls = 0;
await L.measureEvents({ events: [ev('a')], rule, runner: async () => { calls++; }, clock: mkClock(Array(31).fill(1)) });
check('default runs = the rule floor (30): 31 executions including the warm-up', calls, 31);
check('the floor comes from the rule', L.minRuns(rule), 30);
for (const n of [29, 5, 1, 0, -3, 30.5, '30', NaN]) {
  check(`runs ${JSON.stringify(n)} is refused with a RangeError`, await refuses(() => L.measureEvents({ events: [ev('a')], rule, runs: n, runner: noop, clock: mkClock([]) })), 'RangeError');
}
let ran = 0;
await refuses(() => L.measureEvents({ events: [ev('a')], rule, runs: 29, runner: async () => { ran++; } }));
check('a refused run count executes nothing', ran, 0);
const out31 = await L.measureEvents({ events: [ev('a')], rule, runs: 31, runner: noop, clock: mkClock(Array(32).fill(2)) });
check('runs above the floor are honoured', out31.a.samples.length, 31);
check('a missing or ruleless call is an error, not a default', [await refuses(() => L.measureEvents({ events: [ev('a')], runner: noop })), await refuses(() => L.measureEvents({ events: [ev('a')], rule: {}, runner: noop }))], ['Error', 'Error']);

// ---- events are validated ----
for (const [name, events] of [['empty list', []], ['duplicate id', [ev('a'), ev('a')]], ['bad id', [ev('has space')]], ['no id', [{ command: ['x'] }]], ['not an array', 'a']]) {
  check(`events: ${name} is refused`, await refuses(() => L.measureEvents({ events, rule, runner: noop })), 'Error');
}

// ---- strictly positive samples ----
check('a zero elapsed time is an error', await refuses(() => L.measureEvents({ events: [ev('a')], rule, runner: noop, clock: () => 5 })), 'Error');
check('a negative elapsed time is an error', await refuses(() => L.measureEvents({ events: [ev('a')], rule, runner: noop, clock: mkClock(Array(31).fill(-1)) })), 'Error');

// ---- sequential execution ----
let active = 0; let maxActive = 0; const order = [];
const slow = async (e) => { active++; maxActive = Math.max(maxActive, active); order.push(e.id); await new Promise((r) => setImmediate(r)); active--; };
await L.measureEvents({ events: [ev('a'), ev('b')], rule, runner: slow, clock: mkClock(Array(62).fill(1)) });
check('no two runs overlap', maxActive, 1);
check('events run in order, all of one before the next (31 + 31)', [order.slice(0, 31).every((x) => x === 'a'), order.slice(31).every((x) => x === 'b'), order.length], [true, true, 62]);

// ---- timeout ----
const never = () => new Promise(() => {});
check('a runner that never settles times out', await hung(refuses(() => L.measureEvents({ events: [ev('a')], rule, runner: never, timeoutMs: 40 }))), 'Error');
const t = await hung(L.measureEvents({ events: [ev('a')], rule, runner: never, timeoutMs: 40 }).catch((e) => e.message));
check('the timeout message names the event', typeof t === 'string' && t.includes('event a') && t.includes('timed out'), true);
const node = process.execPath;
const ctx = { project: os.tmpdir(), pluginRoot: ROOT, baseEnv: process.env, timeoutMs: 300 };
check('execRunner kills a child that outlives the timeout', await hung(L.execRunner({ id: 'z', command: [node, '-e', 'setTimeout(() => {}, 10000)'] }, ctx).then(() => 'resolved', (e) => e.message.includes('timed out'))), true);
check('execRunner rejects an unexpected exit code and accepts a listed one', [
  await L.execRunner({ id: 'z', command: [node, '-e', 'process.exit(3)'] }, ctx).then(() => 'ok', () => 'rejected'),
  await L.execRunner({ id: 'z', command: [node, '-e', 'process.exit(3)'], okCodes: [3] }, ctx).then(() => 'ok', () => 'rejected'),
], ['rejected', 'ok']);
check('execRunner rejects a command that cannot start', await L.execRunner({ id: 'z', command: ['/nonexistent/bin'] }, ctx).then(() => 'ok', () => 'rejected'), 'rejected');
check('execRunner uses no shell: argv is passed literally', await L.execRunner({ id: 'z', command: [node, '-e', 'process.exit(process.argv[1] === "$(echo hi); ls" ? 0 : 5)', '$(echo hi); ls'] }, ctx).then(() => 'ok', () => 'rejected'), 'ok');
const proj = fs.mkdtempSync(path.join(os.tmpdir(), 'l1t-'));
const sub = await L.execRunner({ id: 'z', command: [node, '-e', 'const f = require("fs"); process.exit(f.realpathSync(process.cwd()) === f.realpathSync(process.argv[1]) && process.env.X === process.argv[1] + "/y" ? 0 : 5)', '{PROJECT}'], env: { X: '{PROJECT}/y' } }, { ...ctx, project: proj, timeoutMs: 5000 }).then(() => 'ok', () => 'rejected');
check('{PROJECT} is replaced in argv and env, and the child runs in the project dir', sub, 'ok');
const stdinOk = await L.execRunner({ id: 'z', command: [node, '-e', 'let s = ""; process.stdin.on("data", (d) => s += d).on("end", () => process.exit(s === "in:" + process.argv[1] ? 0 : 5))', proj], stdin: 'in:{PROJECT}' }, { ...ctx, project: proj, timeoutMs: 5000 }).then(() => 'ok', () => 'rejected');
check('stdin is delivered with the same substitution', stdinOk, 'ok');
fs.rmSync(proj, { recursive: true, force: true });

// ---- environment ----
const e0 = L.buildEnv({ PATH: '/bin', LANG: 'C', SECRET_TOKEN: 'x', HOME: '/home/someone', ANTHROPIC_API_KEY: 'k', SOMI_AUDIT_LOG: '/real/audit.log', CLAUDE_PROJECT_DIR: '/real' }, { project: '/p', pluginRoot: '/r' }, { A: '1' });
check('env: allowlisted names survive, secrets and the real audit log path do not', e0, { PATH: '/bin', LANG: 'C', HOME: '/p', CLAUDE_PROJECT_DIR: '/p', SOMI_AUDIT_LOG: '/p/audit.log', CLAUDE_PLUGIN_ROOT: '/r', A: '1' });
check('env: no plugin root, no plugin root variable', 'CLAUDE_PLUGIN_ROOT' in L.buildEnv({}, { project: '/p' }), false);

// ---- the throwaway project dir ----
let seenProject = null;
await L.measureEvents({ events: [ev('a')], rule, runner: async (e, c) => { seenProject = c.project; }, clock: mkClock(Array(31).fill(1)) });
check('the temp project dir is removed after a run', [typeof seenProject, fs.existsSync(seenProject), seenProject.startsWith(os.tmpdir())], ['string', false, true]);
let failProject = null;
await refuses(() => L.measureEvents({ events: [ev('a')], rule, runner: async (e, c) => { failProject = c.project; throw new Error('boom'); } }));
check('the temp project dir is removed after a failure', fs.existsSync(failProject), false);
const mine = fs.mkdtempSync(path.join(os.tmpdir(), 'l1own-'));
await L.measureEvents({ events: [ev('a')], rule, runner: noop, clock: mkClock(Array(31).fill(1)), projectDir: mine });
check('a caller-supplied project dir is left in place', fs.existsSync(mine), true);

// ---- the real audit log stays untouched ----
// Other hooks (this session's own) may append to the real log at any time, so a hash would be flaky; a unique
// marker in the payload is what proves this harness never wrote there. The marker must reach the temp log.
const realLog = path.join(process.cwd(), '.somi', 'audit.log');
const marker = `benchl1marker${process.pid}x${Date.now()}`;
const before = fs.existsSync(realLog) ? fs.readFileSync(realLog, 'utf8') : '';
const auditEvent = { id: 'hook.post-tool.audit-log', command: [node, '{PLUGIN}/hooks/post-tool/audit-log.mjs'], stdin: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: marker, tool_input: { file_path: '{PROJECT}/n.md' }, session_id: 'b', cwd: '{PROJECT}' }) };
const auditProject = fs.mkdtempSync(path.join(os.tmpdir(), 'l1audit-'));
const real = await L.measureEvents({ events: [auditEvent], rule, runs: 30, pluginRoot: ROOT, projectDir: auditProject, timeoutMs: 8000 });
const after = fs.existsSync(realLog) ? fs.readFileSync(realLog, 'utf8') : '';
const tmpLog = fs.existsSync(path.join(auditProject, 'audit.log')) ? fs.readFileSync(path.join(auditProject, 'audit.log'), 'utf8') : '';
check('a real 30-run mini-run of the audit hook: 30 samples, all positive', [real['hook.post-tool.audit-log'].samples.length, real['hook.post-tool.audit-log'].samples.every((x) => x > 0)], [30, true]);
check('the real audit log gained no marker line', after.split(marker).length - 1, 0);
check('the real audit log kept everything it had', after.startsWith(before), true);
check('the temp audit log received the marker lines (31 runs)', tmpLog.split(marker).length - 1, 31);
fs.rmSync(auditProject, { recursive: true, force: true });

// ---- host fingerprint ----
const KEYS = ['cpuModel', 'cores', 'memGb', 'osRelease', 'nodeVersion', 'pluginVersion'];
const info = { cpuModel: 'Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz', cores: 8, memBytes: 15.6 * 2 ** 30, osRelease: '6.8.0-146-generic', nodeVersion: 'v22.1.0', pluginVersion: '4.0.0' };
const fp = H.hostFingerprint(info);
check('fingerprint keys are exactly the six, in schema order', Object.keys(fp), KEYS);
check('the six keys equal the schema HOST_KEYS', [...Sc.HOST_KEYS], KEYS);
check('fingerprint values', fp, { cpuModel: 'Intel(R) Core(TM) i7-6700HQ CPU @ 2.60GHz', cores: 8, memGb: 16, osRelease: '6.8.0-146-generic', nodeVersion: 'v22.1.0', pluginVersion: '4.0.0' });
check('memory rounds to whole GB (15.4 -> 15, 15.5 -> 16, 0 -> 1)', [15.4, 15.5, 0].map((g) => H.hostFingerprint({ ...info, memBytes: g * 2 ** 30 }).memGb), [15, 16, 1]);
const leaky = H.hostFingerprint({ ...info, hostname: 'box-7', username: 'alice', homedir: '/home/alice', cwd: '/home/alice/repo', env: { A: 1 }, cpuModel: '/home/alice/x\\y:~ Xeon\n E5\t@2GHz' });
check('extra info keys are never copied', Object.keys(leaky), KEYS);
check('path and separator characters are stripped from free text', leaky.cpuModel, 'home alice x y Xeon E5 @2GHz');
check('bad or missing info degrades to safe values, never throws', [H.hostFingerprint(null), H.hostFingerprint({ cores: 'x', memBytes: -5 })].map((f) => [f.cpuModel, f.cores, f.memGb]), [['unknown', 1, 1], ['unknown', 1, 1]]);
check('free text is capped', H.hostFingerprint({ ...info, cpuModel: 'a'.repeat(500) }).cpuModel.length, 80);
const hostText = JSON.stringify(H.hostFingerprint(H.collectHostInfo('4.0.0')));
const user = os.userInfo().username; const hn = os.hostname();
check('the live fingerprint has six keys and no hostname, username, home dir or cwd', [Object.keys(JSON.parse(hostText)), hostText.includes(hn), hostText.includes(user), hostText.includes(os.homedir()), hostText.includes(process.cwd())], [KEYS, false, false, false, false]);
const base = { cores: 8, memBytes: 2 ** 34 };
check('the live values are plausible: cores >= 1, memGb >= 1, node version string', (() => { const f = JSON.parse(hostText); return [f.cores >= 1, f.memGb >= 1, f.nodeVersion === process.version]; })(), [true, true, true]);

// ---- the event list covers every hook in hooks/hooks.json ----
const cli = fs.readFileSync(`${ROOT}/tests/scripts/manual/usage-l1.mjs`, 'utf8');
const hooksJson = fs.readFileSync(`${ROOT}/hooks/hooks.json`, 'utf8');
const hookFiles = [...hooksJson.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/(hooks\/[\w./-]+\.mjs)/g)].map((m) => m[1]);
check('hooks.json lists hook scripts (so the coverage check is not vacuous)', hookFiles.length >= 10, true);
check('every hook script in hooks.json is an event in the CLI', hookFiles.filter((f) => !cli.includes(`'${f}'`)), []);
check('the CLI covers the tier, config and dispatch scripts and the MCP round trip', ['somi-tier.mjs', 'somi-config.mjs', 'somi-dispatch.mjs', "id: 'mcp.round-trip'"].filter((s) => !cli.includes(s)), []);

// ---- the CLI, end to end (bounded real runs; skipped inside mutants, which only touch the libraries) ----
if (FULL) {
  const cliPath = `${ROOT}/tests/scripts/manual/usage-l1.mjs`;
  const run = (args) => spawnSync(node, [cliPath, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 60000 });
  const few = run(['--runs', '5', '--json']);
  check('CLI: --runs 5 is refused with exit 64 and no output on stdout', [few.status, few.stdout], [64, '']);
  const full = run(['--json', '--only', 'cli.somi-config-show,mcp.round-trip']);
  let j = null; try { j = JSON.parse(full.stdout); } catch { /* reported below */ }
  check('CLI: --json exits 0 and prints JSON', [full.status, j !== null], [0, true]);
  if (j) {
    check('CLI: runs is the rule floor and each event has that many samples, all positive', [j.runs, Object.keys(j.L1.events), Object.values(j.L1.events).every((s) => s.length === 30 && s.every((x) => x > 0))], [30, ['cli.somi-config-show', 'mcp.round-trip'], true]);
    check('CLI: the host block has the six keys', Object.keys(j.host), KEYS);
    check('CLI: summary agrees with the library statistics', Object.entries(j.L1.events).every(([id, s]) => j.summary[id].median === St.median(s) && j.summary[id].min === Math.min(...s) && j.summary[id].max === Math.max(...s)), true);
    check('CLI: the MCP round trip completed (a failed conversation is an error exit, not a sample)', j.L1.events['mcp.round-trip'].length, 30);
    check('CLI: output holds no hostname, username, home dir or cwd', [full.stdout.includes(hn), full.stdout.includes(user), full.stdout.includes(os.homedir()), full.stdout.includes(ROOT)], [false, false, false, false]);
  }
  const table = run(['--only', 'cli.somi-config-show']);
  check('CLI: the table prints the event with median, p90 and spread', [table.status, /cli\.somi-config-show\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+\s+[\d.]+/.test(table.stdout), table.stdout.includes('spread')], [0, true, true]);
  check('CLI: an unknown --only is a usage error; an unknown flag too', [run(['--only', 'nope']).status, run(['--bogus']).status], [64, 64]);
}
for (const [ok, name, got, w] of res) console.log((ok ? 'ok' : 'FAIL') + '\t' + name + (ok ? '' : ' (want ' + JSON.stringify(w) + ', got ' + JSON.stringify(got) + ')'));
console.log('DONE\tcomplete');
process.exit(0);
EOS
)
suite() { # lib dir, cwd, FULL flag
  (cd "$2" && LIB="$1" ROOT="$ROOT" FULL="$3" node --input-type=module -e "$CODE" 2>&1)
}
out=$(suite "$ROOT/tests/evals/lib" "$ROOT" 1) || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    DONE) ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"
if ! grep -q '^DONE' <<< "$out"; then fail=$((fail+1)); echo '  FAIL the suite crashed before finishing'; printf '%s\n' "$out" | tail -5; fi

# Mutation: each rule is broken on a scratch copy of the libraries; the suite must then fail. The suite runs with
# its working directory in the scratch dir, so a mutant that writes "the project's" audit log lands there.
nm=0
mutant() { # file, from, to, label
  local d="$TMP/m$((++nm))"; mkdir "$d"
  cp tests/evals/lib/bench-l1.mjs tests/evals/lib/bench-host.mjs tests/evals/lib/bench-stats.mjs tests/evals/lib/bench-rule.mjs \
     tests/evals/lib/bench-schema.mjs tests/evals/lib/mann-whitney.mjs "$d/"
  if ! M_FILE="$d/$1" M_FROM="$2" M_TO="$3" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then fail=$((fail+1)); printf '  FAIL mutation did not apply: %s\n' "$4"; return; fi
  local o; o=$(suite "$d" "$d" 0)
  # A crash (no DONE line) also counts as the suite failing on the mutant.
  if grep -q '^FAIL' <<< "$o" || ! grep -q '^DONE' <<< "$o"; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "$4"; else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "$4"; fi
}
L=bench-l1.mjs; Ho=bench-host.mjs
mutant $L "if (i > 0) samples.push(ms);" "samples.push(ms);" "the warm-up sample is kept"
mutant $L "await withTimeout(runner(event, ctx), timeoutMs, event.id);" "withTimeout(runner(event, ctx), timeoutMs, event.id);" "runs overlap (not awaited)"
mutant $L "i <= runs; i++" "i < runs; i++" "no warm-up run executed"
mutant $L "runs < floor" "runs < 1" "runs below the floor are allowed"
mutant $L "const runs = opts.runs ?? floor;" "const runs = opts.runs ?? 5;" "default run count below the floor"
mutant $L "sorted[Math.ceil(0.9 * sorted.length) - 1]" "sorted[Math.floor(0.9 * sorted.length)]" "p90 index"
mutant $L "median: median(samples)," "median: sorted[Math.floor(sorted.length / 2)]," "median of an even count"
mutant $L "[...samples].sort((a, b) => a - b)" "[...samples].sort()" "numeric sort of samples"
mutant $L "if (!(ms > 0))" "if (false)" "non-positive samples accepted"
mutant $L "return Promise.race([promise, limit])" "return promise" "timeout not enforced"
mutant $L "Promise.race([promise, limit])" "promise" "harness timeout not enforced"
mutant $L "timeout: ctx.timeoutMs" "timeout: 0" "child timeout not enforced"
mutant $L "for (const k of ENV_ALLOWLIST)" "for (const k of Object.keys(baseEnv))" "environment is not an allowlist"
mutant $L "env.HOME = project;" "env.HOME = baseEnv.HOME;" "HOME not isolated"
mutant $L "env.CLAUDE_PROJECT_DIR = project;
  env.SOMI_AUDIT_LOG = join(project, 'audit.log');" "env.CLAUDE_PROJECT_DIR = process.cwd();" "the real audit log is used"
mutant $L "if (own) rmSync(project, { recursive: true, force: true });" "" "temp project dir not removed"
mutant $L "|| seen.has(e.id)" "" "duplicate event ids accepted"
mutant $L "execFile(cmd, args," "execFile([cmd, ...args].join(' '), []," "command run through a joined string"
mutant $L "ok.includes(err.code)" "true" "any exit code accepted"
mutant $Ho "pluginVersion: safeText(i.pluginVersion),
  };" "pluginVersion: safeText(i.pluginVersion),
    hostname: os.hostname(),
  };" "the fingerprint includes the hostname"
mutant $Ho "wholeInt(i.memBytes / 2 ** 30, 1)" "Math.floor(i.memBytes / 2 ** 30)" "memory floored, not rounded"
mutant $Ho "[^A-Za-z0-9 ().,+@-]" "[^A-Za-z0-9 ().,+@/\\\\:~-]" "path characters survive in free text"
mutant $Ho "slice(0, MAX_TEXT)" "slice(0, 4000)" "free text not capped"
mutant $Ho "cpuModel: safeText(i.cpuModel)," "...i," "extra info keys copied"

ran=$((pass + fail))
[ "$ran" -ge 90 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 90 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
