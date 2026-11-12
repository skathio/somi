// The quality gate: the vendored parser is checked before it runs, SoMi-CC v1 scores what SonarSource's spec scores, config can only
// loosen a limit from the user's own file, and the gate scores only what a change touches, against the version before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { CLI, REPO } from './helpers.mjs';
import { findClones, tokensOf } from '../scripts/lib/quality/clones.mjs';
import { cssRules } from '../scripts/lib/quality/css.mjs';
import { qualityGate } from '../scripts/lib/quality/gate.mjs';
import { DEFAULT_LIMITS, limitsFor, resolveLimits } from '../scripts/lib/quality/limits.mjs';
import { topLevelCognitive, unitsOf } from '../scripts/lib/quality/metrics.mjs';
import { parseSource, verifiedFile } from '../scripts/lib/quality/parse.mjs';
import { fileAt, filesAt, listFiles, snapshotTree } from '../scripts/lib/git-tree.mjs';

const VENDOR = path.join(REPO, 'scripts', 'vendor', 'tree-sitter');
const units = async (code, file = 'x.js', opts = {}) => unitsOf((await parseSource(file, code)).tree, { file, ...opts });
const score = async (code) => (await units(code))[0].cognitive;

test('a vendored file runs only if it matches its manifest', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-vendor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const f of ['manifest.json', 'tree-sitter-css.wasm']) fs.copyFileSync(path.join(VENDOR, f), path.join(dir, f));
  assert.ok(verifiedFile('tree-sitter-css.wasm', dir).length > 0);
  fs.appendFileSync(path.join(dir, 'tree-sitter-css.wasm'), Buffer.from([0]));
  assert.throws(() => verifiedFile('tree-sitter-css.wasm', dir), /does not match its manifest/);
  assert.throws(() => verifiedFile('tree-sitter-rust.wasm', dir), /not in the vendored manifest/);
  const manifest = JSON.parse(fs.readFileSync(path.join(VENDOR, 'manifest.json'), 'utf8'));
  for (const [file, entry] of Object.entries(manifest.files)) {
    assert.equal(entry.license, 'MIT', file);
    assert.match(entry.tarball_integrity, /^sha512-/, file);
  }
});

test('SoMi-CC v1 scores SonarSource\'s worked examples as the spec does', async () => {
  assert.equal(await score('function sumOfPrimes(max) { let total = 0; OUT: for (let i = 1; i <= max; ++i) { for (let j = 2; j < i; ++j) { if (i % j === 0) { continue OUT; } } total += i; } return total; }'), 7);
  assert.equal(await score('function getWords(n) { switch (n) { case 1: return "one"; case 2: return "a couple"; default: return "lots"; } }'), 1);
});

test('nesting adds its level, else-if and else add one, like operators count once, and shorthand counts nothing', async () => {
  assert.equal(await score('function f(a,b,c){ if (a) { if (b) { if (c) { return 1; } } } }'), 6);
  assert.equal(await score('function f(xs){ for (const x of xs) { for (const y of x) {} } }'), 3);
  assert.equal(await score('function f(xs,a,b,c){ for (const x of xs) { for (const y of x) { if (a) { if (b) { if (c) {} } } } } }'), 15, 'conditions inside loops inherit their nesting');
  assert.equal(await score('function f(a,b){ if (a) {} else if (b) {} else {} }'), 3);
  assert.equal(await score('function f(a,b,c,d){ if (a && b && c || d) {} }'), 3);
  assert.equal(await score('function f(a,b){ if (a ?? b) {} }'), 1);
  assert.equal(await score('function f(n){ return n ? f(n - 1) : 0; }'), 2, 'recursion adds one');
  assert.equal(await score('function f(a){ if (a) { try { x(); } catch (e) {} } }'), 3);
});

test('a nested function is its own unit and starts at the nesting around it', async () => {
  const [outer, inner] = await units('function g(xs){ for (const x of xs) { xs.map((y) => { if (y) {} }); } }');
  assert.deepEqual([outer.name, outer.cognitive], ['g', 1]);
  assert.equal(inner.cognitive, 2, 'the callback sits inside a loop');
  const suite = await units("describe('a', () => { it('b', () => { expect(1).toBe(1); }); });", 'a.test.js', { isTest: true });
  assert.ok(suite.every((u) => u.kind === 'test' && u.cognitive === 0), 'a describe block is not one giant function');
  assert.equal(topLevelCognitive((await parseSource('t.js', 'if (a) { for (const x of y) {} }')).tree), 3);
});

test('C# shapes the JavaScript grammar does not have score as their JavaScript twins do', async () => {
  const cs = async (body) => (await units(`class C {\n${body}\n}`, 'C.cs')).map((u) => [u.name, u.cognitive, u.params]);
  assert.deepEqual(await cs('int F(int n) { return n > 0 ? F(n - 1) : 0; }'), [['F', 2, 1]], 'a conditional and recursion, as a ternary and a call');
  assert.deepEqual(await cs('void G(bool a) { if (a) { Func<int, int> l = x => x > 0 ? 1 : 0; } }'), [['G', 1, 1], ['l', 2, 1]], 'a lambda is its own unit, with its one bare parameter');
  assert.deepEqual(await cs('int H(int a) => a switch { 1 => 2, _ => a > 3 ? 4 : 5 };'), [['H', 3, 1]], 'a switch expression nests its arms');
  assert.deepEqual(await cs('void J() { goto L; L: ; }'), [['J', 1, 0]], 'a goto breaks linear flow');
  const [d] = await units('class C { void K(bool a, bool b) { if (a) { } else if (b) { if (a) { } } } }', 'C.cs');
  assert.equal(d.depth, 2, 'an else-if is no deeper than the if it continues');
});

test('depth, lines, parameters and kind are measured per function', async () => {
  const [f] = await units('function f(a, { b, c }, ...rest) {\n  // a comment\n\n  if (a) {\n    while (b) { switch (c) { default: break; } }\n  }\n}');
  assert.deepEqual([f.params, f.depth, f.lines], [3, 3, 5], 'a destructured parameter counts once; comments and blank lines are not code');
  const [suite] = await units("describe('a', () => {\n  it('b', () => {\n    expect(1).toBe(1);\n    expect(2).toBe(2);\n  });\n});", 'a.test.js', { isTest: true });
  assert.equal(suite.lines, 4, 'a nested function\'s lines are its own: the describe holds lines 1, 2, 5 and 6');
  const [card] = await units('export function Card({ n }: { n: number }) { return <b>{n}</b>; }', 'c.tsx');
  assert.equal(card.kind, 'component');
  assert.equal((await units('function helper() { return 1; }', 'c.tsx'))[0].kind, 'function');
});

test('limits come from the defaults, the user\'s file may set any, and a project may only tighten', () => {
  assert.deepEqual(resolveLimits({ scope: 'commit' }).limits, JSON.parse(JSON.stringify(DEFAULT_LIMITS)), 'a commit gets the calibrated defaults');
  const loose = resolveLimits({ global: { quality: { function: { cognitive: 25 } } } });
  assert.equal(loose.limits.function.cognitive, 25, 'the user may loosen their own');
  const project = resolveLimits({ global: { quality: { function: { cognitive: 25 } } }, project: { quality: { function: { cognitive: 30, depth: 3 } } } });
  assert.equal(project.limits.function.cognitive, 25, 'a project cannot loosen it further');
  assert.equal(project.limits.function.depth, 3, 'but it can tighten');
  assert.match(project.ignored.find((x) => x.key === 'quality.function.cognitive').reason, /may only tighten/);
  const odd = resolveLimits({ project: { quality: { function: { cognitive: -1, made_up: 2 }, colours: {} } } });
  assert.deepEqual(odd.ignored.map((x) => x.key).sort(), ['quality.colours', 'quality.function.cognitive', 'quality.function.made_up']);
});

test('a commit and a pull request share every limit but how much one change may add, and either can override any', () => {
  assert.equal(limitsFor('commit').file.added_cognitive, 25);
  assert.equal(limitsFor('pr').file.added_cognitive, 100, 'a branch can add a new module');
  assert.deepEqual({ ...limitsFor('pr'), file: null }, { ...limitsFor('commit'), file: null });
  assert.throws(() => limitsFor('release'), /commit, pr, repo/);
  const global = { quality: { function: { cognitive: 20 }, pr: { function: { cognitive: 25 } }, commit: { file: { added_cognitive: 40 } } } };
  assert.equal(resolveLimits({ global, scope: 'pr' }).limits.function.cognitive, 25, 'a scope overrides the shared value');
  assert.equal(resolveLimits({ global, scope: 'commit' }).limits.function.cognitive, 20);
  assert.equal(resolveLimits({ global, scope: 'commit' }).limits.file.added_cognitive, 40);
  const project = { quality: { pr: { function: { depth: 3, cognitive: 40 } } } };
  const pr = resolveLimits({ global, project, scope: 'pr' });
  assert.equal(pr.limits.function.depth, 3, 'a project tightens one scope');
  assert.equal(pr.limits.function.cognitive, 25);
  assert.equal(pr.ignored[0].key, 'quality.pr.function.cognitive');
  assert.equal(resolveLimits({ global, project, scope: 'commit' }).limits.function.depth, 4, 'and not the other');
  assert.deepEqual(resolveLimits({ project: { quality: { pr: { colours: {} } } }, scope: 'pr' }).ignored.map((x) => x.key), ['quality.pr.colours']);
});

test('copied code is found even with its names changed, and short or different code is not', async () => {
  const check = "const user = store.users.get(actorId); const doc = store.docs.get(id); if (!doc) return fail('not_found'); if (!user || user.orgId !== doc.orgId) return fail('not_found'); if (doc.ownerId !== user.id && !user.roles.includes('admin')) return fail('forbidden');";
  const renamed = check.replaceAll('user', 'member').replaceAll('doc', 'item').replace("'admin'", "'owner'");
  const a = (await parseSource('a.js', `export function readDoc(store, actorId, id) { ${check} return ok(doc); }`)).tree;
  const b = (await parseSource('b.js', `export function updateDoc(store, actorId, id) { ${renamed} return ok(item); }`)).tree;
  const found = findClones({ after: [{ file: 'b.js', tokens: tokensOf(b), size: 50 }], rest: [{ file: 'a.js', tokens: tokensOf(a), size: 50 }] });
  assert.equal(found.length, 1);
  assert.deepEqual(found[0].other, { file: 'a.js', line: 1 });
  const other = (await parseSource('c.js', 'export function total(items) { return items.reduce((s, i) => s + i.cents, 0); }')).tree;
  assert.deepEqual(findClones({ after: [{ file: 'c.js', tokens: tokensOf(other), size: 50 }], rest: [{ file: 'a.js', tokens: tokensOf(a), size: 50 }] }), []);
  assert.deepEqual(findClones({ after: [{ file: 'b.js', tokens: tokensOf(b), size: 50 }], before: [{ file: 'b.js', tokens: tokensOf(b), size: 50 }], rest: [{ file: 'a.js', tokens: tokensOf(a), size: 50 }] }), [], 'a copy that was already there is not new');
});

test('stylesheet rules: nesting, chained selectors, IDs and !important', async () => {
  const [rule] = cssRules((await parseSource('s.css', '.a .b > .c .d { color: red !important; }')).tree);
  assert.deepEqual([rule.compound, rule.important, rule.ids], [4, 1, 0]);
  assert.equal(cssRules((await parseSource('s.css', '#x { color: blue; }')).tree)[0].ids, 1);
  assert.equal(Math.max(...cssRules((await parseSource('s.css', '.p { .q { .r { .s { color: green; } } } }')).tree).map((r) => r.nesting)), 4);
});

const repo = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-gate-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  return { dir, git, write: (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); } };
};
const gate = async (r, opts = {}) => {
  const from = r.git('rev-parse', 'HEAD').trim();
  const to = snapshotTree(r.dir);
  return qualityGate(r.dir, { from, to, limits: DEFAULT_LIMITS, now: '2031-01-01T00:00:00Z', repoFiles: listFiles(r.dir, to), ...opts });
};
test('many files read in batches come back as each one read alone would, without the files that are not there', (t) => {
  const r = repo(t);
  for (let i = 0; i < 205; i++) r.write(`src/f${i}.js`, `export const v${i} = ${i};\n`);
  r.write('src/empty.js', '');
  r.write('src/naïve ünïcode.js', 'export const s = "é";\n');
  r.write('src/two\nlines.js', 'export const n = 2;\n');
  const to = snapshotTree(r.dir);
  const files = [...listFiles(r.dir, to), 'src/gone.js'];
  const read = filesAt(r.dir, to, files);
  assert.equal(read.size, files.length - 1, 'a file that is not there is left out');
  for (const f of files.slice(0, -1)) assert.equal(read.get(f), fileAt(r.dir, to, f), f);
  assert.deepEqual([...read.keys()], files.slice(0, -1), 'in the order asked');
});

const PYRAMID = (name) => `export function ${name}(xs, a, b) {\n  for (const x of xs) {\n    for (const y of x) {\n      if (a) { if (b) { if (y) { return y; } } }\n    }\n  }\n  return null;\n}\n`;

test('the gate fails a new function over a limit, and passes an old one that did not get worse', async (t) => {
  const r = repo(t);
  r.write('src/a.js', `${PYRAMID('legacy')}export function small(x) { return x + 1; }\n`);
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.write('src/a.js', `${PYRAMID('legacy').replace('return null;', 'return undefined;')}export function small(x) { return x + 2; }\n${PYRAMID('fresh')}`);
  const result = await gate(r);
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.filter((v) => v.rule === 'depth').map((v) => v.name), ['fresh'], 'the old function is touched but no worse');
  assert.ok(!result.violations.some((v) => v.name === 'legacy'));
  assert.ok(!result.violations.some((v) => v.rule === 'clone'), 'a copy of about 50 tokens is under the default of 100: the known gap calibration chose');
  const strict = await gate(r, { limits: { ...DEFAULT_LIMITS, clones: { tokens: 50 } } });
  assert.ok(strict.violations.some((v) => v.rule === 'clone' && v.other.line === 1), 'with a stricter limit the new one copies the old one');
});

test('a change that takes a function over a limit fails, one already over that gets worse warns, and a file may not gain too much at once', async (t) => {
  const r = repo(t);
  const within = 'export function tidy(xs, a) {\n  for (const x of xs) {\n    if (a) { if (x) { return x; } }\n  }\n  return null;\n}\n';
  r.write('src/a.js', PYRAMID('legacy') + within);
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.write('src/a.js', PYRAMID('legacy').replace('if (y) { return y; }', 'if (y) { if (x) { return y; } }') + within.replace('if (x) { return x; }', 'if (x) { if (x.ok) { if (x.done) { return x; } } }'));
  const changed = await gate(r);
  assert.ok(changed.violations.some((v) => v.rule === 'depth' && v.name === 'tidy' && v.before === 3 && v.value === 5), 'tidy crossed the limit');
  assert.ok(!changed.violations.some((v) => v.name === 'legacy' && v.rule === 'depth'), 'legacy\'s depth was already over');
  assert.ok(changed.violations.some((v) => v.name === 'legacy' && v.rule === 'cognitive' && v.before === 15 && v.value === 21), 'its complexity was at the limit and crossed it');
  assert.ok(changed.warnings.some((w) => w.rule === 'depth' && w.name === 'legacy' && w.before === 5 && w.value === 6), 'legacy was already over: a warning');
  const split = Array.from({ length: 5 }, (_, i) => `export function part${i}(a, b, c) {\n  if (a) { if (b) { if (c) { return ${i}; } } }\n  return -1;\n}\n`).join('');
  r.write('src/a.js', PYRAMID('legacy') + within + split);
  const added = (await gate(r)).violations.find((v) => v.rule === 'file-added-cognitive');
  assert.equal(added?.value, 30, 'five functions of 6 each, under the per-function limit, still add 30 to one file at once');
});

test('code moved between files the change touches is not added, but a copy or a changed function is', async (t) => {
  const r = repo(t);
  const parts = Array.from({ length: 5 }, (_, i) => `export function part${i}(a, b, c) {\n  if (a) { if (b) { if (c) { return ${i}; } } }\n  return -1;\n}\n`);
  r.write('src/a.js', `export const keep = 1;\n${parts.join('')}`);
  r.write('src/gone.js', parts.slice(0, 2).join('').replaceAll('part', 'old'));
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  const cap = async () => (await gate(r, { scope: 'commit' })).violations.filter((v) => v.rule === 'file-added-cognitive').map((v) => [v.file, v.value, v.moved]);
  r.write('src/a.js', 'export const keep = 1;\n');
  r.write('src/b.js', parts.map((p) => p.replaceAll('\n  ', '\n    ')).join(''));
  assert.deepEqual(await cap(), [], 'five functions moved to a new file, reindented, add nothing');
  r.write('src/a.js', `export const keep = 1;\n${parts.join('')}`);
  assert.deepEqual(await cap(), [['src/b.js', 30, undefined]], 'a copy that leaves the original in place is added');
  r.write('src/a.js', 'export const keep = 1;\n');
  r.write('src/b.js', parts.map((p) => p.replace('return -1', 'return -2')).join(''));
  assert.deepEqual(await cap(), [['src/b.js', 30, undefined]], 'a function changed on the way is added');
  r.write('src/b.js', parts.join(''));
  r.write('src/c.js', parts.join(''));
  assert.deepEqual(await cap(), [['src/b.js', 30, undefined], ['src/c.js', 30, undefined]], 'moved to two places at once is a copy: neither is credited');
  fs.rmSync(path.join(r.dir, 'src', 'c.js'));
  r.write('src/b.js', `${parts.slice(0, 4).join('')}export function fresh(a, b, c, d) {\n  if (a) { if (b) { if (c) { if (d) { return 1; } } } }\n  return 0;\n}\n`);
  assert.deepEqual(await cap(), [], 'four moved and one new one of 10 add 10');
  r.git('rm', '-q', 'src/gone.js');
  r.write('src/b.js', [...parts, ...parts.slice(0, 2).map((p) => p.replaceAll('part', 'old'))].join(''));
  assert.deepEqual(await cap(), [], 'what a deleted file held is moved too');
});

test('suppressions, syntax errors and generated files', async (t) => {
  const r = repo(t);
  r.write('src/a.js', 'export const a = 1;\n');
  r.write('src/old.js', `${PYRAMID('legacy')}export function broken( {\n`);
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.write('src/old.js', `export function fresh(a) { return a ? 1 : 2; }\n${PYRAMID('legacy')}export function broken( {\n`);
  r.write('src/reasoned.js', '// eslint-disable-next-line no-console -- the CLI prints its result here\nconsole.log(1);\n');
  r.write('src/mentions.js', "export const help = 'add // eslint-disable-next-line to silence it';\n");
  r.write('src/prose.js', '// This module never needs eslint-disable, because it has no console calls.\nexport const b = 2;\n');
  r.write('src/a.js', 'export const a = 1;\n// eslint-disable-next-line no-console\nconsole.log(a);\n');
  r.write('src/broken.js', 'export function broken( {\n');
  r.write('src/gen.js', `// @generated by a tool\n${PYRAMID('generated')}`);
  const result = await gate(r);
  assert.deepEqual(result.violations.map((v) => `${v.rule}:${v.file}`).sort(), ['suppression:src/a.js'], 'an unreasoned suppression fails; one with a reason passes');
  assert.ok(result.warnings.some((w) => w.rule === 'unanalyzed' && w.file === 'src/broken.js'), 'code the parser cannot follow warns in a project');
  assert.match(result.unanalyzed[0].reason, /could not follow the changed lines/);
  assert.ok(result.scored.functions >= 1);
  const bench = await gate(r, { mode: 'benchmark' });
  assert.equal(bench.violations.filter((v) => v.rule === 'suppression').length, 2, 'a benchmark allows no new suppression, reasoned or not');
  assert.ok(bench.violations.some((v) => v.rule === 'unanalyzed'), 'and fails what it cannot read');
});

test('an exemption needs a reason and an expiry within 90 days, and counts for nothing in a benchmark', async (t) => {
  const r = repo(t);
  r.write('src/a.js', 'export const a = 1;\n');
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  const allow = (reason, expires) => `// somi-gate-allow depth reason="${reason}" expires=${expires}\n${PYRAMID('parser')}`;
  r.write('src/a.js', allow('a token switch is flat and reads in one pass', '2031-02-01'));
  const ok = await gate(r);
  assert.equal(ok.violations.filter((v) => v.rule === 'depth').length, 0);
  assert.equal(ok.exemptions[0].expires, '2031-02-01');
  for (const [reason, expires] of [['too short', '2031-02-01'], ['a token switch is flat and reads in one pass', '2030-12-01'], ['a token switch is flat and reads in one pass', '2031-09-01']]) {
    r.write('src/a.js', allow(reason, expires));
    assert.equal((await gate(r)).violations.filter((v) => v.rule === 'depth').length, 1, `${reason} ${expires}`);
  }
  r.write('src/a.js', allow('a token switch is flat and reads in one pass', '2031-02-01'));
  const bench = await gate(r, { mode: 'benchmark' });
  assert.ok(bench.violations.some((v) => v.rule === 'depth') && bench.violations.some((v) => v.rule === 'exemption'));
});

test('somi quality reads the config, a benchmark ignores it, and it exits 1 on a violation', (t) => {
  const r = repo(t);
  r.write('src/a.js', 'export const a = 1;\n');
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.write('src/a.js', PYRAMID('fresh'));
  r.write('.somi/config.json', JSON.stringify({ quality: { function: { depth: 9 } } }));
  const run = (args, env = {}) => spawnSync(process.execPath, [CLI, 'quality', ...args], { cwd: r.dir, encoding: 'utf8', env: { ...process.env, SOMI_GLOBAL_CONFIG: '', ...env } });
  assert.equal(JSON.parse(run(['--scope', 'commit']).stdout).scope, 'commit');
  assert.equal(run(['--scope', 'release']).status, 64);
  const project = run([]);
  assert.equal(project.status, 1);
  assert.match(JSON.parse(project.stdout).ignored_config[0].reason, /may only tighten/);
  const global = path.join(r.dir, 'global.json');
  fs.writeFileSync(global, JSON.stringify({ quality: { function: { depth: 9, cognitive: 40 } } }));
  assert.equal(run([], { SOMI_GLOBAL_CONFIG: global }).status, 0, 'the user\'s own file may loosen');
  assert.equal(run(['--benchmark'], { SOMI_GLOBAL_CONFIG: global }).status, 1, 'a benchmark scores with the defaults');
});

test('the commit scope scores what a commit adds to the last one, and the pr scope the whole branch', async (t) => {
  const r = repo(t);
  r.write('src/a.js', 'export const a = 1;\n');
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.git('checkout', '-q', '-b', 'work');
  r.write('src/b.js', PYRAMID('early'));
  r.git('add', '-A'); r.git('commit', '-qm', 'first');
  r.write('src/c.js', 'export const c = 3;\n');
  const run = (scope) => JSON.parse(spawnSync(process.execPath, [CLI, 'quality', '--scope', scope], { cwd: r.dir, encoding: 'utf8', env: { ...process.env, SOMI_GLOBAL_CONFIG: '' } }).stdout);
  assert.equal(run('commit').ok, true, 'the uncommitted change is clean');
  assert.equal(run('pr').ok, false, 'the branch still holds the pyramid');
  r.git('add', '-A'); r.git('commit', '-qm', 'second');
  assert.equal(run('commit').ok, true, 'with nothing uncommitted, the last commit is what is scored');
});

test('somi check runs the quality gate at commit scope, --scope pr holds a change to the branch limits, and somi pr refuses below the bar', (t) => {
  const r = repo(t);
  r.write('src/a.js', 'export const a = 1;\n');
  r.write('package.json', '{"name":"q","private":true}\n');
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.git('checkout', '-q', '-b', 'work');
  // Five functions of 6 each: within every function limit, but 30 added to one file is over a commit's 25 and within a branch's 100.
  r.write('src/a.js', `export const a = 1;\n${Array.from({ length: 5 }, (_, i) => `export function part${i}(a, b, c) {\n  if (a) { if (b) { if (c) { return ${i}; } } }\n  return -1;\n}\n`).join('')}`);
  const env = { ...process.env, SOMI_GLOBAL_CONFIG: '' };
  const somi = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: r.dir, encoding: 'utf8', env });
  const commit = JSON.parse(somi('check').stdout);
  assert.equal(commit.ok, false);
  assert.match(commit.gates.find((g) => g.name === 'quality').failures[0], /^file-added-cognitive src\/a\.js:1: 30 over 25/);
  assert.equal(JSON.parse(somi('check', '--scope', 'pr').stdout).failed.includes('quality'), false, 'a branch may add a module');
  assert.equal(somi('check', '--scope', 'release').status, 64);
  r.write('src/b.js', PYRAMID('deep'));
  const refused = somi('pr', '--unreviewed');
  assert.notEqual(refused.status, 0, 'going ahead unreviewed does not go ahead below the quality bar');
  assert.match(`${refused.stdout}${refused.stderr}`, /does not meet the quality limits[\s\S]*depth src\/b\.js:1 deep: 5 over 4/);
});

test('a staged build is checked at the branch scope', () => {
  assert.match(fs.readFileSync(path.join(REPO, 'workflows', 'deliver-stages.js'), 'utf8'), /check --scope pr/);
});

test('the repo scope reports the whole codebase as it stands, worst first, and somi check does not take it', (t) => {
  const r = repo(t);
  const copy = 'export function load(store, id) {\n  const row = store.rows.get(id);\n  if (!row) return { ok: false, error: { code: \'not_found\' } };\n  if (row.deleted) return { ok: false, error: { code: \'gone\' } };\n  const owner = store.users.get(row.ownerId);\n  if (!owner || owner.disabled) return { ok: false, error: { code: \'forbidden\' } };\n  return { ok: true, value: { ...row, owner: owner.name, seen: store.clock() } };\n}\n';
  r.write('src/old.js', `${PYRAMID('legacy')}${copy}`);
  r.write('src/again.js', copy.replace('function load', 'function fetchRow'));
  r.write('src/ok.js', 'export const ok = 1;\n');
  r.git('add', '-A'); r.git('commit', '-qm', 'old code');
  const env = { ...process.env, SOMI_GLOBAL_CONFIG: '' };
  const somi = (...args) => spawnSync(process.execPath, [CLI, ...args], { cwd: r.dir, encoding: 'utf8', env });
  assert.equal(JSON.parse(somi('quality', '--scope', 'pr').stdout).ok, true, 'a change scope sees nothing: nothing changed');
  const run = somi('quality', '--scope', 'repo');
  assert.equal(run.status, 1);
  const report = JSON.parse(run.stdout);
  assert.equal(report.scope, 'repo');
  assert.ok(report.violations.some((v) => v.rule === 'depth' && v.name === 'legacy'), 'old code a diff never touches is reported');
  assert.ok(report.violations.some((v) => v.rule === 'clone'), 'and so is a copy that was already there');
  assert.equal(report.summary.most_complex[0].name, 'legacy', 'worst first');
  assert.equal(report.summary.most_findings[0].file, 'src/old.js');
  const global = path.join(r.dir, 'global.json');
  fs.writeFileSync(global, JSON.stringify({ quality: { repo: { function: { depth: 9, cognitive: 40 }, clones: { tokens: 1000 } } } }));
  assert.equal(spawnSync(process.execPath, [CLI, 'quality', '--scope', 'repo'], { cwd: r.dir, encoding: 'utf8', env: { ...env, SOMI_GLOBAL_CONFIG: global } }).status, 0, 'the repo scope has its own limits under quality.repo');
  assert.equal(somi('check', '--scope', 'repo').status, 64, 'somi check gates a change, not the whole codebase');
});

test('the gate\'s time comes from config: the user\'s file either way, a project\'s only to lengthen it', async () => {
  const { QUALITY_TIMEOUT, resolveTimeout } = await import('../scripts/lib/quality/limits.mjs');
  assert.deepEqual(resolveTimeout({}), { seconds: QUALITY_TIMEOUT.default, ignored: [] });
  assert.equal(resolveTimeout({ global: { quality: { timeout_seconds: 60 } } }).seconds, 60);
  assert.equal(resolveTimeout({ global: { quality: { timeout_seconds: 600 } }, project: { quality: { timeout_seconds: 900 } } }).seconds, 900);
  const shorter = resolveTimeout({ global: { quality: { timeout_seconds: 600 } }, project: { quality: { timeout_seconds: 30 } } });
  assert.equal(shorter.seconds, 600);
  assert.match(shorter.ignored[0].reason, /only lengthen/);
  for (const bad of [5, QUALITY_TIMEOUT.max + 1, 12.5, '600']) {
    const r = resolveTimeout({ global: { quality: { timeout_seconds: bad } } });
    assert.equal(r.seconds, QUALITY_TIMEOUT.default, String(bad));
    assert.equal(r.ignored[0].key, 'quality.timeout_seconds');
  }
  // It sits beside the limits without being read as one.
  const { ignored } = resolveLimits({ global: { quality: { timeout_seconds: 600, function: { cognitive: 20 } } } });
  assert.deepEqual(ignored, []);
});

test('a gate that runs out of time is a failure that says how to give it longer', async () => {
  const { gateOutcome } = await import('../scripts/lib/quality/run.mjs');
  const out = gateOutcome({ error: Object.assign(new Error('spawnSync node ETIMEDOUT'), { code: 'ETIMEDOUT' }), status: null, stdout: '' }, 300);
  assert.equal(out.timed_out, true);
  assert.match(out.error, /did not finish within 300 s/);
  assert.match(out.error, /quality\.timeout_seconds/);
  assert.equal(gateOutcome({ status: 0, stdout: JSON.stringify({ ok: true, violations: [], warnings: [] }) }, 300).ok, true);
  assert.match(gateOutcome({ status: 2, stdout: '', stderr: 'boom\nmore' }, 300).error, /could not run: boom/);
});

test('the end-of-turn hook has longer than the gate\'s longest time, so the host never cuts it off first', async () => {
  const { QUALITY_TIMEOUT } = await import('../scripts/lib/quality/limits.mjs');
  const hooks = JSON.parse(fs.readFileSync(path.join(REPO, 'hooks', 'hooks.json'), 'utf8')).hooks.Stop.flatMap((g) => g.hooks);
  const stop = hooks.find((h) => h.command.includes('review-due.mjs'));
  assert.ok(stop.timeout >= QUALITY_TIMEOUT.max + 60, `the Stop hook's timeout is ${stop.timeout}`);
});
