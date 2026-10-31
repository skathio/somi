#!/usr/bin/env node
// Tests of the labelled sizing set (tests/evals/lib/sizing-set.mjs). Risk: a set that validates when it should not, or a
// hash that does not move when a label, a request or a fixture does, would let two runs on different labels be compared.
// Red cases run against a scratch repository tree; the committed set is checked against the real one. Run by
// tests/scripts/eval-gate-bench-driver.sh. Hermetic: no model, no network.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { REPO_ROOT, SET_FILE, TIERS, labelHash, loadSet, scenarioId, setMaterial, sizingScenarios, stageFixture, validateSet } from '../../evals/lib/sizing-set.mjs';

let pass = 0; let fail = 0;
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${JSON.stringify(want)}, got ${JSON.stringify(got)})`); }
};
const clone = (v) => JSON.parse(JSON.stringify(v));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sizing-set-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
// A scratch tree: one corpus task, two fixtures, and the things a fixture name must not resolve to.
for (const d of ['tests/evals/ab-micro/M1-x', 'tests/evals/fixtures/fx', 'tests/evals/fixtures/fy', 'tests/evals/fixtures/_candidates', 'tests/evals/fixtures/_target', 'tests/evals/ab/D-empty']) fs.mkdirSync(path.join(tmp, d), { recursive: true });
fs.writeFileSync(path.join(tmp, 'tests/evals/ab-micro/M1-x/task.json'), '{}');
fs.writeFileSync(path.join(tmp, 'tests/evals/fixtures/afile'), 'x');
fs.symlinkSync('fx', path.join(tmp, 'tests/evals/fixtures/lnk'));

const corpus = { id: 'M1', label: 'small', task: 'ab-micro/M1-x', reason: 'one file' };
const authored = { id: 'A1', label: 'trivial', fixture: 'fx', request: 'Fix the typo in src/a.mjs.', reason: 'one file' };
const floor = { id: 'A2', label: 'full', sensitive: true, fixture: 'fy', request: 'Rotate the key.', reason: 'floor' };
const base = { schema_version: 1, entries: [corpus, authored, floor] };
const problems = (mut) => { const s = clone(base); mut(s); return validateSet(s, { root: tmp }); };

console.log('== sizing set: validator ==');
check('accepts a valid set of both kinds and a floor case', validateSet(base, { root: tmp }), []);
const REDS = [
  ['a missing label', (s) => { delete s.entries[0].label; }, /no label/],
  ['an unknown tier', (s) => { s.entries[0].label = 'medium'; }, /unknown tier/],
  ['a sensitive entry labelled below full', (s) => { s.entries[2].label = 'small'; }, /security floor/],
  ['a duplicate id', (s) => { s.entries[1].id = 'M1'; }, /duplicate id M1/],
  ['a corpus task that does not exist', (s) => { s.entries[0].task = 'ab-micro/M9-none'; }, /does not exist/],
  ['a corpus task directory with no task.json', (s) => { s.entries[0].task = 'ab/D-empty'; }, /does not exist/],
  ['a corpus task outside the two corpora', (s) => { s.entries[0].task = 'fixtures/fx'; }, /needs a task/],
  ['a corpus entry that carries a fixture', (s) => { s.entries[0].fixture = 'fx'; }, /carries a fixture/],
  ['a corpus entry that carries a request', (s) => { s.entries[0].request = 'x'; }, /carries a fixture or a request/],
  ['an authored entry with no request', (s) => { delete s.entries[1].request; }, /needs request text/],
  ['an authored entry with a blank request', (s) => { s.entries[1].request = '   '; }, /needs request text/],
  ['an authored entry with no fixture', (s) => { delete s.entries[1].fixture; }, /needs a fixture/],
  ['a fixture that does not exist', (s) => { s.entries[1].fixture = 'nope'; }, /fixture does not exist/],
  ['a fixture that is a file', (s) => { s.entries[1].fixture = 'afile'; }, /not a directory/],
  ['a fixture that is a symlink', (s) => { s.entries[1].fixture = 'lnk'; }, /symlink/],
  ['a fixture holding ..', (s) => { s.entries[1].fixture = '..'; }, /plain directory name/],
  ['a fixture path that climbs', (s) => { s.entries[1].fixture = '../fixtures/fx'; }, /plain directory name/],
  ['a fixture that is not directly under fixtures', (s) => { s.entries[1].fixture = 'fx/sub'; }, /plain directory name/],
  ['a fixture that is absolute', (s) => { s.entries[1].fixture = path.join(tmp, 'tests/evals/fixtures/fx'); }, /plain directory name/],
  ['the candidates directory', (s) => { s.entries[1].fixture = '_candidates'; }, /underscore directories/],
  ['the target directory', (s) => { s.entries[1].fixture = '_target'; }, /underscore directories/],
  ['an unknown key', (s) => { s.entries[1].notes = 'x'; }, /unknown key/],
  ['a control character in a request', (s) => { s.entries[1].request = 'a\u202eb'; }, /needs request text/],
  ['a wrong schema version', (s) => { s.schema_version = 2; }, /schema_version/],
  ['no entries', (s) => { s.entries = []; }, /non-empty/],
];
for (const [name, mut, want] of REDS) { const p = problems(mut); check(`rejects ${name}`, p.length > 0 && p.some((x) => want.test(x)), true); }
check('rejects a set that is not an object', validateSet([], { root: tmp }).length, 1);

console.log('== sizing set: label hash ==');
const h0 = labelHash(base);
check('is 64 hex characters', /^[0-9a-f]{64}$/.test(h0), true);
const reordered = { entries: [floor, corpus, authored].map((e) => Object.fromEntries(Object.entries(e).reverse())), schema_version: 1 };
check('is stable across key order and entry order', labelHash(reordered), h0);
const changed = (mut) => { const s = clone(base); mut(s); return labelHash(s) !== h0; };
check('is stable when only a reason changes', changed((s) => { s.entries[1].reason = 'other words'; }), false);
const MOVES = [
  ['an id', (s) => { s.entries[1].id = 'A9'; }],
  ['a label', (s) => { s.entries[0].label = 'full'; }],
  ['a request text', (s) => { s.entries[1].request += ' '; }],
  ['a fixture name', (s) => { s.entries[1].fixture = 'fy'; }],
  ['a corpus task', (s) => { s.entries[0].task = 'ab/D-empty'; }],
  ['the sensitive flag', (s) => { s.entries[2].sensitive = false; }],
  ['an added entry', (s) => { s.entries.push({ ...authored, id: 'A3' }); }],
];
for (const [name, mut] of MOVES) check(`moves when ${name} changes`, changed(mut), true);
check('does not confuse a request with a fixture name', labelHash({ entries: [{ id: 'X', label: 'full', fixture: 'ab', request: 'cd' }] }) !== labelHash({ entries: [{ id: 'X', label: 'full', fixture: 'a', request: 'bcd' }] }), true);

console.log('== sizing set: the committed set ==');
const set = loadSet();
check('loads and validates against the repository', validateSet(set), []);
check('is the file the library points at', path.relative(REPO_ROOT, SET_FILE), path.join('tests', 'evals', 'sizing-set', 'set.json'));
check('holds the planned entries', set.entries.map((e) => e.id), ['M01', 'M02', 'M03', 'M04', 'M05', 'M06', 'M07', 'M08', 'T1', 'H1', 'H2', 'H4', 'A1', 'A2', 'A3', 'A4']);
check('uses all three tiers', TIERS.filter((t) => set.entries.some((e) => e.label === t)), [...TIERS]);
check('has floor cases, all labelled full', set.entries.filter((e) => e.sensitive).map((e) => `${e.id}:${e.label}`), ['H4:full', 'A3:full', 'A4:full']);
check('derives the scenario ids already in use', ['M01', 'T1'].map((id) => scenarioId(set.entries.find((e) => e.id === id))), ['S4-M01', 'S4-T1']);
// A reason or request that cites a path its fixture does not hold is a wrong label, so every cited path must exist: in the
// authored entry's fixture, or for a corpus entry in the repository (tests/...) or in its task's fixture (src/...).
const EV = path.join(REPO_ROOT, 'tests', 'evals');
const missing = [];
for (const e of set.entries) {
  const bases = e.fixture ? [path.join(EV, 'fixtures', e.fixture)] : [REPO_ROOT, path.join(EV, e.task, 'fixture')];
  for (const cited of `${e.request ?? ''} ${e.reason}`.match(/(?<![\w/.-])(?:src|tests|docs)\/[\w./-]*\w/g) ?? []) {
    if (!bases.some((b) => fs.existsSync(path.join(b, cited)))) missing.push(`${e.id}: ${cited}`);
  }
}
check('every entry cites only paths its tree holds', missing, []);
check('loadSet refuses a set that fails validation', (() => { const f = path.join(tmp, 'bad.json'); fs.writeFileSync(f, '{"schema_version":1,"entries":[{"id":"Z"}]}'); try { loadSet(f); return 'no throw'; } catch (e) { return /no label/.test(e.message); } })(), true);
check('loadSet refuses a file that is not JSON', (() => { const f = path.join(tmp, 'junk.json'); fs.writeFileSync(f, 'nope'); try { loadSet(f); return 'no throw'; } catch (e) { return /unreadable/.test(e.message); } })(), true);

console.log('== sizing set: probe scenarios and fixture staging ==');
const scen = sizingScenarios(set);
check('has one probe scenario per entry, in set order', Object.keys(scen), set.entries.map(scenarioId));
check('runs a corpus entry in its task', scen['S4-M03'], { kind: 'task', corpus: 'tests/evals/ab-micro', task: 'M03-rank-aggregation', probe: true });
const a3 = set.entries.find((e) => e.id === 'A3');
check('runs an authored entry as its request in a copy of its fixture', scen['S4-A3'], { kind: 'set', dir: 'tests/evals/fixtures/task02-code', request: a3.request, probe: true });
const fixtureDir = path.join(REPO_ROOT, scen['S4-A3'].dir);
const staged = path.join(tmp, 'staged');
stageFixture(fixtureDir, staged);
check('stages the fixture files and leaves the plan tree out', [fs.existsSync(path.join(staged, 'src/auth/token.mjs')), fs.existsSync(path.join(staged, '_somi')), fs.existsSync(path.join(staged, '.somi'))], [true, false, false]);
check('keeps the plan tree as .somi when asked', (() => { stageFixture(fixtureDir, `${staged}-plans`, { keepPlans: true }); return [fs.existsSync(`${staged}-plans/.somi/plans`), fs.existsSync(`${staged}-plans/_somi`)]; })(), [true, false]);
// A scratch fixture: a file, a plan tree, and a link to a file outside it that staging must never read through.
const fx = path.join(tmp, 'tests/evals/fixtures/fx');
fs.mkdirSync(path.join(fx, '_somi/plans'), { recursive: true });
fs.writeFileSync(path.join(fx, 'a.txt'), 'a'); fs.writeFileSync(path.join(fx, '_somi/plans/p.md'), 'p');
const h1 = setMaterial(fx, 'req');
check('binds a fixture and a request in a stable hash that moves with either', [/^[0-9a-f]{64}$/.test(h1), setMaterial(fx, 'req') === h1, setMaterial(fx, 'req2') !== h1, (fs.writeFileSync(path.join(fx, 'a.txt'), 'b'), setMaterial(fx, 'req') !== h1)], [true, true, true, true]);
fs.writeFileSync(path.join(tmp, 'outside.txt'), 'SECRET');
fs.symlinkSync(path.join(tmp, 'outside.txt'), path.join(fx, 'inner'));
const out = path.join(tmp, 'out-link');
const thrown = (() => { try { stageFixture(fx, out); return 'no throw'; } catch (e) { return e.message; } })();
check('refuses a fixture with an inner link: nothing is staged, so nothing is read through it', [/could not be read/.test(thrown), fs.existsSync(out)], [true, false]);
check('has no material for a fixture with an inner link or one that is missing', [setMaterial(fx, 'req'), setMaterial(path.join(tmp, 'nope'), 'req')], [null, null]);

console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
