// Python in the quality gate, end to end: the grammar is vendored and verified, functions are units, and the gate scores a change in
// a real repository: limits, copies, leftover debugging, a swallowed error and an unused export. The calibration record is its evidence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { REPO } from './helpers.mjs';
import { qualityGate } from '../scripts/lib/quality/gate.mjs';
import { DEFAULT_LIMITS } from '../scripts/lib/quality/limits.mjs';
import { unitsOf } from '../scripts/lib/quality/metrics.mjs';
import { languageOf, parseSource, verifiedFile } from '../scripts/lib/quality/parse.mjs';
import { listFiles, snapshotTree } from '../scripts/lib/git-tree.mjs';

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), 'utf8'));
const tmpDir = (t, prefix) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('the Python grammar is vendored, recorded in the manifest with its sha256, and loads', async () => {
  const manifest = readJson('scripts/vendor/tree-sitter/manifest.json');
  const entry = manifest.files['tree-sitter-python.wasm'];
  assert.ok(entry, 'the manifest names tree-sitter-python.wasm');
  assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  assert.ok(verifiedFile('tree-sitter-python.wasm').length > 0);
  assert.equal(languageOf('pkg/orders/service.py'), 'python');
  assert.equal(languageOf('pkg/App.PY'), 'python');
  const parsed = await parseSource('pkg/a.py', 'def add(a, b):\n    return a + b\n');
  assert.ok(parsed?.tree, 'a Python file comes back with a tree');
  assert.deepEqual(parsed.errors, []);
  parsed.tree.delete();
});

test('each Python function is a unit, named, with its parameters measured', async () => {
  const code = 'def pick(a, b, c):\n    if a:\n        return b\n    return c\n\nclass C:\n    def method(self, x):\n        return x\n';
  const parsed = await parseSource('pkg/a.py', code);
  const units = unitsOf(parsed.tree, { file: 'pkg/a.py' });
  parsed.tree.delete();
  const pick = units.find((u) => u.name === 'pick');
  assert.ok(pick, 'pick is a unit');
  assert.equal(pick.params, 3);
  assert.ok(units.some((u) => u.name === 'method'), 'a method is a unit');
});

const repo = (t) => {
  const dir = tmpDir(t, 'somi-gate-py-');
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  return { dir, git, write };
};
const gate = async (r) => {
  const from = r.git('rev-parse', 'HEAD').trim();
  const to = snapshotTree(r.dir);
  return qualityGate(r.dir, { from, to, limits: DEFAULT_LIMITS, now: '2031-01-01T00:00:00Z', repoFiles: listFiles(r.dir, to) });
};
const based = (r, files) => {
  for (const [f, text] of Object.entries(files)) r.write(f, text);
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
};
const reported = (result, file) => [...result.violations, ...result.warnings].filter((v) => v.file === file);
const PYRAMID = (name) => `def ${name}(xs, a, b):\n    for x in xs:\n        for y in x:\n            if a:\n                if b:\n                    if y > 0:\n                        return y\n    return None\n`;

test('the gate scores Python: a new function over a limit fails, a clean change passes', async (t) => {
  const r = repo(t);
  based(r, { 'pkg/a.py': 'def one():\n    return 1\n' });
  r.write('pkg/a.py', `def one():\n    return 1\n\n\n${PYRAMID('fresh')}`);
  const bad = await gate(r);
  assert.equal(bad.ok, false);
  assert.ok(bad.violations.some((v) => v.rule === 'depth' && v.file === 'pkg/a.py' && v.name === 'fresh'));
  assert.deepEqual(bad.unanalyzed, []);
  assert.ok(bad.scored.files >= 1);
  r.write('pkg/a.py', 'def one():\n    return 1\n\n\ndef two(x):\n    return x + 1\n');
  assert.equal((await gate(r)).ok, true);
});

test('the gate finds a copied block in Python', async (t) => {
  const r = repo(t);
  const body = (name) => `def ${name}(order, rates, region):\n${Array.from({ length: 14 }, (_, i) => `    order.lines[${i}].total = order.lines[${i}].price * rates[region] + order.lines[${i}].fee - ${i}`).join('\n')}\n    return order\n`;
  based(r, { 'pkg/a.py': body('price_a') });
  r.write('pkg/b.py', body('price_b'));
  assert.ok((await gate(r)).violations.some((v) => v.rule === 'clone' && v.file === 'pkg/b.py'));
});

test('the gate reports leftover print and breakpoint, and a swallowed except: pass, in Python', async (t) => {
  for (const [label, added] of [['print', '    print(x)\n'], ['breakpoint', '    breakpoint()\n']]) {
    const r = repo(t);
    based(r, { 'pkg/a.py': 'def f(x):\n    return x\n' });
    r.write('pkg/a.py', `def f(x):\n${added}    return x\n`);
    assert.ok(reported(await gate(r), 'pkg/a.py').length > 0, label);
  }
  const r = repo(t);
  based(r, { 'pkg/a.py': 'def f(x):\n    return x\n' });
  r.write('pkg/a.py', 'def f(x):\n    try:\n        return int(x)\n    except:\n        pass\n');
  assert.ok(reported(await gate(r), 'pkg/a.py').length > 0, 'except: pass');
});

test('the gate reports a Python name in __all__ that nothing imports, and never a leading-underscore name', async (t) => {
  const r = repo(t);
  based(r, { 'pkg/__init__.py': '', 'pkg/main.py': 'def main():\n    return 0\n' });
  r.write('pkg/util.py', "__all__ = ['used', 'unused_helper']\n\n\ndef used():\n    return 1\n\n\ndef unused_helper():\n    return 2\n\n\ndef _private():\n    return 3\n");
  r.write('pkg/main.py', 'from .util import used\n\n\ndef main():\n    return used()\n');
  const found = reported(await gate(r), 'pkg/util.py');
  assert.ok(found.some((v) => v.name === 'unused_helper' || String(v.value).includes('unused_helper')), JSON.stringify(found));
  assert.ok(!found.some((v) => v.name === '_private' || String(v.value ?? '').includes('_private')), 'a leading underscore is private');
  assert.ok(!found.some((v) => v.name === 'used'), 'an imported name is used');
});

test('Python has its own calibration record', () => {
  const dir = path.join(REPO, 'benchmarks/quality/records');
  const python = fs.readdirSync(dir).filter((f) => /^calibration-\d{4}-\d{2}-\d{2}-python\.md$/.test(f));
  assert.ok(python.length > 0, 'a calibration-<date>-python.md record exists');
  assert.match(fs.readFileSync(path.join(dir, python[0]), 'utf8'), /\d+%|\d+ of \d+/, 'it records the share of planted problems caught');
});
