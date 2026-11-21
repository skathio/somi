// brief-route.mjs: what an open brief changes about a route. /somi-deliver builds the open brief, typed bare or with words of the user's
// own; plain SoMi is told the brief is there and builds against it when the request is its work. A brief that no longer reads is named,
// never used, because building from half a brief is worse than building from none.

import { briefRequest, briefStatus } from './brief.mjs';

const BARE_DELIVER = /^\/(?:somi:)?somi-deliver\s*$/;
export const bareDeliver = (said) => BARE_DELIVER.test(String(said ?? '').trim());
const BRIEF_PATH = '.somi/brief.md';

// The staged workflow takes the brief's own lines as the request, so its numbering is the brief's, and gets the rest as facts it would
// otherwise scout for or guess. Every field is a list, so the workflow adds nothing for an empty one without a branch of its own. The
// decisions are not repeated here: saving the brief put them in the ledger, which reaches every stage. The files and the test command it
// names are facts for the stages to read, never a command they run: the scout still finds the test command from the code, so a brief that
// did not come from the user can name work but cannot choose what runs.
const listOf = (value) => [value].flat().filter((v) => typeof v === 'string' && v.trim() !== '');
const NONE = /^none\.?$/i;
export function briefArgs(brief) {
  const fields = { title: listOf(brief.title), goal: listOf(brief.goal), out_of_scope: brief.out_of_scope, conventions: brief.conventions, acceptance: brief.acceptance, boundaries: brief.boundaries.filter((b) => !NONE.test(b)), size: listOf(brief.size), files: brief.files, tests: listOf(brief.test_command) };
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v.length > 0));
}

// Whether this call builds the open brief in stages, and the request it then carries. Only a bare /somi-deliver does, or a staged call with
// no request: words typed after the command are the work, so a brief left open from earlier work is never rebuilt in their place. A bare
// command with no staged flag starts it only from a call that carries no request, because the fix a session makes after the workflow
// returns comes in the same turn, under the same typed message, and must not start the paid workflow again. A brief route, or an
// explicit staged false, never does.
export function stagedFromBrief({ brief, said, staged, flagged, hint, request }) {
  const ready = brief && !brief.invalid ? brief : null;
  const asked = bareDeliver(said) ? staged === true || !request : staged === true && !request;
  // Only build work runs as the staged workflow, so another hint keeps its own request.
  const builds = Boolean(ready) && (hint ?? 'build') === 'build' && flagged !== false && asked;
  return builds ? { staged: true, request: briefRequest(ready), hint: hint ?? 'build', fromBrief: ready } : { staged, request, hint, fromBrief: null };
}

// A brief may come from a cloned repository, so what it says reaches an answer capped, as a quoted name.
const quotedTitle = (brief) => JSON.stringify(String(brief.title).slice(0, 120));

// One line of advice, and the brief's status for the answer.
export function briefFields(brief, { fromBrief, route, staged }) {
  if (!brief) return {};
  if (brief.invalid) return { brief: { path: BRIEF_PATH, invalid: String(brief.invalid).slice(0, 200) }, brief_advice: `The brief at ${BRIEF_PATH} no longer reads: ${String(brief.invalid).slice(0, 200)} Tell the user once; /somi-brief fixes it. Do not build from it.` };
  const status = { path: BRIEF_PATH, ...briefStatus(brief) };
  if (route === 'brief') return { brief: status, brief_advice: `A brief is already open: ${quotedTitle(brief)}. Ask the user whether this work refines it or replaces it.` };
  if (staged && !fromBrief) return { brief: status, brief_advice: `A brief is open, ${quotedTitle(brief)}, but this run builds the user's words, not the brief. Tell the user once; /somi-deliver with nothing after it builds the brief.` };
  if (fromBrief) return { brief: status, brief_advice: `The open brief ${quotedTitle(brief)} is the work, and the workflow builds its ${brief.requirements.length} requirements. If the user's words ask for other work, do not start it: ask them whether to close the brief first. When the workflow's status is done, close the brief with somi_brief.` };
  const deliver = brief.handoff === 'deliver' ? ' Its handoff is deliver: tell the user once that typing /somi-deliver runs it in stages.' : '';
  return { brief: status, brief_advice: `A brief is open at ${BRIEF_PATH}: ${quotedTitle(brief)}. If this request is its work, read it and build every numbered requirement, keeping to its decisions and out of scope, and check each one off before you say it is done; when it is built and reviewed, close it with somi_brief. If this request is other work, leave the brief alone.${deliver}` };
}
