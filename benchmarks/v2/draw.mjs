// draw.mjs: one draw's own work. Admitting its task, preparing the workspace, the request the agent is started with, and the row that
// scores what it did.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { admitTask } from '../../tests/evals/lib/admit.mjs';
import { scoreOwnTests } from '../../tests/evals/lib/own-tests.mjs';
import { childEnv, foldScore, looksPaused, prepareWorkspace, taskText } from '../../tests/evals/lib/ab-draw.mjs';
import { sandboxArgs } from '../../tests/evals/lib/ab-sandbox.mjs';
import { scoreHidden } from '../../tests/evals/lib/score-hidden.mjs';
import { taskHash } from '../../tests/evals/lib/task-store.mjs';
import { ADMIT_TRIES, MAX_FAILED_NAMES, WINDOW_ENV, WINDOW_SETTINGS, armPrompt, engineArm, readJson, scoreRow, servedAsPinned } from './config.mjs';
import { adherence, agentSplit, labelDraw, scopeCheck } from './telemetry.mjs';

// Admission runs the reference solution through the same timed suites, so it gets a few tries. A task is refused only if all fail.
function admitWithRetries(dir, hash) {
  let last = 'no attempt';
  for (let i = 0; i < ADMIT_TRIES; i++) {
    const adm = admitTask(dir, { repeats: 1 });
    if (adm.ok && adm.hash === hash) return adm;
    last = adm.ok ? 'the task changed' : adm.reason;
  }
  throw new Error(`not admitted after ${ADMIT_TRIES} tries: ${String(last).slice(0, 200)}`);
}

const transcriptsOf = (drawDir) => {
  const dir = path.join(drawDir, 'transcripts');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => fs.readFileSync(path.join(dir, f), 'utf8'));
};
const readOr = (file, fallback = '') => { try { return fs.readFileSync(file, 'utf8'); } catch { return fallback; } };
const gitChanged = (ws) => {
  try { return execFileSync('git', ['status', '--porcelain', '--', '.', ':(exclude).somi'], { cwd: ws, encoding: 'utf8' }).trim() !== ''; } catch { return false; }
};
const alias = (id) => (/haiku/.test(id) ? 'haiku' : /sonnet/.test(id) ? 'sonnet' : id);

export function admittedTask(st, d, dir) {
  if (!st.admitted.has(dir)) {
    const th = taskHash(dir);
    if (!th.ok) throw new Error(`task ${d.task}: ${th.reason}`);
    const adm = admitWithRetries(dir, th.hash);
    st.admitted.set(dir, { task: th.task, hash: adm.hash, expect: { total: adm.total, names: adm.names } });
  }
  return st.admitted.get(dir);
}

// The small path's Explore runs on the low tier. It lives in the user's agent folder, so it is not a change in the workspace.
export function prepareDraw(cfg, d, { dir, tmp }) {
  const low = alias(cfg.args['worker-model'] ?? cfg.args.model);
  const config = { cost: { ceiling: 'medium' }, tiers: { claude: { low, medium: alias(cfg.args.model), high: alias(cfg.args.model) } } };
  const prepared = prepareWorkspace({ taskDir: dir, tmp, config, globalConfig: config });
  if (d.arm === 'somi5-hooks') { fs.mkdirSync(path.join(tmp, 'cfg', 'agents'), { recursive: true }); fs.writeFileSync(path.join(tmp, 'cfg', 'agents', 'Explore.md'), `---\nname: Explore\ndescription: Fast read-only search of the codebase.\nmodel: ${low}\n---\nSearch the codebase and answer briefly. Do not edit anything.\n`); }
  return prepared;
}

export function drawRequest(st, cfg, d, { t, dir, tmp, ws, drawDir }) {
  const { args, phase } = cfg;
  return {
    followUps: (t.task.turns ?? []).map((turn) => (d.arm === 'somi5-deliver' ? armPrompt(d.arm, turn) : turn)),
    model: args.model, arm: engineArm(d.arm), prompt: armPrompt(d.arm, taskText(t.task)), budget: cfg.budget.draw, timeoutMs: Number(args['timeout-min'] ?? 40) * 60000,
    settings: WINDOW_SETTINGS[phase], maxResumes: 6, claude: cfg.claude, env: { ...childEnv({ token: cfg.env.token, tmp }), ...WINDOW_ENV[phase] }, cwd: ws, plugin: cfg.pluginOf(d.arm), drawDir, token: cfg.env.token, canary: t.task.canary, task: t.task, absAb: path.dirname(dir), ownTmp: tmp, kills: st.kills, sandbox: cfg.specFor(d.arm),
  };
}

const isSolved = ({ label, scope, scratch, sc }) => label === 'finished' && scope.touched.length === 0 && scratch.outcome === 'scored' && sc.total > 0 && scratch.green === sc.total && !Object.values(scratch.flags ?? {}).some(Boolean);

function ownTestsOf(cfg, { d, dir, ws, t }) {
  const mutantsFile = `${dir}.mutants.json`;
  const spec = cfg.specFor(d.arm);
  return scoreOwnTests({ workspace: ws, taskDir: dir, task: t.task, mutants: fs.existsSync(mutantsFile) ? readJson(mutantsFile) : [], wrap: spec ? (command, argv, rw) => ({ command: 'bwrap', args: sandboxArgs({ ...spec, rw }, command, argv) }) : undefined });
}

// A draw's row: the hidden tests, its own tests, what it did, and whether it ran on the pinned model. solved is decided before the pin is
// checked, as it always was, and a draw served by another model is then invalid.
export function scoreDraw(cfg, c) {
  const { d, t, dir, ws, before, after, result, cls, measured, drawDir, load } = c;
  const scratch = { draw: d.id, outcome: cls.outcome, reason: cls.reason, green: 0 };
  const sc = scoreHidden({ workspace: ws, taskDir: dir, admittedHash: t.hash, expect: t.expect });
  if (!sc.ok) throw new Error(`the scorer failed on ${d.id}: ${sc.reason}`);
  const halt = foldScore(scratch, sc);
  const ownTests = ownTestsOf(cfg, { d, dir, ws, t });
  const streamText = readOr(path.join(drawDir, 'stream.jsonl'));
  const adh = adherence(streamText, readOr(path.join(ws, '.somi/state/reviews.jsonl')));
  const scope = scopeCheck(before.files, after?.ok ? after.files : before.files, t.task);
  const { label, gate } = labelDraw({ outcome: scratch.outcome, reason: scratch.reason, facts: adh, paused: looksPaused(result.text), changed: scope.touched.length + scope.added.length > 0 || gitChanged(ws) });
  const solved = isSolved({ label, scope, scratch, sc });
  const split = agentSplit(streamText, transcriptsOf(drawDir), measured.weighted);
  if (!servedAsPinned(measured.models, cfg.pins)) { scratch.outcome = 'invalid'; scratch.reason = 'model-pin'; }
  const pinned = scratch.reason !== 'model-pin';
  const row = scoreRow(d, { outcome: scratch.outcome, reason: scratch.reason, label: pinned ? label : 'invalid', gate, green: scratch.green, total: sc.total, solved: solved && pinned, scope, adherence: adh, agents: split.agents, split_coverage: split.coverage, failed: (scratch.failedNames ?? []).slice(0, MAX_FAILED_NAMES), flags: scratch.flags, load, ...measured });
  row.own_tests = ownTests;
  return { row, solved, halt, pinned };
}

