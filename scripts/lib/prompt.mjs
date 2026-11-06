// prompt.mjs: the user's latest message, word for word, as a hook saw it arrive. The agent's own summary of a request can lose the words
// that mark it as sensitive, or the detail a worker needs, so routing and briefs read these too. It lives under the state folder, is
// overwritten by every prompt, and never leaves the machine.

import fs from 'node:fs';
import path from 'node:path';
import { statePaths, writeStateFile } from './state.mjs';

export const MAX_PROMPT_BYTES = 65536;
const file = (root, env) => path.join(statePaths(root, env).dir, 'prompt.txt');

export function savePrompt(root, text, env = process.env) {
  if (typeof text !== 'string' || text.trim() === '') return false;
  writeStateFile(root, file(root, env), Buffer.from(text).subarray(0, MAX_PROMPT_BYTES).toString(), env);
  return true;
}

export function readPrompt(root, env = process.env) {
  try { return fs.readFileSync(file(root, env), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
}
