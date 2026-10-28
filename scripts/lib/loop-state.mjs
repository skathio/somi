// loop-state.mjs -- where a loop's state lives and how it is read and written. The state directory is passed in
// (the CLI derives it from SOMI_LOOP_STATE_DIR), so nothing here reads process.env.

import fs from 'node:fs';
import path from 'node:path';
import { usageError } from './loop-exit.mjs';

// <slug>.json, or <slug>.<iteration>.json when the loop is scoped to one iteration.
export function stateFile(stateDir, slug, iteration) {
  return path.join(stateDir, `${iteration ? `${slug}.${iteration}` : slug}.json`);
}

// `date -u +%Y-%m-%dT%H:%M:%SZ` -- no milliseconds.
export function nowIso(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

export function requireState(file) {
  if (!fs.existsSync(file)) throw usageError(`no loop state at ${file} — run init first`);
}

export function loadState(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function saveState(file, state) {
  fs.writeFileSync(file, JSON.stringify(state));
}
