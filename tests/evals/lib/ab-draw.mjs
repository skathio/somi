// Draw machinery for the SoMi-vs-bare experiment: workspace preparation, the child environment, the claude command line
// per arm, process control and outcome classification. A library: no entrypoint, only node built-ins and sibling
// libraries (stream hygiene is in ab-stream.mjs, the sandbox and the plugin package in ab-sandbox.mjs, the report in ab-report.mjs). It runs a
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
// Arms differ in ONE thing: the SoMi arm gets `--plugin-dir <packed plugin>` and a command prefix on the same
//   task text. The plugin is the npm package of the repository extracted read-only (buildPlugin in ab-sandbox.mjs), never the checkout.
// Environment (childEnv): an allowlist of six variables; the token is a parameter, never read from process.env. The sixth,
//   CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0, makes `claude --print` wait for background work without its own 600 s ceiling
//   (a SoMi planner runs in the background); it is set for both arms, and the per-draw deadline stays the hard bound.
// Sandbox (sandboxArgs in ab-sandbox.mjs): bubblewrap, read-only root, the real HOME and /tmp replaced by empty tmpfs, then only the claude
//   and PATH directories (read-only), the plugin (read-only) and the draw directory (read-write) bound back; a new pid
//   namespace dies with the leader. The repository, ~/.claude, ~/.ssh and other draws' directories are not visible. The
//   network stays shared (the model needs it).
// Pauses: a SoMi turn that ends in a question or an approval request is answered once per resume (at most MAX_RESUMES),
//   with `--resume <session>` and the remaining budget; see looksPaused. Every arm is resumed by the same rule.
// Process control: detached child (own group), stdin closed, ONE deadline for all turns of a draw, output cap; the group
//   is killed when the leader exits and the draw's leftovers are swept by their environment (ab-stream.mjs).

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { lstatManifest } from './manifest.mjs';
import { sandboxArgs } from './ab-sandbox.mjs';
import { MAX_STREAM_BYTES, createSink, redactToken, sweepProcesses } from './ab-stream.mjs';

export const MAX_RESUMES = 4;
const STDERR_CAP = 1024 * 1024;
const MIN_REMAINING_USD = 0.1;
const SETUP_MS = 20000;
export const RESUME_PROMPT = 'Approved. Take your recommended option on every open question, and continue to completion without further questions.';
const AUTH_STDERR = /\b401\b|not logged in|invalid (api key|authentication)|authentication[_ ]error|oauth token.{0,40}(expired|revoked)/i;
const TERMINAL_QUESTION = /\?[\s"'*_)\]`]*$/;
const CHECKPOINT_MENU = /\bapprove\b[\s\S]{0,240}\brevise\b[\s\S]{0,240}\babort\b/i;
// A plugin arm's gate laid out as a list: "Reply to continue:" with `approve` and `abort` on later lines, as newer models lay it out.
const GATE_MENU = /\b(reply|respond|answer)\b[\s\S]{0,120}?\bapprove\b[\s\S]{0,400}?\babort\b/i;
const EXPLICIT_REQUEST = /\b(reply|respond|answer) with (a|your|one|the)\b|\btake the recommendations?\b|\bneeds? [^.\n]{0,40}\b(decisions?|answers?) from you\b|\b(reply|respond|answer)\b[^\n]{0,20}\bapprove\b|\b(awaiting|waiting for) (your )?(approval|confirmation)\b|\bneeds? your (verdict|decision|approval|input)\b|\b(shall|should|may) I\b[^.]*\?/i;

// ---- command line and environment ----------------------------------------------------------------------------

/** The task text both arms get: a preface, the numbered statements, the declared-scope sentence. No canary, no brief. */
export function taskText(task) {
  const list = [...task.source, `${task.test_dir}/`, ...task.root_files];
  const where = list.length > 1 ? `${list.slice(0, -1).join(', ')} and ${list.at(-1)}` : list[0];
  return `Implement the following in this repository.\n${task.statements.join('\n')}\nDeclared scope: you may change files under ${where} only.`;
}

/** Whole-dollar-cent budget rounded DOWN, so the cap is never above what was asked. */
const usd = (x) => (Math.floor(x * 100) / 100).toFixed(2);
// The web tools are disabled for both arms (a shell can still reach the network). The list is one comma-separated value:
// the flag is variadic, and every flag after it is an option, so nothing can be swallowed.
export function claudeArgv({ arm, prompt, budget, plugin, resume, model, settings }) {
  return ['--print', prompt, '--output-format', 'stream-json', '--verbose', '--model', model, '--max-budget-usd', usd(budget),
    '--permission-mode', 'bypassPermissions', '--disallowed-tools', 'WebFetch,WebSearch', ...(arm === 'somi' ? ['--plugin-dir', plugin, '--agent', 'somi:somi'] : arm === 'somi-hooks' ? ['--plugin-dir', plugin] : []), ...(settings ? ['--settings', JSON.stringify(settings)] : []), ...(resume ? ['--resume', resume] : [])];
}

/** The only variables the claude child sees. HOME and the config directory are fresh per draw. */
export function childEnv({ token, tmp, tokenFd = false }) {
  const base = { PATH: process.env.PATH ?? '', LANG: 'C.UTF-8', HOME: tmp, CLAUDE_CONFIG_DIR: path.join(tmp, 'cfg'), CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0' };
  return tokenFd ? { ...base, CLAUDE_CODE_OAUTH_TOKEN_FILE_DESCRIPTOR: '3' } : { ...base, CLAUDE_CODE_OAUTH_TOKEN: token };
}

/**
 * Pause heuristic. A SoMi turn is waiting for the operator ONLY when its last assistant text (1) ends in a question, or (2) shows the
 * checkpoint menu (approve, revise, abort) or a reply cue followed by approve and abort, or (3) explicitly asks for approval or confirmation. Words like "approve" or "confirmed"
 * inside a status report are not a pause.
 */
export function looksPaused(text) {
  const t = String(text ?? '').trim();
  return TERMINAL_QUESTION.test(t) || CHECKPOINT_MENU.test(t) || GATE_MENU.test(t) || EXPLICIT_REQUEST.test(t);
}

const ENV_ONE_LINE = 'the env file must hold exactly one line CLAUDE_CODE_OAUTH_TOKEN=<value>';
const ENV_BAD_TOKEN = 'the token is missing or malformed';
// What the file must be before it is read, checked on the lstat and again on the open descriptor: a reason, or null.
function envFileRefusal(st) {
  if (!st.isFile()) return 'the env file is not a regular file';
  if ((st.mode & 0o077) !== 0) return 'the env file must not be accessible to group or others (mode 0600)';
  if (st.uid !== process.getuid()) return 'the env file is not owned by the current user';
  if (st.size > 4096) return 'the env file is larger than 4096 bytes';
  return null;
}
function tokenValue(line, token) {
  const m = /^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line);
  if (!m || m[1] !== 'CLAUDE_CODE_OAUTH_TOKEN' || token !== null) return { reason: ENV_ONE_LINE };
  const q = /^(["'])(.*)(["'])$/.exec(m[2]);
  if (q && q[1] !== q[3]) return { reason: ENV_BAD_TOKEN };
  return { token: q ? q[2] : m[2] };
}
// The file's one token line, among blank lines and comments: {token} or {reason}.
function tokenLine(text) {
  let token = null;
  for (const line of text.split('\n').map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'))) {
    const value = tokenValue(line, token);
    if (value.reason) return value;
    token = value.token;
  }
  // The strict alphabet means the token's JSON form equals its raw form, so a stream scan for the raw literal is exact.
  return token !== null && /^[A-Za-z0-9_-]{16,512}$/.test(token) ? { token } : { reason: ENV_BAD_TOKEN };
}
const closeQuietly = (fd) => { try { fs.closeSync(fd); } catch { /* read-only handle */ } };

/** The env file -> {ok: true, token} or {ok: false, reason}. Owner-only, one regular file, one key, no echo of its content. */
export function readEnvFile(file) {
  let fd = null;
  try {
    const refusal = envFileRefusal(fs.lstatSync(file));
    if (refusal) return { ok: false, reason: refusal };
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    if (envFileRefusal(fs.fstatSync(fd))) return { ok: false, reason: 'the env file changed while it was opened' };
    const read = tokenLine(fs.readFileSync(fd, 'utf8'));
    return read.reason ? { ok: false, reason: read.reason } : { ok: true, token: read.token };
  } catch { return { ok: false, reason: 'the env file could not be read' }; } finally { if (fd !== null) closeQuietly(fd); }
}

// ---- workspace ------------------------------------------------------------------------------------------

const PATH_ONLY = (home) => ({ PATH: process.env.PATH ?? '', HOME: home });
function copyFixture(root, files, ws) {
  for (const [p] of files.filter(([f]) => f.startsWith('fixture/'))) {
    const from = `${root}/${p}`; const to = path.join(ws, p.slice('fixture/'.length));
    if (!fs.lstatSync(from).isFile()) throw new Error('a fixture entry is not a regular file');
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
  }
}
// Same invocation as task admission, so the files git cannot hold on every host exist before the snapshot.
function runTaskSetup(root, ws) {
  const r = spawnSync(process.execPath, [path.resolve(root, 'hidden/setup.mjs'), ws], { cwd: ws, env: PATH_ONLY(ws), stdio: 'ignore', timeout: SETUP_MS, killSignal: 'SIGKILL' });
  if (r.error || r.status !== 0) throw new Error('the task setup failed');
}
function writeConfigs(ws, tmp, { config, globalConfig }) {
  fs.mkdirSync(path.join(ws, '.somi'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.somi', 'config.json'), `${JSON.stringify(config)}\n`);
  // Reviewers read only the user's own config, so a recording pins their model there. childEnv makes tmp the home directory.
  if (!globalConfig) return;
  fs.mkdirSync(path.join(tmp, '.config', 'somi'), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(tmp, '.config', 'somi', 'config.json'), `${JSON.stringify(globalConfig)}\n`);
}
function commitWorkspace(ws, tmp) {
  const git = (...a) => { const r = spawnSync('git', a, { cwd: ws, env: { ...PATH_ONLY(tmp), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }, stdio: 'ignore', timeout: SETUP_MS }); if (r.error || r.status !== 0) throw new Error(`git ${a[0]} failed`); };
  git('init', '-q', '-b', 'main', '--template=');
  git('config', 'user.name', 'somi-ab');
  git('config', 'user.email', 'ab@example.invalid');
  git('config', 'core.hooksPath', '/dev/null');
  git('add', '-A');
  git('commit', '-q', '--no-verify', '-m', 'initial');
}

/** Fresh directories under `tmp` (made by the caller with mkdtemp) -> {ws, before}; throws an Error naming the step that failed. */
/** `cost` is the already-validated `cost` block of the workspace's .somi/config.json (plain data; the caller validates it). */
export function prepareWorkspace({ taskDir, tmp, config = { cost: { ceiling: 'medium' } }, globalConfig }) {
  const ws = path.join(tmp, 'ws');
  fs.mkdirSync(ws, { mode: 0o700 });
  fs.mkdirSync(path.join(tmp, 'cfg'), { mode: 0o700 });
  const root = taskDir.replace(/\/+$/, '');
  const m = lstatManifest(root);
  if (!m?.ok) throw new Error('the task directory could not be read');
  copyFixture(root, m.files, ws);
  if (m.files.some(([p]) => p === 'hidden/setup.mjs')) runTaskSetup(root, ws);
  writeConfigs(ws, tmp, { config, globalConfig });
  commitWorkspace(ws, tmp);
  const before = lstatManifest(ws);
  if (!before?.ok) throw new Error('the before manifest was refused');
  return { ws, before };
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

// A resumed session reports what the whole session has cost so far, so each session counts once, at its latest total.
function addUsage({ run, loop }, res, turns) {
  loop.sessionCosts.set(typeof res.session_id === 'string' ? res.session_id : `run-${loop.sessionCosts.size}`, Number.isFinite(res.total_cost_usd) ? res.total_cost_usd : 0);
  run.cost = [...loop.sessionCosts.values()].reduce((s, c) => s + c, 0);
  run.turns += turns;
  for (const k of Object.keys(res.modelUsage ?? {})) run.models.add(k);
  loop.session = typeof res.session_id === 'string' ? res.session_id : null;
}

// One invocation, folded into the run: its result event, or null when it failed or ended without one.
async function oneCall(o, draw) {
  const { sink, run, loop } = draw;
  sink.turn();
  const argv = claudeArgv({ model: o.model, arm: o.arm, prompt: loop.text, budget: o.budget - run.cost, plugin: o.plugin, resume: loop.session, settings: o.settings });
  const launch = o.sandbox ? { command: 'bwrap', args: sandboxArgs({ ...o.sandbox, rw: [o.ownTmp] }, o.claude, argv) } : { command: o.claude, args: argv };
  const r = await runClaude({ ...launch, env: o.env, cwd: o.cwd, sink, timeoutMs: loop.deadline - Date.now(), kills: o.kills, fdToken: o.tokenFd ? o.token : null });
  run.stderr += r.stderr; run.error = r.error; run.timedOut = r.timedOut;
  const res = sink.state.result; run.result = res;
  if (r.error || r.timedOut || sink.state.capped || !res) return null;
  addUsage(draw, res, sink.state.turns);
  return res;
}

// What the draw sends next, or null when it is done. A session that asked a question gets the fixed approval. One that finished gets the
// task's next scripted message, the way a user carries on a conversation, so a task can test what survives across turns.
function nextMessage(o, { sink, run, loop }, res) {
  if (sink.state.limit || res.subtype !== 'success' || loop.session === null) return null;
  const paused = looksPaused(sink.state.text);
  const resume = paused && run.resumes < o.maxResumes;
  const followUp = !paused && run.followUps < o.followUps.length;
  if (!resume && !followUp) return null;
  if (o.budget - run.cost < MIN_REMAINING_USD) { run.exhausted = true; return null; }
  if (resume) { run.resumes++; return RESUME_PROMPT; }
  return o.followUps[run.followUps++];
}

/** All turns of one draw -> the facts classify() needs. The token is only ever handed to the child and the sink. */
export async function runDraw({ followUps = [], maxBytes = MAX_STREAM_BYTES, maxResumes = MAX_RESUMES, ...rest }) {
  const o = { ...rest, followUps, maxResumes };
  const sink = createSink(path.join(o.drawDir, 'stream.jsonl'), { token: o.token, canary: o.canary, task: o.task, absAb: o.absAb, ownTmp: o.ownTmp, maxBytes });
  const run = { arm: o.arm, cost: 0, turns: 0, resumes: 0, followUps: 0, models: new Set(), exhausted: false, error: null, timedOut: false, stderr: '', result: null };
  const started = Date.now();
  const draw = { sink, run, loop: { deadline: started + o.timeoutMs, session: null, text: o.prompt, sessionCosts: new Map() } };
  try {
    for (;;) {
      const res = await oneCall(o, draw);
      const next = res && nextMessage(o, draw, res);
      if (!next) break;
      draw.loop.text = next;
    }
  } finally { await sweepProcesses(`CLAUDE_CONFIG_DIR=${o.env.CLAUDE_CONFIG_DIR}`); sink.end(); }
  return { ...run, models: [...run.models].sort(), text: sink.state.text, leaks: [...sink.state.leaks].sort(), capped: sink.state.capped, limit: sink.state.limit, reset: sink.state.reset, wallMs: Date.now() - started, stderr: redactToken(run.stderr, o.token) };
}

// The draws that say nothing about the arm, in order: the first that matches names the reason.
const INVALID = [
  [(run) => run.error, (run) => `spawn-error:${run.error}`],
  [(run) => run.leaks.length > 0, (run) => `leak:${run.leaks.join(',')}`],
  [(run) => run.capped, () => 'output-cap'],
  [(run) => run.timedOut, () => 'timeout'],
  // An exhausted usage window ends a call as a success; it is an infrastructure failure and outranks every other reading.
  [(run) => run.limit, () => 'account-limit'],
  // The CLI ended the session on its own background-wait ceiling: the work never finished, so the score says nothing.
  [(run) => /Background tasks still running after/.test(run.stderr), () => 'bg-wait-ceiling'],
  [(run) => !run.result, (run) => (AUTH_STDERR.test(run.stderr) ? 'auth' : 'no-result')],
  [(run) => run.result.is_error && (AUTH_STDERR.test(run.stderr) || /please run \/login/i.test(String(run.result.result ?? ''))), () => 'auth'],
];

/** Facts -> {outcome, reason} in the compareArms vocabulary; the first matching rule wins. */
export function classify({ run, budget }) {
  const invalid = INVALID.find(([when]) => when(run));
  if (invalid) return { outcome: 'invalid', reason: invalid[1](run) };
  const r = run.result;
  if (r.subtype === 'error_max_budget_usd' || run.cost > budget || run.exhausted) return { outcome: 'over-budget', reason: 'budget exhausted' };
  if (r.subtype === 'success' && looksPaused(run.text)) return { outcome: 'paused', reason: `still waiting after ${run.resumes} resume(s)` };
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
