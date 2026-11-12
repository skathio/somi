// The quality gate's advice on hastily written code, in what a change added: swallowed and pointless catches, focused and skipped
// tests, tests that assert nothing, debugging left in, names nothing reads, and functions that only pass their arguments on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreSlop } from '../scripts/lib/quality/slop.mjs';
import { parseSource } from '../scripts/lib/quality/parse.mjs';

const EVERY_LINE = [[1, 1e9]];
async function slop(code, { file = 'src/a.js', test = false, added = EVERY_LINE } = {}) {
  const parsed = await parseSource(file, code);
  const ctx = { mode: 'project', violations: [], warnings: [] };
  try { scoreSlop(ctx, { file, tree: parsed.tree, added, language: parsed.language, test }); } finally { parsed.tree.delete(); }
  return [...ctx.violations, ...ctx.warnings].map((f) => `${f.rule}:${f.line}${f.name ? `:${f.name}` : ''}`);
}

test('a catch that swallows, only logs or rethrows unchanged is named, and one that says why or handles the error is not', async () => {
  const code = [
    'export function a() { try { run(); } catch {} }',
    'export function b() { try { run(); } catch (e) { /* a missing file is the normal case */ } }',
    'export function c() { try { run(); } catch (e) { console.error(e); } }',
    'export function d() { try { run(); } catch (e) { throw e; } }',
    'export function e() { try { run(); } catch (err) { throw new Error(`run failed: ${err.message}`, { cause: err }); } }',
    'export function f() { try { run(); } catch (e) { logger.warn(e); return null; } }',
  ].join('\n');
  assert.deepEqual(await slop(code), ['empty-catch:1', 'log-only-catch:3', 'rethrow-catch:4']);
  const cs = 'class C {\n  void A() { try { Run(); } catch (Exception e) { throw; } }\n  void B() { try { Run(); } catch (Exception e) { throw e; } }\n  void D() { try { Run(); } catch (Exception) { } }\n}\n';
  assert.deepEqual(await slop(cs, { file: 'src/C.cs' }), ['rethrow-catch:2', 'rethrow-catch:3', 'empty-catch:4']);
});

test('a focused or skipped test and a test that asserts nothing are named in a test file', async () => {
  const code = [
    "describe.only('a', () => {",
    "  it('checks', () => { expect(sum(1, 2)).toBe(3); });",
    "  it.skip('later', () => { expect(1).toBe(1); });",
    "  it('runs', () => { sum(1, 2); });",
    "  test('node', (t) => { t.equal(sum(1, 2), 3); });",
    "  test('assert', async () => { assert.deepEqual(await load(), []); });",
    "  xit('old', () => {});",
    '});',
  ].join('\n');
  assert.deepEqual(await slop(code, { file: 'src/a.test.js', test: true }), ['focused-test:1', 'skipped-test:3', 'test-without-assertion:4', 'skipped-test:7']);
});

test('debugging left in product code is named, and console.error is not', async () => {
  assert.deepEqual(await slop('export function a(x) {\n  console.log(x);\n  debugger;\n  console.error(x);\n  return x;\n}\n'), ['console:2', 'debugger:3']);
});

test('a local nothing reads and the parameters after the last one read are unused, and only on added lines', async () => {
  const code = [
    'export function handler(req, res, next) {',
    '  const unused = 1;',
    '  const kept = req.body;',
    '  const _ignored = 2;',
    '  return res.send(kept);',
    '}',
    'export function placeholder(_a, b) { return b; }',
    'export function legacy(x, y) { return arguments.length; }',
    'export const nested = (a) => () => a;',
  ].join('\n');
  assert.deepEqual(await slop(code), ['unused-binding:1:next', 'unused-binding:2:unused']);
  assert.deepEqual(await slop(code, { added: [[3, 9]] }), [], 'lines the change did not add are not its doing');
});

test('a function that only passes its own parameters on to another is named, and one that changes them is not', async () => {
  const code = [
    'export function getUser(id) { return fetchUser(id); }',
    'export const save = async (a, b) => await store.save(a, b);',
    'export function getUserName(id) { return fetchUser(id).name; }',
    'export function swap(a, b) { return pair(b, a); }',
    'export function now() { return Date.now(); }',
    'class A extends B { constructor(x) { super(x); } }',
    'items.map((x) => format(x));',
  ].join('\n');
  assert.deepEqual(await slop(code), ['pass-through:1', 'pass-through:2']);
});
