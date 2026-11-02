#!/usr/bin/env node
// Tests of scripts/lib/path-facts.mjs. Risk: a committed config or a hostile path list lowering a floor (a glob
// removed, a container dropped so two modules fold into one), or a config glob costing unbounded time. Pure strings,
// no mocks. Usage: node path-facts-tests.mjs <module path>; tests/scripts/fact-sheet.sh runs it on the module and on
// scratch mutants of it, and each mutant must turn the test named there red. Hermetic: no model, no network.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const modPath = path.resolve(process.argv[2]);
const M = await import(pathToFileURL(modPath).href);
const { classifyPaths, MAX_GLOBS, MAX_GLOB_CHARS, BUILTIN_CONTAINERS } = M;
const { mergeConfig } = await import(pathToFileURL(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../scripts/lib/config-files.mjs')).href);

let pass = 0; let fail = 0;
const skip = (name, why) => console.log(`  skip ${name} (${why})`);
const clip = (v) => JSON.stringify(v).slice(0, 160);
const check = (name, got, want) => {
  if (isDeepStrictEqual(got, want)) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} (want ${clip(want)}, got ${clip(got)})`); }
};
// A throw is reported as a result, so a broken module fails the named check instead of ending the run.
const run = (paths, config) => { try { return classifyPaths(paths, config); } catch { return { threw: true }; } };
const one = (p, config) => run([p], config).files?.[0] ?? { threw: true };
const hits = (p, config) => { const f = one(p, config); return [f.sensitive, f.boundary, f.contract]; };
const modules = (paths, config) => run(paths, config).modules;
const sizing = (o) => ({ sizing: o });
const with1 = (key, list) => sizing({ [key]: list });

console.log('== path facts: glob classes ==');
check('an unconfigured repo flags .env, a migrations directory, a lockfile and a route file', [
  hits('.env'), hits('db/migrations/001_init.sql'), hits('package-lock.json'), hits('src/routes/users.js'),
], [
  [['deny_list'], ['deny_list'], []],
  [['migrations'], ['data'], []],
  [[], [], ['lockfile']],
  [[], ['routes'], []],
]);
check('flags secrets, auth, crypto and infra as sensitive', [
  hits('lib/client_secret.go')[0], hits('src/auth/login.ts')[0], hits('pkg/crypto/aes.go')[0], hits('.github/workflows/ci.yml')[0], hits('infra/main.tf')[0],
], [['secrets'], ['auth'], ['crypto'], ['infra', 'ci'], ['infra']]);
check('flags sinks and contracts', [
  hits('app/uploads/handler.py')[1], hits('x/Spawn.js')[1], hits('db/schema.sql')[1], hits('package.json')[2], hits('api/openapi.yaml')[2], hits('proto/a.proto')[2],
], [['input'], ['process'], ['data'], ['manifest'], ['schema'], ['schema']]);
const CI_PATHS = ['.github/workflows/ci.yml', '.gitlab-ci.yml', 'x/.circleci/config.yml', '.travis.yml', 'azure-pipelines.yml', 'bitbucket-pipelines.yml', 'Jenkinsfile', 'ci/Jenkinsfile', '.gitlab/ci/build.yml', '.gitlab-ci.yaml', 'action.yml', 'sub/action.yaml', '.gitea/workflows/w.yml', '.forgejo/workflows/w.yml', 'Jenkinsfile.groovy', 'build.jenkinsfile', 'azure-pipelines-ci.yaml', '.azure-pipelines/b.yml', '.buildkite/pipeline.yml', '.drone.yml', '.woodpecker/b.yml', '.woodpecker.yaml', 'appveyor.yml', 'cloudbuild.yaml', 'buildspec.yml', '.pre-commit-config.yaml'];
check('every CI system is a ci hit in the sensitive list (a sensitive name, so it raises), and a look-alike is not', [CI_PATHS.map((p) => hits(p)[0].includes('ci')), ['docs/ci.md', 'src/jenkins.md', 'ci/run.sh', 'azure.md', 'action.md'].map((p) => hits(p)[0].includes('ci'))], [CI_PATHS.map(() => true), Array(5).fill(false)]);
check('does not flag ordinary source or a look-alike', [hits('src/util/strings.js'), hits('docs/author.md'), hits('README.md')], [[[], [], []], [[], [], []], [[], [], []]]);
check('matching is case-folded', [hits('DB/Migrations/001.SQL'), hits('SRC/Routes/X.JS')[1]], [[['migrations'], ['data'], []], ['routes']]);
check('a directory glob with a slash is anchored and also matches what is under it', [
  hits('x/y.js', with1('sensitive_paths', ['x'])), hits('a/x/y.js', with1('sensitive_paths', ['x/**'])), hits('x/a/b.js', with1('sensitive_paths', ['x/**'])), hits('a/x/b.js', with1('sensitive_paths', ['**/x'])),
].map((h) => h[0]), [['config'], [], ['config'], ['config']]);
check('a config glob is literal text except star, question mark and a ** segment', [
  hits('abc', with1('sensitive_paths', ['a.c']))[0], hits('a.c', with1('sensitive_paths', ['a.c']))[0], hits('(x|y)', with1('sensitive_paths', ['(x|y)']))[0],
  hits('x', with1('sensitive_paths', ['(x|y)']))[0], hits('aXc', with1('sensitive_paths', ['a?c']))[0], hits('abbc', with1('sensitive_paths', ['a*c']))[0],
], [[], ['config'], ['config'], [], ['config'], ['config']]);

console.log('== path facts: production, test and module key ==');
check('a test file is not a production file, and a fixtures directory is not a test directory', run(['tests/a.sh', 'src/a.test.js', 'lib/b_test.go', 'x/__tests__/c.js', 'test_d.py', 'scripts/lib/e-tests.mjs', 'src/f.js', 'docs/g.md', 'app/fixtures/seed.json']).production_files, 3);
check('module key: first segment, a root file is the one module with the empty key, a deep file is its first directory', [
  one('README.md').module, one('LICENSE').module, one('scripts/lib/a.mjs').module, one('a/b/c/d.js').module, one('./x\\y.js').module,
], ['', '', 'scripts', 'a', 'x']);
check('module key under a built-in container is <container>/<segment>; a file directly in a container is the container', [
  one('packages/a/x.js').module, one('src/a/b/c.js').module, one('apps/web/x').module, one('libs/core/x').module, one('src/main.js').module,
], ['packages/a', 'src/a', 'apps/web', 'libs/core', 'src']);
check('a configured container splits its children, however its name is written', [one('services/a/x', with1('module_containers', ['services'])).module, one('Services/B/x', with1('module_containers', ['SERVICES'])).module, one('services/a/x').module,
  one('services/a/x', with1('module_containers', ['services/'])).module, one('services/a/x', with1('module_containers', ['./services'])).module], ['services/a', 'Services/B', 'services', 'services/a', 'services/a']);
const LONG_PATH = 'a/'.repeat(200);
check('an unusable entry has a module key no real path can have: it never merges with a first segment like ?0', [modules([LONG_PATH, '?0/a.js']), modules([LONG_PATH, '/?0/a.js']), modules([null, '?0/a.js', '?1/a.js', LONG_PATH])], [2, 2, 4]);
check('the module key keeps the case of the path: packages/Foo and packages/foo are two modules, the container still matches folded', [modules(['packages/Foo/x', 'packages/foo/y']), one('PACKAGES/a/x').module], [2, 'PACKAGES/a']);
check('a trailing dot or space on a segment does not hide a glob hit', [hits('package.json.')[2], hits('db/migrations ./1.sql')[0]], [['manifest'], ['migrations']]);
check('the trim is an extra reading: a dots-only directory does not shift an anchored glob, and a trailing dot does not hide a wildcard', [
  hits('infra/.../prod/db.yml', with1('sensitive_paths', ['infra/*/prod/**']))[0], hits('infra/prod/db.yml', with1('sensitive_paths', ['infra/*/prod/**']))[0], hits('billing./x', with1('sensitive_paths', ['billing.*']))[0],
], [['config'], [], ['config']]);
check('a name that trims to a test directory is still production code', [one('tests./a.js').production, run(['tests./a.js', 'tests/a.js']).production_files], [true, 1]);
check('a code point that folds to a separator stays inside its segment: tests\uff0fx.js is production code, not a test directory', [one('tests\uff0fx.js').production, run(['tests\uff0fx.js', 'src/a.js']).production_files], [true, 2]);
const SEP_ANCHORED = with1('sensitive_paths', ['infra/*/prod/**']); const SEP_PLAIN = with1('sensitive_paths', ['infra/a/b/**']);
check('a code point that folds to a separator: the primary reading keeps it one segment (hits infra/*/prod/**), the re-split reading is an extra one (hits infra/a/b/**), and neither widens a plain path', [
  hits('infra/a\uff0fb/prod/db.yml', SEP_ANCHORED)[0], hits('infra/a\uff0fb/x', SEP_PLAIN)[0], hits('infra/a/b/prod/db.yml', SEP_ANCHORED)[0], hits('infra/ab/x', SEP_PLAIN)[0],
], [['config'], ['config'], [], []]);
check('a glob or a container written with a trailing dot or space is trimmed like a path segment', [
  hits('services/x', with1('sensitive_paths', ['services.']))[0], hits('services./x', with1('sensitive_paths', ['services']))[0], hits('a/b', with1('sensitive_paths', ['a./b']))[0],
  one('services/a/x', with1('module_containers', ['services.'])).module, one('services./a/x', with1('module_containers', ['services'])).module, one('services./a/x', with1('module_containers', ['services. '])).module,
], [['config'], ['config'], ['config'], 'services/a', 'services./a', 'services./a']);

console.log('== path facts: the deny list floors whatever the config says ==');
const withEnv = run(['src/a.js', '.env']); const without = run(['src/a.js', 'src/b.js']);
check('a denied name reports a deny_list hit in the sensitive and boundary lists and the same list without it does not', [withEnv.sensitive, withEnv.boundary, without.sensitive.includes('deny_list'), without.boundary.includes('deny_list')], [['deny_list'], ['deny_list'], false, false]);
check('every path carries the denied fact, and a denied name hits even when the config tries to list others only', [
  one('src/a.js').denied, one('config/KEY.PEM').denied, one('.git/config', with1('sensitive_paths', ['zzz'])).sensitive.includes('deny_list'), one('id_rsa', sizing({ sensitive_paths: [], module_containers: [] })).boundary,
], [false, true, true, ['deny_list']]);
check('an unusable entry floors instead of vanishing: not a string, over the length cap, not an array, over the count cap', [
  one(null).denied, one('a/'.repeat(200)).denied, run('src/a.js').sensitive, run(Array(41).fill('a.js')).boundary, one('a/'.repeat(200)).path,
], [true, true, ['deny_list'], ['deny_list'], '']);
check('an unusable list reports the counts at the path cap', [run('src/a.js'), run(Array(41).fill('a.js'))].map((r) => [r.files.length, r.production_files, r.modules]), [[40, 40, 40], [40, 40, 40]]);

console.log('== path facts: config only adds ==');
const ALL = ['.env', 'db/migrations/1.sql', 'package-lock.json', 'src/routes/u.js', 'lib/secret.js', '.circleci/config.yml'];
const base = run(ALL);
check('config globs are added to the built-ins, not instead of them', [hits('zed/x.js', with1('sensitive_paths', ['zed']))[0], run(ALL, with1('sensitive_paths', ['zzz'])).sensitive], [['config'], base.sensitive]);
const a = { sizing: { sensitive_paths: ['a/**'] } }; const b = { sizing: { sensitive_paths: ['b/**'] } };
const merged = mergeConfig(a, b);
check('mergeConfig replaces an array between layers: global [a] plus project [b] is [b]', merged.sizing.sensitive_paths, ['b/**']);
check('the merged config adds only b, and every built-in still flags', [hits('b/x')[0], hits('a/x')[0], hits('b/x', merged)[0], hits('a/x', merged)[0], run(ALL, merged).sensitive.filter((n) => n !== 'config')], [[], [], ['config'], [], base.sensitive]);
const LAYER_MIX = [with1('sensitive_paths', ['q']), with1('sensitive_paths', []), sizing({ sensitive_paths: ['..'] }), sizing({ module_containers: ['a..b'] }), null, undefined, 'x'];
check('a later layer, valid, empty, invalid or absent, cannot remove an earlier layer\'s sensitive glob', LAYER_MIX.map((p) => hits('b/x', [with1('sensitive_paths', ['b']), p])[0]), LAYER_MIX.map(() => ['config']));
check('a later layer cannot remove an earlier layer\'s container, and an earlier layer cannot remove a later one\'s', LAYER_MIX.map((p) => [modules(['services/a/x', 'services/b/y'], [with1('module_containers', ['services']), p]), modules(['services/a/x', 'services/b/y'], [p, with1('module_containers', ['services'])])]), LAYER_MIX.map(() => [2, 2]));
check('one invalid key drops only itself: its sibling key and the other layers still apply', [
  hits('good/x', sizing({ sensitive_paths: ['good'], module_containers: ['..'] }))[0], modules(['services/a/x', 'services/b/y'], sizing({ sensitive_paths: ['..'], module_containers: ['services'] })),
  hits('good/x', [sizing({ sensitive_paths: ['..'] }), sizing({ sensitive_paths: ['good'] })])[0], hits('one/x', [sizing({ sensitive_paths: ['one', '..'] })])[0],
], [['config'], 2, ['config'], []]);
check('config cannot remove a built-in glob even when it lists nothing or something else', [run(ALL, with1('sensitive_paths', [])).sensitive, run(ALL, sizing({ sensitive_paths: ['q'], module_containers: ['q'] })).files.map((f) => f.sensitive.length > 0)], [base.sensitive, [true, true, false, false, true, true]]);
check('a config cannot remove the ci class: it stays a sensitive hit with an empty list, an other list and a hostile one', [with1('sensitive_paths', []), with1('sensitive_paths', ['zzz']), with1('sensitive_paths', ['..']), null].map((c) => hits('.circleci/config.yml', c)[0].includes('ci')), [true, true, true, true]);

const WRAP = (g, p) => ({ config: with1('sensitive_paths', ['merged']), global: { path: null, present: true, config: g }, project: { path: 'p', present: true, config: p } });
check('loadConfig\'s {global, project} result is the layers [global.config, project.config]: an empty project list keeps the global glob, and the merged .config is not read', [
  hits('zed/x', WRAP(with1('sensitive_paths', ['zed']), with1('sensitive_paths', [])))[0], hits('p/x', WRAP(with1('sensitive_paths', ['zed']), with1('sensitive_paths', ['p'])))[0],
  hits('merged/x', WRAP({}, {}))[0], hits('zed/x', WRAP(with1('sensitive_paths', ['zed']), {}))[0], hits('zed/x', { global: {}, project: {} })[0],
], [['config'], ['config'], [], ['config'], []]);

console.log('== path facts: caps count the folded text ==');
const FDFA = '\ufdfa'; // one character that folds to eighteen
const L = with1('sensitive_paths', ['q']);
check('a path whose fold exceeds the path cap is an unusable entry with the floor, one at the cap is usable', [one(FDFA.repeat(14)).denied, one(FDFA.repeat(14)).path, one(FDFA.repeat(13)).denied, one('a/'.repeat(119) + 'a').denied], [true, '', false, false]);
check('a glob whose fold exceeds the glob cap is refused and named, and so is one whose raw text does though its fold is short; one at the cap is accepted', [hits('q/x', with1('sensitive_paths', [FDFA.repeat(6)]))[0], run(['a.js'], with1('sensitive_paths', [FDFA.repeat(6)])).refused,
  run(['a.js'], with1('sensitive_paths', ['e\u0301'.repeat(51)])).refused, run(['a.js'], with1('sensitive_paths', [FDFA.repeat(5)])).refused], [[], ['sensitive_paths'], ['sensitive_paths'], []]);
check('more layers than loadConfig supplies floor every path, and two do not', [run(['a.js'], [L, L, L]).files[0].denied, run(['a.js'], [L, L]).files[0].denied, run(['a.js'], [L, L]).files[0].path], [true, false, 'a.js']);
check('a refused key is named in refused, once, and a valid or absent one is not', [run(['a.js'], sizing({ sensitive_paths: ['*.'], module_containers: 'x' })).refused, run(['a.js'], [with1('sensitive_paths', 5), with1('sensitive_paths', 6)]).refused, run(['a.js'], sizing({ sensitive_paths: ['q'] })).refused, run(['a.js']).refused], [['module_containers', 'sensitive_paths'], ['sensitive_paths'], [], []]);

console.log('== path facts: the module override only splits ==');
const PAIR = ['packages/a/x', 'packages/b/y'];
check('an unconfigured repo counts packages/a and packages/b as two modules', modules(PAIR), 2);
const FOLDING = [undefined, {}, null, 'x', [], sizing({}), sizing(null), with1('module_containers', []), with1('module_containers', ['services']), with1('sensitive_paths', ['q']),
  sizing({ module_containers: ['packages'] }), sizing({ module_containers: ['src'], sensitive_paths: [] }), sizing({ module_containers: 'packages' }), sizing({ module_containers: ['..', 'a/b'] }),
  sizing({ module_containers: [], sensitive_paths: 7 }), { sizing: { module_containers: { packages: false } } }, { module_containers: [] }, sizing({ __proto__: { module_containers: [] } })];
const ROWS = ['packages/a/x', 'packages/b/y', 'src/a/y', 'services/a/x', 'services/b/y', 'README.md'];
check('still two with an empty container list, a config that omits the built-ins, and a config naming extra containers', FOLDING.map((c) => modules(PAIR, c)), FOLDING.map(() => 2));
check('no config in a finite table yields a module count below the unconfigured one', FOLDING.map((c) => modules(ROWS, c) >= modules(ROWS)), FOLDING.map(() => true));
check('extra containers raise the count and nothing else does', [modules(ROWS), modules(ROWS, with1('module_containers', ['services']))], [5, 6]);
check('one name under two containers is two modules, and two files in one module are one', [modules(['packages/a/x', 'src/a/y']), modules(['packages/a/x', 'packages/a/z']), one('src/a/y').module], [2, 1, 'src/a']);
check('the built-in containers are the stated list', BUILTIN_CONTAINERS, ['packages', 'apps', 'libs', 'src']);

console.log('== path facts: hostile config ==');
const HOSTILE = [
  with1('sensitive_paths', ['x'.repeat(10000)]), with1('sensitive_paths', ['x'.repeat(MAX_GLOB_CHARS + 1)]), with1('sensitive_paths', ['..']), with1('sensitive_paths', ['a/../b']), with1('sensitive_paths', ['/etc/passwd']),
  with1('sensitive_paths', ['C:\\x']), with1('sensitive_paths', ['\\x']), with1('sensitive_paths', 'abc'), with1('sensitive_paths', 5), with1('sensitive_paths', { a: 1 }), with1('sensitive_paths', [1]),
  with1('sensitive_paths', ['']), with1('sensitive_paths', ['/']), with1('sensitive_paths', ['.']), with1('sensitive_paths', ['./']), with1('sensitive_paths', ['a\u0000b']), with1('sensitive_paths', ['a\u202eb']), with1('sensitive_paths', Array(MAX_GLOBS + 1).fill('q')),
  with1('sensitive_paths', [' ']), with1('sensitive_paths', ['. ']), with1('sensitive_paths', ['*.']), with1('sensitive_paths', ['*/.']), with1('sensitive_paths', ['*\uff0f.']), with1('sensitive_paths', ['a/**. /b']), with1('module_containers', [' ']), with1('module_containers', ['. ']),
  with1('module_containers', ['a/b']), with1('module_containers', ['..']), with1('module_containers', ['a\\b']), with1('module_containers', 'src'),
  sizing({ sensitive_paths: ['good', '..'], module_containers: ['..'] }), with1('module_containers', ['*']), with1('module_containers', ['a*']), with1('module_containers', ['**']),
];
const HOSTILE_PATHS = ['.env', 'good/x.js', 'services/a/x', 'services/b/y', 'q/z', 'src/routes/a.js', 'packages/a/x', 'packages/b/y', '../x', 'a/../b', 'etc/passwd', 'x', 'c:/x', 'a\u0000b', 'a\u202eb', 'a/b.js', 'a/c/x', 'a/d/y', 'x'.repeat(MAX_GLOB_CHARS + 1)];
const baseline = run(HOSTILE_PATHS);
check('a hostile section reads as the defaults: the same facts as no config', HOSTILE.map((c) => ({ ...run(HOSTILE_PATHS, c), refused: [] })), HOSTILE.map(() => baseline));
check('the caps are stated: a section at the limit is accepted', [hits('q', with1('sensitive_paths', Array(MAX_GLOBS).fill('q')))[0], hits('y'.repeat(MAX_GLOB_CHARS), with1('sensitive_paths', ['y'.repeat(MAX_GLOB_CHARS)]))[0]], [['config'], ['config']]);

// Pathological shapes in their own process with a clock, so a hang is a failed check and not a stuck suite.
const SHAPES = ['(a+)+$', '(a|aa)+$', 'a*a*a*a*a*a*a*a*a*a*b', '**/**/**/**/**/**/x', '*?*?*?*?*?*?*?*?c'];
const VICTIMS = [`${'a'.repeat(32)}!`, 'a/'.repeat(100), 'a'.repeat(200)];
// The real worst case under the caps (measured on the development machine): 40 paths, the cap, each of 119 segments with a trailing-dot segment and
// a U+FF0F, so all four readings differ, against two full layers (what loadConfig supplies) of 32 globs that keep every position alive (`**/a/` x19 and one
// of 31 adjacent **): about 2.5 s in-process, about 60 ms a path. The caps on the folded text are what bound it: before them a glob of `*` and 98 `?` against
// U+FDFA paths took 17 s. This check times 20 such paths, about 1.3 s, against a 2.6 s bound; the quadratic-step mutant takes about 5.4 s: a margin of about 2x each side.
// A caller with many paths bounds the total itself (escalation-facts reads the clock between chunks).
const GLOBS = Array.from({ length: MAX_GLOBS }, (_, i) => (i ? '**/a/'.repeat(19) : '**/'.repeat(31)) + 'z');
const WORST = `${'a/'.repeat(58)}a./${'a/'.repeat(30)}a／${'a/'.repeat(28)}a`;
// Adjacent ** in a glob are one step: 64 globs of 31 of them on the same paths take about 0.12 s collapsed (40 paths) and about 2.2 s without the collapse; bound 1 s.
const STARS = Array(MAX_GLOBS).fill(`${'**/'.repeat(31)}z`);
const child = `import * as M from ${JSON.stringify(pathToFileURL(modPath).href)};
const jobs = JSON.parse(process.argv[1]);
console.log(JSON.stringify(jobs.map(({ paths, layers }) => M.classifyPaths(paths, layers.map((globs) => ({ sizing: { sensitive_paths: globs } }))).sensitive)));`;
const timedJobs = (jobs, boundMs) => spawnSync(process.execPath, ['--input-type=module', '-e', child, JSON.stringify(jobs)], { encoding: 'utf8', timeout: boundMs });
const outcome = (t) => (t.status === 0 ? JSON.parse(t.stdout) : `child ended ${t.status ?? t.signal}`);
// fact-sheet.sh sets SKIP_TIMED=mutant-run for the scratch mutants that these checks do not name, so most of them need not wait for the child.
// Only that exact value skips: a stray exported SKIP_TIMED=1 never turns the cost check off, here or when this lib is run directly.
// Residual, stated: the stray-seam check there runs the real module with SKIP_TIMED=1, not a stale copy that is named like a sentinel; the guard is the exact comparison below.
const skipTimed = process.env.SKIP_TIMED === 'mutant-run';
const SHAPE_JOBS = SHAPES.map((s) => ({ paths: VICTIMS, layers: [[s]] }));
if (skipTimed) skip('nested-quantifier shapes, star runs and two layers of the largest glob list', 'SKIP_TIMED=mutant-run is set by the mutation runs that do not name this check');
else check('nested-quantifier shapes, star runs and two layers of the largest glob list on 119-segment paths with four readings finish inside the time bound and match nothing',
  outcome(timedJobs([...SHAPE_JOBS, { paths: Array(20).fill(WORST), layers: [GLOBS, GLOBS] }], 2600)), [...SHAPES.map(() => []), []]);
if (skipTimed) skip('adjacent ** segments in a glob are one step', 'SKIP_TIMED=mutant-run is set by the mutation runs that do not name this check');
else check('adjacent ** segments in a glob are one step: 64 globs of 31 of them on 40 four-reading paths finish inside the time bound', outcome(timedJobs([{ paths: Array(40).fill(WORST), layers: [STARS, STARS] }], 1000)), [[]]);
check('a nested-quantifier glob is literal text: it matches only itself', [hits('(a+)+$', with1('sensitive_paths', ['(a+)+$']))[0], hits('a', with1('sensitive_paths', ['(a+)+$']))[0]], [['config'], []]);

console.log('== path facts: no content ==');
const SECRET = 'TOPSECRET-FILE-CONTENT';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'path-facts-')); process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
fs.mkdirSync(path.join(dir, 'src')); fs.writeFileSync(path.join(dir, 'src/a.js'), SECRET); fs.writeFileSync(path.join(dir, '.env'), SECRET);
const result = run(['src/a.js', '.env', 'src/b.js']);
check('a result holds only the fixed fact fields, none of the file text', [JSON.stringify(result).includes(SECRET), Object.keys(result), Object.keys(result.files[0])], [false,
  ['files', 'production_files', 'modules', 'sensitive', 'boundary', 'contract', 'refused'], ['path', 'denied', 'production', 'module', 'sensitive', 'boundary', 'contract']]);
check('the module touches no filesystem API', /node:fs|readFile|openSync|statSync/.test(fs.readFileSync(modPath, 'utf8')), false);

console.log(`SUMMARY ${pass + fail} ${fail}`);
process.exit(fail ? 1 : 0);
