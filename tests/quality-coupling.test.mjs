// The quality gate's coupling rules: the import graph read from the text, a cycle a change closes, folders a project forbids from
// importing others, a module's fan-out, and names a change exports that nothing imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { listFiles, snapshotTree } from '../scripts/lib/git-tree.mjs';
import { qualityGate } from '../scripts/lib/quality/gate.mjs';
import { importsOf, resolveImport } from '../scripts/lib/quality/imports.mjs';
import { limitsFor, resolveForbidden } from '../scripts/lib/quality/limits.mjs';

const repo = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-coupling-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  return { dir, git, write, commit: () => { git('add', '-A'); git('commit', '-qm', 'base'); } };
};
const gate = async (r, opts = {}) => {
  const to = snapshotTree(r.dir);
  return qualityGate(r.dir, { from: r.git('rev-parse', 'HEAD').trim(), to, limits: limitsFor('pr'), now: '2031-01-01T00:00:00Z', repoFiles: listFiles(r.dir, to), ...opts });
};
const found = (result, rule) => [...result.violations, ...result.warnings].filter((f) => f.rule === rule);

test('imports are read from the text: names, namespaces, type-only imports, re-exports, require and import()', () => {
  const text = [
    "import React, { useState, type Props as P } from './react';",
    "import type { Shape } from './shape';",
    "import * as all from './all';",
    "export { a, b as c } from './re';",
    "export * from './star';",
    "import './side-effect';",
    "const x = require('./req');",
    "const y = await import('./lazy');",
    "import fs from 'node:fs';",
  ].join('\n');
  assert.deepEqual(importsOf(text).map((i) => [i.spec, i.names, i.typeOnly]), [
    ['./react', ['default', 'useState', 'Props'], false],
    ['./shape', ['Shape'], true],
    ['./all', null, false],
    ['./re', ['a', 'b'], false],
    ['./star', null, false],
    ['node:fs', ['default'], false],
    ['./side-effect', [], false],
    ['./req', null, false],
    ['./lazy', null, false],
  ]);
  const files = new Set(['src/a.ts', 'src/lib/index.js', 'src/b.mjs']);
  assert.equal(resolveImport('./a.js', 'src/x.ts', files), 'src/a.ts', 'ESM TypeScript names the .js it compiles to');
  assert.equal(resolveImport('./lib', 'src/x.js', files), 'src/lib/index.js');
  assert.equal(resolveImport('../src/b.mjs', 'test/x.js', files), 'src/b.mjs');
  assert.equal(resolveImport('lodash', 'src/x.js', files), null, 'a package is not a file of the repository');
});

test('a change that closes an import cycle fails, one inside a loop that was already there is advice, and a type-only one is neither', async (t) => {
  const r = repo(t);
  r.write('src/a.js', "import { b } from './b.js';\nexport const a = () => b;\n");
  r.write('src/b.js', 'export const b = 1;\n');
  r.write('src/c.js', "import { d } from './d.js';\nexport const c = d;\n");
  r.write('src/d.js', "import { e } from './e.js';\nexport const d = e;\n");
  r.write('src/e.js', "import { c } from './c.js';\nexport const e = 1;\nexport const ce = () => c;\n");
  r.write('src/t.ts', 'export type T = number;\nexport const t = 1;\n');
  r.write('src/u.ts', "import { t } from './t';\nexport const u = t;\n");
  r.commit();
  r.write('src/b.js', "import { a } from './a.js';\nexport const b = 1;\nexport const ba = () => a;\n");
  const closed = found(await gate(r), 'cycle');
  assert.deepEqual(closed.map((c) => [c.file, c.reason]), [['src/b.js', 'src/b.js -> src/a.js -> src/b.js']]);
  assert.equal((await gate(r)).ok, false);
  r.write('src/b.js', 'export const b = 1;\n');
  r.write('src/c.js', "import { d } from './d.js';\nimport { e } from './e.js';\nexport const c = d + e;\n");
  const grown = await gate(r);
  assert.equal(grown.ok, true);
  assert.deepEqual(found(grown, 'cycle-grown').map((c) => c.file), ['src/c.js']);
  r.write('src/c.js', "import { d } from './d.js';\nexport const c = d;\n");
  r.write('src/t.ts', "import type { U } from './u';\nexport type T = U;\nexport const t = 1;\n");
  assert.deepEqual(found(await gate(r), 'cycle'), [], 'a type-only import is gone when the code runs');
});

test('a folder a config forbids from importing another fails a change that adds that import', async (t) => {
  const r = repo(t);
  r.write('src/db/store.js', 'export const store = 1;\n');
  r.write('src/ui/view.js', 'export const view = 1;\n');
  r.commit();
  r.write('src/ui/view.js', "import { store } from '../db/store.js';\nexport const view = store;\n");
  const { forbid } = resolveForbidden({ project: { quality: { forbid_imports: [{ from: 'src/ui/', to: 'src/db/' }] } } });
  assert.deepEqual(found(await gate(r, { forbid }), 'forbidden-import').map((v) => [v.file, v.other.file]), [['src/ui/view.js', 'src/db/store.js']]);
  assert.equal((await gate(r)).ok, true, 'with no rule it is an ordinary import');
  const odd = resolveForbidden({ global: { quality: { forbid_imports: 'src/ui' } }, project: { quality: { forbid_imports: [{ from: 'src/ui/' }] } } });
  assert.deepEqual(odd.forbid, []);
  assert.equal(odd.ignored.length, 2);
});

test('a module others import that comes to depend on too many others is advice, and an entry point is not held to it', async (t) => {
  const r = repo(t);
  for (let i = 0; i < 4; i++) r.write(`src/m${i}.js`, `export const m${i} = ${i};\n`);
  r.write('src/hub.js', 'export const hub = 1;\n');
  r.write('src/main.js', "import { hub } from './hub.js';\nexport default hub;\n");
  r.write('src/cli.js', 'export const cli = 1;\n');
  r.commit();
  const many = Array.from({ length: 4 }, (_, i) => `import { m${i} } from './m${i}.js';\n`).join('');
  r.write('src/hub.js', `${many}export const hub = m0 + m1 + m2 + m3;\n`);
  r.write('src/cli.js', `${many}export const cli = m0 + m1 + m2 + m3;\n`);
  const limits = { ...limitsFor('pr'), imports: { fan_out: 3 } };
  const result = await gate(r, { limits });
  assert.equal(result.ok, true);
  assert.deepEqual(found(result, 'import-fan-out').map((w) => [w.file, w.value, w.before]), [['src/hub.js', 4, 0]]);
});

test('a name a change exports from an imported module that nothing imports is advice', async (t) => {
  const r = repo(t);
  r.write('src/lib.js', 'export function used() { return 1; }\n');
  r.write('src/app.js', "import { used } from './lib.js';\nexport default used;\n");
  r.write('src/ns.js', 'export const one = 1;\n');
  r.write('src/whole.js', "import * as ns from './ns.js';\nexport default ns;\n");
  r.commit();
  r.write('src/lib.js', 'export function used() { return 1; }\nexport function spare() { return 2; }\nexport const taken = 3, dropped = 4;\n');
  r.write('src/app.js', "import { used, taken } from './lib.js';\nexport default used + taken;\n");
  r.write('src/ns.js', 'export const one = 1;\nexport const two = 2;\n');
  r.write('src/fresh.js', 'export const lonely = 1;\n');
  const result = await gate(r);
  assert.equal(result.ok, true);
  assert.deepEqual(found(result, 'unused-export').map((w) => `${w.file}:${w.name}`).sort(), ['src/lib.js:dropped', 'src/lib.js:spare'], 'a namespace import may use any name, and a module nothing imports may be an entry point');
});
