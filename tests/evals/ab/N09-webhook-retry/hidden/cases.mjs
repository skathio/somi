// SOMI-CANARY-N09-0d11aeb1872d1109
import { createHmac } from 'node:crypto';

const SECRET = 'whsec';
function world(script) {
  let now = 1000000000; const sent = [];
  const http = { post: async (url, req) => { sent.push({ ...req, at: now }); const step = script(sent.length); if (step === 'down') throw new Error('unreachable'); return { status: step }; } };
  return { http, clock: () => now, secret: SECRET, sent, advance: (ms) => { now += ms; } };
}
const setup = async (l, w) => { const { enqueue } = await l('src/enqueue.mjs'); const queue = { events: [], dead: [] }; enqueue(queue, { id: 'e1', url: 'u', payload: { b: 1, a: [2] } }, w); return queue; };
const valid = (d) => { const m = /^t=(\d+),v1=([0-9a-f]+)$/.exec(d.headers['x-signature']); if (!m) return false; const fresh = Math.abs(Number(m[1]) * 1000 - d.at) <= 300000; return fresh && m[2] === createHmac('sha256', SECRET).update(`${m[1]}.${d.body}`).digest('hex'); };
const Dr = async (l, q, w) => (await l('src/deliver.mjs')).drain(q, w);
const fails = async (l, w, q, n, gap) => { for (let i = 0; i < n; i++) { await Dr(l, q, w); w.advance(gap(i)); } };
const min = 60000;
export const cases = [
  { name: 'AC1 [functional] a failed delivery tries again once the wait has passed', run: async (l) => { const w = world((n) => (n === 1 ? 500 : 200)); const q = await setup(l, w); await Dr(l, q, w); w.advance(min); await Dr(l, q, w); return { sent: w.sent.length, left: q.events.length, dead: q.dead.length }; }, expect: { sent: 2, left: 0, dead: 0 } },
  { name: 'AC1 [functional] an unreachable endpoint is a failure and the rest still go', run: async (l) => { const w = world((n) => (n === 1 ? 'down' : 200)); const { enqueue } = await l('src/enqueue.mjs'); const q = await setup(l, w); enqueue(q, { id: 'e2', url: 'u', payload: {} }, w); await Dr(l, q, w); return { sent: w.sent.length, ids: q.events.map((e) => e.id) }; }, expect: { sent: 2, ids: ['e1'] } },
  { name: 'AC2 [boundary] nothing is sent before the wait is over', run: async (l) => { const w = world(() => 500); const q = await setup(l, w); await Dr(l, q, w); w.advance(min - 1); await Dr(l, q, w); const early = w.sent.length; w.advance(1); await Dr(l, q, w); return [early, w.sent.length]; }, expect: [1, 2] },
  { name: 'AC2 [functional] the wait doubles', run: async (l) => { const w = world(() => 500); const q = await setup(l, w); await Dr(l, q, w); w.advance(min); await Dr(l, q, w); w.advance(2 * min - 1); await Dr(l, q, w); const early = w.sent.length; w.advance(1); await Dr(l, q, w); return [early, w.sent.length]; }, expect: [2, 3] },
  { name: 'AC2 [functional] after five failures it moves to dead and stops', run: async (l) => { const w = world(() => 500); const q = await setup(l, w); await fails(l, w, q, 8, () => 60 * min); return { sent: w.sent.length, events: q.events.length, dead: q.dead.map((e) => e.id) }; }, expect: { sent: 5, events: 0, dead: ['e1'] } },
  { name: 'AC3 [functional] a refusal goes to dead at once', run: async (l) => { const w = world(() => 410); const q = await setup(l, w); await fails(l, w, q, 3, () => 60 * min); return { sent: w.sent.length, dead: q.dead.length }; }, expect: { sent: 1, dead: 1 } },
  { name: 'AC3 [boundary] 429 means try later', run: async (l) => { const w = world((n) => (n === 1 ? 429 : 200)); const q = await setup(l, w); await fails(l, w, q, 2, () => min); return { sent: w.sent.length, dead: q.dead.length, left: q.events.length }; }, expect: { sent: 2, dead: 0, left: 0 } },
  { name: 'AC4 [safety] a retry long after queueing still passes the customer check', run: async (l) => { const w = world((n) => (n < 4 ? 500 : 200)); const q = await setup(l, w); await fails(l, w, q, 4, () => 60 * min); return w.sent.map(valid); }, expect: [true, true, true, true] },
  { name: 'AC4 [safety] an event that waited in the queue is signed when it goes', run: async (l) => { const w = world(() => 200); const q = await setup(l, w); w.advance(10 * min); await Dr(l, q, w); return valid(w.sent[0]); }, expect: true },
  { name: 'AC4 [boundary] every attempt has the same body bytes and event id', run: async (l) => { const w = world((n) => (n < 3 ? 500 : 200)); const q = await setup(l, w); await fails(l, w, q, 3, () => 60 * min); return { sent: w.sent.length, bodies: [...new Set(w.sent.map((s) => s.body))], ids: [...new Set(w.sent.map((s) => s.headers['x-event-id']))] }; }, expect: { sent: 3, bodies: ['{"b":1,"a":[2]}'], ids: ['e1'] } },
  { name: 'AC5 [regression] a healthy delivery goes once', run: async (l) => { const w = world(() => 200); const q = await setup(l, w); await Dr(l, q, w); return { sent: w.sent.length, body: w.sent[0].body }; }, expect: { sent: 1, body: '{"b":1,"a":[2]}' } },
];
