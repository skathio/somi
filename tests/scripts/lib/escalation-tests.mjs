#!/usr/bin/env node
// Tests of scripts/lib/escalation.mjs. Risk: a floor that goes DOWN (a class dropped from the raise, an edge moved, a
// fact added that removes a seat) or an unreadable input that reads as quiet. Pure numbers and names, no mocks.
// Usage: node escalation-tests.mjs <module path>; tests/scripts/escalation.sh runs it on the module and on scratch
// mutants of it, and each mutant must turn the test named there red. Hermetic: no model, no network.
//
// Monotonicity domain (finite, no random generator), asserted as the loop's own count so a shrunk domain turns the suite red:
// eight boolean facts, ordered false < true: a sensitive class name, a boundary class name, a contract class name, a ci
// class name, a denied name, a plan target, a slug given, a deleted test file; crossed with production_lines {0, 150, 151},
// production_files {0, 5, 6}, modules {0, 2, 3}, new_top_dirs {0, 1} and net test lines {+30, 0, -19, -20} (lower is more
// alarming). 2^8 x 3 x 3 x 3 x 2 x 4 = 55,296 evaluations. Moving one fact one step up must never turn off a seat, a seat
// reason, a reason, review_min, a hard-surface id or size_flag. Net test lines are the ordered fact, not their sum (the
// large-test-change seat reads the sum, out of range here). Outside it: more test lines added alone (`tests_weakened` reads
// net lines, so padding tests switches it off) and a test file changed (drops `untested_production`); that one stays 0 here.

import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';

const M = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const { escalation, HARD_SURFACE_IDS, SEAT_REASONS, CLASS_NAMES, REFUSED_REASON, INTERNAL_REASON } = M;

let pass = 0; let fail = 0;
const clip = (v) => JSON.stringify(v).slice(0, 160);
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${clip(want)}, got ${clip(got)})`); }
};
const LENSES = Object.keys(SEAT_REASONS);
const facts = (o = {}, classes = {}) => ({
  production_lines: 0, production_files: 0, test_lines_added: 0, test_lines_deleted: 0, test_files_deleted: 0, test_files_changed: 0,
  modules: 0, new_top_dirs: 0, denied: false, plan_target: false, plan_paths: false, slug_given: false, work_item_paths: false,
  ...o, classes: { sensitive: [], boundary: [], contract: [], ci: [], ...classes },
});
const run = (o, classes) => { try { return escalation(facts(o, classes)); } catch { return { threw: true }; } };
const seated = (r) => LENSES.filter((l) => r.seats?.[l]?.seat);

console.log('== escalation: edges ==');
check('an empty fact set seats only the reviewer, raises nothing and flags nothing', (({ review_min, reasons, tests_weakened, size_flag, hard_surface, seats }) => [review_min, reasons, tests_weakened, size_flag, hard_surface, seats['somi-reviewer'], seated({ seats })])(run()),
  [null, [], false, false, [], { seat: true, reasons: ['always'] }, ['somi-reviewer']]);
check('size_flag at the line and file edges, and it raises nothing', [150, 151].map((n) => run({ production_lines: n, test_files_changed: 1 })).concat([5, 6].map((n) => run({ production_files: n }))).map((r) => [r.size_flag, r.review_min, seated(r).length]),
  [[false, null, 1], [true, null, 1], [false, null, 1], [true, null, 1]]);
const weak = (added, deleted, gone) => run({ test_lines_added: added, test_lines_deleted: deleted, test_files_deleted: gone }).tests_weakened;
check('tests_weakened at net -19 and -20, with and without a deleted test file', [weak(0, 19, 0), weak(0, 20, 0), weak(0, 19, 1), weak(0, 1, 1), weak(5, 25, 0), weak(5, 24, 0)], [false, true, true, true, true, false]);
check('a moved test (a delete plus an add of the same lines) does not weaken tests, and a deletion with nothing added does', [weak(40, 40, 1), weak(0, 40, 1)], [false, true]);
check('tests_weakened raises security and seats the test strategist', (({ review_min, reasons, seats }) => [review_min, reasons, seats['somi-test-strategist']])(run({ test_lines_deleted: 20 })),
  ['security', ['tests_weakened'], { seat: true, reasons: ['tests_weakened'] }]);
check('modules at 2 and 3, and one new top directory, seat the architecture lens', [run({ modules: 2 }), run({ modules: 3 }), run({ new_top_dirs: 1 })].map((r) => r.seats['somi-architecture-reviewer'].reasons), [[], ['modules'], ['new_top_dirs']]);
check('the test strategist: a large test change at 99 and 100, 60 production lines with and without a changed test', [
  run({ test_lines_added: 99 }), run({ test_lines_added: 60, test_lines_deleted: 40 }), run({ production_lines: 59 }), run({ production_lines: 60 }), run({ production_lines: 60, test_files_changed: 1 }),
].map((r) => r.seats['somi-test-strategist'].reasons), [[], ['large_test_change'], [], ['untested_production'], []]);
check('the plan and sdlc lenses follow their flags', [run({ plan_target: true }), run({ plan_paths: true }), run({ slug_given: true }), run({ work_item_paths: true })].map((r) => seated(r).slice(1)),
  [['somi-plan-reviewer'], ['somi-plan-reviewer'], ['somi-sdlc-reviewer'], ['somi-sdlc-reviewer']]);

console.log('== escalation: classes and hard surface ==');
const each = (cls, rest = {}) => CLASS_NAMES[cls].map((n) => run(rest, { [cls]: [n] }));
check('every sensitive class name raises security with its reason', each('sensitive').map((r) => [r.review_min, r.reasons]).filter(([, rs]) => rs[0] !== 'deny_list'),
  CLASS_NAMES.sensitive.filter((n) => n !== 'deny_list').map((n) => ['security', [`sensitive:${n}`]]));
check('every boundary class name raises security with its reason', each('boundary').map((r) => [r.review_min, r.reasons]).filter(([, rs]) => rs[0] !== 'deny_list'),
  CLASS_NAMES.boundary.filter((n) => n !== 'deny_list').map((n) => ['security', [`boundary:${n}`]]));
check('a contract or ci class name raises no lens, and a contract name seats architecture', [...each('contract'), ...each('ci')].map((r) => [r.review_min, seated(r).length]), [...CLASS_NAMES.contract.map(() => [null, 2]), [null, 1]]);
check('a denied flag, or the deny_list class name, raises security as one deny_list reason', [run({ denied: true }), run({}, { sensitive: ['deny_list'], boundary: ['deny_list'] })].map((r) => [r.review_min, r.reasons, r.hard_surface]), [['security', ['deny_list'], ['deny_list']], ['security', ['deny_list'], ['deny_list']]]);
check('hard-surface ids: manifest, lockfile and schema from contract names, migration from migrations, ci from a ci name or the sensitive ci name, deny_list from denied', [
  ...CLASS_NAMES.contract.map((n) => run({}, { contract: [n] }).hard_surface), run({}, { sensitive: ['migrations'] }).hard_surface, run({}, { ci: ['ci'] }).hard_surface, run({}, { sensitive: ['ci'] }).hard_surface, run({ denied: true }).hard_surface,
], [['lockfile'], ['manifest'], ['schema'], ['migration'], ['ci'], ['ci'], ['deny_list']]);
check('hard-surface ids are sorted, unique and drawn from the closed set', run({ denied: true }, { contract: ['schema', 'schema', 'lockfile'], sensitive: ['migrations', 'ci'], ci: ['ci'] }).hard_surface, ['ci', 'deny_list', 'lockfile', 'migration', 'schema']);
check('the raising classes and reasons name security in the one security lens', (({ seats }) => seats['somi-security-reviewer'])(run({ denied: true, test_lines_deleted: 30 }, { boundary: ['routes', 'routes'] })),
  { seat: true, reasons: ['boundary:routes', 'deny_list', 'tests_weakened'] });

console.log('== escalation: refused input ==');
const good = facts();
const accessor = { ...good }; Object.defineProperty(accessor, 'modules', { get: () => 0, enumerable: true });
const badClass = (k, v) => ({ ...good, classes: { ...good.classes, [k]: v } });
const hole = []; hole.length = 1;
const proxy = new Proxy(good, { ownKeys() { throw new Error('trap'); } });
const REFUSALS = {
  'an unknown key': { ...good, extra: 1 }, 'a missing key': (({ modules, ...r }) => r)(good), 'a string for a count': { ...good, modules: '3' }, 'a negative count': { ...good, modules: -1 },
  'a fractional count': { ...good, modules: 1.5 }, 'an unsafe integer': { ...good, modules: 2 ** 60 }, 'infinity': { ...good, production_lines: Infinity }, 'a number for a flag': { ...good, denied: 1 },
  'an accessor': accessor, 'an array': [], 'null': null, 'a string': 'facts', 'undefined': undefined, 'a class instance': Object.assign(new (class X {})(), good),
  'an unknown class name': badClass('sensitive', ['/etc/passwd']), 'an unknown class key': { ...good, classes: { ...good.classes, extra: [] } }, 'a missing class key': { ...good, classes: { sensitive: [] } },
  'a class list that is not an array': badClass('boundary', 'routes'), 'a sparse class list': badClass('boundary', hole), 'an over-long class list': badClass('boundary', Array(17).fill('data')), 'a throwing proxy': proxy,
};
check('refused input returns the raising result and never throws', Object.fromEntries(Object.entries(REFUSALS).map(([k, v]) => [k, (() => { try { const r = escalation(v); return [r.review_min, r.reasons]; } catch { return 'threw'; } })()])),
  Object.fromEntries(Object.keys(REFUSALS).map((k) => [k, ['security', [REFUSED_REASON]]])));
check('the refused result seats every lens, flags size and carries every hard-surface id', (({ seats, size_flag, tests_weakened, hard_surface }) => [seated({ seats }), size_flag, tests_weakened, hard_surface])(escalation(null)), [LENSES, true, false, [...HARD_SURFACE_IDS]]);
// Array.prototype.filter is called by the rules and not by the input reader, so a throwing one is a bug in the rules, not bad input.
// `reached` counts the calls: when the rules stop calling it, the next check says so instead of failing on its values.
let reached = 0;
const whileBroken = (fn) => { const keep = Array.prototype.filter; Array.prototype.filter = () => { reached++; throw new Error('bug'); }; try { return fn(); } finally { Array.prototype.filter = keep; } };
const broken = whileBroken(() => { try { return escalation(facts()); } catch { return { threw: true }; } });
check('the internal-error test breaks the rules where it means to: Array.prototype.filter is reached (if not, patch whichever method the rules call now)', reached > 0, true);
check('an unexpected error in the rules is the raising result under its own reason id, not the unreadable-input one; bad input keeps its id', [
  broken.threw ?? [broken.review_min, broken.reasons, broken.hard_surface, seated(broken), LENSES.map((l) => broken.seats[l].reasons)], escalation(null).reasons, INTERNAL_REASON !== REFUSED_REASON,
], [['security', [INTERNAL_REASON], [...HARD_SURFACE_IDS], LENSES, LENSES.map(() => [INTERNAL_REASON])], [REFUSED_REASON], true]);
check('a plain object with a null prototype and a frozen input are read', [escalation(Object.assign(Object.create(null), facts())).review_min, escalation(Object.freeze(facts())).review_min], [null, null]);

console.log('== escalation: output ==');
const sample = [run(), run({ denied: true, test_lines_deleted: 40, modules: 3 }, { sensitive: ['auth'], contract: ['manifest'] }), escalation(null)];
check('the output is deterministic, pure ASCII and has the same keys always', [escalation(facts()), JSON.stringify(sample).length > 0 && /^[\x20-\x7e]*$/.test(JSON.stringify(sample)), sample.map((r) => Object.keys(r).join())],
  [run(), true, sample.map(() => 'review_min,reasons,tests_weakened,size_flag,hard_surface,seats')]);
const SHAPE = ['always', 'facts_unreadable', 'internal_error', 'review_min', ...Object.values(SEAT_REASONS).flat(), 'security'];
const strings = (v) => (typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [...(Array.isArray(v) ? [] : [k]), ...strings(x)]) : []);
const ids = new Set(strings(sample).concat(strings(run({ denied: true }, { sensitive: ['auth'], boundary: ['data'], contract: ['schema'] }))));
const known = new Set([...SHAPE, 'seat', 'reasons', 'tests_weakened', 'size_flag', 'hard_surface', 'seats', ...LENSES, ...HARD_SURFACE_IDS, ...CLASS_NAMES.sensitive.map((n) => `sensitive:${n}`), ...CLASS_NAMES.boundary.map((n) => `boundary:${n}`), ...CLASS_NAMES.contract.map((n) => `contract:${n}`)]);
check('a result holds ids, booleans and counts only: every string is a fixed id and no input name is echoed', [[...ids].filter((s) => !known.has(s)), JSON.stringify(escalation({ ...good, '/home/u/secret.pem': 1 }))], [[], JSON.stringify(escalation(null))]);
const ALL = run({ denied: true, test_lines_deleted: 100, production_lines: 60, new_top_dirs: 1, modules: 3, plan_target: true, plan_paths: true, slug_given: true, work_item_paths: true },
  { sensitive: [...CLASS_NAMES.sensitive], boundary: [...CLASS_NAMES.boundary], contract: [...CLASS_NAMES.contract], ci: ['ci'] });
check('the registries and constants are frozen and, with every fact on, a lens emits exactly the reason ids its registry lists', [
  Object.isFrozen(HARD_SURFACE_IDS), Object.isFrozen(SEAT_REASONS), Object.isFrozen(SEAT_REASONS['somi-reviewer']), Object.isFrozen(CLASS_NAMES.sensitive),
  LENSES.map((l) => [...new Set(ALL.seats[l].reasons.map((id) => id.split(':')[0]))].sort()),
], [true, true, true, true, LENSES.map((l) => [...SEAT_REASONS[l]].sort())]);

console.log('== escalation: exhaustive monotonicity ==');
// escalation.sh sets SKIP_DOMAIN=mutant-run for the scratch mutants that do not name one of these checks. Only that exact value skips.
if (process.env.SKIP_DOMAIN === 'mutant-run') console.log('  skip the exhaustive monotonicity checks (SKIP_DOMAIN=mutant-run)');
else {
  // Each flag fact is [fact overrides, class overrides] when set.
  const FLAG_FACTS = [
    [{}, { sensitive: ['auth'] }], [{}, { boundary: ['routes'] }], [{}, { contract: ['manifest'] }], [{}, { ci: ['ci'] }],
    [{ denied: true }, {}], [{ plan_target: true }, {}], [{ slug_given: true }, {}], [{ test_files_deleted: 1 }, {}],
  ];
  const AXES = [[0, 150, 151], [0, 5, 6], [0, 2, 3], [0, 1], [30, 0, -19, -20]];
  const point = (bits, ax) => {
    const net = AXES[4][ax[4]];
    const o = { production_lines: AXES[0][ax[0]], production_files: AXES[1][ax[1]], modules: AXES[2][ax[2]], new_top_dirs: AXES[3][ax[3]], test_lines_added: Math.max(net, 0), test_lines_deleted: Math.max(-net, 0) };
    const classes = {};
    FLAG_FACTS.forEach(([over, cls], i) => { if (bits >> i & 1) { Object.assign(o, over); Object.assign(classes, cls); } });
    return facts(o, classes);
  };
  const SIZES = AXES.map((a) => a.length);
  const results = new Map(); let evaluations = 0;
  for (let bits = 0; bits < 256; bits++) for (let a = 0; a < SIZES[0]; a++) for (let b = 0; b < SIZES[1]; b++) for (let c = 0; c < SIZES[2]; c++) for (let d = 0; d < SIZES[3]; d++) for (let e = 0; e < SIZES[4]; e++) {
    results.set([bits, a, b, c, d, e].join(), escalation(point(bits, [a, b, c, d, e]))); evaluations++;
  }
  // Every decision a result makes, as strings: `lo` is covered by `hi` when its set is inside hi's. The reason ids count too,
  // except against the refused result, whose one reason is its own.
  const decisions = (r, reasons) => new Set([...(r.review_min ? ['review_min'] : []), ...(r.size_flag ? ['size_flag'] : []), ...r.hard_surface.map((h) => `hard:${h}`),
    ...LENSES.flatMap((l) => [...(r.seats[l].seat ? [l] : []), ...(reasons ? r.seats[l].reasons.map((x) => `${l}/${x}`) : [])]), ...(reasons ? r.reasons : [])]);
  const inside = (lo, hi) => { for (const x of lo) if (!hi.has(x)) return false; return true; };
  const full = new Map([...results].map(([k, r]) => [k, decisions(r, true)]));
  let edges = 0; const broken = [];
  for (const key of results.keys()) {
    const [bits, ...ax] = key.split(',').map(Number);
    const ups = [...FLAG_FACTS.map((_, i) => (bits >> i & 1 ? null : [bits | 1 << i, ...ax])), ...ax.map((v, i) => (v + 1 < SIZES[i] ? [bits, ...ax.map((x, j) => (j === i ? x + 1 : x))] : null))];
    for (const up of ups.filter(Boolean)) { edges++; if (!inside(full.get(key), full.get(up.join()))) broken.push(`${key} -> ${up.join()}`); }
  }
  // Flag edges 8 x 128 x 216, ordinal edges 110,592 + 27,648 + 41,472.
  check('the monotonicity domain has 55,296 evaluations and 400,896 one-step edges', [evaluations, results.size, edges], [55296, 55296, 400896]);
  check('a fact moved one step up never turns off a seat, a seat reason, a reason, review_min, a hard-surface id or size_flag', broken.slice(0, 3), []);
  check('review_min is null or security over the whole domain, and a quiet point exists', [[...new Set([...results.values()].map((r) => r.review_min))].sort(), results.get('0,0,0,0,0,0').review_min], [[null, 'security'], null]);
  check('the refused result dominates every result in the domain', (() => { const top = decisions(escalation(null)); return [...results.values()].filter((r) => !inside(decisions(r), top)).length; })(), 0);
}

console.log(`SUMMARY ${pass + fail} ${fail}`);
process.exit(fail ? 1 : 0);
