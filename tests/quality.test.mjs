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
import { DEFAULT_LIMITS, loosens, resolveLimits } from '../scripts/lib/quality/limits.mjs';
import { topLevelCognitive, unitsOf } from '../scripts/lib/quality/metrics.mjs';
import { parseSource, verifiedFile } from '../scripts/lib/quality/parse.mjs';
import { listFiles, snapshotTree } from '../scripts/lib/git-tree.mjs';

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
  assert.deepEqual(resolveLimits().limits, JSON.parse(JSON.stringify(DEFAULT_LIMITS)));
  const loose = resolveLimits({ global: { quality: { function: { cognitive: 25 } } } });
  assert.equal(loose.limits.function.cognitive, 25, 'the user may loosen their own');
  const project = resolveLimits({ global: { quality: { function: { cognitive: 25 } } }, project: { quality: { function: { cognitive: 30, depth: 3 } } } });
  assert.equal(project.limits.function.cognitive, 25, 'a project cannot loosen it further');
  assert.equal(project.limits.function.depth, 3, 'but it can tighten');
  assert.match(project.ignored.find((x) => x.key === 'quality.function.cognitive').reason, /may only tighten/);
  const odd = resolveLimits({ project: { quality: { function: { cognitive: -1, made_up: 2 }, colours: {} } } });
  assert.deepEqual(odd.ignored.map((x) => x.key).sort(), ['quality.colours', 'quality.function.cognitive', 'quality.function.made_up']);
  assert.equal(loosens(DEFAULT_LIMITS, { function: { cognitive: 20 } }), true);
  assert.equal(loosens(DEFAULT_LIMITS, { function: { cognitive: 10 } }), false);
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

test('suppressions, syntax errors and generated files', async (t) => {
  const r = repo(t);
  r.write('src/a.js', 'export const a = 1;\n');
  r.write('src/old.js', `${PYRAMID('legacy')}export function broken( {\n`);
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.write('src/old.js', `export function fresh(a) { return a ? 1 : 2; }\n${PYRAMID('legacy')}export function broken( {\n`);
  r.write('src/reasoned.js', '// eslint-disable-next-line no-console -- the CLI prints its result here\nconsole.log(1);\n');
  r.write('src/mentions.js', "export const help = 'add // eslint-disable-next-line to silence it';\n");
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
  const project = run([]);
  assert.equal(project.status, 1);
  assert.match(JSON.parse(project.stdout).ignored_config[0].reason, /may only tighten/);
  const global = path.join(r.dir, 'global.json');
  fs.writeFileSync(global, JSON.stringify({ quality: { function: { depth: 9, cognitive: 40 } } }));
  assert.equal(run([], { SOMI_GLOBAL_CONFIG: global }).status, 0, 'the user\'s own file may loosen');
  assert.equal(run(['--benchmark'], { SOMI_GLOBAL_CONFIG: global }).status, 1, 'a benchmark scores with the defaults');
});
