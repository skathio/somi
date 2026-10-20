#!/usr/bin/env bash
# Pins the L0 footprint of the usage and speed benchmark (tests/evals/lib/bench-l0.mjs, its scenario list
# benchmarks/usage-speed/l0-scenarios.json and the CLI tests/scripts/manual/usage-l0.mjs): exact byte counts on a
# fixture tree (frontmatter included and stripped, digest, hook output with multibyte text, a silent hook), every
# refusal, the hook sandbox (allowlisted environment, temp audit log, temp dir removed), determinism, and the real
# repository's scenarios validating against the baseline schema. Each rule is then mutated on a scratch copy and the
# suite must fail. Hermetic: no model, network or credential; hooks run only from the fixture or this repository.
# Skipped in a tarball, where tests/evals is absent.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
echo "== eval gate: benchmark L0 footprint =="
if [ ! -d tests/evals ]; then echo "  (skipped: tests/evals not packaged)"; exit 0; fi

TMP="$(mktemp -d -t bl0.XXXXXX)"
trap 'rm -rf "$TMP"' EXIT

CODE=$(cat <<'EOJ'
const L = await import(`${process.env.LIB}/bench-l0.mjs`);
const Sc = await import(`${process.env.ROOT}/tests/evals/lib/bench-schema.mjs`);
const fs = await import('node:fs');
const path = await import('node:path');
const ROOT = process.env.ROOT;
const FIX = process.env.FIXDIR;
const res = [];
const check = (name, got, want) => res.push([JSON.stringify(got) === JSON.stringify(want), name, got, want]);
const w = (rel, text) => { const f = path.join(FIX, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const refused = async (name, fn) => { let m = null; try { await fn(); } catch (e) { m = String(e.message); } check(name, m !== null && m.startsWith('l0: '), true); return m; };

// ---- fixture tree with known sizes ----
w('commands/c.md', '---\nk: v\n---\nhello\n');                       // 19 bytes, 6 after the frontmatter
w('agents/a.md', '---\r\nk: v\r\n---\r\nhi');                        // 18 bytes, 2 after the frontmatter
w('skills/s/SKILL.md', 'ab\n');                                      // 3 bytes, no frontmatter
w('rules/CLAUDE.md', 'pre\n<!-- digest:start -->\nabcé\n<!-- digest:end -->\npost'); // digest is "\nabcé\n" = 7
const hook = (rel, body) => w(`hooks/${rel}`, `import fs from 'node:fs';import path from 'node:path';const raw = fs.readFileSync(0, 'utf8');\nconst inp = raw ? JSON.parse(raw) : {};\nconst out = (c) => console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'X', additionalContext: c } }));\n${body}\n`);
hook('session-start/emit.mjs', "out('h\\u00e9llo');");                                                        // 6 bytes
hook('user-prompt-submit/echo.mjs', "out(`${inp.prompt}|${inp.hook_event_name}`);");
hook('user-prompt-submit/silent.mjs', '');
hook('post-tool/envkeys.mjs', "out(Object.keys(process.env).sort().join(','));");
hook('post-tool/audit.mjs', "fs.appendFileSync(process.env.SOMI_AUDIT_LOG, 'x\\n'); out(`inside:${path.resolve(process.env.SOMI_AUDIT_LOG).startsWith(process.cwd())}`);"); // 11
hook('post-tool/seeded.mjs', "out(fs.readFileSync('sub/seed.txt', 'utf8'));");
hook('pre-tool/fail.mjs', 'process.exit(3);');
hook('pre-tool/junk.mjs', "console.log('not json');");
hook('pre-tool/noctx.mjs', "console.log('{\"a\":1}');");
fs.symlinkSync(path.join(FIX, 'commands/c.md'), path.join(FIX, 'commands/link.md'));

const C = (kind, name, more = {}) => ({ kind, name, ...more });
const S = (id, ...components) => ({ id, components });
const run = (scenarios, o = {}) => L.measureL0({ repo: FIX, scenarios, ...o });
const bytesOf = (r, id) => r[id].components.map((c) => c.bytes);

// ---- exact counts ----
let r = await run([S('files', C('command', 'c'), C('agent', 'a'), C('skill', 's'), C('digest', 'rules/CLAUDE.md'))]);
check('file kinds count the whole file; the digest counts between its markers', [r.files.bytes, bytesOf(r, 'files')], [19 + 18 + 3 + 7, [19, 18, 3, 7]]);
r = await run([S('files', C('command', 'c'), C('agent', 'a'), C('skill', 's'))], { frontmatter: 'strip' });
check('strip removes the frontmatter block (LF and CRLF) and leaves a file without one', bytesOf(r, 'files'), [6, 2, 3]);
check('a component entry carries kind, name and bytes only', Object.keys(r.files.components[0]), ['kind', 'name', 'bytes']);
r = await run([S('hooks', C('hook', 'session-start/emit.mjs', { event: 'SessionStart' }))]);
check('a hook counts the UTF-8 bytes of its additionalContext', r.hooks.bytes, 6);
const prompt = 'café ✓';
r = await run([S('echo', C('hook', 'user-prompt-submit/echo.mjs', { event: 'UserPromptSubmit', payload: { prompt } }))]);
check('the synthetic stdin reaches the hook, with the event name', r.echo.bytes, Buffer.byteLength(`${prompt}|UserPromptSubmit`));
r = await run([S('quiet', C('hook', 'user-prompt-submit/silent.mjs', { event: 'UserPromptSubmit' }), C('skill', 's'))]);
check('a hook that prints nothing counts zero and does not fail the scenario', bytesOf(r, 'quiet'), [0, 3]);
r = await run([S('seed', C('hook', 'post-tool/seeded.mjs', { event: 'PostToolUse', files: { 'sub/seed.txt': 'seededé' } }))]);
check('hook files seed the temp project', r.seed.bytes, 8);
r = await run([S('tool', C('tool', 'somi_tier'))], { tools: { somi_tier: 'définition' } });
check('a supplied tool text counts its UTF-8 bytes', r.tool.bytes, 11);
const KEYS = 'CLAUDE_PLUGIN_ROOT,CLAUDE_PROJECT_DIR,HOME,LANG,PATH,SOMI_AUDIT_LOG,TMPDIR,TZ';
r = await run([S('env', C('hook', 'post-tool/envkeys.mjs', { event: 'PostToolUse' }))]);
check('the hook sees exactly the allowlisted environment', r.env.bytes, KEYS.length);
r = await run([S('audit', C('hook', 'post-tool/audit.mjs', { event: 'PostToolUse' }))]);
check('SOMI_AUDIT_LOG points inside the temp project', r.audit.bytes, 'inside:true'.length);
const left = fs.readdirSync(process.env.TMPDIR).filter((n) => n.startsWith('somi-l0-'));
check('the temp project directories are removed', left, []);
const A = [S('s1', C('command', 'c'), C('hook', 'session-start/emit.mjs', { event: 'SessionStart' })), S('s2', C('skill', 's'))];
check('two runs are identical', JSON.stringify(await run(A)), JSON.stringify(await run(A)));
check('scenario order and ids are kept', Object.keys(await run(A)), ['s1', 's2']);
check('l0Section is the baseline shape', L.l0Section(await run(A)), { bytes: { s1: 25, s2: 3 } });

// ---- refusals ----
await refused('a missing command is refused', () => run([S('x', C('skill', 's'), C('command', 'nope'))]));
await refused('a missing skill is refused', () => run([S('x', C('command', 'c'), C('skill', 'nope'))]));
await refused('a symlinked file is refused', () => run([S('x', C('command', 'link'))]));
await refused('a missing hook script is refused', () => run([S('x', C('hook', 'session-start/none.mjs', { event: 'E' }))]));
await refused('a tool that was not supplied is refused', () => run([S('x', C('tool', 'somi_tier'))]));
await refused('an empty tool text is refused', () => run([S('x', C('tool', 'somi_tier'))], { tools: { somi_tier: '' } }));
await refused('a digest without markers is refused', async () => { w('rules2/CLAUDE.md', 'none'); fs.mkdirSync(path.join(FIX, '../r2/rules'), { recursive: true }); fs.writeFileSync(path.join(FIX, '../r2/rules/CLAUDE.md'), 'none'); await L.measureL0({ repo: path.join(FIX, '../r2'), scenarios: [S('x', C('digest', 'rules/CLAUDE.md'))] }); });
await refused('a failing hook is refused', () => run([S('x', C('hook', 'pre-tool/fail.mjs', { event: 'E' }))]));
await refused('hook output that is not JSON is refused', () => run([S('x', C('hook', 'pre-tool/junk.mjs', { event: 'E' }))]));
await refused('hook JSON without additionalContext is refused', () => run([S('x', C('hook', 'pre-tool/noctx.mjs', { event: 'E' }))]));
await refused('a scenario of only a silent hook (zero bytes) is refused', () => run([S('x', C('hook', 'user-prompt-submit/silent.mjs', { event: 'E' }))]));
await refused('the same component twice in one scenario is refused', () => run([S('x', C('command', 'c'), C('command', 'c'))]));
await refused('a duplicate scenario id is refused', () => run([S('x', C('command', 'c')), S('x', C('skill', 's'))]));
await refused('an unknown kind is refused', () => run([S('x', C('rule', 'c'))]));
await refused('a path in a command name is refused', () => run([S('x', C('command', '../agents/a'))]));
await refused('a path in a hook name is refused', () => run([S('x', C('hook', '../x.mjs', { event: 'E' }))]));
await refused('an unexpected key is refused', () => run([S('x', C('command', 'c', { extra: 1 }))]));
await refused('a hook seed file escaping the project is refused', () => run([S('x', C('hook', 'session-start/emit.mjs', { event: 'E', files: { '../x': 'y' } }))]));
await refused('an absolute hook seed file is refused', () => run([S('x', C('hook', 'session-start/emit.mjs', { event: 'E', files: { '/x': 'y' } }))]));
await refused('an empty scenario list is refused', () => run([]));
await refused('a scenario without components is refused', () => run([{ id: 'x', components: [] }]));
await refused('a scenario id that is not a valid baseline key is refused', () => run([S('__proto__', C('command', 'c'))]));
await refused('an unknown frontmatter mode is refused', () => run(A, { frontmatter: 'maybe' }));
await refused('no repo is refused', () => L.measureL0({ scenarios: A }));
await refused('a missing repo directory is refused', () => L.measureL0({ repo: path.join(FIX, 'absent'), scenarios: A }));

// ---- the real repository ----
const file = JSON.parse(fs.readFileSync(`${ROOT}/benchmarks/usage-speed/l0-scenarios.json`, 'utf8'));
const tools = { somi_tier: 'x'.repeat(100) };
const real = await L.measureL0({ repo: ROOT, scenarios: file.scenarios, tools });
check('the real scenarios all measure at least one byte', Object.values(real).every((s) => Number.isInteger(s.bytes) && s.bytes >= 1), true);
check('the real run is repeatable', JSON.stringify(await L.measureL0({ repo: ROOT, scenarios: file.scenarios, tools })), JSON.stringify(real));
const size = (rel) => fs.statSync(path.join(ROOT, rel)).size;
const comp = (id, kind, name) => real[id].components.find((c) => c.kind === kind && c.name === name).bytes;
check('a real command counts its file size', comp('plan', 'command', 'plan'), size('commands/plan.md'));
check('a real agent counts its file size', comp('plan', 'agent', 'planner'), size('agents/planner.md'));
check('a real skill counts its file size', comp('dispatch', 'skill', 'somi-dispatch'), size('skills/somi-dispatch/SKILL.md'));
check('the prompt hook emits the digest, so it outweighs the digest alone', comp('first-prompt', 'hook', 'user-prompt-submit/inject-workflow-context.mjs') > comp('rules-digest', 'digest', 'rules/CLAUDE.md'), true);
check('every scenario total is the sum of its components', Object.values(real).every((s) => s.bytes === s.components.reduce((t, c) => t + c.bytes, 0)), true);
const strip = await L.measureL0({ repo: ROOT, scenarios: file.scenarios, tools, frontmatter: 'strip' });
check('stripping frontmatter shrinks a command scenario', strip.plan.bytes < real.plan.bytes, true);
const sc = [{ id: 'a', repeats: 8, requiredTier: null }];
const base = { schema: 1, sha: 'a'.repeat(40), pluginVersion: '4.0.0', date: '2026-10-20', rule: { version: 1, hash: 'b'.repeat(64) }, model: { alias: 'alias-a', tier: 'low' }, pinAll: true,
  host: { cpuModel: 'cpu-x', cores: 8, memGb: 16, osRelease: 'os-1', nodeVersion: 'v22', pluginVersion: '4.0.0' }, scenarios: sc, L0: L.l0Section(real), L1: { events: { e1: Array.from({ length: 30 }, () => 5) } }, L2: { rows: [] } };
check('a baseline carrying the real L0 section is valid', Sc.baselineProblems(base, { repoRoot: ROOT }), []);
const zero = JSON.parse(JSON.stringify(base)); zero.L0.bytes.plan = 0;
check('the schema does reject a zero L0 entry (the check above can fail)', Sc.baselineProblems(zero).some((p) => p.startsWith('L0')), true);

for (const [ok, name, got, want] of res) console.log(`${ok ? 'ok' : 'FAIL'}\t${name}${ok ? '' : ` (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`}`);
EOJ
)
suite() { local fx="$TMP/fx$RANDOM"; local tt="$TMP/tt$RANDOM"; mkdir -p "$fx" "$tt"; LIB="$1" ROOT="$ROOT" FIXDIR="$fx" TMPDIR="$tt" node --input-type=module -e "$CODE" 2>&1; }
out=$(suite "$ROOT/tests/evals/lib") || true

pass=0; fail=0
while IFS=$'\t' read -r status name; do
  case "$status" in
    ok)   pass=$((pass+1)); printf '  ok   %s\n' "$name" ;;
    FAIL) fail=$((fail+1)); printf '  FAIL %s\n' "$name" ;;
    *)    fail=$((fail+1)); printf '  FAIL unexpected output: %s\n' "$status $name" ;;
  esac
done <<< "$out"

# CLI: output, determinism, exit codes, audit log untouched, temp dirs removed.
CLI=tests/scripts/manual/usage-l0.mjs
chk() { if [ "$2" = "$3" ]; then pass=$((pass+1)); printf '  ok   %s\n' "$1"; else fail=$((fail+1)); printf '  FAIL %s (want %s, got %s)\n' "$1" "$3" "$2"; fi; }
mkdir "$TMP/cli-tmp"
audit_state() { if [ -e .somi/audit.log ]; then cksum .somi/audit.log; stat -c '%Y %s' .somi/audit.log; else echo none; fi; }
before="$(audit_state)"
TMPDIR="$TMP/cli-tmp" node "$CLI" --json >"$TMP/j1.json" 2>"$TMP/e1.txt"; chk "cli: --json exits 0" "$?" 0
TMPDIR="$TMP/cli-tmp" node "$CLI" --json >"$TMP/j2.json" 2>/dev/null
cmp -s "$TMP/j1.json" "$TMP/j2.json"; chk "cli: two runs are byte-identical" "$?" 0
chk "cli: the real .somi/audit.log is untouched" "$(audit_state)" "$before"
chk "cli: no temp project directory is left behind" "$(ls "$TMP/cli-tmp" | wc -l | tr -d ' ')" 0
TMPDIR="$TMP/cli-tmp" node "$CLI" >"$TMP/t.txt" 2>/dev/null; chk "cli: the table exits 0" "$?" 0
grep -q '^plan  [0-9]* bytes' "$TMP/t.txt" && grep -q 'tool somi_tier' "$TMP/t.txt" && grep -q 'hook session-start/' "$TMP/t.txt"; chk "cli: the table lists scenarios and components" "$?" 0
node -e "
const o = JSON.parse(require('fs').readFileSync('$TMP/j1.json', 'utf8'));
const t = o.scenarios['ship-loop-stage-m1'].components.find((c) => c.kind === 'tool');
process.exit(t && t.bytes > 500 && Object.values(o.L0.bytes).every((b) => b >= 1) ? 0 : 1)"; chk "cli: the tool definition is read from the live server and every scenario has bytes" "$?" 0
grep -q "$ROOT" "$TMP/j1.json"; chk "cli: no checkout path appears in the output" "$?" 1
node "$CLI" --bogus >/dev/null 2>&1; chk "cli: an unknown flag exits 64" "$?" 64
node "$CLI" --frontmatter maybe >/dev/null 2>&1; chk "cli: a bad frontmatter mode exits 64" "$?" 64
node "$CLI" --repo "$TMP/no-such-repo" >/dev/null 2>&1; chk "cli: a missing repo is refused (65)" "$?" 65
printf '{bad' > "$TMP/bad.json"
node "$CLI" --scenarios "$TMP/bad.json" >/dev/null 2>&1; chk "cli: an unparseable scenario file is refused (65)" "$?" 65

# Mutation: each rule is broken on a scratch copy of the library; the suite must then fail.
nm=0
mutant() { # from, to, label
  local d="$TMP/m$((++nm))"; mkdir "$d"; cp tests/evals/lib/bench-l0.mjs "$d/"
  if ! M_FILE="$d/bench-l0.mjs" M_FROM="$1" M_TO="$2" node -e "const f=process.env.M_FILE,fs=require('fs'),s=fs.readFileSync(f,'utf8');if(!s.includes(process.env.M_FROM))process.exit(3);fs.writeFileSync(f,s.replace(process.env.M_FROM,()=>process.env.M_TO))"; then fail=$((fail+1)); printf '  FAIL mutation did not apply: %s\n' "$3"; return; fi
  mo=$(suite "$d")
  if grep -qv $'^ok\t' <<< "$mo"; then pass=$((pass+1)); printf '  ok   mutation caught: %s\n' "$3"; else fail=$((fail+1)); printf '  FAIL mutation survived: %s\n' "$3"; fi
}
mutant "frontmatter === 'strip' ? stripFrontmatter(text) : text" "text" "frontmatter handling dropped"
mutant "const m = /^---\\r?\\n[\\s\\S]*?\\r?\\n---[ \\t]*(?:\\r?\\n|\$)/.exec(text);" "const m = /^---\\n[\\s\\S]*?\\n---\\n/.exec(text);" "CRLF frontmatter no longer stripped"
mutant "t + c.bytes, 0)" "t + c.bytes * 2, 0)" "components counted twice"
mutant "if (keys.has(key)) fail(" "if (false) fail(" "duplicate component allowed"
mutant "if (c.kind === 'hook') return hookBytes(repo, c);" "if (c.kind === 'hook') return 1;" "hook not run"
mutant "return bytesOf(ctx);" "return bytesOf(out);" "hook output not measured (whole stdout counted)"
mutant "if (out.trim() === '') return 0;" "if (out.trim() === '') return 1;" "silent hook counted as a byte"
mutant "text.slice(a + DIGEST_START.length, b)" "text.slice(a, b)" "digest markers counted"
mutant "if (bytes < 1) fail(" "if (false) fail(" "zero-byte scenario allowed"
mutant "if (!st.isFile()) fail(" "if (false) fail(" "symlinked file allowed"
mutant "catch { return fail(\`\${what} is missing or unreadable\`); }" "catch { return ''; }" "missing file counted as empty"
mutant "if (typeof text !== 'string' || text === '') fail(" "if (false) fail(" "missing tool counted as empty"
mutant "env = { PATH: process.env.PATH ?? ''," "env = { ...process.env, PATH: process.env.PATH ?? ''," "environment not allowlisted"
mutant "SOMI_AUDIT_LOG: join(proj, 'audit.log') }" "X_UNUSED: '1' }" "audit log not redirected"
mutant "rmSync(proj, { recursive: true, force: true });" "void proj;" "temp project not removed"
mutant "if (typeof ctx !== 'string') return fail(" "if (false) return fail(" "hook without additionalContext allowed"

ran=$((pass + fail))
[ "$ran" -ge 70 ] || { fail=$((fail+1)); echo "  FAIL ran $ran checks, fewer than the 70 written"; }
echo
printf '  %d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
