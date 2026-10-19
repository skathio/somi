// Stream and disk hygiene for the draw driver: token redaction, the stdout sink with its leak scan, the post-draw
// inspection of the workspace and the config directory, and the sweep of leftover processes. No model call, no network.
// The agent runs with the token in its environment, so everything it can write is treated as a possible copy of it.
//
// Redaction (redactToken): every 12-character window of the token is a match, overlapping matches merge into one
// [REDACTED], so a token folded across lines or cut by a pager loses all but fragments shorter than 12 characters.
//   Not covered: reversed or re-encoded forms (base64, hex), and fragments shorter than 12 characters.
// Sink (createSink): stdout goes to disk line by line, redacted. The scan flags the task canary, the token, a
//   `sk-ant-` prefix and, in assistant and user events only (what the agent did and saw), the repository's
//   tests/evals/ab path, the task's hidden and oracle paths, another draw's temp directory and the env file name.
// Inspection (inspectDraw, run after the child is gone): the canary in any file of the after manifest (a silent copy of
//   the oracle), the canary, the repository path and the token in the session transcripts under cfg/projects (then
//   deleted, a redacted copy kept when small), and the token redacted in place in every regular file of the workspace and
//   the config directory. Links are never followed. Git objects are compressed and are not searched for the canary.
// Sweep (sweepProcesses): SIGKILL every process whose environment holds the draw's unique config directory entry, so a
//   process that left the process group (setsid) cannot outlive the draw. Linux /proc only; elsewhere it does nothing.

import fs from 'node:fs';
import path from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export const MAX_STREAM_BYTES = 64 * 1024 * 1024;
const MAX_LINE = 16 * 1024 * 1024;
const MAX_FILE = 64 * 1024 * 1024;
const KEEP_COPY = 2 * 1024 * 1024;
const WIN = 12;
const MAX_WALK = 100000;
const SK = /sk-ant-[A-Za-z0-9_-]{4,}/g;
const MARK = '[REDACTED]';
// The account's usage window ran out: the CLI ends the call as a success with this text, or reports a rejected rate-limit event.
const LIMIT_TEXT = /hit your (session|weekly|usage|five.hour) limit|usage limit|resets \d/i;
const RESET_TEXT = /resets [^\n"·]{1,60}/i;
const winCache = new Map();
const windowsOf = (token) => {
  if (!token) return [];
  if (!winCache.has(token)) winCache.set(token, Array.from({ length: Math.max(0, token.length - WIN + 1) }, (_, i) => token.slice(i, i + WIN)));
  return winCache.get(token);
};

/** Spans [start, end) of every token window in `text`, merged. */
function spans(text, token) {
  const hits = [];
  for (const w of windowsOf(token)) for (let i = text.indexOf(w); i >= 0; i = text.indexOf(w, i + 1)) hits.push(i);
  hits.sort((a, b) => a - b);
  const out = [];
  for (const s of hits) { const last = out.at(-1); if (last && s <= last[1]) last[1] = Math.max(last[1], s + WIN); else out.push([s, s + WIN]); }
  return out;
}
export const tokenHit = (text, token) => spans(text, token).length > 0;
export function redactToken(text, token) {
  let out = text; const sp = spans(text, token);
  if (sp.length > 0) { let pos = 0; out = ''; for (const [s, e] of sp) { out += text.slice(pos, s) + MARK; pos = e; } out += text.slice(pos); }
  return out.replace(SK, MARK);
}

const parse = (l) => { try { const v = JSON.parse(l); return typeof v === 'object' && v !== null ? v : null; } catch { return null; } };

/** Disk sink for one draw's stdout: feed(chunk) per read, turn() between claude invocations, end() at the close. */
export function createSink(file, { token, canary, task, absAb, ownTmp, maxBytes = MAX_STREAM_BYTES }) {
  const fd = fs.openSync(file, 'a', 0o600);
  let dec = new StringDecoder('utf8');
  const s = { bytes: 0, capped: false, leaks: new Set(), result: null, text: '', limit: false, reset: null };
  const limitText = (t) => { if (typeof t === 'string' && LIMIT_TEXT.test(t)) { s.limit = true; s.reset ??= RESET_TEXT.exec(t)?.[0].replace(/^resets /i, '').trim() ?? null; } };
  let pending = '';
  const paths = [['ab-path', 'tests/evals/ab'], ['task-hidden', `${task}/hidden`], ['task-oracle', `${task}/oracle`], ['eval-env', '.somi/eval.env']];
  if (absAb) paths.push(['ab-path', absAb]);
  function line(raw) {
    const ev = parse(raw);
    if (tokenHit(raw, token)) s.leaks.add('token');
    if (raw.includes(canary)) s.leaks.add('canary');
    if (raw.includes('sk-ant-')) s.leaks.add('sk-ant-');
    // The system events list the plugin's own files; only what the agent did and saw is scanned for paths.
    if (!ev || ev.type === 'assistant' || ev.type === 'user') {
      for (const [name, needle] of paths) if (raw.includes(needle)) s.leaks.add(name);
      // The own directory also shows up in its relative form (Node's "Did you mean to import ./ab-draw-X/..." hint), so
      // both spellings are removed before looking for another draw's directory.
      const own = ownTmp ? ownTmp.slice(ownTmp.lastIndexOf('/')) : null;
      if ((ownTmp ? raw.split(ownTmp).join('').split(own).join('') : raw).includes('/ab-draw-')) s.leaks.add('other-draw');
    }
    if (ev?.type === 'rate_limit_event' && /"status":"rejected"/.test(raw)) s.limit = true;
    if (ev?.type === 'result') { s.result = ev; limitText(ev.result); }
    if (ev?.type === 'assistant' && Array.isArray(ev.message?.content)) {
      const t = ev.message.content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
      if (t !== '') { s.text = t; limitText(t); }
    }
    fs.writeSync(fd, `${redactToken(raw, token)}\n`);
  }
  const drain = (final) => {
    const parts = pending.split('\n');
    pending = final ? '' : parts.pop();
    for (const p of parts) if (p !== '') line(p);
    if (pending.length > MAX_LINE) s.capped = true;
  };
  return {
    state: s,
    feed(chunk) {
      s.bytes += chunk.length;
      if (s.bytes > maxBytes) s.capped = true;
      if (s.capped) return;
      pending += dec.write(chunk);
      drain(false);
    },
    // An unterminated last line of the previous invocation is a line of its own, not the start of the next one.
    turn() { if (!s.capped) { pending += dec.end(); drain(true); } dec = new StringDecoder('utf8'); s.result = null; s.text = ''; },
    end() { if (!s.capped) { pending += dec.end(); drain(true); } try { fs.closeSync(fd); } catch { /* closed */ } },
  };
}

// ---- disk inspection ------------------------------------------------------------------------------------------

function readNoFollow(file, max = MAX_FILE) {
  let fd = null;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
    const st = fs.fstatSync(fd);
    return st.isFile() && st.size <= max ? fs.readFileSync(fd) : null;
  } catch { return null; } finally { if (fd !== null) try { fs.closeSync(fd); } catch { /* read-only handle */ } }
}
/** Regular files under `root` (links and special files skipped, never followed), or null when the walk exceeded its cap. */
function filesUnder(root) {
  const out = []; let n = 0;
  const walk = (dir, depth) => {
    if (depth > 32) return false;
    let names; try { names = fs.readdirSync(dir); } catch { return true; }
    for (const name of names) {
      if (++n > MAX_WALK) return false;
      const p = path.join(dir, name); let st; try { st = fs.lstatSync(p); } catch { continue; }
      if (st.isDirectory()) { if (!walk(p, depth + 1)) return false; } else if (st.isFile()) out.push(p);
    }
    return true;
  };
  return walk(root, 0) ? out : null;
}
function redactInPlace(file, token) {
  const buf = readNoFollow(file);
  if (buf === null) return false;
  const text = buf.toString('latin1');
  if (!tokenHit(text, token)) return false;
  fs.writeFileSync(file, Buffer.from(redactToken(text, token), 'latin1'));
  return true;
}

/** After the child is gone -> the set of leak names found on disk; transcripts are deleted, token copies redacted. */
export function inspectDraw({ ws, cfg, after, drawDir, token, canary, absAb }) {
  const leaks = new Set();
  if (!after?.ok) leaks.add('unscanned-workspace');
  else for (const [rel] of after.files) { const b = readNoFollow(path.join(ws, rel)); if (b === null) leaks.add('unscanned-workspace'); else if (b.includes(canary)) leaks.add('canary-in-file'); }
  const proj = path.join(cfg, 'projects');
  let st = null; try { st = fs.lstatSync(proj); } catch { /* no transcripts */ }
  if (st?.isDirectory()) {
    const list = filesUnder(proj);
    if (list === null) leaks.add('unscanned-transcript');
    let k = 0;
    for (const f of list ?? []) {
      if (!f.endsWith('.jsonl')) continue;
      const b = readNoFollow(f);
      if (b === null) { leaks.add('unscanned-transcript'); continue; }
      const text = b.toString('latin1');
      if (text.includes(canary)) leaks.add('canary-in-transcript');
      if (absAb && text.includes(absAb)) leaks.add('ab-path-in-transcript');
      if (tokenHit(text, token)) leaks.add('token');
      if (b.length <= KEEP_COPY) { fs.mkdirSync(path.join(drawDir, 'transcripts'), { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(drawDir, 'transcripts', `${++k}.jsonl`), redactToken(text, token), { mode: 0o600 }); }
    }
    fs.rmSync(proj, { recursive: true, force: true });
  } else if (st !== null) fs.rmSync(proj, { force: true });
  for (const root of [ws, cfg]) {
    const list = filesUnder(root);
    if (list === null) { leaks.add('unscanned-workspace'); continue; }
    for (const f of list) if (redactInPlace(f, token)) leaks.add('token');
  }
  return [...leaks].sort();
}

/** SIGKILL every process whose environment holds `entry` (NAME=value), until none is left or `capMs` has passed. */
export async function sweepProcesses(entry, capMs = 2000) {
  const needle = Buffer.from(`\0${entry}\0`); const end = Date.now() + capMs;
  for (;;) {
    let killed = 0;
    let pids; try { pids = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n) && Number(n) !== process.pid); } catch { return; }
    for (const pid of pids) {
      try { if (Buffer.concat([Buffer.from('\0'), fs.readFileSync(`/proc/${pid}/environ`)]).includes(needle)) { process.kill(Number(pid), 'SIGKILL'); killed++; } } catch { /* gone or not ours */ }
    }
    if (killed === 0 || Date.now() > end) return;
    await new Promise((r) => setTimeout(r, 50));
  }
}
