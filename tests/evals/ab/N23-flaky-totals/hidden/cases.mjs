// SOMI-CANARY-N23-a087c4c53cbe8bd5
const rows = [{ region: 'eu', currency: 'EUR', cents: 100 }, { region: 'eu', currency: 'GBP', cents: 100 }, { region: 'eu', currency: 'EUR', cents: 100 }, { region: 'us', currency: 'USD', cents: 50 }, { region: 'asia', currency: 'GBP', cents: 200 }];
const RATE = { EUR: 1.5, GBP: 2, USD: 1 };
const slow = (delays) => async (c) => { await new Promise((r) => setTimeout(r, delays[c] ?? 1)); return RATE[c]; };
const T = (l) => l('src/totals.mjs');
const sorted = (list) => [...list].sort((a, b) => (a.region < b.region ? -1 : 1));
export const cases = [
  { name: 'AC2 [functional] every row of a region is counted', run: async (l) => sorted(await (await T(l)).regionTotals(rows, slow({}))), expect: [{ region: 'asia', total: 400 }, { region: 'eu', total: 500 }, { region: 'us', total: 50 }] },
  { name: 'AC2 [functional] slow rates in any order give the same totals', run: async (l) => { const m = await T(l); const a = sorted(await m.regionTotals(rows, slow({ EUR: 15, GBP: 1 }))); const b = sorted(await m.regionTotals(rows, slow({ EUR: 1, GBP: 15 }))); return [a, JSON.stringify(a) === JSON.stringify(b)]; }, expect: [[{ region: 'asia', total: 400 }, { region: 'eu', total: 500 }, { region: 'us', total: 50 }], true] },
  { name: 'AC2 [boundary] the answer comes in the same order however the rates arrive', run: async (l) => { const m = await T(l); const a = await m.regionTotals(rows, slow({ EUR: 15, GBP: 1, USD: 8 })); const b = await m.regionTotals(rows, slow({ EUR: 1, GBP: 15, USD: 8 })); const c = await m.regionTotals(rows, slow({ EUR: 8, GBP: 8, USD: 1 })); return JSON.stringify(a) === JSON.stringify(b) && JSON.stringify(b) === JSON.stringify(c); }, expect: true },
  { name: 'AC2 [functional] ranking does not disturb the shared list', run: async (l) => { const m = await T(l); const list = [{ region: 'a', total: 1 }, { region: 'b', total: 3 }, { region: 'c', total: 2 }]; m.topRegions(list, 1); return list.map((r) => r.region); }, expect: ['a', 'b', 'c'] },
  { name: 'AC2 [boundary] ties come in name order', run: async (l) => (await T(l)).topRegions([{ region: 'c', total: 5 }, { region: 'a', total: 5 }, { region: 'b', total: 5 }, { region: 'd', total: 9 }], 3).map((r) => r.region), expect: ['d', 'a', 'b'] },
  { name: 'AC2 [boundary] ties in any starting order give the same ranking', run: async (l) => { const m = await T(l); const r = (o) => m.topRegions(o, 3).map((x) => x.region).join(); return r([{ region: 'b', total: 5 }, { region: 'a', total: 5 }, { region: 'c', total: 5 }]) === 'a,b,c' && r([{ region: 'c', total: 5 }, { region: 'b', total: 5 }, { region: 'a', total: 5 }]) === 'a,b,c'; }, expect: true },
  { name: 'AC3 [regression] a limit bigger than the list is fine', run: async (l) => (await T(l)).topRegions([{ region: 'a', total: 1 }], 5).length, expect: 1 },
  { name: 'AC3 [regression] no rows give no totals', run: async (l) => (await T(l)).regionTotals([], async () => 1), expect: [] },
  { name: 'AC2 [regression] no dependency was added', run: async (l) => { const { readFileSync } = await import('node:fs'); const pkg = JSON.parse(readFileSync(process.env.TASK_WORKSPACE + '/package.json', 'utf8')); return [Object.keys(pkg.dependencies ?? {}).length, (await T(l)).topRegions([{ region: 'b', total: 1 }, { region: 'a', total: 1 }], 1)[0].region]; }, expect: [0, 'a'] },
];
