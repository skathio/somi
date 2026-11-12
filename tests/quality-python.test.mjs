// Python in the quality gate: the same SoMi-CC v1 rules as the other languages where Python has the same structure, and its own
// reading where it differs: elif and else side by side, except, match, word operators, self, optional parameters and docstrings. The
// three checks only Python gets are leftover debugging, a swallowed error and an export that nothing imports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { qualityGate } from '../scripts/lib/quality/gate.mjs';
import { DEFAULT_LIMITS } from '../scripts/lib/quality/limits.mjs';
import { unitsOf } from '../scripts/lib/quality/metrics.mjs';
import { parseSource } from '../scripts/lib/quality/parse.mjs';
import { exportsOf, importsOf, isImported, pythonFindings } from '../scripts/lib/quality/python.mjs';
import { repoQuality } from '../scripts/lib/quality/repo.mjs';
import { listFiles, snapshotTree } from '../scripts/lib/git-tree.mjs';

const read = async (code, use, file = 'pkg/a.py') => {
  const parsed = await parseSource(file, code);
  try { return use(parsed.tree); } finally { parsed.tree.delete(); }
};
const units = (code) => read(code, (tree) => unitsOf(tree, { file: 'pkg/a.py' }));
const score = async (code) => (await units(code))[0].cognitive;
const body = (...rows) => `def f(a, b, c):\n${rows.map((r) => `    ${r}`).join('\n')}\n`;

test('SoMi-CC v1 scores Python as the spec does: nesting, elif and else, word operators, loops, except and match', async () => {
  assert.equal(await score(body('if a:', '    if b:', '        if c:', '            return 1')), 6);
  assert.equal(await score(body('if a:', '    pass', 'elif b:', '    pass', 'elif c:', '    pass', 'else:', '    pass')), 4, 'each elif and the else add one, without nesting');
  assert.equal(await score(body('if a and b and c or a:', '    pass')), 3, 'one for the if, one per run of like operators');
  assert.equal(await score(body('for x in a:', '    for y in x:', '        pass')), 3);
  assert.equal(await score(body('try:', '    pass', 'except ValueError:', '    if a:', '        pass')), 3, 'an except adds one, and what it holds is nested');
  assert.equal(await score(body('match a:', '    case 1:', '        return b', '    case _:', '        return c')), 1);
  assert.equal(await score(body('return b if a else c')), 1);
  assert.equal(await score('def f(n):\n    return f(n - 1)\n'), 1, 'recursion');
});

test('a method\'s self is not a parameter, optional parameters count as one, and a docstring is not a line', async () => {
  const [method, options, documented] = await units('class C:\n    def m(self, a, b):\n        return a\n\n\ndef options(a, b, *, c=1, d=2, e=3, **rest):\n    return a\n\n\ndef documented(a):\n    """Says what it does.\n\n    Over several lines.\n    """\n    return a\n');
  assert.equal(method.params, 2);
  assert.equal(options.params, 3, 'two required, and the optional ones together');
  assert.equal(documented.lines, 2);
  const inTest = await read('def test_pager(runner, monkeypatch, tmp_path, capsys, pager):\n    assert runner\n', (tree) => unitsOf(tree, { file: 'tests/test_a.py', isTest: true }));
  assert.equal(inTest[0].params, 0, 'a pytest test names fixtures, which nobody passes');
});

test('debugging left in product code is found, and a test may print', async () => {
  const code = 'import pdb\n\n\ndef f(x):\n    print(x)\n    breakpoint()\n    pdb.set_trace()\n    return x\n';
  const found = await read(code, (tree) => pythonFindings(tree));
  assert.deepEqual(found.map((f) => [f.rule, f.level, f.name, f.line]), [['debug', 'warning', 'print', 5], ['debug', 'violation', 'breakpoint', 6], ['debug', 'violation', 'pdb.set_trace', 7]]);
  assert.deepEqual(await read(code, (tree) => pythonFindings(tree, { test: true })), []);
});

test('catching everything and doing nothing is a violation, passing on one named exception warns, and handling it is neither', async () => {
  const code = 'def f(x):\n    try:\n        return int(x)\n    except:\n        pass\n    try:\n        return int(x)\n    except Exception:\n        ...\n    try:\n        return int(x)\n    except KeyError:\n        pass\n    try:\n        return int(x)\n    except ValueError:\n        return 0\n';
  const found = await read(code, (tree) => pythonFindings(tree));
  assert.deepEqual(found.map((f) => [f.rule, f.level, f.line]), [['swallowed-error', 'violation', 4], ['swallowed-error', 'violation', 8], ['swallowed-error', 'warning', 12]]);
});

test('a module exports what __all__ lists, or else its public functions and classes', async () => {
  const listed = await read("__all__ = ['a', '_b']\n__all__ += ['c']\n\n\ndef a():\n    return 1\n\n\ndef d():\n    return 2\n", exportsOf);
  assert.deepEqual(listed.map((x) => x.name), ['a', 'c']);
  const plain = await read('def a():\n    return 1\n\n\ndef _b():\n    return 2\n\n\nclass C:\n    pass\n\n\n@route\ndef handler():\n    return 3\n', exportsOf);
  assert.deepEqual(plain.map((x) => x.name), ['a', 'C'], 'a leading underscore is private, and a decorated function is registered somewhere');
});

test('a name counts as imported through a relative import, a package import, a module import and a star import', async () => {
  const other = async (file, text) => ({ file, text, imports: await read(text, (tree) => importsOf(tree, file), file) });
  const used = async (file, text) => isImported('src/pkg/util.py', 'helper', [await other(file, text)]);
  assert.equal(await used('src/pkg/main.py', 'from .util import helper\n'), true);
  assert.equal(await used('src/pkg/sub/deep.py', 'from ..util import (\n    other,\n    helper as h,\n)\n'), true);
  assert.equal(await used('src/app.py', 'from pkg.util import helper\n'), true, 'an absolute import matches the end of the path');
  assert.equal(await used('src/app.py', 'from pkg.util import *\n'), true);
  assert.equal(await used('src/app.py', 'import pkg.util\n\nx = pkg.util.helper()\n'), true);
  assert.equal(await used('src/app.py', 'from pkg import util\n\nx = util.helper()\n'), true);
  assert.equal(await used('src/app.py', 'from pkg.util import other\n'), false);
  assert.equal(await used('src/app.py', 'from other.util2 import helper\n'), false);
  assert.equal(await used('src/pkg/sub/deep.py', 'from .util import helper\n'), false, 'a relative import is resolved from the importing file');
});

test('a name from __all__ that is not an identifier is matched literally and does not break the gate', async (t) => {
  const r = repo(t, { 'pkg/__init__.py': '', 'pkg/a.py': 'def one():\n    return 1\n' });
  r.write('pkg/m.py', '__all__ = ["a(b", "c.*"]\n');
  r.write('pkg/use.py', 'import pkg.m\n\nx = pkg.m.cX\n');
  const result = await r.gate();
  assert.deepEqual(result.warnings.filter((w) => w.rule === 'unused-export').map((w) => w.name).sort(), ['a(b', 'c.*'], '"c.*" is not used by pkg.m.cX');
});

function repo(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'somi-gate-python-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir, encoding: 'utf8' });
  const write = (file, text) => { fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); fs.writeFileSync(path.join(dir, file), text); };
  git('init', '-q');
  for (const [f, text] of Object.entries(files)) write(f, text);
  git('add', '-A'); git('commit', '-qm', 'base');
  const gate = (mode = 'project') => { const to = snapshotTree(dir); return qualityGate(dir, { from: git('rev-parse', 'HEAD').trim(), to, limits: DEFAULT_LIMITS, mode, now: '2031-01-01T00:00:00Z', repoFiles: listFiles(dir, to) }); };
  return { dir, git, write, gate };
};

test('a new public function nothing uses is a warning, and one the file itself uses or a test imports is not', async (t) => {
  const r = repo(t, { 'pkg/__init__.py': '', 'pkg/a.py': 'def one():\n    return 1\n', 'tests/test_a.py': 'from pkg.a import one\n' });
  r.write('pkg/a.py', 'def one():\n    return helper() + tested()\n\n\ndef helper():\n    return 1\n\n\ndef tested():\n    return 2\n\n\ndef orphan():\n    return 3\n');
  r.write('tests/test_a.py', 'from pkg.a import one, tested\n');
  const result = await r.gate();
  assert.deepEqual(result.warnings.filter((w) => w.rule === 'unused-export').map((w) => w.name), ['orphan']);
  assert.equal(result.ok, true, 'it warns: in a library the same function is the interface');
});

test('a suppression that names its rule passes in a project and fails in a benchmark, and a bare one fails in both', async (t) => {
  const r = repo(t, { 'pkg/a.py': 'def one():\n    return 1\n' });
  r.write('pkg/a.py', 'import os  # noqa: F401\n\n\ndef one():\n    return 1  # type: ignore[return-value]\n');
  assert.deepEqual((await r.gate()).violations, []);
  assert.equal((await r.gate('benchmark')).violations.filter((v) => v.rule === 'suppression').length, 2);
  r.write('pkg/a.py', 'import os  # noqa\n\n\ndef one():\n    return 1\n');
  assert.deepEqual((await r.gate()).violations.map((v) => v.rule), ['suppression']);
});

test('the whole-codebase report covers Python: a function over a limit, a breakpoint and a copy', async (t) => {
  const copy = (name) => `def ${name}(order, rates, region):\n${Array.from({ length: 14 }, (_, i) => `    order.lines[${i}].total = order.lines[${i}].price * rates[region] + order.lines[${i}].fee - ${i}`).join('\n')}\n    return order\n`;
  const r = repo(t, { 'pkg/a.py': `${copy('price_a')}\n\ndef stop(x):\n    breakpoint()\n    return x\n`, 'pkg/b.py': `${copy('price_b')}\n\ndef many(a, b, c, d, e, f):\n    return a\n` });
  const report = await repoQuality(r.dir, { rev: r.git('rev-parse', 'HEAD').trim(), limits: DEFAULT_LIMITS });
  const rules = new Set(report.violations.map((v) => v.rule));
  for (const rule of ['debug', 'clone', 'params']) assert.ok(rules.has(rule), rule);
  assert.deepEqual(report.unanalyzed, []);
});
