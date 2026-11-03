// Writes the L3 large task: a service of forty domains in dollars, and a ticket that moves every one of them to binding decisions, then
// reaches back into all of them at the end. It is big enough to fill a context window, which the smaller large tasks are not.
// Run: node tests/evals/lib/gen-fleet-task.mjs tests/evals/ab/L3-fleet-backoffice
import fs from 'node:fs';
import path from 'node:path';

const CANARY = 'SOMI-CANARY-L3-5d1e7ac94b02f863';
const out = process.argv[2];
if (!out) throw new Error('give the task directory');

// name, verb, unit field, rule [kind, threshold, constant], most units allowed, what the domain is for
const DOMAINS = [
  ['fuel', 'add', 'litres', ['bulk', 40, 10], 500, 'Fuel bought on a company card. Bulk fills earn a discount from the supplier contract.'],
  ['trips', 'log', 'km', ['allowance', 20, 0], 2000, 'Trips charged back to customers. The first stretch of every trip is included in the call-out.'],
  ['tolls', 'record', 'crossings', ['cap', 6, 45.5], 60, 'Road tolls. The operator stops charging once the daily cap is reached.'],
  ['parking', 'add', 'hours', ['minimum', 2, 12.75], 72, 'Parking sessions. The garage bills a minimum, however short the stay.'],
  ['tires', 'register', 'tires', ['surcharge', 4, 18.25], 40, 'Tire replacements. Orders above a set size carry a handling fee.'],
  ['washes', 'log', 'washes', ['tiered', 10, 20], 200, 'Vehicle washes. Washes beyond the monthly block are cheaper.'],
  ['fines', 'record', 'points', ['double', 3, 0], 30, 'Traffic fines. Points beyond the first few cost double, as a deterrent.'],
  ['rentals', 'add', 'days', ['bulk', 7, 15], 90, 'Short-term rentals. A week or longer earns a discount.'],
  ['leases', 'register', 'months', ['tiered', 12, 25], 72, 'Long-term leases. Months past the first year are cheaper.'],
  ['insurance', 'record', 'vehicles', ['minimum', 3, 150.5], 300, 'Insurance premiums. The broker has a minimum premium per policy.'],
  ['repairs', 'log', 'hours', ['surcharge', 8, 35.75], 160, 'Workshop repairs. Long jobs carry a supervisor fee.'],
  ['towing', 'add', 'km', ['allowance', 15, 0], 800, 'Towing. The first stretch of a tow is covered by the callout.'],
  ['permits', 'register', 'permits', ['cap', 5, 88.25], 50, 'City permits. The council caps what one application can cost.'],
  ['storage', 'record', 'pallets', ['tiered', 25, 10], 400, 'Depot storage. Pallets beyond the contracted block are cheaper.'],
  ['ferries', 'log', 'sailings', ['bulk', 12, 20], 150, 'Ferry crossings. A book of sailings earns a discount.'],
  ['radios', 'add', 'units', ['double', 10, 0], 120, 'Radio licences. Units past the base licence cost double.'],
  ['inspections', 'register', 'vehicles', ['minimum', 4, 96.5], 250, 'Safety inspections. The inspector charges a minimum per visit.'],
  ['couriers', 'record', 'parcels', ['surcharge', 30, 22.5], 900, 'Courier runs. Large runs carry a depot fee.'],
  ['training', 'log', 'seats', ['cap', 8, 310.5], 90, 'Driver training. The provider caps a course at a block price.'],
  ['cleaning', 'add', 'cabins', ['allowance', 2, 0], 80, 'Cabin cleaning. The first few cabins are covered by the depot contract.'],
  ['tachographs', 'register', 'units', ['bulk', 15, 5], 180, 'Tachograph calibration. A large batch earns a workshop discount.'],
  ['batteries', 'add', 'packs', ['surcharge', 6, 42.25], 70, 'Battery swaps. Larger orders carry a hazardous goods fee.'],
  ['chargers', 'log', 'sessions', ['tiered', 30, 15], 600, 'Charging sessions. Sessions beyond the monthly block are cheaper.'],
  ['uniforms', 'record', 'sets', ['minimum', 5, 64.5], 120, 'Driver uniforms. The supplier has a minimum order value.'],
  ['telemetry', 'register', 'devices', ['cap', 12, 275.5], 200, 'Telemetry subscriptions. The vendor caps a fleet account.'],
  ['tenders', 'add', 'bids', ['allowance', 1, 0], 25, 'Public tender fees. The first bid in a round carries no fee.'],
  ['customs', 'log', 'declarations', ['double', 4, 0], 50, 'Customs declarations. Beyond the first few, the agent charges double.'],
  ['glass', 'record', 'panes', ['surcharge', 2, 27.75], 24, 'Windscreen repairs. More than a couple on one order adds a callout fee.'],
  ['oil', 'add', 'litres', ['bulk', 60, 8], 900, 'Engine oil. A drum order earns a discount.'],
  ['software', 'register', 'seats', ['tiered', 20, 30], 500, 'Dispatch software. Seats beyond the first block are cheaper.'],
  ['licences', 'log', 'drivers', ['minimum', 2, 58.25], 300, 'Driver licence checks. The agency has a minimum charge.'],
  ['medicals', 'record', 'drivers', ['cap', 9, 412.5], 120, 'Driver medicals. The clinic caps a booking.'],
  ['recovery', 'add', 'callouts', ['double', 2, 0], 30, 'Breakdown recovery. After the included level, callouts cost double.'],
  ['consumables', 'register', 'boxes', ['allowance', 3, 0], 150, 'Workshop consumables. The first few boxes are covered by the contract.'],
  ['bridges', 'log', 'crossings', ['bulk', 25, 12], 400, 'Bridge passes. A book of passes earns a discount.'],
  ['scales', 'record', 'weighings', ['surcharge', 15, 16.5], 240, 'Weighbridge fees. Heavy use in a period adds a service fee.'],
  ['pallets', 'add', 'pallets', ['tiered', 40, 18], 800, 'Pallet hire. Pallets beyond the first block are cheaper.'],
  ['lighting', 'register', 'lamps', ['minimum', 6, 33.75], 110, 'Lamp replacements. The workshop has a minimum job value.'],
  ['audits', 'log', 'sites', ['cap', 3, 725.25], 20, 'Compliance audits. The auditor caps an engagement.'],
  ['shuttles', 'record', 'runs', ['allowance', 5, 0], 300, 'Staff shuttles. The first runs in a roster are included.'],
].map(([name, verb, unit, rule, max, about], i) => ({ i, name, verb, unit, rule, max, about, Cap: name[0].toUpperCase() + name.slice(1) }));
const fns = (d) => ({ add: `${d.verb}${d.Cap}`, void: `void${d.Cap}`, total: `${d.name}Total`, report: `${d.name}Report`, csv: `${d.name}Csv`, month: `${d.name}ByMonth`, price: `price${d.Cap}`, make: `make${d.Cap}Entry` });

// The price of `units` at `rate`, in cents, for the numbers the hidden tests use.
function priceCents(d, units, rate) {
  const [kind, t, k] = d.rule;
  if (kind === 'bulk') return units >= t ? Math.round((units * rate * (100 - k)) / 100) : units * rate;
  if (kind === 'allowance') return Math.max(0, units - t) * rate;
  if (kind === 'cap') return Math.min(units * rate, Math.round(k * 100));
  if (kind === 'minimum') return Math.max(units * rate, Math.round(k * 100));
  if (kind === 'surcharge') return units * rate + (units > t ? Math.round(k * 100) : 0);
  if (kind === 'tiered') return Math.min(units, t) * rate + Math.round((Math.max(0, units - t) * rate * (100 - k)) / 100);
  return Math.min(units, t) * rate + Math.max(0, units - t) * rate * 2;
}
// The same formula as source. `money` turns the dollar constant into what this tree counts in.
function ruleSource(d, money, round) {
  const [kind, t, k] = d.rule; const u = 'units'; const r = 'rate';
  const c = { bulk: [`const BULK_FROM = ${t};`, `const BULK_PERCENT = ${k};`], allowance: [`const INCLUDED = ${t};`], cap: [`const CAP_FROM = ${t};`, `const CAP = ${money(k)};`], minimum: [`const SMALL_JOB = ${t};`, `const MINIMUM = ${money(k)};`], surcharge: [`const FEE_ABOVE = ${t};`, `const FEE = ${money(k)};`], tiered: [`const BLOCK = ${t};`, `const BEYOND_PERCENT_OFF = ${k};`], double: [`const BASE = ${t};`] }[kind];
  const body = {
    bulk: `const gross = ${u} * ${r};\n  return ${u} >= BULK_FROM ? ${round(`gross * (100 - BULK_PERCENT) / 100`)} : ${round('gross')};`,
    allowance: `return ${round(`Math.max(0, ${u} - INCLUDED) * ${r}`)};`,
    cap: `// CAP_FROM is the size the operator expects a capped job to reach. It is advice for the planners and does not change the price.\n  return ${round(`Math.min(${u} * ${r}, CAP)`)};`,
    minimum: `// SMALL_JOB is the size below which dispatch should merge jobs. It does not change the price.\n  return ${round(`Math.max(${u} * ${r}, MINIMUM)`)};`,
    surcharge: `const base = ${u} * ${r};\n  return ${round(`${u} > FEE_ABOVE ? base + FEE : base`)};`,
    tiered: `const inside = Math.min(${u}, BLOCK) * ${r};\n  const beyond = Math.max(0, ${u} - BLOCK) * ${r} * (100 - BEYOND_PERCENT_OFF) / 100;\n  return ${round('inside + beyond')};`,
    double: `const inside = Math.min(${u}, BASE) * ${r};\n  const beyond = Math.max(0, ${u} - BASE) * ${r} * 2;\n  return ${round('inside + beyond')};`,
  }[kind];
  return { constants: c.join('\n'), body };
}

const w = (rel, text) => { const p = path.join(out, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
const store = `export function createStore(now = 0) {
  let t = now;
  let seq = 0;
  return {
    clock: () => t,
    advance: (ms) => { t += ms; },
    nextId: () => \`e\${++seq}\`,
    audit: [],
  };
}
`;
const vendor = `// Maintained by the routing team. Do not edit here: changes come from their repository.
export const DEPOTS = Object.freeze(['north', 'south', 'east', 'west', 'harbour']);
export const isDepot = (name) => DEPOTS.includes(name);
export function haversineKm(a, b) {
  const rad = (x) => (x * Math.PI) / 180;
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}
`;

// ---- the service as it stands: dollars, no tenants, throws, no audit ----
function fixtureDomain(d) {
  const f = fns(d); const { constants, body } = ruleSource(d, (k) => k, (x) => `Math.round((${x}) * 100) / 100`);
  const style = d.i % 3;
  w(`fixture/src/${d.name}/rules.mjs`, `// ${d.about}
// All amounts here are dollars.
${constants}

export function ${f.price}(units, rate) {
  ${body}
}

export function ${d.name}Explained(units, rate) {
  const amount = ${f.price}(units, rate);
  const plain = Math.round(units * rate * 100) / 100;
  return { amount, plain, saved: Math.round((plain - amount) * 100) / 100 };
}

export const ${d.name}Label = (units) => \`\${units} ${d.unit}\`;
`);
  const check = style === 0
    ? `  if (!Number.isInteger(input.${d.unit}) || input.${d.unit} < 1 || input.${d.unit} > MAX_UNITS) throw new RangeError('${d.unit} must be a whole number from 1 to ' + MAX_UNITS);
  if (typeof input.rate !== 'number' || !(input.rate > 0)) throw new RangeError('rate must be a positive number of dollars');`
    : style === 1
      ? `  const problems = [];
  if (!Number.isInteger(input.${d.unit}) || input.${d.unit} < 1 || input.${d.unit} > MAX_UNITS) problems.push('${d.unit}');
  if (typeof input.rate !== 'number' || !(input.rate > 0)) problems.push('rate');
  if (problems.length > 0) throw new RangeError('invalid ' + problems.join(' and '));`
      : `  for (const [field, ok] of [['${d.unit}', Number.isInteger(input.${d.unit}) && input.${d.unit} >= 1 && input.${d.unit} <= MAX_UNITS], ['rate', typeof input.rate === 'number' && input.rate > 0]]) {
    if (!ok) throw new RangeError(field + ' is out of range');
  }`;
  w(`fixture/src/${d.name}/model.mjs`, `// ${d.Cap} entries: what one is made of, and what makes one valid.
export const MAX_UNITS = ${d.max};

export function ${f.make}(id, input, at) {
${check}
  return { id, ${d.unit}: input.${d.unit}, rate: input.rate, note: String(input.note ?? ''), at, amount: 0, voided: false };
}

export const is${d.Cap}Open = (entry) => !entry.voided;
export const is${d.Cap}Large = (entry) => entry.${d.unit} > MAX_UNITS / 2;

export function describe${d.Cap}(entry) {
  const state = entry.voided ? 'void' : 'open';
  return \`\${entry.id}: \${entry.${d.unit}} ${d.unit} at \${entry.rate} (\${state})\`;
}
`);
  const total = style === 0
    ? `  let sum = 0;
  for (const entry of store.${d.name} ?? []) {
    if (!entry.voided) sum += entry.amount;
  }
  return Math.round(sum * 100) / 100;`
    : style === 1
      ? `  const open = (store.${d.name} ?? []).filter((entry) => !entry.voided);
  return Math.round(open.reduce((sum, entry) => sum + entry.amount, 0) * 100) / 100;`
      : `  const amounts = (store.${d.name} ?? []).map((entry) => (entry.voided ? 0 : entry.amount));
  return Math.round(amounts.reduce((a, b) => a + b, 0) * 100) / 100;`;
  w(`fixture/src/${d.name}/service.mjs`, `// ${d.about}
import { ${f.make} } from './model.mjs';
import { ${f.price} } from './rules.mjs';

export function ${f.add}(store, input) {
  const entry = ${f.make}(store.nextId(), input, store.clock());
  entry.amount = ${f.price}(entry.${d.unit}, entry.rate);
  (store.${d.name} ??= []).push(entry);
  return entry;
}

export function ${f.void}(store, id) {
  const entry = (store.${d.name} ?? []).find((e) => e.id === id);
  if (!entry) throw new Error('no such ${d.name} entry: ' + id);
  entry.voided = true;
  return entry;
}

export function ${f.total}(store) {
${total}
}

export function latest${d.Cap}(store, count = 5) {
  return [...(store.${d.name} ?? [])].filter((e) => !e.voided).sort((a, b) => b.at - a.at).slice(0, count);
}

export function largest${d.Cap}(store) {
  let best = null;
  for (const entry of store.${d.name} ?? []) {
    if (!entry.voided && (best === null || entry.amount > best.amount)) best = entry;
  }
  return best;
}
`);
  w(`fixture/src/${d.name}/report.mjs`, `// Reports for people. Amounts print as dollars with two decimals.
const dollars = (amount) => '$' + amount.toFixed(2);

export function ${f.report}(store) {
  const lines = [];
  for (const entry of store.${d.name} ?? []) {
    if (entry.voided) continue;
    lines.push(\`\${entry.id} \${entry.${d.unit}} ${d.unit} \${dollars(entry.amount)}\`);
  }
  return lines;
}

export function ${f.csv}(store) {
  const rows = [['id', '${d.unit}', 'rate', 'amount']];
  for (const entry of store.${d.name} ?? []) rows.push([entry.id, entry.${d.unit}, entry.rate.toFixed(2), entry.amount.toFixed(2)]);
  return rows.map((row) => row.join(',')).join('\\n');
}

export function ${f.month}(store) {
  const months = new Map();
  for (const entry of store.${d.name} ?? []) {
    if (entry.voided) continue;
    const key = new Date(entry.at).toISOString().slice(0, 7);
    months.set(key, Math.round(((months.get(key) ?? 0) + entry.amount) * 100) / 100);
  }
  return Object.fromEntries(months);
}
`);
  const [u, r] = [3, 10];
  w(`fixture/test/${d.name}.test.mjs`, `import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStore } from '../src/store.mjs';
import { ${f.add}, ${f.void}, ${f.total} } from '../src/${d.name}/service.mjs';
import { ${f.report} } from '../src/${d.name}/report.mjs';

test('${d.name}: an entry is priced and counted', () => {
  const store = createStore(1000);
  const entry = ${f.add}(store, { ${d.unit}: ${u}, rate: ${r} });
  assert.equal(entry.amount, ${priceCents(d, u, r * 100) / 100});
  assert.equal(${f.total}(store), ${priceCents(d, u, r * 100) / 100});
});

test('${d.name}: a void entry stops counting', () => {
  const store = createStore(1000);
  const entry = ${f.add}(store, { ${d.unit}: ${u}, rate: ${r} });
  ${f.void}(store, entry.id);
  assert.equal(${f.total}(store), 0);
  assert.deepEqual(${f.report}(store), []);
});

test('${d.name}: too many ${d.unit} is refused', () => {
  const store = createStore(1000);
  assert.throws(() => ${f.add}(store, { ${d.unit}: ${d.max + 1}, rate: ${r} }), RangeError);
});
`);
}

// ---- two independent solutions, one with everything inline and one through a shared helper ----
function solution(tree, d) {
  const f = fns(d); const shared = tree === 'oracle2';
  const { constants, body } = ruleSource(d, (k) => Math.round(k * 100), (x) => `Math.round(${x})`);
  w(`${tree}/src/${d.name}/rules.mjs`, `// ${CANARY}\n${constants}\nexport function ${f.price}(units, rate) {\n  ${body}\n}\n`);
  w(`${tree}/src/${d.name}/model.mjs`, `// ${CANARY}\nexport const MAX_UNITS = ${d.max};\nexport const valid${d.Cap} = (input) => Number.isInteger(input?.${d.unit}) && input.${d.unit} >= 1 && input.${d.unit} <= MAX_UNITS && Number.isInteger(input.rate) && input.rate > 0;\n`);
  const helper = shared ? `import { fail, ok, note } from '../shared.mjs';\n` : `const ok = (value) => ({ ok: true, value });\nconst fail = (code) => ({ ok: false, error: { code } });\nconst note = (store, type, id) => { store.audit.push({ type, at: store.clock(), id }); };\n`;
  w(`${tree}/src/${d.name}/service.mjs`, `// ${CANARY}
import { valid${d.Cap} } from './model.mjs';
import { ${f.price} } from './rules.mjs';
${helper}
export function ${f.add}(store, tenantId, input) {
  if (!valid${d.Cap}(input)) return fail('invalid');
  const entry = { id: store.nextId(), tenantId, ${d.unit}: input.${d.unit}, rate: input.rate, at: store.clock(), amount: ${f.price}(input.${d.unit}, input.rate), voided: false };
  (store.${d.name} ??= []).push(entry);
  note(store, '${d.name}.added', entry.id);
  return ok(entry);
}
export function ${f.void}(store, tenantId, id) {
  const entry = (store.${d.name} ?? []).find((e) => e.id === id && e.tenantId === tenantId);
  if (!entry) return fail('not_found');
  if (entry.voided) return fail('already_void');
  entry.voided = true;
  note(store, '${d.name}.voided', entry.id);
  return ok(entry);
}
export function ${f.total}(store, tenantId) {
  return (store.${d.name} ?? []).filter((e) => e.tenantId === tenantId && !e.voided).reduce((sum, e) => sum + e.amount, 0);
}
`);
  w(`${tree}/src/${d.name}/report.mjs`, `// ${CANARY}\nexport function ${f.report}(store, tenantId) {\n  return (store.${d.name} ?? []).filter((e) => e.tenantId === tenantId && !e.voided).map((e) => \`\${e.id} \${e.${d.unit}} ${d.unit} $\${(e.amount / 100).toFixed(2)}\`);\n}\n`);
  w(`${tree}/test/${d.name}.test.mjs`, `// ${CANARY}\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { createStore } from '../src/store.mjs';\nimport { ${f.add} } from '../src/${d.name}/service.mjs';\ntest('${d.name} prices in cents', () => { assert.equal(${f.add}(createStore(1), 't', { ${d.unit}: 1, rate: 100 }).ok, true); });\n`);
}

// ---- the hidden tests: the same eight for each domain, so the score shows where along the ticket the decisions wore off ----
const units = (d) => ({ low: 1, high: d.rule[1] + 2 });
const table = DOMAINS.map((d) => {
  const f = fns(d); const { low, high } = units(d); const rate = 1000;
  return { m: `M${String(d.i + 1).padStart(2, '0')}`, mod: d.name, unit: d.unit, max: d.max, add: f.add, void: f.void, total: f.total, report: f.report, low, high, rate, lowAmount: priceCents(d, low, rate), highAmount: priceCents(d, high, rate) };
});
const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const cases = `// ${CANARY}
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const WS = () => process.env.TASK_WORKSPACE;
const DOMAINS = ${JSON.stringify(table, null, 0)};
async function W(l, d) {
  const [{ createStore }, service, report] = await Promise.all([l('src/store.mjs'), l(\`src/\${d.mod}/service.mjs\`), l(\`src/\${d.mod}/report.mjs\`)]);
  const store = createStore(1700000000000);
  const add = (tenant, count, rate = d.rate) => service[d.add](store, tenant, { [d.unit]: count, rate });
  return { store, add, void: (t, id) => service[d.void](store, t, id), total: (t) => service[d.total](store, t), report: (t) => report[d.report](store, t) };
}
const dollars = (c) => '$' + (c / 100).toFixed(2);
const forDomain = (d) => [
  { name: \`\${d.m} \${d.mod} [functional] an entry is priced in whole cents\`, run: async (l) => (await W(l, d)).add('t1', d.low).value.amount, expect: d.lowAmount },
  { name: \`\${d.m} \${d.mod} [boundary] its pricing rule still holds past the threshold, in cents\`, run: async (l) => (await W(l, d)).add('t1', d.high).value.amount, expect: d.highAmount },
  { name: \`\${d.m} \${d.mod} [decision] bad input fails as a value, including a fractional rate\`, run: async (l) => { const x = await W(l, d); return [x.add('t1', d.max + 1).error.code, x.add('t1', 1, 10.5).error.code]; }, expect: ['invalid', 'invalid'] },
  { name: \`\${d.m} \${d.mod} [decision] another tenant's entry is not found, and stays as it was\`, run: async (l) => { const x = await W(l, d); const e = x.add('t1', d.low).value; return [x.void('t2', e.id).error.code, x.total('t1')]; }, expect: ['not_found', d.lowAmount] },
  { name: \`\${d.m} \${d.mod} [decision] adding and voiding are both in the audit log\`, run: async (l) => { const x = await W(l, d); const e = x.add('t1', d.low).value; x.void('t1', e.id); return x.store.audit.map((a) => [typeof a.type, a.at, a.id]); }, expect: [['string', 1700000000000, 'e1'], ['string', 1700000000000, 'e1']] },
  { name: \`\${d.m} \${d.mod} [functional] the total counts one tenant and no void entries, as an integer\`, run: async (l) => { const x = await W(l, d); x.add('t1', d.low); const v = x.add('t1', d.low).value; x.add('t2', d.low); x.void('t1', v.id); return x.total('t1'); }, expect: d.lowAmount },
  { name: \`\${d.m} \${d.mod} [functional] the report prints dollars, for one tenant\`, run: async (l) => { const x = await W(l, d); x.add('t1', d.high); const a = x.report('t1'); const b = x.report('t2'); return [a.length, a[0].includes(dollars(d.highAmount)), b.length]; }, expect: [1, true, 0] },
  { name: \`\${d.m} \${d.mod} [functional] voiding twice fails with already_void\`, run: async (l) => { const x = await W(l, d); const e = x.add('t1', d.low).value; x.void('t1', e.id); return x.void('t1', e.id).error.code; }, expect: 'already_void' },
];
export const cases = [
  ...DOMAINS.flatMap(forDomain),
  { name: 'M00 [regression] the vendor folder is untouched', run: async () => createHash('sha256').update(readFileSync(\`\${WS()}/src/vendor/geo.mjs\`)).digest('hex').slice(0, 12), expect: '${''}__VENDOR__' },
  { name: 'M00 [regression] no dependency was added', run: async () => { const p = JSON.parse(readFileSync(\`\${WS()}/package.json\`, 'utf8')); return Object.keys({ ...p.dependencies, ...p.devDependencies }).length; }, expect: 0 },
  { name: 'M22 [functional] the decisions are in the README', run: async () => /cents/i.test(readFileSync(\`\${WS()}/README.md\`, 'utf8')) && /tenant/i.test(readFileSync(\`\${WS()}/README.md\`, 'utf8')), expect: true },
];
`;

// ---- write it ----
fs.rmSync(out, { recursive: true, force: true });
const vendorHash = (await import('node:crypto')).createHash('sha256').update(vendor).digest('hex').slice(0, 12);
// A solution is laid over the fixture, so it holds only what it changes.
w('fixture/package.json', `${JSON.stringify({ name: 'fleet-backoffice', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`);
w('fixture/src/store.mjs', store);
w('fixture/src/vendor/geo.mjs', vendor);
w('fixture/README.md', '# Fleet back office\n\nOne service for everything a fleet pays for. Each domain lives in its own folder under `src/`.\n');
const readme = `# Fleet back office\n\n${CANARY}\n\nMoney is whole cents. Everything belongs to a tenant. Failures are values, and changes are audited.\n`;
w('oracle/README.md', readme); w('oracle2/README.md', readme);
w('oracle2/src/shared.mjs', `// ${CANARY}\nexport const ok = (value) => ({ ok: true, value });\nexport const fail = (code) => ({ ok: false, error: { code } });\nexport function note(store, type, id) { store.audit.push({ type, at: store.clock(), id }); }\n`);
for (const d of DOMAINS) { fixtureDomain(d); solution('oracle', d); solution('oracle2', d); }
w('hidden/cases.mjs', cases.replace('__VENDOR__', vendorHash));
w('hidden/run.mjs', `// ${CANARY}
import { cases } from './cases.mjs';

const [, , name, nonce] = process.argv;
process.on('uncaughtException', () => {});
process.on('unhandledRejection', () => {});
const load = (file) => import(process.env.TASK_WORKSPACE + '/' + file);
let out;
try { out = { value: await cases.find((c) => c.name === name).run(load) }; } catch (e) { out = { threw: String(e?.code ?? e?.name ?? 'Error') }; }
process.stdout.write('\\n@@' + nonce + '@@' + JSON.stringify(out) + '\\n');
process.exit(0);
`);
w('hidden/task.test.mjs', `// ${CANARY}
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cases } from './cases.mjs';

// Candidate code only ever runs in a harness-owned child. This process compares the JSON it reports.
const runner = fileURLToPath(new URL('./run.mjs', import.meta.url));
for (const c of cases) {
  test(c.name, () => {
    const nonce = randomUUID();
    const r = spawnSync(process.execPath, [runner, c.name, nonce], { cwd: process.env.TASK_WORKSPACE, env: process.env, encoding: 'utf8', timeout: 15000, killSignal: 'SIGKILL', maxBuffer: 1 << 22 });
    const m = new RegExp('@@' + nonce + '@@(.*)').exec(r.stdout ?? '');
    assert.ok(m, 'the runner reported nothing');
    assert.deepEqual(JSON.parse(m[1]), { value: c.expect });
  });
}
`);
const statements = [
  'This is a long piece of work on the fleet back office. Do the milestones in order and keep everything working as you go. The decisions below are binding on all of them, including the last.',
  'Decision A: money is whole cents in integers in every function, field and test, including each rate you are passed and every constant in a pricing rule. A rate that is not a positive whole number is invalid. Only report lines and CSV text print dollars, with two decimals.',
  'Decision B: every function that adds or voids returns { ok: false, error: { code } } for a business failure and never throws for one. On success it returns { ok: true, value }, where value is the entry. Bad input has the code invalid.',
  'Decision C: everything belongs to a tenant. Each service and report function takes tenantId as its second argument, right after store, and an entry records it as tenantId. An entry of another tenant behaves as if it did not exist, with the code not_found. Totals and reports count only the given tenant.',
  'Decision D: every add and every void appends one entry to store.audit, shaped { type, at, id }, where at comes from store.clock() and id is the entry\'s id. A failed operation appends nothing.',
  'Decision E: no new dependencies, and src/vendor/ must not change, because another team owns it. Keep each domain\'s function names, its pricing rule and its limits, moved to cents.',
  ...DOMAINS.map((d) => { const f = fns(d); return `Milestone ${d.i + 1}: move src/${d.name}/ and test/${d.name}.test.mjs to the decisions: ${f.add}(store, tenantId, { ${d.unit}, rate }), ${f.void}(store, tenantId, id), ${f.total}(store, tenantId), ${f.report}(store, tenantId), and the rest of the folder.`; }),
  `Milestone ${DOMAINS.length + 1}: voiding an entry that is already void now fails with the code already_void and changes nothing, in every domain. Add that to each domain's test file.`,
  `Milestone ${DOMAINS.length + 2}: describe the decisions in the README, including the words cents and tenant.`,
];
w('task.json', `${JSON.stringify({ schema_version: 1, statements, runner: 'node-test', canary: CANARY, source: ['src/'], test_dir: 'test', root_files: ['README.md'], brief: 'Carry out the numbered milestones on the fleet back office in order. The decisions are binding throughout. Follow the conventions already in the code.' }, null, 1)}\n`);
// One mutant per kind of mistake, early and late, so a test that cannot see a late domain would be caught.
const pick = (i) => DOMAINS[i];
const mutants = [
  { name: 'early-rule-constant-left-in-dollars', file: 'src/tolls/rules.mjs', find: `const CAP = ${Math.round(pick(2).rule[2] * 100)};`, replace: `const CAP = ${pick(2).rule[2]};` },
  { name: 'late-rule-constant-left-in-dollars', file: 'src/couriers/rules.mjs', find: `const FEE = ${Math.round(pick(17).rule[2] * 100)};`, replace: `const FEE = ${pick(17).rule[2]};` },
  { name: 'early-tenant-not-checked', file: 'src/fuel/service.mjs', find: 'e.id === id && e.tenantId === tenantId', replace: 'e.id === id' },
  { name: 'late-tenant-not-checked', file: 'src/cleaning/service.mjs', find: 'e.id === id && e.tenantId === tenantId', replace: 'e.id === id' },
  { name: 'late-void-not-audited', file: 'src/training/service.mjs', find: `  note(store, 'training.voided', entry.id);\n`, replace: '' },
  { name: 'late-add-not-audited', file: 'src/radios/service.mjs', find: `  note(store, 'radios.added', entry.id);\n`, replace: '' },
  { name: 'late-void-twice-allowed', file: 'src/ferries/service.mjs', find: `  if (entry.voided) return fail('already_void');\n`, replace: '' },
  { name: 'late-total-counts-void', file: 'src/storage/service.mjs', find: 'e.tenantId === tenantId && !e.voided', replace: 'e.tenantId === tenantId' },
  { name: 'fractional-rate-accepted', file: 'src/towing/model.mjs', find: 'Number.isInteger(input.rate) && input.rate > 0', replace: 'input.rate > 0' },
  { name: 'report-prints-cents', file: 'src/permits/report.mjs', find: '(e.amount / 100).toFixed(2)', replace: 'e.amount.toFixed(2)' },
  { name: 'report-other-tenants', file: 'src/washes/report.mjs', find: 'e.tenantId === tenantId && !e.voided', replace: '!e.voided' },
];
fs.writeFileSync(`${out}.mutants.json`, `${JSON.stringify(mutants, null, 1)}\n`);
