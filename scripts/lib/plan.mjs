// plan.mjs: large work as a plain file. The plan is a list of milestones that a person can read and that survives compaction and a new
// session. It does not gate anything: it says where the work has got to, and the agent and the user decide what happens next.

import fs from 'node:fs';
import path from 'node:path';
import { clearLedger } from './ledger.mjs';
import { StateError, ensureSomiDir, refuseLink } from './state.mjs';

const MAX_PLAN_LINES = 200;
const MAX_PLAN_BYTES = 16384;
const DONE_MARK = ' (done)';
const PLAN_STEP = /^\s*(?:#{1,6}\s*)?(?:\d+[.)]\s+|[-*]\s+)?(?:milestone\b[^:]*:\s*)(.+)$/i;
const NUMBERED = /^\s*\d+[.)]\s+(.+)$/;
const planFile = (root) => path.join(root, '.somi', 'plan.md');

export function parseMilestones(text) {
  const lines = String(text).split('\n');
  const named = lines.map((l) => PLAN_STEP.exec(l)?.[1]).filter(Boolean);
  const list = named.length > 0 ? named : lines.map((l) => NUMBERED.exec(l)?.[1]).filter(Boolean);
  return list.map((s) => s.trim());
}

export function readPlan(root) {
  try {
    if (refuseLink(planFile(root))) return fs.readFileSync(planFile(root), 'utf8');
  } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof StateError)) throw e; }
  return null;
}

export function savePlan(root, text) {
  if (text.split('\n').length > MAX_PLAN_LINES || Buffer.byteLength(text) > MAX_PLAN_BYTES) throw new StateError(`a plan is limited to ${MAX_PLAN_LINES} lines and ${MAX_PLAN_BYTES} bytes; state milestones and their proofs, not the detail`);
  ensureSomiDir(root);
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW = 0 } = fs.constants;
  const fd = fs.openSync(planFile(root), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o644);
  try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
  return path.relative(root, planFile(root));
}

const isDone = (milestone) => milestone.endsWith(DONE_MARK);

export function planStatus(root) {
  const text = readPlan(root);
  if (text === null) return null;
  const milestones = parseMilestones(text);
  const done = milestones.filter(isDone).length;
  const next = milestones.find((m) => !isDone(m));
  return { total: milestones.length, done, next: next ?? null };
}

// Marks the Nth milestone by adding to the end of its line, so the plan reads the same to a person and to the parser.
export function markMilestoneDone(root, n) {
  const text = readPlan(root);
  if (text === null) throw new StateError('there is no plan to update');
  const lines = text.split('\n');
  const named = lines.some((l) => PLAN_STEP.test(l));
  const at = lines.map((l, i) => ((named ? PLAN_STEP : NUMBERED).test(l) ? i : -1)).filter((i) => i >= 0);
  const line = at[n - 1];
  if (!Number.isInteger(n) || line === undefined) throw new StateError(`the plan has ${at.length} milestones, and there is no number ${n}`);
  if (!lines[line].trimEnd().endsWith(DONE_MARK)) lines[line] = `${lines[line].trimEnd()}${DONE_MARK}`;
  savePlan(root, lines.join('\n'));
  return planStatus(root);
}

// The ledger belongs to the work in the plan, and left in place its decisions would read as binding later work.
export function closePlan(root, env = process.env) {
  if (readPlan(root) !== null) fs.rmSync(planFile(root), { force: true });
  clearLedger(root, env);
  return { closed: true };
}
