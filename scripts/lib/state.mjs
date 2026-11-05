// state.mjs: the few files SoMi keeps in its state folder. Nothing here steers the work. These files only remember what happened, so a new
// session, a compacted one and `somi pr` can read it. A committed link must not redirect a write, so each folder on the way is checked.

import fs from 'node:fs';
import path from 'node:path';

export class StateError extends Error {}

export function statePaths(root, env = process.env) {
  const dir = env.SOMI_STATE_DIR ? path.resolve(env.SOMI_STATE_DIR) : path.join(root, '.somi', 'state');
  return { dir, reviews: path.join(dir, 'reviews.jsonl'), check: path.join(dir, 'check.json') };
}

export function refuseLink(p) {
  let st;
  try { st = fs.lstatSync(p); } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  if (st.isSymbolicLink()) throw new StateError(`refusing to write through a link at ${p}; set SOMI_STATE_DIR to keep state elsewhere`);
  return true;
}

export function ensureSomiDir(root) {
  const somi = path.join(root, '.somi');
  if (!refuseLink(somi)) fs.mkdirSync(somi);
  return somi;
}

export function ensureStateDir(root, env = process.env) {
  const { dir } = statePaths(root, env);
  if (env.SOMI_STATE_DIR) { fs.mkdirSync(dir, { recursive: true }); return dir; }
  ensureSomiDir(root);
  if (!refuseLink(dir)) fs.mkdirSync(dir);
  return dir;
}

export function writeStateFile(root, file, text, env = process.env, flag = 'w') {
  ensureStateDir(root, env);
  refuseLink(file);
  fs.writeFileSync(file, text, { flag });
}
