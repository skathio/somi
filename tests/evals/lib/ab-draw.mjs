// Draw machinery for the SoMi-vs-bare experiment: workspace preparation, the child environment, the sandbox, the claude
// command line per arm, process control, outcome classification and the plugin package. A library: no entrypoint,
// only node built-ins and sibling libraries (stream hygiene is in ab-stream.mjs, the report in ab-report.mjs). It runs a
// model agent with host access (bypassPermissions) and handles one credential, so every doubt is a refusal and nothing
// here prints or stores the token.
//
// Workspace (prepareWorkspace): a fresh 0700 directory per draw OUTSIDE the repository (a parent CLAUDE.md would
//   otherwise reach the bare arm), the task's fixture/ files (regular files from the task manifest, no link), the optional
//   hidden/setup.mjs run the way admission runs it, a .somi/config.json with the cost ceiling, then git init and one
//   commit (local identity, no hooks). The 'before' manifest is taken last, so none of that counts as a candidate change.
//   DEVIATION from the experiment plan (section 2: the bare arm must have no .somi/): BOTH workspaces carry the same
//   .somi/config.json so they are byte-identical apart from the plugin; the bare arm has no plugin to read it, so it only
//   sits there as an inert file. Recorded here because a plan that says "no .somi" would otherwise be silently contradicted.
// Arms differ in ONE thing: the SoMi arm gets `--plugin-dir <packed plugin>` and a `/somi:ship-loop ` prefix on the same
//   task text. The plugin is the npm package of the repository extracted read-only (buildPlugin), never the checkout.
// Environment (childEnv): an allowlist of five variables; the token is a parameter, never read from process.env.
// Sandbox (sandboxArgs): bubblewrap, read-only root, the real HOME and /tmp replaced by empty tmpfs, then only the claude
//   and PATH directories (read-only), the plugin (read-only) and the draw directory (read-write) bound back; a new pid
//   namespace dies with the leader. The repository, ~/.claude, ~/.ssh and other draws' directories are not visible. The
//   network stays shared (the model needs it).
// Pauses: a SoMi turn that ends in a question or an approval request is answered once per resume (at most MAX_RESUMES),
//   with `--resume <session>` and the remaining budget; see looksPaused. The bare arm is never resumed.
// Process control: detached child (own group), stdin closed, ONE deadline for all turns of a draw, output cap; the group
//   is killed when the leader exits and the draw's leftovers are swept by their environment (ab-stream.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { lstatManifest } from './manifest.mjs';
import { MAX_STREAM_BYTES, createSink, redactToken, sweepProcesses } from './ab-stream.mjs';

export const MAX_RESUMES = 4;
const STDERR_CAP = 1024 * 1024;
const MIN_REMAINING_USD = 0.1;
const SETUP_MS = 20000;
export const RESUME_PROMPT = 'Approved. Continue to completion without further questions.';
const AUTH_STDERR = /\b401\b|not logged in|invalid (api key|authentication)|authentication[_ ]error|oauth token.{0,40}(expired|revoked)/i;
const TERMINAL_QUESTION = /\?[\s"'*_)\]`]*$/;
const CHECKPOINT_MENU = /\bapprove\b[^\n]{0,120}\brevise\b[^\n]{0,120}\babort\b/i;
const EXPLICIT_REQUEST = /\b(reply|respond|answer)\b[^\n]{0,20}\bapprove\b|\b(awaiting|waiting for) (your )?(approval|confirmation)\b|\b(shall|should|may) I\b[^.]*\?/i;

// ---- command line and environment ----------------------------------------------------------------------------

/** The task text both arms get: a preface, the numbered statements, the declared-scope sentence. No canary, no brief. */
export function taskText(task) {
  const list = [...task.source, `${task.test_dir}/`, ...task.root_files];
  const where = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  return `Implement the following in this repository.\n${task.statements.join('\n')}\nDeclared scope: you may change files under ${where} only.`;
}
export const armPrompt = (arm, text) => (arm === 'somi' ? `/somi:ship-loop ${text}` : text);

/** Whole-dollar-cent budget rounded DOWN, so the cap is never above what was asked. */
const usd = (x) => (Math.floor(x * 100) / 100).toFixed(2);
// The web tools are disabled for both arms (a shell can still reach the network). The list is one comma-separated value:
// the flag is variadic, and every flag after it is an option, so nothing can be swallowed.
export function claudeArgv({ arm, prompt, budget, plugin, resume, model }) {
  return ['--print', prompt, '--output-format', 'stream-json', '--verbose', '--model', model, '--max-budget-usd', usd(budget),
    '--permission-mode', 'bypassPermissions', '--disallowed-tools', 'WebFetch,WebSearch', ...(arm === 'somi' ? ['--plugin-dir', plugin] : []), ...(resume ? ['--resume', resume] : [])];
}

/** The only variables the claude child sees. HOME and the config directory are fresh per draw. */
export function childEnv({ token, tmp, tokenFd = false }) {
  const base = { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', HOME: tmp, CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg') };
  return tokenFd ? { ...base, CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3' } : { ...base, CLAUDE_CODE_OAUTH_TOKEN: token };
}

/**
 * Pause heuristic. A SoMi turn is waiting for the operator ONLY when its last assistant text (1) ends in a question, or (2) shows the
 * checkpoint menu (approve, revise, abort), or (3) explicitly asks for approval or confirmation. Words like "approve" or "confirmed"
 * inside a status report are not a pause.
 */
export function looksPaused(text) {
  const t = String(text ?? '').trim();
  return TERMINAL_QUESTION.test(t) || CHECKPOINT_MENU.test(t) || EXPLICIT_REQUEST.test(t);
}

/** The env file -> {ok: true, token} or {ok: false, reason}. Owner-only, one regular file, one key, no echo of its content. */
export function readEnvFile(file) {
  let fd = null;
  const ok = (st) => st.isFile() && (st.mode & 0o077) === 0 && st.uid === process.getuid() && st.size <= 4096;
  try {
    const l = fs.lstatSync(file);
    if (!l.isFile()) return { ok: false, reason: 'the env file is not a regular file' };
    if ((l.mode & 0o077) !== 0) return { ok: false, reason: 'the env file must not be accessible to group or others (mode 0600)' };
    if (l.uid !== process.getuid()) return { ok: false, reason: 'the env file is not owned by the current user' };
    if (l.size > 4096) return { ok: false, reason: 'the env file is larger than 4096 bytes' };
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    if (!ok(fs.fstatSync(fd))) return { ok: false, reason: 'the env file changed while it was opened' };
    const text = fs.readFileSync(fd, 'utf8');
    let token = null;
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const m = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
      if (!m || m[1] !== 'CLAUDE_CODE_OAUTH_TOKEN' || token !== null) return { ok: false, reason: 'the env file must hold exactly one line CLAUDE_CODE_OAUTH_TOKEN=<value>' };
      const q = /^(["'])(.*)(["'])$/.exec(m[2]);
      if (q && q[1] !== q[3]) return { ok: false, reason: 'the token is missing or malformed' };
      token = q ? q[2] : m[2];
    }
    // The strict alphabet means the token's JSON form equals its raw form, so a stream scan for the raw literal is exact.
    return token !== null && /^[A-Za-z0-9_-]{16,512}$/.test(token) ? { ok: true, token } : { ok: false, reason: 'the token is missing or malformed' };
  } catch { return { ok: false, reason: 'the env file could not be read' }; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* read-only handle */ } }
}

// ---- sandbox --------------------------------------------------------------------------------------------------

const under = (p, dir) => p === dir || p.startsWith(`${dir}/`);
/** Absolute real path of a command (looked up in PATH when it has no slash), or null. */
export function resolveBinary(name) {
  const cands = name.includes('/') ? [path.resolve(name)] : (process.env.PATH ?? '').split(':').filter(Boolean).map((d) => path.join(d, name));
  for (const c of cands) { try { const r = fs.realpathSync(c); if (fs.statSync(r).isFile()) return r; } catch { /* next */ } }
  return null;
}
/** The bubblewrap command line (without the program name) running `command argv` in the sandbox described by `spec`. */
export function sandboxArgs(spec, command, argv) {
  const a = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--tmpfs', spec.home, '--tmpfs', '/tmp'];
  if (!under(spec.repoRoot, spec.home) && !under(spec.repoRoot, '/tmp')) a.push('--tmpfs', spec.repoRoot);
  for (const p of spec.ro) a.push('--ro-bind', p, p);
  for (const p of spec.rw) a.push('--bind', p, p);
  return [...a, '--unshare-pid', '--die-with-parent', '--new-session', '--share-net', '--', command, ...argv];
}
/** The spec for one run: the claude binary's directory and every PATH directory under HOME, read-only; `rw` per draw. */
export function sandboxSpec({ home, repoRoot, claudeReal, plugin }) {
  const ro = new Set([path.dirname(claudeReal)]);
  for (const d of (process.env.PATH ?? '').split(':').filter(Boolean)) { try { const r = fs.realpathSync(d); if (under(r, home)) ro.add(r); } catch { /* absent */ } }
  if (plugin) ro.add(plugin);
  return { home, repoRoot, ro: [...ro].filter((p) => fs.existsSync(p)) };
}
/** True when bubblewrap runs a harmless command with this spec. */
export const probeSandbox = (spec) => spawnSync('bwrap', sandboxArgs({ ...spec, rw: [] }, 'true', []), { stdio: 'ignore', timeout: 10000 }).status === 0;

// ---- workspace and plugin ---------------------------------------------------------------------------------------

const PATH_ONLY = (home) => ({ PATH: process.env.PATH ?? '', HOME: home });
/** Fresh directories under `tmp` (made by the caller with mkdtemp) -> {ws, before}; throws an Error naming the step that failed. */
export function prepareWorkspace({ taskDir, tmp }) {
  const ws = path.join(tmp, 'ws');
  fs.mkdirSync(ws, { mode: 0o700 });
  fs.mkdirSync(path.join(tmp, 'cfg'), { mode: 0o700 });
  const root = taskDir.replace(/\/+$/, '');
  const m = lstatManifest(root);
  if (!m?.ok) throw new Error('the task directory could not be read');
  for (const [p] of m.files) {
    if (!p.startsWith('fixture/')) continue;
    const from = `${root}/${p}`; const to = path.join(ws, p.slice('fixture/'.length));
    if (!fs.lstatSync(from).isFile()) throw new Error('a fixture entry is not a regular file');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
  // Same invocation as task admission, so the files git cannot hold on every host exist before the snapshot.
  if (m.files.some(([p]) => p === 'hidden/setup.mjs')) {
    const r = spawnSync(process.execPath, [path.resolve(root, 'hidden/setup.mjs'), ws], { cwd: ws, env: PATH_ONLY(ws), stdio: 'ignore', timeout: SETUP_MS, killSignal: 'SIGKILL' });
    if (r.error || r.status !== 0) throw new Error('the task setup failed');
  }
  fs.mkdirSync(path.join(ws, '.somi'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.somi', 'config.json'), `${JSON.stringify({ cost: { ceiling: 'medium' } })}\n`);
  const git = (...a) => { const r = spawnSync('git', a, { cwd: ws, env: { ...PATH_ONLY(tmp), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'ignore', timeout: SETUP_MS }); if (r.error || r.status !== 0) throw new Error(`git ${a[0]} failed`); };
  git('init', '-q', '-b', 'main', '--template=');
  git('config', 'user.name', 'somi-ab');
  git('config', 'user.email', 'ab@example.invalid');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', 'initial');
  const before = lstatManifest(ws);
  if (!before?.ok) throw new Error('the before manifest was refused');
  return { ws, before };
}

/** `npm pack` the repository into `runTmp` and extract it read-only -> the plugin directory. Throws on any doubt. */
export function buildPlugin({ repoRoot, runTmp }) {
  const env = { PATH: process.env.PATH ?? '', HOME: runTmp, npm_config_cache: path.join(runTmp, 'npm-cache'), npm_config_update_notifier: 'false' };
  const pack = spawnSync('npm', ['pack', '--ignore-scripts', '--silent', '--pack-destination', runTmp], { cwd: repoRoot, env, encoding: 'utf8', timeout: 120000 });
  const name = (pack.stdout ?? '').trim().split('\n').pop();
  if (pack.status !== 0 || !/^[A-Za-z0-9._@-]+\.tgz$/.test(name)) throw new Error('npm pack failed');
  const dest = path.join(runTmp, 'plugin');
  fs.mkdirSync(dest, { mode: 0o700 });
  const tar = spawnSync('tar', ['-xzf', path.join(runTmp, name), '-C', dest, '--strip-components=1', '--no-same-owner'], { stdio: 'ignore', timeout: 60000 });
  if (tar.status !== 0) throw new Error('extracting the package failed');
  const m = lstatManifest(dest);
  if (!m?.ok || m.files.some(([p]) => p.startsWith('tests/evals/') || p.startsWith('.somi/') || p.includes('/manual/'))) throw new Error('the packed plugin holds files that must not ship');
  const lock = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) lock(p); else fs.chmodSync(p, fs.statSync(p).mode & 0o111 ? 0o500 : 0o400); } fs.chmodSync(d, 0o500); };
  lock(dest);
  return dest;
}

// ---- process control ---------------------------------------------------------------------------------------------

/** Run one invocation to its end -> {error, timedOut, code, stderr}. `kills` collects group killers for signals and exit. */
export function runClaude({ command, args, env, cwd, sink, timeoutMs, kills, fdToken }) {
  return new Promise((resolve) => {
    const out = { error: null, timedOut: false, code: null, stderr: '' };
    const timers = []; let child; let finished = false;
    const killGroup = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* the group is already gone */ } };
    const finish = () => { if (finished) return; finished = true; timers.forEach(clearTimeout); kills?.delete(killGroup); resolve(out); };
    // A process outside the group can hold a pipe open; the driver stops waiting for it.
    const release = () => { child?.stdout?.destroy(); child?.stderr?.destroy(); finish(); };
    try { child = spawn(command, args, { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe', ...(fdToken ? ["pipe"] : [])] }); } catch (e) { out.error = e?.code ?? 'spawn'; return finish(); }
    kills?.add(killGroup);
    timers.push(setTimeout(() => { out.timedOut = true; killGroup(); timers.push(setTimeout(release, 1000)); }, Math.max(1, timeoutMs)));
    child.on('error', (e) => { out.error = e?.code ?? 'spawn'; if (!child.pid) finish(); });
    if (fdToken && child.stdio[3]) { child.stdio[3].on("error", () => {}); child.stdio[3].end(fdToken); }
    child.stdout.on('data', (c) => { sink.feed(c); if (sink.state.capped) killGroup(); });
    child.stderr.on('data', (c) => { if (out.stderr.length < STDERR_CAP) out.stderr += c.toString('utf8').slice(0, STDERR_CAP - out.stderr.length); });
    child.on('exit', () => { killGroup(); timers.push(setTimeout(release, 2000)); });
    child.on('close', (code) => { killGroup(); out.code = code; finish(); });
  });
}

/** All turns of one draw -> the facts classify() needs. The token is only ever handed to the child and the sink. */
export async function runDraw({ model, arm, prompt, budget, timeoutMs, claude, env, cwd, plugin, drawDir, token, tokenFd, canary, task, absAb, ownTmp, maxBytes = MAX_STREAM_BYTES, sandbox, kills }) {
  const sink = createSink(path.join(drawDir, 'stream.jsonl'), { token, canary, task, absAb, ownTmp, maxBytes });
  const run = { arm, cost: 0, turns: 0, resumes: 0, models: new Set(), exhausted: false, error: null, timedOut: false, stderr: '', result: null };
  const deadline = Date.now() + timeoutMs; const started = Date.now();
  let session = null; let text = prompt;
  try {
    for (;;) {
      sink.turn();
      const argv = claudeArgv({ model, arm, prompt: text, budget: budget - run.cost, plugin, resume: session });
      const launch = sandbox ? { command: 'bwrap', args: sandboxArgs({ ...sandbox, rw: [ownTmp] }, claude, argv) } : { command: claude, args: argv };
      const r = await runClaude({ ...launch, env, cwd, sink, timeoutMs: deadline - Date.now(), kills, fdToken: tokenFd ? token : null });
      run.stderr += r.stderr; run.error = r.error; run.timedOut = r.timedOut;
      const res = sink.state.result; run.result = res;
      if (r.error || r.timedOut || sink.state.capped || !res) break;
      run.cost += Number.isFinite(res.total_cost_usd) ? res.total_cost_usd : 0;
      run.turns += Number.isInteger(res.num_turns) ? res.num_turns : 0;
      for (const k of Object.keys(res.modelUsage ?? {})) run.models.add(k);
      session = typeof res.session_id === 'string' ? res.session_id : null;
      if (arm !== 'somi' || res.subtype !== 'success' || session === null || !looksPaused(sink.state.text) || run.resumes >= MAX_RESUMES) break;
      if (budget - run.cost < MIN_REMAINING_USD) { run.exhausted = true; break; }
      run.resumes++; text = RESUME_PROMPT;
    }
  } finally { await sweepProcesses(`CLAUDE_CONFIG_DIR=${env.CLAUDE_CONFIG_DIR}`); sink.end(); }
  return { ...run, models: [...run.models].sort(), text: sink.state.text, leaks: [...sink.state.leaks].sort(), capped: sink.state.capped, wallMs: Date.now() - started, stderr: redactToken(run.stderr, token) };
}

/** Facts -> {outcome, reason} in the compareArms vocabulary; the first matching rule wins. */
export function classify({ run, arm, budget }) {
  const inv = (reason) => ({ outcome: 'invalid', reason });
  const r = run.result;
  if (run.error) return inv(`spawn-error:${run.error}`);
  if (run.leaks.length > 0) return inv(`leak:${run.leaks.join(',')}`);
  if (run.capped) return inv('output-cap');
  if (run.timedOut) return inv('timeout');
  if (!r) return inv(AUTH_STDERR.test(run.stderr) ? 'auth' : 'no-result');
  if (r.is_error && (AUTH_STDERR.test(run.stderr) || /please run \/login/i.test(String(r.result ?? '')))) return inv('auth');
  if (r.subtype === 'error_max_budget_usd' || run.cost > budget || run.exhausted) return { outcome: 'over-budget', reason: 'budget exhausted' };
  if (arm === 'somi' && r.subtype === 'success' && looksPaused(run.text)) return { outcome: 'paused', reason: `still waiting after ${run.resumes} resume(s)` };
  return { outcome: 'scored', reason: r.subtype === 'success' ? '' : String(r.subtype ?? 'no-subtype').slice(0, 40) };
}

/** Fold a scoreHidden result into the row -> a halt message, or null. A scorer fault, a changed task or a tampered harness halts the run. */
export function foldScore(row, sc) {
  if (!sc.ok) { Object.assign(row, { outcome: 'invalid', reason: `scorer-fault: ${sc.reason}` }); return `${row.draw}: ${sc.reason}`; }
  row.green = sc.green; row.failedNames = sc.failed.slice(0, 50);
  row.flags = { timedOut: sc.timedOut, crashed: sc.crashed, integrity: sc.integrity, tampered: sc.tampered, taskChanged: sc.taskChanged, truncated: sc.truncated };
  if (sc.taskChanged) { Object.assign(row, { outcome: 'invalid', reason: 'task-changed' }); return `${row.draw}: the task changed during the run`; }
  if (sc.tampered) { Object.assign(row, { outcome: 'invalid', reason: 'tampered' }); return `${row.draw}: the scoring harness was tampered with`; }
  return null;
}

/** Seeded Fisher-Yates over a mulberry32 stream: the same seed and list always give the same order. */
export function seededShuffle(list, seed) {
  let a = seed >>> 0;
  const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
