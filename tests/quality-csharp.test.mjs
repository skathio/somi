// C# in the quality gate: a .cs file is parsed with a vendored grammar, its methods are measured by the same SoMi-CC v1 rules as
// JavaScript, and the gate holds a change to C# code to the same limits.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { qualityGate } from '../scripts/lib/quality/gate.mjs';
import { DEFAULT_LIMITS } from '../scripts/lib/quality/limits.mjs';
import { unitsOf } from '../scripts/lib/quality/metrics.mjs';
import { languageOf, parseSource } from '../scripts/lib/quality/parse.mjs';
import { listFiles, snapshotTree } from '../scripts/lib/git-tree.mjs';

const cs = (body) => `namespace App {\n  public class C {\n${body}\n  }\n}\n`;
const units = async (code, file = 'C.cs') => unitsOf((await parseSource(file, code)).tree, { file });
const score = async (method) => (await units(cs(method)))[0].cognitive;

test('a .cs file is a language the gate covers, and valid C# parses without errors', async () => {
  assert.notEqual(languageOf('src/Orders/OrderService.cs'), null);
  assert.notEqual(languageOf('src/Program.CS'), null, 'the extension is matched without regard to case, like the others');
  const parsed = await parseSource('src/C.cs', cs('    public int Add(int a, int b) { return a + b; }'));
  assert.ok(parsed?.tree, 'a C# file comes back with a tree, not null or unanalyzed');
  assert.deepEqual(parsed.errors, []);
  parsed.tree.delete();
});

test('each C# method is a unit, named, with its parameters and depth measured', async () => {
  const [m] = await units(cs('    public int Pick(int a, bool b, string c) {\n      if (a > 0) {\n        while (b) { switch (c) { default: break; } }\n      }\n      return a;\n    }'));
  assert.equal(m.name, 'Pick');
  assert.deepEqual([m.params, m.depth], [3, 3]);
  const many = await units(cs('    public C(int x) { }\n    public void One() { }\n    public static int Two(int y) { return y; }'));
  assert.ok(['One', 'Two'].every((n) => many.some((u) => u.name === n)), 'every method is scored');
});

test('SoMi-CC v1 scores C# as the spec does: nesting, else-if and else, boolean sequences, loops and catch', async () => {
  assert.equal(await score('    void F(bool a, bool b, bool c) { if (a) { if (b) { if (c) { return; } } } }'), 6);
  assert.equal(await score('    void F(bool a, bool b) { if (a) { } else if (b) { } else { } }'), 3);
  assert.equal(await score('    void F(bool a, bool b, bool c, bool d) { if (a && b && c || d) { } }'), 3);
  assert.equal(await score('    void F(int[][] xs) { foreach (var x in xs) { foreach (var y in x) { } } }'), 3);
  assert.equal(await score('    void F(bool a) { if (a) { try { G(); } catch (System.Exception) { } } }'), 3);
  assert.equal(await score('    string F(int n) { switch (n) { case 1: return "one"; case 2: return "a couple"; default: return "lots"; } }'), 1);
});

const repo = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-gate-cs-'));
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
const PYRAMID = (name) => `    public object ${name}(int[][] xs, bool a, bool b) {\n      foreach (var x in xs) {\n        foreach (var y in x) {\n          if (a) { if (b) { if (y > 0) { return y; } } }\n        }\n      }\n      return null;\n    }\n`;

test('the gate fails a new C# method over a limit, and passes an old one that did not get worse', async (t) => {
  const r = repo(t);
  r.write('src/Legacy.cs', cs(`${PYRAMID('Legacy')}    public int Small(int x) { return x + 1; }`));
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.write('src/Legacy.cs', cs(`${PYRAMID('Legacy').replace('return null;', 'return 0;')}    public int Small(int x) { return x + 2; }\n${PYRAMID('Fresh')}`));
  const result = await gate(r);
  assert.equal(result.ok, false);
  assert.deepEqual(result.violations.filter((v) => v.rule === 'depth').map((v) => [v.file, v.name, v.value]), [['src/Legacy.cs', 'Fresh', 5]]);
  assert.ok(!result.violations.some((v) => v.name === 'Legacy'), 'the old method is touched but no worse');
  assert.deepEqual(result.unanalyzed, [], 'valid C# is not unanalyzed');
  assert.ok(result.scored.files >= 1 && result.scored.functions >= 2);
});

test('a clean C# change passes the gate', async (t) => {
  const r = repo(t);
  r.write('src/A.cs', cs('    public int A() { return 1; }'));
  r.git('add', '-A'); r.git('commit', '-qm', 'base');
  r.write('src/A.cs', cs('    public int A() { return 1; }\n    public int B(int x) { return x > 0 ? x : -x; }'));
  const result = await gate(r);
  assert.equal(result.ok, true);
  assert.equal(result.scored.files, 1);
});
