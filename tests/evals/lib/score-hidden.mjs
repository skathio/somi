// Hidden-suite scoring for the A/B tasks: run a task's `node:test` files against one workspace and count green
// tests. The workspace is a candidate's output (hostile data); the hidden suite is repo-authored and trusted. No
// model call, no network, no shell.
//
// scoreHidden({workspace, hiddenDir, expect, taskDir, admittedHash, extraEnv, timeoutMs}) -> {ok: true, green, total,
//   failed, names, timedOut, truncated, crashed, loadFailed, integrity, tampered, taskChanged} or {ok: false, reason}.
//   hiddenDir  (default taskDir/hidden; with taskDir it may only be that path) the suite's regular files are copied into
//              the per-run harness directory and the top-level `*.test.mjs` run from the copy; a link is refused, a
//              subdirectory is not copied (helpers must be top-level files). Modes 0444/0555 are hygiene only: the
//              same uid can undo them. Each test calls the candidate through a harness-owned runner in a child process
//              (task standard, section 3), so a missing or broken module fails each test and the file still loads.
//   expect     {total, names}: the names an oracle run reported. WITH IT NOTHING THE CANDIDATE DOES IN THIS RUN RETURNS ok:false.
//              Green is the number of expected names reported as passed exactly once; every expected name not
//              reported (an exit, a crash, a skip) and every test of a file that ended in an uncaught error is failed;
//              total is expect.total. A hang scores green 0 (timedOut); a killed runner or output over 8 MiB scores
//              what was reported (crashed, truncated); an unknown or repeated name, too many records or a malformed
//              record scores green 0 (integrity); a harness copy that changed, vanished or became unreadable, or a task
//              that changed during the run, scores green 0 (tampered; taskChanged for the task: the driver must HALT
//              and re-admit on taskChanged or tampered, never exclude the pair). The only ok:false results left are
//              harness faults, all decided before candidate code runs: malformed arguments, a taskDir problem, a task
//              changed since admission, a missing workspace, a link or no tests in hiddenDir, a copy failure, a spawn
//              error other than timeout or output cap, an unexpected exception. The driver halts on any ok:false.
//              Without `expect` (establishing an oracle's list) every one of the faults above, a load failure, a skip, a
//              duplicate name and an empty suite is a refusal.
//   taskDir    optional: taskHash(taskDir) before and after the run. admittedHash (needs taskDir): the hash admission
//              returned; a different one refuses ('changed since admission').
//   extraEnv   optional: at most 8 variables, each named UPSTREAM_KEY or TASK_[A-Z0-9_]* (not an allowlisted name),
//              string values of at most 256 characters (a planted test value goes in here, never inherited).
//   timeoutMs  1..600000, default 60000 (SIGKILL). Names are escaped (esc), cut to 200 characters; reasons carry basenames.
// Child: argv array, cwd a fresh 0700 harness directory, stdin ignored, stderr dropped, an allowlist environment (see
//   childEnv), its own process group (killed at the end), a harness reporter printing one JSON record per test.
// Tamper detection: right after the copy, the harness directory and the copy get an lstat snapshot (device, inode,
//   mode, size, ctime in ns) plus a hash of every file; the child's HOME and cwd are tmp/home, so tmp has no legitimate
//   write afterwards. After the run, names and lstat values are compared first and nothing is read on a mismatch; only
//   then are the size-matched files read (O_NOFOLLOW, O_NONBLOCK) and hashed, so post-run reads are bounded by the
//   original suite size. ctime cannot be reset without root, so a rewrite-and-restore shows. Cleanup removes the harness
//   directory by its explicit path only if it is still the directory mkdtemp made (a swapped-in link is not followed).
// Residuals, named (no container here): the candidate can READ the hidden suite and the oracle at run time (the copy
//   sits next to process.argv[1]; /proc/<ancestor>/cwd and cmdline lead to the repository) and answer from them, so a score
//   of an untrusted candidate is trustworthy only under containment: a mount namespace exposing only the workspace and a
//   candidate runner, the suite unreadable by the candidate's uid (`unshare -Urpf --kill-child` gives user and pid
//   namespaces only: it stops strays, not reads); the compensating control is the driver's canary and stream scan. Also: a
//   detached process can outlive the run and tamper later; the same uid can read the harness's /proc/<pid>/environ and the
//   home directory (run from an invocation that never sourced .somi/eval.env); a bare import would resolve through
//   ancestors such as /tmp/node_modules, creatable by any local user (hidden suites import only node: built-ins); the driver can be signalled and the
//   library files rewritten; a tree deeper than PATH_MAX or a renamed-aside harness dir leaks a 0700 temp copy;
//   disk or process exhaustion fails a later run (the driver halts); a survivor, or ptrace on hosts with ptrace_scope 0, can forge. Candidate code imported into the
//   assertion process can forge a result (the runner-child rule closes that). Defensive and unreachable through the public
//   API: the record-shape check and a spawn error. Not covered: the second oracle exercising the test dir and tolerated
//   files (standard, section 4).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { esc } from './manifest.mjs';
import { taskHash } from './task-store.mjs';

const DEFAULT_TIMEOUT_MS = 60000;
const MAX_TIMEOUT_MS = 600000;
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_TESTS = 10000;
const MAX_NAME = 200;
const ALLOWED = ['PATH', 'HOME', 'TZ', 'LC_ALL', 'TASK_WORKSPACE'];
export const SCORE_TZ = 'America/Los_Angeles';

// Written into the harness directory and loaded by `node --test --test-reporter`; one line per finished test.
const REPORTER = `import path from 'node:path';
export default async function* (source) {
  for await (const e of source) {
    if (e.type !== 'test:pass' && e.type !== 'test:fail') continue;
    const d = e.data;
    yield JSON.stringify({ file: typeof d.file === 'string' ? path.basename(d.file) : '', ok: e.type === 'test:pass', name: d.name, kind: d.details?.type, skip: d.skip === true || d.todo === true, load: d.nesting === 0 && typeof d.file === 'string' && (d.name === path.basename(d.file) || d.name === d.file) }) + '\\n';
  }
}
`;

/** The only environment the suite sees: the allowlist, plus validated extras that cannot replace it. */
export function childEnv(workspaceReal, home, hostPath, extra = {}) {
  return { ...extra, PATH: hostPath ?? '', HOME: home, TZ: SCORE_TZ, LC_ALL: 'C', TASK_WORKSPACE: workspaceReal };
}

const refuse = (reason) => ({ ok: false, reason }); class Fault extends Error {}
const plain = (v) => typeof v === 'object' && v !== null && !Array.isArray(v) && [Object.prototype, null].includes(Reflect.getPrototypeOf(v));
const lst = (p) => { const x = fs.lstatSync(p, { bigint: true }); return `${x.dev}:${x.ino}:${x.mode}:${x.size}:${x.ctimeNs}`; };
const sha = (p) => { const fd = fs.openSync(p, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); try { return createHash('sha256').update(fs.readFileSync(fd)).digest('hex'); } finally { fs.closeSync(fd); } };
const snapshot = (tmp, hid) => { const names = fs.readdirSync(hid).sort(); return { t: lst(tmp), h: lst(hid), names, f: names.map((n) => lst(path.join(hid, n))), sums: names.map((n) => sha(path.join(hid, n))) }; };
// Unchanged since `pre`? lstat values first (nothing is read on a mismatch), then the bytes of the size-matched files.
function intact(tmp, hid, pre) {
  try {
    const names = fs.readdirSync(hid).sort();
    if (lst(tmp) !== pre.t || lst(hid) !== pre.h || names.join('\0') !== pre.names.join('\0') || names.some((n, i) => lst(path.join(hid, n)) !== pre.f[i])) return false;
    return names.every((n, i) => sha(path.join(hid, n)) === pre.sums[i]);
  } catch { return false; }
}
// Best effort: make a tree removable again after a candidate changed modes (regular files and directories only).
const unlock = (d, depth = 0) => { if (depth > 64) return; try { fs.chmodSync(d, 0o700); for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) unlock(f, depth + 1); else if (e.isFile()) fs.chmodSync(f, 0o600); } } catch { /* removal is attempted anyway */ } };
const tname = (s) => esc(s.slice(0, MAX_NAME));
function readExtra(x) {
  if (x === undefined) return {};
  const ds = plain(x) ? Reflect.ownKeys(x).map((k) => [k, Reflect.getOwnPropertyDescriptor(x, k)]) : null;
  const ok = ds && ds.length <= 8 && ds.every(([k, d]) => typeof k === 'string' && /^(UPSTREAM_KEY|TASK_[A-Z0-9_]+)$/.test(k) && !ALLOWED.includes(k) && typeof d.value === 'string' && d.value.length <= 256);
  return ok ? Object.fromEntries(ds.map(([k, d]) => [k, d.value])) : null;
}
function readExpect(e) {
  if (!plain(e)) return null;
  const { total, names } = e;
  return Number.isInteger(total) && total >= 1 && total <= MAX_TESTS && Array.isArray(names) && names.length === total && names.every((s) => typeof s === 'string') && new Set(names).size === total ? { total, names: [...names] } : null;
}

/** See the header. */
export function scoreHidden(args) {
  let tmp = null; let tmpId = null;
  try {
    if (!plain(args)) return refuse('arguments: not an object');
    const { workspace, timeoutMs = DEFAULT_TIMEOUT_MS, taskDir, admittedHash } = args;
    const hiddenDir = args.hiddenDir ?? (typeof taskDir === 'string' ? `${taskDir}/hidden` : undefined);
    const extra = readExtra(args.extraEnv); const expect = args.expect === undefined ? undefined : readExpect(args.expect);
    if (![workspace, hiddenDir].every((v) => typeof v === 'string' && v !== '')) return refuse('arguments: workspace and hiddenDir (or taskDir) must be paths');
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) return refuse('arguments: timeoutMs must be an integer from 1 to 600000');
    if (extra === null || expect === null || !['undefined', 'string'].includes(typeof taskDir) || !['undefined', 'string'].includes(typeof admittedHash)) return refuse('arguments: extraEnv, expect, taskDir or admittedHash is malformed');
    if ((admittedHash !== undefined && taskDir === undefined) || (args.hiddenDir !== undefined && taskDir !== undefined && path.resolve(hiddenDir) !== path.resolve(taskDir, 'hidden'))) return refuse('arguments: admittedHash needs taskDir, and hiddenDir may only be taskDir/hidden');
    const before = taskDir === undefined ? null : taskHash(taskDir);
    if (before && !before.ok) return refuse(`taskDir: ${before.reason}`);
    if (before && admittedHash !== undefined && before.hash !== admittedHash) return refuse('task material changed since admission');
    const real = fs.realpathSync(workspace);
    if (!fs.statSync(real).isDirectory()) return refuse('workspace: not a directory');
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'score-')); tmpId = lst(tmp).split(':').slice(0, 2).join(':');
    const hid = path.join(tmp, 'hidden'); const home = path.join(tmp, 'home'); const files = []; fs.mkdirSync(hid); fs.mkdirSync(home);
    for (const e of fs.readdirSync(hiddenDir, { withFileTypes: true })) {
      if (e.isSymbolicLink()) return refuse(`hiddenDir: ${tname(e.name)} is a link`);
      if (!e.isFile()) continue;
      fs.copyFileSync(path.join(hiddenDir, e.name), path.join(hid, e.name), fs.constants.COPYFILE_EXCL);
      fs.chmodSync(path.join(hid, e.name), 0o444);
      if (e.name.endsWith('.test.mjs')) files.push(path.join(hid, e.name));
    }
    if (files.length === 0) return refuse('hiddenDir: no *.test.mjs files');
    files.sort(); fs.writeFileSync(path.join(tmp, 'reporter.mjs'), REPORTER); fs.chmodSync(hid, 0o555);
    const pre = snapshot(tmp, hid);
    const r = spawnSync(process.execPath, ['--test', `--test-reporter=${path.join(tmp, 'reporter.mjs')}`, '--test-concurrency=1', ...files], {
      cwd: home, env: childEnv(real, home, process.env.PATH, extra), shell: false, detached: true, stdio: ['ignore', 'pipe', 'ignore'], timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT, windowsHide: true,
    });
    // `--test` runs each file in a child of its own, which a SIGKILL of the runner leaves behind: end the whole group.
    if (r.pid) try { process.kill(-r.pid, 'SIGKILL'); } catch { /* the group is already gone */ }
    const taskChanged = before !== null && (() => { const after = taskHash(taskDir); return !after.ok || after.hash !== before.hash; })();
    const tampered = !intact(tmp, hid, pre) || taskChanged;
    const timedOut = r.error?.code === 'ETIMEDOUT'; const truncated = r.error?.code === 'ENOBUFS'; const crashed = !r.error && r.signal != null;
    if (r.error && !timedOut && !truncated) return refuse('run: the suite could not be run');
    if (!expect && (timedOut || truncated || crashed || tampered)) return refuse(timedOut ? 'timeout' : truncated ? 'output: the report exceeded 8 MiB' : tampered ? 'task material changed during the run' : 'run: the suite was killed');
    let text = r.stdout ? r.stdout.toString('utf8') : '';
    if (truncated) text = text.slice(0, text.lastIndexOf('\n') + 1);
    const got = new Map(); const badFiles = new Set(); const fileOf = new Map(); let loadFailed = false; let integrity = false;
    try {
      const lines = text.split('\n').filter((l) => l !== '');
      if (lines.length > MAX_TESTS) throw new Fault('report: too many records');
      for (const line of lines) {
        let rec;
        try { rec = JSON.parse(line); } catch { throw new Fault('report: a line is not JSON'); }
        if (!plain(rec) || typeof rec.ok !== 'boolean' || typeof rec.name !== 'string' || typeof rec.skip !== 'boolean' || typeof rec.load !== 'boolean') throw new Fault('report: a record has the wrong shape');
        const name = tname(rec.load ? path.basename(rec.name) : rec.name);
        if (rec.load && !rec.ok) { if (!expect) throw new Fault(`load: a test file failed to load: ${name}`); loadFailed = true; badFiles.add(rec.file); }
        if (rec.kind !== 'test' || rec.load) continue; // a suite, or the file's own record
        if (rec.skip && !expect) throw new Fault(`skipped: a test is skipped or todo: ${name}`);
        if (got.has(name)) throw new Fault(`integrity: a test is reported twice: ${name}`);
        if (expect && !expect.names.includes(name)) throw new Fault(`integrity: a test the oracle does not have: ${name}`);
        got.set(name, rec.ok && !rec.skip); fileOf.set(name, rec.file);
      }
    } catch (e) {
      if (!(e instanceof Fault)) throw e;
      if (!expect) return refuse(e.message);
      integrity = true; // a candidate that adds, repeats or garbles reports is scored, never excluded
    }
    if (!expect && got.size === 0) return refuse('report: the suite reported no tests');
    const good = (n) => got.get(n) === true && !badFiles.has(fileOf.get(n));
    const list = expect ? expect.names : [...got.keys()];
    const failed = list.filter((n) => timedOut || integrity || tampered || !good(n));
    return { ok: true, green: list.length - failed.length, total: list.length, failed, names: [...got.keys()], timedOut, truncated, crashed, loadFailed, integrity, tampered, taskChanged };
  } catch {
    return refuse('run: the suite could not be run');
  } finally {
    if (tmp !== null) { let same = false; try { const c = fs.lstatSync(tmp); same = c.isDirectory() && lst(tmp).split(':').slice(0, 2).join(':') === tmpId; } catch { /* gone */ } if (same) { unlock(tmp); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* disposable */ } } }
  }
}
