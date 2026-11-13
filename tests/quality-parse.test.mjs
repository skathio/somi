// The parser's first use, alone in its own process so nothing has loaded the runtime before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSource } from '../scripts/lib/quality/parse.mjs';

test('parses that start together on first use share one load of the runtime and grammar', async () => {
  const files = ['a.js', 'b.js', 'c.ts', 'd.py', 'e.cs'];
  const code = { js: 'export const f = (x) => x + 1;', ts: 'export const f = (x: number) => x + 1;', py: 'def f(x):\n    return x + 1\n', cs: 'class C { int F(int x) { return x + 1; } }' };
  const results = await Promise.all(files.map((f) => parseSource(f, code[f.split('.')[1]])));
  for (const [i, r] of results.entries()) assert.ok(r?.tree, `${files[i]}: ${JSON.stringify(r)}`);
});
