// run-budget.mjs -- a /ship-loop run's wall-time budget. The run records its start once (run-start); every later
// `pass` of any plan or code loop on the same slug checks it, so the stop does not depend on an orchestrator
// remembering to look at the clock. State: .somi/somi-state/run/<slug>.json { started, max_minutes }.

import fs from 'node:fs';
import path from 'node:path';

const file = (stateRoot, slug) => path.join(stateRoot, 'run', `${slug}.json`);

// -> the recorded run; an existing one is kept unless `force` (a resumed run keeps its clock).
export function startRun(stateRoot, slug, maxMinutes, { force = false, now = Date.now() } = {}) {
  const f = file(stateRoot, slug);
  if (!force && fs.existsSync(f)) return { ...JSON.parse(fs.readFileSync(f, 'utf8')), resumed: true };
  const run = { started: new Date(now).toISOString(), max_minutes: maxMinutes };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(run));
  return run;
}

// -> null when the slug has no run or no time budget, else { elapsed_minutes, max_minutes, over }.
export function checkRun(stateRoot, slug, now = Date.now()) {
  let run;
  try { run = JSON.parse(fs.readFileSync(file(stateRoot, slug), 'utf8')); } catch { return null; }
  if (!Number.isSafeInteger(run?.max_minutes) || run.max_minutes < 1) return null;
  const elapsed = Math.floor((now - Date.parse(run.started)) / 60000);
  if (!Number.isFinite(elapsed)) return { elapsed_minutes: null, max_minutes: run.max_minutes, over: true }; // unreadable start: fail closed
  return { elapsed_minutes: elapsed, max_minutes: run.max_minutes, over: elapsed >= run.max_minutes };
}
