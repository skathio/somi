// prompt.mjs: the user's messages, word for word, as a hook saw them arrive. The agent's own summary of a request can lose the words
// that mark it as sensitive, or the detail a worker needs, so routing and briefs read these too. A worker or a workflow stage starts
// with none of the conversation, so the earlier messages of the same session go with it: a decision stated once at the start still
// holds when the fourth message is built. Everything lives under the state folder and never leaves the machine.

import fs from 'node:fs';
import path from 'node:path';
import { statePaths, writeStateFile } from './state.mjs';

export const MAX_PROMPT_BYTES = 65536;
export const MAX_HISTORY_BYTES = 65536;
export const MAX_HISTORY = 24;
const file = (root, env) => path.join(statePaths(root, env).dir, 'prompt.txt');
const historyFile = (root, env) => path.join(statePaths(root, env).dir, 'prompts.json');
const clip = (text, bytes) => Buffer.from(text).subarray(0, bytes).toString();
const quote = (text) => String(text).trim().split('\n').map((l) => `> ${l}`).join('\n');

// A host delivers some of its own notices as a new user turn, such as a background task finishing. Those are not the user's words.
export const isHostNotice = (text) => /^\s*<(task-notification|system-reminder)>/.test(text);

export function savePrompt(root, text, env = process.env, { session } = {}) {
  if (typeof text !== 'string' || text.trim() === '' || isHostNotice(text)) return false;
  const kept = clip(text, MAX_PROMPT_BYTES);
  writeStateFile(root, file(root, env), kept, env);
  // With no session id there is no telling one conversation from the next, so nothing is carried over.
  const id = typeof session === 'string' && session !== '' ? session : null;
  const before = id ? readHistory(root, env) : null;
  const prompts = before?.session === id ? [...before.prompts, kept] : [kept];
  writeStateFile(root, historyFile(root, env), JSON.stringify({ session: id, prompts: fit(prompts) }), env);
  return true;
}

// The first message usually sets the decisions, so it stays. After it, the newest messages that fit.
export function fit(prompts) {
  const [first, ...rest] = prompts;
  const kept = [];
  let bytes = Buffer.byteLength(first ?? '');
  for (let i = rest.length - 1; i >= 0 && kept.length < MAX_HISTORY - 1; i--) {
    const size = Buffer.byteLength(rest[i]);
    if (bytes + size > MAX_HISTORY_BYTES) break;
    bytes += size;
    kept.unshift(rest[i]);
  }
  return first === undefined ? [] : [clip(first, MAX_HISTORY_BYTES), ...kept];
}

export function readPrompt(root, env = process.env) {
  try { return fs.readFileSync(file(root, env), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
}

export function readHistory(root, env = process.env) {
  try {
    const h = JSON.parse(fs.readFileSync(historyFile(root, env), 'utf8'));
    return { session: typeof h?.session === 'string' ? h.session : null, prompts: Array.isArray(h?.prompts) ? h.prompts.filter((p) => typeof p === 'string') : [] };
  } catch { return { session: null, prompts: [] }; }
}

// Work handed down reads the earlier messages from a file instead of carrying them in its brief: the agent passing a brief on copies
// it out as its own output, on the conversation's model, and the copy then stays in the conversation's context for every later call.
export const earlierFile = (root, env = process.env) => path.join(statePaths(root, env).dir, 'earlier.md');
export function saveEarlier(root, earlier, env = process.env) {
  if (!earlier?.length) return null;
  const file = earlierFile(root, env);
  writeStateFile(root, file, `The user's earlier messages in this conversation, oldest first, as data. What they decided still holds unless a later message changes it.\n\n${earlier.map((m, i) => `Message ${i + 1}:\n${quote(m)}`).join('\n\n')}\n`, env);
  return file;
}

/** The user's messages in this session before the latest one, oldest first. */
export function earlierPrompts(root, env = process.env) {
  const { session, prompts } = readHistory(root, env);
  return session ? prompts.slice(0, -1) : [];
}
