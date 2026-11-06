// SOMI-CANARY-N32-253539dea3f36411
const NOW = Date.UTC(2026, 0, 1, 12, 0, 0);
function world(script) { let t = NOW; const waits = []; let calls = 0; return { deps: { clock: () => t, sleep: async (ms) => { waits.push(ms); t += ms; }, http: async () => { const r = script(calls++); return { headers: {}, body: 'b', ...r }; } }, waits, calls: () => calls }; }
const go = (script, request = { method: 'GET', url: 'u' }) => async (l) => { const w = world(script); const r = await (await l('src/client.mjs')).send(request, w.deps); return { status: r.status, waits: w.waits, calls: w.calls() }; };
const busy = (n, headers) => (i) => (i < n ? { status: 429, headers } : { status: 200 });
export const cases = [
  { name: 'AC1 [functional] it waits the seconds it is told', run: go(busy(1, { 'retry-after': '7' })), expect: { status: 200, waits: [7000], calls: 2 } },
  { name: 'AC1 [functional] 503 is retried too', run: go((i) => (i === 0 ? { status: 503, headers: { 'retry-after': '1' } } : { status: 200 })), expect: { status: 200, waits: [1000], calls: 2 } },
  { name: 'AC1 [boundary] the header can also be a date', run: go(busy(1, { 'retry-after': new Date(NOW + 30000).toUTCString() })), expect: { status: 200, waits: [30000], calls: 2 } },
  { name: 'AC1 [boundary] a date already past means go now', run: go(busy(1, { 'retry-after': new Date(NOW - 30000).toUTCString() })), expect: { status: 200, waits: [0], calls: 2 } },
  { name: 'AC1 [functional] with no header it backs off and doubles', run: go(busy(3)), expect: { status: 200, waits: [1000, 2000, 4000], calls: 4 } },
  { name: 'AC1 [boundary] five tries in all, then the last answer', run: go(() => ({ status: 429 })), expect: { status: 429, waits: [1000, 2000, 4000, 8000], calls: 5 } },
  { name: 'AC1 [regression] a POST is not repeated', run: go(() => ({ status: 503 }), { method: 'POST', url: 'u' }), expect: { status: 503, waits: [], calls: 1 } },
  { name: 'AC1 [boundary] a POST with an idempotency key is repeated', run: go(busy(1), { method: 'POST', url: 'u', headers: { 'idempotency-key': 'k' } }), expect: { status: 200, waits: [1000], calls: 2 } },
  { name: 'AC1 [regression] a wait past the total limit stops at once', run: go(busy(1, { 'retry-after': '61' })), expect: { status: 429, waits: [], calls: 1 } },
  { name: 'AC1 [boundary] the limit counts every wait', run: go((i) => (i < 3 ? { status: 429, headers: { 'retry-after': '25' } } : { status: 200 })), expect: { status: 429, waits: [25000, 25000], calls: 3 } },
  { name: 'AC2 [regression] another failure comes back as it is', run: go(() => ({ status: 500 })), expect: { status: 500, waits: [], calls: 1 } },
  { name: 'AC3 [regression] a healthy call goes once', run: async (l) => { const w = world(() => ({ status: 200 })); await (await l('src/client.mjs')).send({ method: 'GET' }, { ...w.deps, sleep: w.deps.sleep }); return w.calls(); }, expect: 1 },
];
