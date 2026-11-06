// delegation.mjs: a short-lived note that somi_route has just sent a change to a worker. On Claude Code the main thread's file edits are held
// back while it stands, because a model on the conversation's tier will otherwise do cheaper work itself: in a smoke run it did so in 9 of
// 11 tasks it was told to hand down. The note goes when a SoMi worker starts, when the user sends the next message, or after 30 minutes,
// so a follow-up, a change of mind or the user saying "do it here" is never held back.

import fs from 'node:fs';
import path from 'node:path';
import { statePaths, writeStateFile } from './state.mjs';

export const DELEGATION_TTL_MS = 30 * 60 * 1000;
const file = (root, env) => path.join(statePaths(root, env).dir, 'delegation.json');

export function markDelegation(root, { agent, tier }, env = process.env, now = Date.now()) {
  writeStateFile(root, file(root, env), `${JSON.stringify({ agent, tier, at: now })}\n`, env);
}

export function activeDelegation(root, env = process.env, now = Date.now()) {
  let note;
  try { note = JSON.parse(fs.readFileSync(file(root, env), 'utf8')); } catch { return null; }
  return Number.isFinite(note?.at) && now - note.at < DELEGATION_TTL_MS && typeof note.agent === 'string' ? note : null;
}

export function clearDelegation(root, env = process.env) {
  fs.rmSync(file(root, env), { force: true });
}
