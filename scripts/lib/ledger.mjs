// ledger.mjs: the small decision record that survives compaction. Compaction drops rules and scope exclusions first, and what gets
// re-injected survives, so this one file is put back at every session start and at the top of every brief. It has a hard size limit,
// because a state file nobody can afford to read protects nothing. Writes go through here only.

import fs from 'node:fs';
import path from 'node:path';
import { StateError, statePaths } from './journal.mjs';

export const MAX_LINES = 40;
export const MAX_BYTES = 6144;
const KINDS = Object.freeze(['decision', 'constraint', 'pointer']);

const file = (root, env) => path.join(statePaths(root, env).dir, 'ledger.md');
const oneLine = (s) => String(s ?? '').replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ').trim();

export function readLedger(root, env = process.env) {
  try { return fs.readFileSync(file(root, env), 'utf8').trim(); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; }
}

// The ledger belongs to one route. Left in place, old decisions would reach later briefs as if they still bound the work.
export function clearLedger(root, env = process.env) {
  fs.rmSync(file(root, env), { force: true });
}

export function addToLedger(root, { kind, text }, env = process.env) {
  if (!KINDS.includes(kind)) throw new StateError(`a ledger entry is one of: ${KINDS.join(', ')}`);
  const line = oneLine(text);
  if (line === '') throw new StateError('a ledger entry needs text');
  const current = readLedger(root, env);
  const entry = `- ${kind}: ${line}`;
  if (current.split('\n').includes(entry)) return { lines: current.split('\n').length, added: false };
  const kept = kind === 'pointer' ? current.split('\n').filter((l) => l !== '' && !l.startsWith('- pointer:')) : current.split('\n').filter(Boolean);
  const next = [...kept, entry];
  const text2 = `${next.join('\n')}\n`;
  if (next.length > MAX_LINES || Buffer.byteLength(text2) > MAX_BYTES) throw new StateError(`the ledger is limited to ${MAX_LINES} lines and ${MAX_BYTES} bytes; state fewer, shorter decisions`);
  const target = file(root, env);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (fs.existsSync(target) && fs.lstatSync(target).isSymbolicLink()) throw new StateError(`refusing to write through a link at ${target}`);
  fs.writeFileSync(target, text2);
  return { lines: next.length, added: true };
}
