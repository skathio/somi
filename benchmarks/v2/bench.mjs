#!/usr/bin/env node
// bench.mjs: benchmark v2. Is SoMi worth it against a bare agent on the same model, is 5.0 better than 4.1, and which parts pay? See
// docs/BENCHMARK.md for the design. A paid run needs --go. The test suite proves this driver with a stub agent and spends nothing.
//
//   bench.mjs plan   --phase pilot|aa|trial|baseline|candidate|ablation|large|tight|smoke|routing [--pilot DIR] [--seed N]    the draws and timeout, spends nothing
//   bench.mjs routes                                                                     scores the router on the labelled set, spends nothing
//   bench.mjs admit                                                                      every live task's admission and mutants, spends nothing
//   bench.mjs power  [--pilot DIR]                                                       draws per arm for each effect, spends nothing
//   bench.mjs run    --phase ... --out DIR --model ID --go --budget-total USD [--chunk 24] [--budget-draw USD] [--window-tokens N]
//                    [--worker-model ID] [--plugin-41 DIR] [--env-file FILE] [--timeout-min N] [--quiet-wait-min 90]
//                    [--claude PATH --no-sandbox --tasks ID,ID]   a stub agent, for proving the harness without spending anything
//   bench.mjs record takes what run takes: runs chunks to the end or a stop, then writes the record and the report skeleton
//   bench.mjs select --pilot DIR[,DIR] [--allow-short]                                      writes task-set.json from a pilot
//   bench.mjs prereg                                                                  binds task-set.json into prereg.json
//   bench.mjs report --out DIR [--write DIR]                                          prints the report, or writes the record
//   bench.mjs decide --aa DIR --baseline DIR --candidate DIR                                              the release rule; exit 0 only when it ships

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { admitTask } from '../../tests/evals/lib/admit.mjs';
import { CANDIDATES, HERE, MAX_CHUNK, PHASE_ARMS, PREREG, REPO, TASK_SET, armKFor, buildPlan, drawsFor, liveCandidates, openDecisions, preregProblem, readJson, readResults, sha256, tasksFor, timeoutFromPilot } from './config.mjs';
import { comparableRecordings, completed, pilotRows, renderPower, renderReport, writeRecord } from './report.mjs';
import { record, run } from './run.mjs';
import { evaluateRelease, logRatio, selectTasks } from './stats.mjs';

export * from './config.mjs';
export * from './report.mjs';
export * from './scoring.mjs';
export * from './usage.mjs';
export { isQuiet } from './run.mjs';

function planCommand(args) {
  if (args.command === 'run') return run(args).then((r) => (r.stop ? 1 : 0));
  if (args.command === 'record') return record(args);
  const prereg = readJson(PREREG);
  const plan = buildPlan(args.phase, tasksFor(args.phase), { seed: Number(args.seed ?? 1), k: drawsFor(args.phase, prereg), armK: armKFor(args.phase, prereg) });
  console.log(`${plan.length} draws across ${new Set(plan.map((d) => d.task)).size} tasks; chunks of at most ${MAX_CHUNK}; no spend`);
  if (args.pilot) console.log(`timeout from the pilot: ${JSON.stringify(timeoutFromPilot(completed(args.pilot)))} minutes`);
  plan.forEach((d) => console.log(`  ${d.id}`));
  return 0;
}

function selectCommand(args) {
  if (!args.pilot) throw new Error('--pilot is required');
  const reg = readJson(PREREG);
  const picked = selectTasks(pilotRows(args.pilot.split(',')), liveCandidates(readJson(CANDIDATES).tasks), { mix: reg.mix, minBoundary: reg.min_boundary, k: reg.pilot_k });
  console.log(JSON.stringify({ kept: picked.tasks.length, boundary: picked.boundary, strata: picked.strata, shortfalls: picked.shortfalls }));
  if (picked.shortfalls.length > 0 && !args['allow-short']) { console.error('the set falls short; author more tasks, or pass --allow-short to record the shortfall'); return 1; }
  fs.writeFileSync(TASK_SET, `${JSON.stringify({ tasks: picked.tasks, hardest: picked.hardest, shortfalls: picked.shortfalls }, null, 2)}\n`);
  return 0;
}

function preregCommand() {
  const prereg = readJson(PREREG);
  const open = openDecisions(prereg);
  if (open.length > 0) throw new Error(`these decisions are still open: ${open.join(', ')}`);
  prereg.task_set_sha256 = sha256(fs.readFileSync(TASK_SET));
  fs.writeFileSync(PREREG, `${JSON.stringify(prereg, null, 2)}\n`);
  console.log(`bound ${prereg.task_set_sha256}; commit prereg.json and task-set.json before the first paid main draw`);
  return 0;
}

function reportCommand(args) {
  if (!args.out) throw new Error('--out is required');
  if (args.write) return writeRecord(args.out, args.write) ? 0 : 1;
  console.log(renderReport(args.out));
  return 0;
}

function decideCommand(args) {
  if (!args.aa || !args.baseline || !args.candidate) throw new Error('--aa, --baseline and --candidate are required');
  const problem = preregProblem() ?? comparableRecordings(args.aa, args.baseline) ?? comparableRecordings(args.baseline, args.candidate);
  if (problem) throw new Error(problem);
  const reg = readJson(PREREG);
  const [base, cand] = [completed(args.baseline), completed(args.candidate)];
  const verdict = evaluateRelease({ aa: completed(args.aa), main: [...base, ...cand], rule: { ...reg.rule, min_tasks: reg.tasks_wanted, k: reg.k, aa_k: reg.aa_k } });
  verdict.against_41 = { dollars: logRatio([...base, ...cand], 'somi5', 'somi41', 'cost'), tokens: logRatio([...base, ...cand], 'somi5', 'somi41') };
  verdict.bare_drift = logRatio([...cand, ...base], 'bare-check', 'bare', 'cost');
  console.log(JSON.stringify(verdict, null, 2));
  return verdict.ships ? 0 : 1;
}

// Free and deterministic, and too slow for the fast gate: every suite runs against each reference solution, the empty fixture and each mutant.
function admitCommand() {
  let refused = 0;
  for (const t of liveCandidates(readJson(CANDIDATES).tasks)) {
    const dir = path.join(REPO, t.dir);
    const r = admitTask(dir, { mutants: readJson(`${dir}.mutants.json`), repeats: 1 });
    if (!r.ok) refused++;
    console.log(`${t.id}: ${r.ok ? `admitted, ${r.total} tests, ${r.mutantsKilled.length} mutants killed` : `REFUSED ${r.reason}`}`);
  }
  return refused ? 1 : 0;
}

async function routesCommand() {
  const { scoreRouter } = await import('./routing-score.mjs');
  console.log(JSON.stringify(scoreRouter(readJson(path.join(HERE, 'routes.json')).items), null, 1));
  return 0;
}

function phased(command) {
  return (args) => {
    if (!Object.hasOwn(PHASE_ARMS, args.phase ?? '')) throw new Error(`--phase takes ${Object.keys(PHASE_ARMS).join(', ')}`);
    return planCommand({ ...args, command });
  };
}

const COMMANDS = {
  plan: phased('plan'),
  run: phased('run'),
  record: phased('record'),
  select: selectCommand,
  prereg: preregCommand,
  report: reportCommand,
  decide: decideCommand,
  admit: admitCommand,
  routes: routesCommand,
  power: (args) => { console.log(renderPower(args.pilot ? readResults(args.pilot) : [])); return 0; },
};

async function main(argv) {
  const [command, ...rest] = argv;
  const { values: args } = parseArgs({
    args: rest,
    options: {
      phase: { type: 'string' }, out: { type: 'string' }, model: { type: 'string' }, seed: { type: 'string' }, go: { type: 'boolean' }, chunk: { type: 'string' },
      'budget-total': { type: 'string' }, 'budget-draw': { type: 'string' }, 'window-tokens': { type: 'string' }, 'plugin-41': { type: 'string' }, 'env-file': { type: 'string' },
      'timeout-min': { type: 'string' }, 'worker-model': { type: 'string' }, 'stop-session': { type: 'string' }, 'stop-week': { type: 'string' }, arms: { type: 'string' }, k: { type: 'string' }, baseline: { type: 'string' }, candidate: { type: 'string' }, tasks: { type: 'string' }, write: { type: 'string' }, 'quiet-wait-min': { type: 'string' }, claude: { type: 'string' }, 'no-sandbox': { type: 'boolean' }, pilot: { type: 'string' }, 'allow-short': { type: 'boolean' }, aa: { type: 'string' }, main: { type: 'string' },
    },
  });
  const handler = Object.hasOwn(COMMANDS, command ?? '') ? COMMANDS[command] : null;
  if (!handler) throw new Error('bench takes plan, admit, routes, power, run, record, select, prereg, report or decide');
  return handler(args);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`bench: ${e.message}`); process.exitCode = 1; });
}
