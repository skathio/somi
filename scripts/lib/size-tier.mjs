// size-tier.mjs — decideTier(signals): how much pipeline does this request deserve?
//
// The model extracts observable signals (each with an evidence string); this pure function decides
// the tier, so the same signals always give the same answer and the reasons come from signal ids,
// never from model prose. No I/O, no clock, no imports. Unsure goes up: a signal that is unknown,
// missing, lacks evidence, is malformed, or is contradicted by the counts counts as its worst case
// and is listed in `failed`.
//
// Tiers: trivial (-> /code), small (-> inline brief -> /code-loop), full (-> today's flow).
//
// Signals T1..T5 are the five numbered signals of the trivial threshold, in the same order. Their
// meaning, and how to extract every other signal (what the count signals measure, what
// hard_surface covers), lives only in skills/somi-routing/SKILL.md, section "Size tiers"; this
// file holds ids and thresholds, never the wording.
//
// Input: { <id>: { value, evidence } }; evidence is 1..MAX_EVIDENCE_CHARS characters with no
// control characters. Output, always the same keys:
//   tier     'trivial' | 'small' | 'full'
//   floor    'full' | null — 'full' whenever T3 is not a proven true, whichever rule fired first
//            (a security doubt must survive an existing-work-item match); no override may go below it
//   failed   ids that were read as their worst case = unknown + invalid, in SIGNAL_IDS order
//   unknown  ids the extractor explicitly marked null / 'unknown'
//   invalid  ids that were missing, malformed, over the evidence cap, or contradicted by the counts
//   reasons  signal ids that fired the deciding rule (`<id>_unknown` for an unknown work-item or
//            brief signal); for small, the signals that kept it from trivial; for trivial, empty
//   basis    { id: evidence } for T3 and, when the tier is below full, every signal read cleanly,
//            so a human can see why security and size were ruled out
//
// Hostile input: the function runs no user code of its own making. It reads own data properties
// only (an accessor is never invoked) once each into a plain copy. That guarantee covers
// JSON-derived input, which is all a caller should pass (the CLI hands over JSON.parse output
// only). A Proxy can still fire its own traps, which the function survives (any throw becomes the
// refusal result), but it cannot claim more than plain JSON could.

export const MAX_MODULES = 2;
export const MAX_FILES = 6;
// Provisional: production lines only, tests not counted. To be revisited once the code loop's
// diff cap no longer counts test lines.
export const MAX_DIFF_LINES = 100;
export const TRIVIAL_MAX_FILES = 1;
export const TRIVIAL_MAX_MODULES = 1;
export const TRIVIAL_MAX_DIFF_LINES = 50;
export const MAX_EVIDENCE_CHARS = 300;

export const SIGNAL_IDS = Object.freeze([
  'T1', 'T2', 'T3', 'T4', 'T5',
  'hard_surface', 'design_open', 'open_questions', 'acceptance_testable',
  'modules_touched', 'est_files', 'est_diff_lines',
  'existing_work_item', 'brief_exists',
]);

const MIN_COUNT = { open_questions: 0, modules_touched: 1, est_files: 1, est_diff_lines: 1 };
const TRIVIAL_IDS = SIGNAL_IDS.slice(0, 5);
// C0/C1 controls plus the invisible and direction-changing characters that can disguise text in a terminal.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/;

// What an unreadable signal is taken to be: the answer that sends the tier up.
const WORST = Object.freeze({
  T1: false, T2: false, T3: false, T4: false, T5: false,
  hard_surface: true, design_open: true, acceptance_testable: false,
  existing_work_item: true, brief_exists: true,
  open_questions: Infinity, modules_touched: Infinity, est_files: Infinity, est_diff_lines: Infinity,
});

const REFUSED = () => ({
  tier: 'full', floor: 'full', failed: [...SIGNAL_IDS], unknown: [], invalid: [...SIGNAL_IDS],
  reasons: ['signals_unreadable'], basis: {},
});

function plain(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
}

// Own data property only: an accessor is never invoked, an inherited key is never seen.
function own(o, key) {
  const d = Object.getOwnPropertyDescriptor(o, key);
  return d && 'value' in d ? d.value : undefined;
}

const validEvidence = (e) => typeof e === 'string' && e.trim() !== ''
  && e.length <= MAX_EVIDENCE_CHARS && !CONTROL_CHARS.test(e);

// -> { state: 'ok', value, evidence } | { state: 'unknown' } | { state: 'invalid' }
function readEntry(entry, id) {
  if (!plain(entry)) return { state: 'invalid' };
  const value = own(entry, 'value');
  const evidence = own(entry, 'evidence');
  if (!validEvidence(evidence)) return { state: 'invalid' };
  if (value === null || value === 'unknown') return { state: 'unknown' };
  const isCount = id in MIN_COUNT;
  const good = isCount ? Number.isSafeInteger(value) && value >= MIN_COUNT[id] : typeof value === 'boolean';
  return good ? { state: 'ok', value, evidence } : { state: 'invalid' };
}

// One pass, each field read once into a plain copy; everything after works on the copy.
function readSignals(input) {
  if (!plain(input)) return null;
  const v = {};
  const read = {};
  for (const id of SIGNAL_IDS) read[id] = readEntry(own(input, id), id);
  // A footprint claim the counts contradict is not believed.
  if (read.T1.state === 'ok' && read.T1.value) {
    const files = read.est_files, mods = read.modules_touched;
    if ((files.state === 'ok' && files.value > TRIVIAL_MAX_FILES) || (mods.state === 'ok' && mods.value > TRIVIAL_MAX_MODULES)) {
      read.T1 = { state: 'invalid' };
    }
  }
  for (const id of SIGNAL_IDS) v[id] = read[id].state === 'ok' ? read[id].value : WORST[id];
  const unknown = SIGNAL_IDS.filter((id) => read[id].state === 'unknown');
  const invalid = SIGNAL_IDS.filter((id) => read[id].state === 'invalid');
  return { v, read, unknown, invalid };
}

// Each check is [signal id, does this value send the tier up?].
const fired = (v, checks) => checks.filter(([id, up]) => up(v[id])).map(([id]) => id);

// First match wins. Order is the contract; each rule names the signals that fired it.
const RULES = [
  (v) => {
    const hit = fired(v, [['existing_work_item', (x) => x], ['brief_exists', (x) => x]]);
    return hit.length ? { tier: 'full', reasons: hit } : null;
  },
  (v) => (v.T3 === false ? { tier: 'full', reasons: ['T3'] } : null),
  (v) => {
    const hit = fired(v, [
      ['hard_surface', (x) => x], ['design_open', (x) => x], ['open_questions', (x) => x > 0],
      ['acceptance_testable', (x) => !x], ['T4', (x) => !x],
    ]);
    return hit.length ? { tier: 'full', reasons: hit } : null;
  },
  (v) => {
    const hit = fired(v, [
      ['modules_touched', (x) => x > MAX_MODULES], ['est_files', (x) => x > MAX_FILES],
      ['est_diff_lines', (x) => x > MAX_DIFF_LINES],
    ]);
    return hit.length ? { tier: 'full', reasons: hit } : null;
  },
  (v) => (TRIVIAL_IDS.every((id) => v[id] === true) && v.est_files <= TRIVIAL_MAX_FILES
    && v.modules_touched <= TRIVIAL_MAX_MODULES && v.est_diff_lines <= TRIVIAL_MAX_DIFF_LINES
    ? { tier: 'trivial', reasons: [] } : null),
];

const SMALL_BECAUSE = [
  ['est_files', (x) => x > TRIVIAL_MAX_FILES],
  ['modules_touched', (x) => x > TRIVIAL_MAX_MODULES],
  ['est_diff_lines', (x) => x > TRIVIAL_MAX_DIFF_LINES],
];

export function decideTier(signals) {
  let r;
  try {
    r = readSignals(signals);
  } catch {
    return REFUSED();
  }
  if (!r) return REFUSED();
  const { v, read, unknown, invalid } = r;
  let decided = null;
  for (const rule of RULES) {
    decided = rule(v);
    if (decided) break;
  }
  if (!decided) {
    decided = { tier: 'small', reasons: [...TRIVIAL_IDS.filter((id) => v[id] !== true), ...fired(v, SMALL_BECAUSE)] };
  }
  const failed = SIGNAL_IDS.filter((id) => read[id].state !== 'ok');
  const reasons = decided.reasons.map((id) => ((id === 'existing_work_item' || id === 'brief_exists') && failed.includes(id) ? `${id}_unknown` : id));
  const basis = {};
  for (const id of SIGNAL_IDS) {
    if (read[id].state === 'ok' && (id === 'T3' || decided.tier !== 'full')) basis[id] = read[id].evidence;
  }
  return { tier: decided.tier, floor: v.T3 === true ? null : 'full', failed, unknown, invalid, reasons, basis };
}
