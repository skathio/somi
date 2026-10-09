// SOMI-CANARY-H5-6c2e9a41d7b3f085
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExtra, buildGroups } from './carts.mjs';

const WS = process.env.TASK_WORKSPACE;
const HERE = dirname(fileURLToPath(import.meta.url));
const MODULES = ['rounding', 'discounts', 'shipping', 'tax'];
const GOLDEN = JSON.parse(readFileSync(join(HERE, 'golden.json'), 'utf8'));
const ORIGINAL_TESTS = [
  'tax is added on top in the US', 'in Germany the price already includes the tax', 'SAVE10 takes ten percent off', 'an unknown coupon is reported, not applied',
  'standard shipping is free from 75 in the US', 'yen are whole numbers', 'an empty cart is refused', 'the coupon list is sorted',
];

// The candidate's code runs only in child processes (the harness-owned runner), one per kind of work and each with its own
// time limit, so a hang on one kind of cart fails that kind alone. Results are cached; a timeout is a failure of that call.
const nonce = randomUUID();
const cache = new Map();
function ran(key, args, ms) {
  if (cache.has(key)) return cache.get(key);
  const r = spawnSync(process.execPath, [join(HERE, 'run-pricing.mjs'), nonce, ...args], { cwd: WS, env: process.env, encoding: 'utf8', timeout: ms, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  let data = null;
  try {
    const tag = 'H5:' + nonce + ':';
    data = JSON.parse((r.stdout ?? '').split('\n').reverse().find((l) => l.startsWith(tag)).slice(tag.length));
  } catch { data = null; }
  const got = { timedOut: r.error?.code === 'ETIMEDOUT', data };
  cache.set(key, got);
  return got;
}
const probe = () => {
  const p = ran('probe', ['probe'], 3000);
  assert.ok(!p.timedOut, 'loading the modules timed out');
  assert.ok(p.data && p.data.loaded, 'src/pricing.mjs did not load or does not export quote');
  return p.data;
};
const group = (name) => ran('group:' + name, ['group', name], 2500);
const replayed = (name) => {
  const g = group(name);
  assert.ok(!g.timedOut, 'the carts of this group timed out');
  assert.ok(g.data && g.data.loaded, 'src/pricing.mjs did not load or does not export quote');
  return g.data;
};
const ALL = [...buildGroups(), ...buildExtra()];

// Static reading of the candidate's files (nothing of it is executed here; links are never followed).
const kind = (rel) => { try { const s = lstatSync(join(WS, rel)); return s.isSymbolicLink() ? 'link' : s.isDirectory() ? 'dir' : s.isFile() ? 'file' : 'other'; } catch { return null; } };
const has = (rel) => kind(rel) === 'file';
const read = (rel) => { assert.equal(kind(rel), 'file', rel + ' is not a regular file'); return readFileSync(join(WS, rel), 'utf8'); };
const lineCount = (text) => text.replace(/\n$/, '').split('\n').length;
const noComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
function srcFiles(dir = 'src') {
  if (kind(dir) !== 'dir') return [];
  return readdirSync(join(WS, dir)).flatMap((n) => {
    const rel = dir + '/' + n;
    const k = kind(rel);
    return k === 'dir' ? srcFiles(rel) : k !== null && /\.(mjs|js|cjs)$/.test(n) ? [rel] : [];
  });
}
const needModules = () => { for (const m of MODULES) assert.ok(has('src/' + m + '.mjs'), 'src/' + m + '.mjs does not exist'); };
const importsOf = (rel) => {
  const found = [];
  for (const m of noComments(read(rel)).matchAll(/(?:\bfrom|\bimport)\s*\(?\s*['"`](\.{1,2}\/[^'"`]+)['"`]/g)) found.push(resolve(join(WS, dirname(rel)), m[1]));
  return found;
};
// the text without `ns.` for every `import * as ns from './rounding.mjs'`: a call to a helper of that module is not rounding here
const withoutRoundingNamespaces = (text) => {
  let t = text;
  for (const m of text.matchAll(/import\s*\*\s*as\s+([A-Za-z_$][\w$]*)\s+from\s*['"`]\.{1,2}\/(?:[\w.-]+\/)*rounding(?:\.mjs)?['"`]/g)) t = t.replace(new RegExp('\\b' + m[1].replace(/\$/g, '\\$') + '\\s*\\.\\s*', 'g'), '');
  return t;
};

let testsHung = false; // once the candidate's own test run times out, later runs fail at once instead of waiting again
const nodeTest = (args) => {
  assert.ok(!testsHung, 'an earlier run of the tests timed out');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const r = spawnSync(process.execPath, ['--test', ...args], { cwd: WS, env, encoding: 'utf8', timeout: 12000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024 });
  if (r.error?.code === 'ETIMEDOUT') testsHung = true;
  assert.ok(r.error?.code !== 'ETIMEDOUT', 'the tests timed out');
  return r;
};

for (const m of MODULES) {
  test('AC1 [functional] src/' + m + '.mjs exists and exports at least one function', () => {
    assert.ok(has('src/' + m + '.mjs'), 'src/' + m + '.mjs does not exist');
    assert.ok(probe().modules[m] >= 1, 'src/' + m + '.mjs does not load or exports no function');
  });
}

test('AC2 [functional] src/pricing.mjs only coordinates: at most 120 lines', () => { assert.ok(lineCount(read('src/pricing.mjs')) <= 120, 'src/pricing.mjs has ' + lineCount(read('src/pricing.mjs')) + ' lines'); });
test('AC2 [regression] src/pricing.mjs still exports quote, PricingError, SUPPORTED_CURRENCIES and couponCodes, unchanged', () => {
  const api = probe().api;
  assert.ok(api, 'the exports could not be used');
  for (const [k, t] of [['quote', 'function'], ['PricingError', 'function'], ['SUPPORTED_CURRENCIES', 'object'], ['couponCodes', 'function']]) assert.equal(api.types[k], t, k);
  assert.deepEqual(api.currencies, ['USD', 'EUR', 'GBP', 'JPY']);
  assert.deepEqual(api.coupons, ['BOOKS15', 'FIVEOFF', 'FREESHIP', 'GOLD5', 'SAVE10', 'SAVE20', 'TENOFF', 'WELCOME']);
  assert.deepEqual(api.error, [true, 'PricingError', 'some_code', 'some message']);
});

test('AC3 [boundary] no file under src/ is longer than 200 lines', () => {
  const files = srcFiles();
  assert.ok(files.length >= 5, 'expected the pricing module and at least four others under src/');
  for (const f of files) assert.ok(lineCount(read(f)) <= 200, f + ' has ' + lineCount(read(f)) + ' lines');
});

test('AC4 [boundary] amounts are rounded only in src/rounding.mjs: no other file under src/ uses Math.round or toFixed', () => {
  assert.ok(has('src/rounding.mjs'), 'src/rounding.mjs does not exist');
  for (const f of srcFiles().filter((x) => x !== 'src/rounding.mjs')) assert.ok(!/\bMath\s*\.\s*round\b|\.\s*toFixed\s*\(/.test(withoutRoundingNamespaces(noComments(read(f)))), f + ' rounds amounts itself');
});

test('AC5 [boundary] none of the other modules imports src/pricing.mjs', () => {
  needModules();
  const entry = resolve(join(WS, 'src/pricing.mjs'));
  for (const f of srcFiles().filter((x) => x !== 'src/pricing.mjs')) assert.ok(!importsOf(f).includes(entry), f + ' imports src/pricing.mjs');
});
test('AC5 [boundary] the modules under src/ do not import each other in a circle', () => {
  needModules();
  const graph = new Map(srcFiles().map((f) => [resolve(join(WS, f)), importsOf(f)]));
  const state = new Map();
  const visit = (n, path) => {
    if (state.get(n) === 'done' || !graph.has(n)) return;
    assert.notEqual(state.get(n), 'open', 'import cycle: ' + [...path, n].map((p) => p.slice(WS.length + 1)).join(' -> '));
    state.set(n, 'open');
    for (const d of graph.get(n)) visit(d, [...path, n]);
    state.set(n, 'done');
  };
  for (const n of graph.keys()) visit(n, []);
});

for (const g of buildGroups()) {
  const ac = g.name === 'errors' ? 'AC7' : 'AC6';
  test(ac + ' [regression] quote gives the same answers as before for ' + g.carts.length + ' carts: ' + g.title, () => {
    const r = replayed(g.name);
    for (const { id } of g.carts) assert.deepStrictEqual(r.results[id], GOLDEN[id], id);
  });
}
// Scored apart from the rest (not pooled): obscure, but the original does answer these carts.
for (const g of buildExtra()) {
  test('AC6 [regression] [extra] quote gives the same answers as before for ' + g.carts.length + ' carts: ' + g.title, () => {
    const r = replayed(g.name);
    for (const { id } of g.carts) assert.deepStrictEqual(r.results[id], GOLDEN[id], id);
  });
}

// A group that hung or crashed already fails its own test above; here it is skipped so one defect fails one test.
const liveGroups = () => {
  probe();
  const live = ALL.map((g) => replayed2(g.name)).filter(Boolean);
  assert.ok(live.length > 0, 'no group of carts could be replayed');
  return live;
};
const replayed2 = (name) => { const g = group(name); return !g.timedOut && g.data && g.data.loaded ? g.data : null; };

test('AC8 [regression] quote does not modify the cart it is given, and works on a frozen cart', () => {
  for (const r of liveGroups()) {
    assert.deepEqual(r.mutated, [], 'carts that quote modified: ' + r.mutated.slice(0, 5).join(', '));
    for (const id of Object.keys(r.results)) assert.deepStrictEqual(r.frozen[id], r.results[id], 'frozen ' + id);
  }
});
test('AC8 [regression] the same cart gives the same answer again, in any order of calls', () => {
  for (const r of liveGroups()) for (const id of Object.keys(r.results)) assert.deepStrictEqual(r.again[id], r.results[id], 'second pass ' + id);
});

test('AC9 [regression] the existing tests in test/pricing.test.mjs are all still there and still pass', () => {
  const text = read('test/pricing.test.mjs');
  for (const n of ORIGINAL_TESTS) assert.ok(text.includes(n), 'the existing test "' + n + '" is gone');
  const res = nodeTest(['test/pricing.test.mjs']);
  assert.equal(res.status, 0, 'the existing tests fail: ' + (res.stdout ?? '').slice(-300));
});
for (const m of MODULES) {
  test('AC9 [functional] test/' + m + '.test.mjs exists, tests src/' + m + '.mjs and contains tests', () => {
    const f = 'test/' + m + '.test.mjs';
    assert.ok(has(f), f + ' does not exist');
    const text = noComments(read(f));
    assert.ok(text.includes(m + '.mjs'), f + ' does not import src/' + m + '.mjs');
    assert.ok(/\b(test|it)\s*\(/.test(text), f + ' contains no test');
  });
}
test('AC9 [functional] every test file in test/ passes', () => {
  needModules();
  for (const m of MODULES) assert.ok(has('test/' + m + '.test.mjs'), 'test/' + m + '.test.mjs does not exist');
  const res = nodeTest([]); // what `npm test` runs: node --test, which finds the files under test/
  assert.equal(res.status, 0, 'tests fail: ' + (res.stdout ?? '').slice(-300));
});

test('AC10 [functional] the README names the new modules', () => {
  const text = read('README.md');
  for (const m of MODULES) assert.ok(new RegExp('\\b' + m + '\\.mjs|src/' + m + '\\b|`' + m + '`').test(text), 'README.md does not name ' + m);
});
