// escalation.mjs — escalation(facts): which review lenses does the shape of a diff warrant?
//
// Pure: no import, no filesystem, no clock, no content. The input is counts, flags and class names (what
// classifyPaths and a diff's per-file rows give); no path and no diff text goes in, so none can come out. Output:
//   { review_min, reasons, tests_weakened, size_flag, hard_surface, seats: { <lens>: { seat, reasons } } }
// `review_min` is `security` or null and nothing else (the loop's validator allows only that). A sensitive or
// boundary class name, a denied name or weakened tests raise it. Size only marks: `size_flag` changes no lens.
//
// Raise-only, with two exceptions: every fact is ordered (a class name present, a flag set, a count over its edge is the
// more alarming value) and every output grows with it, so a fact added never removes a seat, a reason, a hard-surface id
// or the flag, except more test lines added (`tests_weakened` reads net lines, so padding tests switches it off) and a
// test file changed (drops `untested_production`). There is no config. A result is never lowered across passes because
// the loop takes the max with the earlier pass. The input is a closed grammar read once into a plain
// copy: an unknown or missing key, a wrong type, a negative count, an unknown class name, an accessor or a
// non-plain object is the refused result, which is the raising result (every seat, every hard-surface id), as
// size-tier does for unreadable signals. `escalation` never throws.
//
// Provisional: the numbers are the research report's guesses (150 lines, 5 files) or the planner's, and live
// here so they can be fitted without touching the rules.

export const SIZE_FLAG_LINES = 150;
export const SIZE_FLAG_FILES = 5;
export const WEAKENED_NET_LINES = 20;
export const MAX_MODULES_SEAT = 2;
export const LARGE_TEST_CHANGE = 100;
export const UNTESTED_PRODUCTION_LINES = 60;
export const MAX_CLASS_NAMES = 16;
export const REFUSED_REASON = 'facts_unreadable';
const DENY = 'deny_list';

const freezeAll = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze(v)])));
export const HARD_SURFACE_IDS = Object.freeze(['ci', DENY, 'lockfile', 'manifest', 'migration', 'schema']);
export const CLASS_NAMES = freezeAll({
  sensitive: ['auth', 'ci', 'config', 'crypto', DENY, 'infra', 'migrations', 'secrets'],
  boundary: ['data', DENY, 'input', 'process', 'routes'],
  contract: ['lockfile', 'manifest', 'schema'],
  ci: ['ci'],
});
// The reason ids each lens can carry (`sensitive:<name>` and `contract:<name>` are listed by prefix); the lens table in
// the review-panel flow is compared with this.
export const SEAT_REASONS = freezeAll({
  'somi-reviewer': ['always'],
  'somi-security-reviewer': ['sensitive', 'boundary', DENY, 'tests_weakened'],
  'somi-architecture-reviewer': ['new_top_dirs', 'contract', 'modules'],
  'somi-test-strategist': ['tests_weakened', 'large_test_change', 'untested_production'],
  'somi-plan-reviewer': ['plan_target', 'plan_paths'],
  'somi-sdlc-reviewer': ['slug_given', 'work_item_paths'],
});
const SEATS = Object.keys(SEAT_REASONS);
const COUNTS = ['production_lines', 'production_files', 'test_lines_added', 'test_lines_deleted', 'test_files_deleted', 'test_files_changed', 'modules', 'new_top_dirs'];
const FLAGS = ['denied', 'plan_target', 'plan_paths', 'slug_given', 'work_item_paths'];

const refuse = () => { throw new TypeError('unreadable facts'); };
const isPlain = (o) => o !== null && typeof o === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(o));
const own = (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d && 'value' in d ? d.value : refuse(); };
const keysAre = (o, want) => { const have = Reflect.ownKeys(o); return (have.length === want.length && want.every((k) => have.includes(k))) || refuse(); };

function names(list, allowed) {
  if (!Array.isArray(list) || Object.getPrototypeOf(list) !== Array.prototype || list.length > MAX_CLASS_NAMES) refuse();
  const slots = Array.from({ length: list.length }, (_, i) => String(i));
  keysAre(list, [...slots, 'length']);
  const out = slots.map((i) => own(list, i));
  return out.every((n) => allowed.includes(n)) ? [...new Set(out)].sort() : refuse();
}

function read(facts) {
  if (!isPlain(facts)) refuse();
  keysAre(facts, [...COUNTS, ...FLAGS, 'classes']);
  const f = {};
  for (const k of COUNTS) { const v = own(facts, k); f[k] = Number.isSafeInteger(v) && v >= 0 ? v : refuse(); }
  for (const k of FLAGS) { const v = own(facts, k); f[k] = typeof v === 'boolean' ? v : refuse(); }
  const classes = own(facts, 'classes');
  if (!isPlain(classes)) refuse();
  keysAre(classes, Object.keys(CLASS_NAMES));
  f.classes = Object.fromEntries(Object.keys(CLASS_NAMES).map((k) => [k, names(own(classes, k), CLASS_NAMES[k])]));
  return f;
}

const seated = (byLens) => Object.fromEntries(SEATS.map((l) => [l, { seat: byLens[l].length > 0, reasons: byLens[l] }]));
const when = (on, id) => (on ? [id] : []);

function judge(f) {
  const { sensitive, boundary, contract, ci } = f.classes;
  const net = f.test_lines_added - f.test_lines_deleted;
  const tests_weakened = net < 0 && (f.test_files_deleted >= 1 || -net >= WEAKENED_NET_LINES);
  const denied = f.denied || sensitive.includes(DENY) || boundary.includes(DENY);
  const reasons = [
    ...sensitive.filter((n) => n !== DENY).map((n) => `sensitive:${n}`),
    ...boundary.filter((n) => n !== DENY).map((n) => `boundary:${n}`),
    ...when(denied, DENY), ...when(tests_weakened, 'tests_weakened'),
  ];
  const hard = [...contract, ...when(sensitive.includes('migrations'), 'migration'), ...when(ci.length > 0 || sensitive.includes('ci'), 'ci'), ...when(denied, DENY)];
  return {
    review_min: reasons.length > 0 ? 'security' : null,
    reasons,
    tests_weakened,
    size_flag: f.production_lines > SIZE_FLAG_LINES || f.production_files > SIZE_FLAG_FILES,
    hard_surface: [...new Set(hard)].sort(),
    seats: seated({
      'somi-reviewer': ['always'],
      'somi-security-reviewer': reasons,
      'somi-architecture-reviewer': [...when(f.new_top_dirs >= 1, 'new_top_dirs'), ...contract.map((n) => `contract:${n}`), ...when(f.modules > MAX_MODULES_SEAT, 'modules')],
      'somi-test-strategist': [
        ...when(tests_weakened, 'tests_weakened'),
        ...when(f.test_lines_added + f.test_lines_deleted >= LARGE_TEST_CHANGE, 'large_test_change'),
        ...when(f.production_lines >= UNTESTED_PRODUCTION_LINES && f.test_files_changed === 0, 'untested_production'),
      ],
      'somi-plan-reviewer': [...when(f.plan_target, 'plan_target'), ...when(f.plan_paths, 'plan_paths')],
      'somi-sdlc-reviewer': [...when(f.slug_given, 'slug_given'), ...when(f.work_item_paths, 'work_item_paths')],
    }),
  };
}

const refused = () => ({
  review_min: 'security',
  reasons: [REFUSED_REASON],
  tests_weakened: false,
  size_flag: true,
  hard_surface: [...HARD_SURFACE_IDS],
  seats: seated(Object.fromEntries(SEATS.map((l) => [l, [REFUSED_REASON]]))),
});

export function escalation(facts) {
  try { return judge(read(facts)); } catch { return refused(); }
}
