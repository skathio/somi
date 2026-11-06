// config.mjs: what a benchmark run is made of. The files it reads, the limits it keeps, which arms each phase has, the plan of draws,
// and whether a registration still holds. Nothing here spends anything.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seededShuffle } from '../../tests/evals/lib/ab-draw.mjs';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');
export const CANDIDATES = path.join(HERE, 'candidates.json');
export const TASK_SET = path.join(HERE, 'task-set.json');
export const PREREG = path.join(HERE, 'prereg.json');
export const ABLATIONS = path.join(HERE, 'ablations.json');
export const MAX_CHUNK = 24;
export const WINDOW_STOP_SHARE = 0.6;
// The host reports the account's real usage with every call. A recording stops short of the limit, because the maintainer's own work shares it.
export const HOST_STOP_SHARE = 0.85;
export const ABANDON_AFTER = 2;
export const QUIET_LOAD_SHARE = 0.5;
export const QUIET_WAIT_MIN = 90;
export const QUIET_POLL_MS = 30000;
export const ADMIT_TRIES = 3;
export const MAX_FAILED_NAMES = 20;

export const PHASE_ARMS = Object.freeze({
  pilot: ['bare'],
  aa: ['bare-a', 'bare-b'],
  trial: ['somi5', 'somi41'],
  baseline: ['bare', 'somi41'],
  candidate: ['somi5', 'bare-check'],
  ablation: ['bare'],
  large: ['bare', 'somi5', 'somi5-lane', 'somi41'],
  tight: ['bare', 'somi5', 'somi5-lane'],
  // A quick look, one draw per task and arm on tasks you name, to check a change works before anything is recorded for real.
  smoke: ['bare', 'somi5', 'somi5-hooks', 'somi5-deliver'],
});

export const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
export const sha256 = (text) => createHash('sha256').update(text).digest('hex');

export const isBare = (arm) => arm.startsWith('bare');
// Every arm gets the same plain request. The SoMi arms go through their own front door, so routing is what gets measured, not a flow
// the benchmark picked for them. The one exception asks for a plan, as a maintainer can, because that is how the milestone lane is reached.
// somi5-deliver is SoMi with each message sent as /somi:deliver, the way a user asks for the staged workflow, which only they can start.
export const armPrompt = (arm, text) => (arm === 'somi5-lane' ? `Show me a plan first, then build it.\n${text}` : arm === 'somi5-deliver' ? `/somi:deliver ${text}` : text);
// The hooks arm is SoMi's small path: the plugin's hooks and an Explore agent on the low tier, with no SoMi agent and no routing call.
export const engineArm = (arm) => (isBare(arm) ? 'bare' : arm === 'somi5-hooks' ? 'somi-hooks' : 'somi');
export const armsFor = (phase, cells = readJson(ABLATIONS).cells) => (phase === 'ablation' ? [...PHASE_ARMS.ablation, ...Object.keys(cells)] : PHASE_ARMS[phase]);

export const drawsFor = (phase, reg) => ({ pilot: reg.pilot_k, aa: reg.aa_k, trial: reg.trial_k, ablation: reg.ablation_k, large: reg.large_k, tight: reg.tight_k, smoke: 1 })[phase] ?? reg.k;
export const armKFor = (phase, reg) => (phase === 'candidate' ? reg.arm_k : {});
// The large phase runs on a window a long session can really fill. The tight phase makes the window small enough that every arm compacts,
// because no task we can write offline fills a large one: a model scripts uniform work and finishes short work in one pass.
// The host takes a window from 100000 to 1000000 and ignores anything else, so the tight phase lowers the point of compaction with its percentage instead.
// At 30 the host stops sessions as thrashing, because a session starts at about 20000 tokens and a worker's brief and files fill the rest.
export const WINDOW_SETTINGS = Object.freeze({ large: { autoCompactWindow: 120000 }, tight: { autoCompactWindow: 100000 } });
export const WINDOW_ENV = Object.freeze({ tight: { CLAUDE_AUTOCOMPACT_PCT_OVERRIDE: '50' } });
export const liveCandidates = (tasks) => tasks.filter((t) => !t.retired);
export function tasksFor(phase, only) {
  if (phase === 'pilot') { const all = readJson(CANDIDATES).tasks; return only ? all.filter((t) => only.includes(t.id)) : liveCandidates(all).filter((t) => !t.large && !t.release_large); }
  if (phase === 'large' || phase === 'tight') return readJson(CANDIDATES).tasks.filter((t) => t.large);
  // A smoke run can name any admitted task: the registered set, or a candidate such as the large multi-turn ones.
  if (phase === 'smoke') {
    if (!only) throw new Error('smoke takes --tasks, a few task ids');
    const set = readJson(TASK_SET).tasks;
    const extra = readJson(CANDIDATES).tasks.filter((t) => only.includes(t.id) && !set.some((s) => s.id === t.id));
    return [...set.filter((t) => only.includes(t.id)), ...extra];
  }
  if (!fs.existsSync(TASK_SET)) throw new Error('no task-set.json yet: run the pilot, then select');
  const set = readJson(TASK_SET);
  return phase === 'trial' ? set.tasks.filter((t) => set.hardest.includes(t.id)).slice(0, 2) : set.tasks;
}

// Every arm of a task runs in the same round, in a seeded order, so drift over a long recording falls on all arms alike.
export function buildPlan(phase, tasks, { seed = 1, k = 3, armK = {} } = {}) {
  const arms = armsFor(phase);
  const draws = [];
  for (let draw = 1; draw <= k; draw++) {
    for (const task of seededShuffle(tasks, seed + draw)) {
      for (const arm of seededShuffle(arms.filter((a) => draw <= (armK[a] ?? k)), seed + draw * 31)) draws.push({ id: `${task.id}.${arm}.${draw}`, task: task.id, dir: task.dir, arm, draw });
    }
  }
  return draws;
}

export function readResults(dir) {
  const file = path.join(dir, 'results.jsonl');
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// Registration holds only when prereg.json names this exact task set and both files are committed and unchanged. A file the
// maintainer can still edit after seeing a number registers nothing.
export function preregProblem(repo = REPO, dir = HERE) {
  const prereg = path.join(dir, 'prereg.json');
  const set = path.join(dir, 'task-set.json');
  if (!fs.existsSync(prereg) || !fs.existsSync(set)) return 'prereg.json and task-set.json must both exist';
  if (readJson(prereg).task_set_sha256 !== sha256(fs.readFileSync(set))) return 'prereg.json does not name this task-set.json; run prereg';
  const rel = [prereg, set].map((f) => path.relative(repo, f));
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', ...rel], { cwd: repo, stdio: 'ignore' });
    const dirty = execFileSync('git', ['status', '--porcelain', '--', ...rel], { cwd: repo, encoding: 'utf8' });
    if (dirty.trim() !== '') return 'prereg.json or task-set.json has uncommitted changes';
  } catch { return 'prereg.json and task-set.json must be committed before the first paid main draw'; }
  return null;
}

// An alias can move to a new model between two recordings, and a calibration does not survive that, so a run is pinned to a full id
// and every model the draw reports must be that id, with at most a date suffix.
export const isFullModelId = (m) => /-\d/.test(m);
export const servedAsPinned = (served, pins) => served.every((m) => m === '<synthetic>' || pins.some((p) => m === p || (m.startsWith(`${p}-`) && /^\d{8}$/.test(m.slice(p.length + 1)))));

// Six plain fields so two recordings can be compared. Free text is reduced to a safe alphabet, so no name or path can survive into a record.
export const safeText = (v) => String(v ?? '').replace(/[^A-Za-z0-9 ().,+@-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
export const hostFingerprint = () => ({ cpu: safeText(os.cpus()[0]?.model), cores: os.cpus().length, memGb: Math.round(os.totalmem() / 2 ** 30), os: safeText(os.release()), node: safeText(process.version) });


// A recording's timeout comes from what the pilot measured. Only a bare arm is piloted, so a workflow arm's limit scales by the widest
// time overhead 4.1 recorded.
export const WORKFLOW_TIME_MARGIN = 7;
export function timeoutFromPilot(rows) {
  const walls = rows.filter((r) => r.wall_ms > 0).map((r) => r.wall_ms).sort((a, b) => a - b);
  if (walls.length === 0) return null;
  const p95 = walls[Math.min(walls.length - 1, Math.ceil(walls.length * 0.95) - 1)];
  return { bare_min: Math.ceil((p95 * 1.5) / 60000), workflow_min: Math.ceil((p95 * 1.5 * WORKFLOW_TIME_MARGIN) / 60000) };
}

export const scoreRow = (d, fields) => ({ schema: 2, draw: d.id, task: d.task, arm: d.arm, k: d.draw, ...fields });

export function abandonedArms(rows) {
  const out = new Set();
  const streak = new Map();
  for (const r of rows) {
    if (r.halted === 'account-limit') {
      const n = (streak.get(r.arm) ?? 0) + 1;
      streak.set(r.arm, n);
      if (n >= ABANDON_AFTER) out.add(r.arm);
    } else if (!r.halted) streak.set(r.arm, 0);
  }
  return out;
}

export const openDecisions = (prereg) => Object.entries(prereg.decisions ?? {}).filter(([, v]) => v === null).map(([k]) => k);
export const ruleHash = () => sha256(JSON.stringify({ ...readJson(PREREG), task_set_sha256: null }));

