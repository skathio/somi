// loop-escalate.mjs -- the code loop's report of what its own cumulative diff warrants. Glue between the diff rows, the facts
// adapter (escalation-facts.mjs) and the pure rules (escalation.mjs), so loop-step.mjs stays small. It reports only: nothing
// here changes a review mode, a cap or a stop.
//
// escalate(root, env, rows, baseline) -> { ran: true, reasons, size_flag, tests_weakened, hard_surface, notes } or { ran: false }.
// `rows` are the measured diff's rows ({file, added, deleted, status}); the folders the measurement excludes (.claude, and the
// two .somi paths that carry policy) are listed here and added, because a change there is the one an injected coder would make
// to loosen its own limits. Everything the object carries is an id from a closed list; a path or file text never goes in. Any
// failure (a config file that cannot be read, which would drop the user's own sensitive paths; a git call that fails; an id of an
// unexpected shape) is `{ ran: false }`: the response says the escalation did not run, it is never skipped silently.
import { loadConfig } from './config-files.mjs';
import { diffFacts } from './escalation-facts.mjs';
import { escalation } from './escalation.mjs';
import { guardedRows } from './loop-review.mjs';

const ID = /^[a-z_]{1,32}(:[a-z_]{1,32})?$/;
const MAX_IDS = 24;
const ids = (list) => {
  if (!Array.isArray(list) || list.length > MAX_IDS || !list.every((x) => typeof x === 'string' && ID.test(x))) throw new TypeError('not an id list');
  return list;
};

export function escalate(root, env, rows, baseline) {
  try {
    const all = [...rows, ...guardedRows(root, baseline)];
    const { facts, notes } = diffFacts(all, { config: loadConfig(root, env) }); // its {global, project}, never the merged `.config`
    const e = escalation(facts);
    return { ran: true, reasons: ids(e.reasons), size_flag: e.size_flag === true, tests_weakened: e.tests_weakened === true, hard_surface: ids(e.hard_surface), notes: ids(notes) };
  } catch {
    return { ran: false };
  }
}

// What a step response carries: the object only when it has something to say.
export const reported = (e) => (e.ran === false || e.reasons.length > 0 || e.size_flag || e.tests_weakened || e.hard_surface.length > 0 || e.notes.length > 0
  ? { escalation: { ran: e.ran, ...(e.ran ? { reasons: e.reasons, size_flag: e.size_flag, tests_weakened: e.tests_weakened, hard_surface: e.hard_surface, ...(e.notes.length ? { notes: e.notes } : {}) } : {}) } }
  : {});

// The pass's diary text from a stored response's escalation; stored state is read as untrusted, so only ids of the closed shape pass.
export function diaryText(e) {
  if (e === null || typeof e !== 'object') return '';
  if (e.ran === false) return '; escalation did not run';
  try {
    const parts = [...ids(e.reasons), ...ids(e.hard_surface).map((h) => `hard:${h}`), ...(e.size_flag === true ? ['size_flag'] : []), ...(e.notes === undefined ? [] : ids(e.notes).map((n) => `note:${n}`))];
    return parts.length ? `; escalation: ${parts.join(', ')}` : '';
  } catch {
    return '; escalation unreadable';
  }
}
