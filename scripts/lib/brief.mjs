// brief.mjs: a feature made ready to build, as a plain file. /somi-brief writes it with the user, and the staged workflow or plain SoMi
// builds from it. brief-parse.mjs says what a ready brief holds. Writes go through here only.

import fs from 'node:fs';
import path from 'node:path';
import { notOwn } from './brief-own.mjs';
import { addToLedger, removeFromLedger } from './ledger.mjs';
import { MAX_BRIEF_BYTES, parseBrief } from './brief-parse.mjs';
import { StateError, ensureSomiDir, refuseLink } from './state.mjs';

export { MAX_REQUIREMENTS, parseBrief } from './brief-parse.mjs';

const briefFile = (root) => path.join(root, '.somi', 'brief.md');

// Over the size limit, the file is not read at all: it may have come from anywhere, and nothing past the limit could be a brief.
function readBriefText(root) {
  try {
    if (!refuseLink(briefFile(root))) return null;
    return fs.statSync(briefFile(root)).size > MAX_BRIEF_BYTES ? '' : fs.readFileSync(briefFile(root), 'utf8');
  } catch (e) { if (e.code !== 'ENOENT' && !(e instanceof StateError)) throw e; }
  return null;
}


// A brief that no longer parses, or that the repository ships, is reported and never used, and its text is not handed on: building from
// half a brief, or from someone else's, is worse than building from none.
export function readBrief(root) {
  const text = readBriefText(root);
  if (text === null) return null;
  const foreign = notOwn(root);
  if (foreign) return { invalid: foreign, foreign: true };
  try { return { ...parseBrief(text), text }; } catch (e) { if (e instanceof StateError) return { invalid: e.message }; throw e; }
}

// Its decisions go to the ledger too, which comes back after compaction and reaches every worker. A ledger that is full keeps the brief
// saved and says which decisions did not fit, so none is lost without anyone seeing.
export function saveBrief(root, text, env = process.env) {
  const brief = parseBrief(text);
  const foreign = notOwn(root);
  if (foreign) throw new StateError(`a brief cannot be saved here: ${foreign}`);
  const replaced = readBrief(root);
  ensureSomiDir(root);
  refuseLink(briefFile(root));
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW = 0 } = fs.constants;
  const fd = fs.openSync(briefFile(root), O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o644);
  try { fs.writeSync(fd, text); } finally { fs.closeSync(fd); }
  // A brief that does not read has no decisions, so nothing of it is taken out.
  removeFromLedger(root, { kind: 'decision', texts: replaced?.decisions ?? [] }, env);
  const unrecorded = [];
  for (const d of brief.decisions) {
    try { addToLedger(root, { kind: 'decision', text: d }, env); } catch (e) { if (e instanceof StateError) unrecorded.push(d); else throw e; }
  }
  return { saved: path.relative(root, briefFile(root)), ...briefStatus(brief), ...(unrecorded.length ? { unrecorded } : {}) };
}

export const briefStatus = (brief) => (brief?.invalid ? { invalid: brief.invalid } : { title: brief.title, requirements: brief.requirements.length, handoff: brief.handoff });

// Closing takes the brief's own decisions out of the ledger and leaves every other note there. With no brief open there is nothing to close.
export function closeBrief(root, env = process.env) {
  const open = readBrief(root);
  // A brief that is not the user's own is not theirs to delete either: it is a file in the repository, or behind a link to one.
  if (open === null || open.foreign) return { closed: false, invalid: open?.invalid };
  fs.rmSync(briefFile(root), { force: true });
  removeFromLedger(root, { kind: 'decision', texts: open.decisions ?? [] }, env);
  return { closed: true };
}

// The request the stages read: the requirements, one per line and unnumbered, so the workflow's own numbering matches the brief's.
export const briefRequest = (brief) => brief.requirements.join('\n');
