#!/usr/bin/env node
// Tests of scripts/lib/escalation-facts.mjs. Risk: a diff whose facts come out lower than the diff warrants (a class not
// mapped, a status ignored, a denied name lost to a prefix, a degraded read returning fewer facts), or a path leaving in
// the result. Real classifier and real escalation(), no mocks. Usage: node escalation-facts-tests.mjs <module path>;
// tests/scripts/escalation.sh runs it on the module and on scratch mutants of it, and each mutant must turn the test
// named there red. Hermetic: no model, no network; the config check writes two files in a temp directory.

import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { isDeepStrictEqual } from 'node:util'; import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const lib = (name) => import(pathToFileURL(path.join(here, '../../../scripts/lib', name)).href);
const { diffFacts, MAX_ROWS } = await import(pathToFileURL(path.resolve(process.argv[2])).href);
const { escalation } = await lib('escalation.mjs');
const { loadConfig } = await lib('config-files.mjs');

let pass = 0; let fail = 0;
const clip = (v) => JSON.stringify(v).slice(0, 160);
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${clip(want)}, got ${clip(got)})`); }
};
const row = (file, added = 1, deleted = 0, status = 'M') => ({ file, added, deleted, status });
const diff = (rows, options) => { try { return diffFacts(rows, options); } catch { return { threw: true }; } };
const esc = (rows, options) => escalation(diff(rows, options).facts);
const ids = (rows, options) => { const e = esc(rows, options); return [e.review_min, e.reasons, e.hard_surface]; };

console.log('== escalation facts: rows to facts ==');
check('a new 40-line file sizes nothing and raises nothing; auth code raises security as a sensitive name and a routes directory as a boundary one', [ids([row('src/new.mjs', 40, 0, 'A')]), ids([row('src/auth/token.mjs')]).slice(0, 2), ids([row('src/routes/u.mjs')]).slice(0, 2)],
  [[null, [], []], ['security', ['sensitive:auth']], ['security', ['boundary:routes']]]);
check('a deleted .env, a renamed id_rsa (delete plus add) and a secret under a non-ASCII directory set denied and the deny_list id', [
  [row('.env', 0, 2, 'D')], [row('id_rsa', 0, 3, 'D'), row('keys/id_rsa', 3, 0, 'A')], [row('é/a.pem')],
].map((r) => [diff(r).facts.denied, ids(r)]), Array(3).fill([true, ['security', ['deny_list'], ['deny_list']]]));
check('a git-quoted name is an unusable row that floors, never a clean one', [diff([row('"\\303\\251/a.pem"')]).notes, ids([row('"\\303\\251/a.pem"')])[0]], [['row_unusable'], 'security']);
const HARD = [['package.json', 'manifest'], ['package-lock.json', 'lockfile'], ['db/migrations/001.sql', 'migration'], ['openapi.yaml', 'schema'], ['.github/workflows/ci.yml', 'ci'], ['.env', 'deny_list']];
check('each hard-surface id comes from its path', HARD.map(([f, id]) => ids([row(f)])[2].includes(id)), HARD.map(() => true));
check('CI paths raise security as a sensitive name and carry the ci id: .github also hits infra, a bare .circleci only ci', [ids([row('.github/workflows/ci.yml')]), ids([row('.circleci/config.yml')]), diff([row('Jenkinsfile')]).facts.classes],
  [['security', ['sensitive:ci', 'sensitive:infra'], ['ci']], ['security', ['sensitive:ci'], ['ci']], { sensitive: ['ci'], boundary: [], contract: [], ci: ['ci'] }]);
check('151 production lines flag the size mark and 150 do not; neither raises a lens, and test rows never count as production', [
  esc([row('src/a.mjs', 100, 51)]).size_flag, esc([row('src/a.mjs', 100, 50)]).size_flag, esc([row('src/a.mjs', 10), row('tests/a.test.mjs', 500, 0)]).size_flag, diff([row('src/a.mjs', 5, 3), row('tests/a.test.mjs', 500, 9)]).facts.production_lines,
], [true, false, false, 8]);
const weak = (rows) => esc(rows).tests_weakened;
check('tests_weakened: a moved test (delete plus add) is not, a deleted test file with nothing added is, a modified one losing 10 lines is not', [
  weak([row('tests/a.test.mjs', 0, 40, 'D'), row('tests/b.test.mjs', 40, 0, 'A')]), weak([row('tests/a.test.mjs', 0, 40, 'D')]), weak([row('tests/a.test.mjs', 0, 10, 'D')]), weak([row('tests/a.test.mjs', 0, 10, 'M')]),
], [false, true, true, false]);
check('test rows are counted apart: files changed, lines added and deleted, files deleted', (({ facts: f }) => [f.test_files_changed, f.test_lines_added, f.test_lines_deleted, f.test_files_deleted, f.production_files])(diff([row('tests/a.test.mjs', 7, 2, 'D'), row('src/b.mjs', 3, 1, 'M'), row('lib/c_test.go', 1, 1, 'M')])), [2, 8, 3, 1, 1]);
const tops = (...r) => diff(r).facts.new_top_dirs;
check('a top directory is new only when every row under it is an add; a root file is none; modules count distinct module keys', [
  tops(row('a/x', 1, 0, 'A'), row('a/y', 1, 0, 'A')), tops(row('a/x', 1, 0, 'A'), row('a/y')), tops(row('README.md', 1, 0, 'A')), tops(row('a/x', 1, 0, 'A'), row('b/x', 1, 0, 'A')),
  diff([row('a/x'), row('a/y'), row('packages/p/z'), row('packages/q/z'), row('README.md')]).facts.modules,
], [1, 0, 0, 2, 4]);
check('planning churn under .somi is ignored and a denied name there still floors', [diff([row('.somi/plans/x/spec.md', 900)]).facts, diff([row('.somi/reviews/r.md', 900)]).facts, diff([row('.somi/x/.env')]).facts.denied, ids([row('.somi/plans/x.md')])[0]],
  [diff([]).facts, diff([]).facts, true, null]);
const GUARDED = ['.Claude/settings.json', '.CLAUDE/hooks/x', '.somi/Config.json', '.SOMI/config.json', '.claude', '.somi', '.claude/plugins/somi/x', '.claude\\settings.json', '.claude/a/b/c/d', '.claude./x', '.somi/config.json.', '.claude\uff0fsettings.json', '\uff0e\uff43laude/x'];
check('the guard raises sensitive config on every row, hidden or not: any case, either separator, bare names, any depth, no plugins exemption', GUARDED.map((f) => ids([row(f)]).slice(0, 2)), GUARDED.map(() => ['security', ['sensitive:config']]));
check('the guard raises on a row among ordinary ones, and a guarded row is also classified when it is not an exact ignored prefix', [ids([row('src/a.mjs'), row('.Somi')])[1], diff([row('.Claude/evil.mjs', 9)]).facts.production_lines], [['sensitive:config'], 9]);
const late = Array.from({ length: 25 }, (_, i) => row(`src/m${i % 3}/f${i}.mjs`)); late[10] = row('.env'); late[21] = row('.circleci/c.yml'); late[24] = row('tests/t.test.mjs', 0, 9, 'D');
check('rows past the first chunk are read: a denied name, a ci row and a deleted test after row 10 all count', (({ facts: f }) => [f.production_files, f.test_files_deleted, f.denied, f.classes.ci])(diff(late)), [24, 1, true, ['ci']]);
check('an ignored prefix is exact: .somi2/ and a name with a backslash are classified like any other', [diff([row('.somi2/a.mjs', 9)]).facts.production_lines, diff([row('.claude\\evil.mjs', 9)]).facts.production_lines, ids([row('.somi2/a.mjs')])[0]], [9, 9, null]);

console.log('== escalation facts: config, plan inputs and what is returned ==');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'escalation-facts-')); process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
fs.mkdirSync(path.join(tmp, '.somi')); fs.writeFileSync(path.join(tmp, '.somi', 'config.json'), JSON.stringify({ sizing: { sensitive_paths: [] } })); fs.writeFileSync(path.join(tmp, 'global.json'), JSON.stringify({ sizing: { sensitive_paths: ['zed'] } }));
const loaded = loadConfig(tmp, { SOMI_GLOBAL_CONFIG: path.join(tmp, 'global.json') });
check('through the real loadConfig, a project list of [] keeps the global glob; the merged .config would erase it; config cannot remove ci', [
  diff([row('zed/x.mjs')], { config: loaded }).facts.classes.sensitive, diff([row('zed/x.mjs')], { config: loaded.config }).facts.classes.sensitive, diff([row('.circleci/c.yml')], { config: loaded }).facts.classes.ci,
], [['config'], [], ['ci']]);
const REFUSED = { global: { config: { sizing: { sensitive_paths: ['*.'] } } }, project: { config: {} } };
const cfgOnly = (rows, config) => { const d = diff(rows, { config }); return [d.notes, d.facts.classes.sensitive]; };
check('a refused sensitive_paths key is noted, adds sensitive config, and does so with no row, or only an ignored row, reaching the classifier', [
  cfgOnly([row('a/x')], REFUSED), cfgOnly([], REFUSED), cfgOnly([row('.somi/plans/x.md')], REFUSED), cfgOnly([row('a/x')], loaded), cfgOnly([row('a/x')]),
], [[['config_refused'], ['config']], [['config_refused'], ['config']], [['config_refused'], ['config']], [[], []], [[], []]]);
check('only undefined or the loadConfig shape is read: a merged .config, a layer list, one layer, null and a shape without its config are noted, and only the built-in lists apply', [
  loaded.config, [loaded.global.config, loaded.project.config], loaded.global.config, null, { global: {}, project: {} }, { global: { config: {} }, project: { config: [] } }, 'x',
].map((config) => cfgOnly([row('zed/x.mjs')], config)), Array(7).fill([['config_refused'], []]));
const plan = (o) => { const d = diff([], o); return [d.facts.plan_target, d.facts.plan_paths, d.facts.slug_given, d.facts.work_item_paths, d.source]; };
check('plan inputs: a plan directory, a brief and an ADR path name a plan target, other paths and nothing do not, and a bad target raises', [
  ['.somi/plans/s/', 'x/brief.md', 'docs/adr/0001-x.md', 'docs\\decisions\\a.md'].map((target) => plan({ target })[0]), ['src/a.mjs', undefined, ''].map((target) => plan({ target })[0]), plan({ target: 5 })[0], plan({ target: 'a'.repeat(300) })[0],
], [[true, true, true, true], [false, false, false], true, true]);
check('plan and sdlc sources: paths and slug are named, empty lists are nothing, a bad value raises', [plan({ planPaths: ['p'], slug: 's' }), plan({ workItemPaths: ['w'], planPaths: [], target: '.somi/plans/s' }), plan({ planPaths: 5 })[1]],
  [[false, true, true, false, { plan: ['paths'], sdlc: ['slug'] }], [true, false, false, true, { plan: ['target'], sdlc: ['paths'] }], true]);
const FILES = ['zzsecret-token.mjs', 'qédir/kk.pem', 'src/auth/zzlogin.mjs', 'zzpkg/package.json'];
const serial = JSON.stringify(diff(FILES.map((f) => row(f)), { slug: 'zzslug-name', target: 'zzplans/brief.md' }));
check('the result carries no input path, no slug and no target, and is pure ASCII', [FILES.filter((f) => serial.includes(f)), serial.includes('zzslug'), serial.includes('zzplans'), /^[\x20-\x7e]*$/.test(serial)], [[], false, false, true]);
check('every result is a grammar escalation() reads: none comes back as facts_unreadable', [[row('src/a.mjs')], [row('.env')], [row('"x"')], [], [row('t/a.test.js', 0, 30, 'D')], [row('docs/adr-0001.md')], [row('.claude/settings.json')], [null]].filter((r) => esc(r, { slug: 's' }).reasons.includes('facts_unreadable')).length, 0);

console.log('== escalation facts: hostile and degraded input ==');
const raising = (rows, options) => { const d = diff(rows, options); return [d.threw === true, esc(rows, options).review_min, d.notes]; };
check('a path over the length cap, a control character, a bad count and a bad status are each handled: a raising result for the unusable ones, a note, no throw', [
  raising([row('a/'.repeat(121))]), raising([row('e\u0301'.repeat(130))]), raising([row('.e\u200cnv')]), raising([row('src/a.mjs', -1)]), raising([row('src/a.mjs', '5')]), raising([row('src/a.mjs', 1, 0, 'AM')]), raising([null]), raising([{ file: 5, added: 1, deleted: 0, status: 'M' }]),
], Array(8).fill([false, 'security', ['row_unusable']]));
// U+FDFA is 18 characters once folded: 14 of them are 14 raw characters and 252 folded, over the cap. Three of them sit in three chunks of one module.
const GROWN = '\ufdfa'.repeat(14); const grown = Array.from({ length: 30 }, (_, i) => row(i % 10 === 0 ? GROWN : `src/a/f${i}.mjs`));
check('a name that only passes the length cap once folded is an unusable row in any chunk: three of them in three chunks floor and seat architecture', [diff(grown).notes, escalation(diff(grown).facts).seats['somi-architecture-reviewer'].seat], [['row_unusable'], true]);
const UNPLAIN = ['../x', './a.mjs', 'a//b', 'a/./b', 'a/../b', '/a', 'a/', 'a/.. /b', '\uff0e\uff0e/x', 'a\\..\\b', 'a\uff0f/b'];
check('a name with an empty, dot or dot-dot segment, or a leading ./, is an unusable row', UNPLAIN.map((f) => raising([row(f)])), UNPLAIN.map(() => [false, 'security', ['row_unusable']]));
const HUGE = Number.MAX_SAFE_INTEGER;
check('a summed count past the safe integers is the floor with rows_unusable, never a count that wrapped', [
  [row('src/a.mjs', HUGE, 1)], [row('tests/a.test.mjs', HUGE, 0), row('tests/b.test.mjs', 1, 0)], [row('tests/a.test.mjs', 0, HUGE, 'D'), row('tests/b.test.mjs', 0, 1, 'D')],
].map((r) => [raising(r), diff(r).facts.production_lines]), Array(3).fill([[false, 'security', ['rows_unusable']], 1e9]));
const started = Date.now(); const many = raising(Array(10000).fill(row('src/a.mjs')));
check('10,000 rows, a non-list and MAX_ROWS + 1 rows are the raising result with the rows_unusable note, quickly; MAX_ROWS rows are read', [many, raising('x'), raising(Array(MAX_ROWS + 1).fill(row('a.mjs'))), raising(Array(MAX_ROWS).fill(row('a.mjs')))[2], Date.now() - started < 2000],
  [[false, 'security', ['rows_unusable']], [false, 'security', ['rows_unusable']], [false, 'security', ['rows_unusable']], [], true]);
const timed = diff([row('src/a.mjs'), row('.env')], { budgetMs: 0 });
check('a time box that runs out returns the floor, never the partial facts; a budget that is not a finite number is no time box', [timed.notes, escalation(timed.facts).seats['somi-architecture-reviewer'].seat, [null, 'x', NaN].map((budgetMs) => diff([row('src/a.mjs')], { budgetMs }).notes)], [['time_box'], true, [[], [], []]]);
const FULL = [row('src/auth/a.mjs', 900), row('src/routes/r.mjs'), row('db/migrations/1.sql'), row('package-lock.json'), row('openapi.yaml'), row('.github/w.yml'), row('src/new/x.mjs', 5, 0, 'A'), row('tests/t.test.mjs', 0, 80, 'D')];
const OPT = { slug: 's', target: '.somi/plans/s', planPaths: ['p'], workItemPaths: ['w'] }; const sup = (a, b) => b.every((x) => a.includes(x));
// A second full read: no test file at all, a new top directory and production lines past the untested mark, which FULL does not hold.
const NO_TEST = [row('src/new/x.mjs', 70, 0, 'A')];
const covers = (hi, full) => sup(hi.reasons, full.reasons) && sup(hi.hard_surface, full.hard_surface) && (!full.tests_weakened || hi.tests_weakened) && (!full.size_flag || hi.size_flag) && hi.review_min === 'security' && Object.keys(full.seats).every((l) => sup(hi.seats[l].reasons, full.seats[l].reasons));
const DEGRADED = [['time_box', FULL, { budgetMs: 0 }], ['rows_unusable', Array(MAX_ROWS + 1).fill(FULL[0]), {}], ['row_unusable', [...FULL, null], {}], ['internal_error', [...FULL, { get file() { throw new Error('x'); } }], {}]];
const READS = [FULL, NO_TEST].map((rows) => esc(rows, OPT));
check('every degraded result covers a full read of a diff holding every class, a deleted test and a lockfile, and of a diff with no test and a new top directory: every seat, reason, hard-surface id and flag', DEGRADED.map(([, rows, o]) => { const d = diff(rows, { ...OPT, ...o }); return [d.notes[0], READS.map((full) => covers(escalation(d.facts), full))]; }), DEGRADED.map(([n]) => [n, [true, true]]));
const broken = diff([row('src/a.mjs')], { get config() { throw new Error('boom'); } });
check('an unexpected error is the floor with its own note, every plan seat kept, and never a throw', [broken.notes, escalation(broken.facts).review_min, diff([], { get slug() { throw new Error('boom'); } }).facts.plan_target], [['internal_error'], 'security', true]);

console.log(`SUMMARY ${pass + fail} ${fail}`);
process.exit(fail ? 1 : 0);
