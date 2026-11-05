// journal.mjs: the one source of truth for SoMi state. An append-only JSONL file written only by the tools, plus a
// derived cursor (state.json) that can always be rebuilt from it. The model never edits either file.
//
// Replay safety: every event carries a `key`. A transition that finds its key already in the journal appends nothing and
// returns the stored response, so a retried step writes nothing twice. A process killed mid-write leaves at most one torn
// line with no newline; it is dropped on the next read and truncated on the next append.
//
// Writers refuse links: a cloned repository can commit a symlink at `.somi` to aim our writes elsewhere. Someone who keeps
// state outside the tree on purpose sets SOMI_STATE_DIR, which is their own environment, not repository content.

import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;
export const EVENT_TYPES = Object.freeze(['open', 'check', 'after-code', 'after-review', 'decide', 'close', 'migrate', 'route', 'plan', 'escalate', 'tested-fix', 'halt', 'critic', 'choose', 'finish', 'nudge']);
export const NEXT_ACTIONS = Object.freeze(['open', 'code', 'fix', 'review', 'close', 'ask']);
export const STOP_REASONS = Object.freeze(['intent-gate', 'area-follow-up', 'max-passes', 'recurring-finding', 'still-failing', 'worker-blocked']);

export class StateError extends Error {}

export function statePaths(root, env = process.env) {
  const dir = env.SOMI_STATE_DIR ? path.resolve(env.SOMI_STATE_DIR) : path.join(root, '.somi', 'state');
  return { dir, journal: path.join(dir, 'journal.jsonl'), state: path.join(dir, 'state.json') };
}

function refuseLink(p) {
  let st;
  try { st = fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  if (st.isSymbolicLink()) throw new StateError(`refusing to write through a link at ${p}; set SOMI_STATE_DIR to keep state elsewhere`);
  return true;
}

function ensureDir(root, dir, env) {
  if (env.SOMI_STATE_DIR) { fs.mkdirSync(dir, { recursive: true }); return; }
  const somi = path.join(root, '.somi');
  if (!refuseLink(somi)) fs.mkdirSync(somi);
  if (!refuseLink(dir)) fs.mkdirSync(dir);
}

export function readEvents(root, env = process.env) {
  const { journal } = statePaths(root, env);
  let text;
  try { text = fs.readFileSync(journal, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const end = text.lastIndexOf('\n');
  if (end <= 0) return [];
  return text.slice(0, end).split('\n').map((line, i) => {
    try { return JSON.parse(line); } catch { throw new StateError(`journal line ${i + 1} is not JSON`); }
  });
}

function dropTornTail(file) {
  const text = fs.readFileSync(file, 'utf8');
  if (text === '' || text.endsWith('\n')) return;
  fs.truncateSync(file, Buffer.byteLength(text.slice(0, text.lastIndexOf('\n') + 1)));
}

// Test seam for the crash-replay proof: SOMI_FAILPOINT=<type>:before|torn|after kills this process at that point.
function failpoint(env, type, where) {
  if (env.SOMI_FAILPOINT === `${type}:${where}`) process.kill(process.pid, 'SIGKILL');
}

export function appendEvent(root, event, env = process.env) {
  const { dir, journal } = statePaths(root, env);
  ensureDir(root, dir, env);
  if (refuseLink(journal)) dropTornTail(journal);
  const line = `${JSON.stringify(event)}\n`;
  failpoint(env, event.type, 'before');
  const { O_WRONLY, O_CREAT, O_APPEND, O_NOFOLLOW = 0 } = fs.constants;
  const fd = fs.openSync(journal, O_WRONLY | O_CREAT | O_APPEND | O_NOFOLLOW, 0o644);
  try {
    if (env.SOMI_FAILPOINT === `${event.type}:torn`) {
      fs.writeSync(fd, line.slice(0, Math.floor(line.length / 2)));
      failpoint(env, event.type, 'torn');
    }
    fs.writeSync(fd, line);
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  failpoint(env, event.type, 'after');
}

export function writeCursor(root, cursor, env = process.env) {
  const { dir, state } = statePaths(root, env);
  ensureDir(root, dir, env);
  refuseLink(state);
  const tmp = `${state}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(cursor, null, 2)}\n`, { flag: 'wx' });
  fs.renameSync(tmp, state);
}

const IDLE = Object.freeze({
  v: SCHEMA_VERSION, seq: 0, milestone: null, title: null, next: 'open', pass: 0, base: null, tree: null, reviewed_tree: null,
  stop: null, question: null, release_candidate: false, reviewers: [], blocking: [], extra_passes: 0, follow_up: null,
  route: null, tier: null, escalated: false, lane: null, awaiting: null,
});

// What a route holds across its milestones. A milestone's own fields reset at each open and close.
const routeFields = (c) => ({ route: c.route, tier: c.tier, escalated: c.escalated, lane: c.lane, awaiting: c.awaiting });

// The cursor is a pure fold of the events: state.json is only a cached copy of this.
export function deriveCursor(events) {
  let c = { ...IDLE };
  for (const e of events) {
    c.seq = e.seq;
    switch (e.type) {
      case 'open':
        c = { ...IDLE, ...routeFields(c), seq: e.seq, milestone: e.milestone, title: e.title, next: e.next, base: e.base, stop: e.stop ?? null, question: e.question ?? null, release_candidate: Boolean(e.release_candidate), follow_up: e.follow_up ?? null };
        break;
      case 'after-code':
        Object.assign(c, { tree: e.tree, next: e.next, stop: e.stop ?? null, question: e.question ?? null, reviewers: e.reviewers ?? [] });
        break;
      case 'after-review':
        Object.assign(c, { pass: e.pass, reviewed_tree: e.tree, next: e.next, stop: e.stop ?? null, question: e.question ?? null, blocking: e.blocking ?? [] });
        break;
      case 'decide':
        Object.assign(c, { next: e.next, stop: null, question: null, extra_passes: c.extra_passes + (e.grants_pass ? 1 : 0) });
        break;
      case 'close':
        c = { ...IDLE, ...routeFields(c), seq: e.seq };
        if (c.lane) c.lane = { ...c.lane, index: c.lane.index + 1 };
        break;
      case 'route':
        c = { ...IDLE, seq: e.seq, route: e.route, tier: e.tier };
        break;
      case 'plan':
        c.lane = { milestones: e.milestones, index: e.index ?? c.lane?.index ?? 0 };
        c.awaiting = e.approved ? null : e.awaiting ?? null;
        if (e.tier) c.tier = e.tier;
        break;
      case 'escalate':
        Object.assign(c, { tier: e.tier, escalated: true });
        break;
      case 'halt':
        Object.assign(c, { next: e.next, stop: e.stop ?? null, question: e.question ?? null });
        break;
      case 'critic':
        c.awaiting = e.done ? null : e.awaiting ?? null;
        break;
      case 'finish':
        c = { ...IDLE, seq: e.seq };
        break;
      default: // check, nudge and migrate carry facts and move no cursor
    }
  }
  return c;
}

const REQUIRED = {
  open: ['milestone', 'title', 'base', 'next'],
  check: ['milestone', 'ok', 'tree'],
  'after-code': ['milestone', 'tree', 'next'],
  'after-review': ['milestone', 'pass', 'next', 'findings'],
  decide: ['milestone', 'text', 'next'],
  close: ['milestone', 'outcome'],
  migrate: ['slug'],
  route: ['route', 'tier', 'request'],
  plan: ['milestones'],
  escalate: ['tier'],
  'tested-fix': ['milestone'],
  halt: ['milestone', 'next'],
  critic: [],
  choose: ['request'],
  finish: ['outcome'],
  nudge: ['milestone'],
};

// What the artefact gate runs: a journal that fails here means a writer broke the documented shape.
export function journalProblems(events) {
  const problems = [];
  events.forEach((e, i) => {
    const at = `event ${i + 1}`;
    if (e === null || typeof e !== 'object') { problems.push(`${at}: not an object`); return; }
    if (e.v !== SCHEMA_VERSION) problems.push(`${at}: unknown schema version`);
    if (e.seq !== i + 1) problems.push(`${at}: seq is not ${i + 1}`);
    if (typeof e.key !== 'string' || e.key === '') problems.push(`${at}: no key`);
    if (!EVENT_TYPES.includes(e.type)) { problems.push(`${at}: unknown type`); return; }
    for (const f of REQUIRED[e.type]) if (e[f] === undefined) problems.push(`${at}: ${e.type} has no ${f}`);
    if (e.next !== undefined && !NEXT_ACTIONS.includes(e.next)) problems.push(`${at}: undocumented next status`);
    if (e.stop !== undefined && !STOP_REASONS.includes(e.stop)) problems.push(`${at}: undocumented stop status`);
  });
  const keys = events.map((e) => e?.key);
  if (new Set(keys).size !== keys.length) problems.push('duplicate event key');
  return problems;
}
