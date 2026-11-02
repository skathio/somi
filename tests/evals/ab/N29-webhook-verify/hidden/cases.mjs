// SOMI-CANARY-N29-76d22d6616b79c6c
import { createHmac } from 'node:crypto';

const NOW = 1000000000000; const T = Math.floor(NOW / 1000);
const sig = (body, t = T, secret = 'k1') => createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${t}.`), body])).digest('hex');
const B = (o = { id: 'e1', type: 'paid' }) => Buffer.from(JSON.stringify(o));
const H = (s) => ({ 'x-pay-signature': s });
const D = (over = {}) => ({ secrets: ['k1'], clock: () => NOW, seen: new Map(), ...over });
const V = (l) => l('src/inbound.mjs');
const code = (f) => { try { f(); return null; } catch (e) { return e.code ?? ('crash:' + e.name); } };
const bad = (headerOf, body = B()) => async (l) => { const m = await V(l); const d = D(); return { c: code(() => m.verifyWebhook(body, H(headerOf(body)), d)), seen: d.seen.size }; };
const no = { c: 'bad_signature', seen: 0 };
export const cases = [
  { name: 'AC1 [functional] a good delivery gives the event', run: async (l) => (await V(l)).verifyWebhook(B(), H(`t=${T},v1=${sig(B())}`), D()), expect: { id: 'e1', type: 'paid' } },
  { name: 'AC1 [boundary] the bytes are verified as sent, not as re-encoded', run: async (l) => { const body = Buffer.from('{ "id":"e1",\n  "amount": 1.50 }'); return (await V(l)).verifyWebhook(body, H(`t=${T},v1=${sig(body)}`), D()).id; }, expect: 'e1' },
  { name: 'AC1 [boundary] body bytes that are not plain text are verified as bytes', run: async (l) => { const body = Buffer.concat([Buffer.from('{"id":"e1","n":"'), Buffer.from([0xc3, 0xa9]), Buffer.from('"}')]); return (await V(l)).verifyWebhook(body, H(`t=${T},v1=${sig(body)}`), D()).n; }, expect: 'é' },
  { name: 'AC1 [functional] other keys are ignored, in any order', run: async (l) => (await V(l)).verifyWebhook(B(), H(`v0=abc, v1=${sig(B())},  t=${T},x=y`), D()).id, expect: 'e1' },
  { name: 'AC1 [functional] during a rotation any v1 and any secret will do', run: async (l) => { const m = await V(l); const a = m.verifyWebhook(B(), H(`t=${T},v1=${'0'.repeat(64)},v1=${sig(B())}`), D()).id; const b = m.verifyWebhook(B(), H(`t=${T},v1=${sig(B(), T, 'k2')}`), D({ secrets: ['old', 'k2'] })).id; return [a, b]; }, expect: ['e1', 'e1'] },
  { name: 'AC2 [safety] a wrong secret is refused', run: bad((b) => `t=${T},v1=${sig(b, T, 'other')}`), expect: no },
  { name: 'AC2 [safety] a changed body is refused', run: async (l) => { const m = await V(l); return code(() => m.verifyWebhook(B({ id: 'e1', type: 'paid', x: 1 }), H(`t=${T},v1=${sig(B())}`), D())); }, expect: 'bad_signature' },
  { name: 'AC2 [safety] a changed time is refused', run: bad((b) => `t=${T + 1},v1=${sig(b)}`), expect: no },
  { name: 'AC1 [boundary] exactly five minutes away is accepted, either way', run: async (l) => { const m = await V(l); return [T - 300, T + 300].map((t) => code(() => m.verifyWebhook(B(), H(`t=${t},v1=${sig(B(), t)}`), D()))); }, expect: [null, null] },
  { name: 'AC1 [safety] an old delivery is refused', run: bad((b) => `t=${T - 301},v1=${sig(b, T - 301)}`), expect: no },
  { name: 'AC1 [safety] a delivery from the future is refused', run: bad((b) => `t=${T + 301},v1=${sig(b, T + 301)}`), expect: no },
  { name: 'AC2 [safety] [unprompted] a signature of the wrong length is refused, not a crash', run: bad(() => `t=${T},v1=abc`), expect: no },
  { name: 'AC2 [safety] [unprompted] a signature that is not hex is refused, not a crash', run: bad(() => `t=${T},v1=${'z'.repeat(64)}`), expect: no },
  { name: 'AC2 [safety] [unprompted] a missing header is refused, not a crash', run: async (l) => { const m = await V(l); return code(() => m.verifyWebhook(B(), {}, D())); }, expect: 'bad_signature' },
  { name: 'AC2 [safety] [unprompted] a time that is not a number is refused', run: bad((b) => `t=soon,v1=${sig(b, 'soon')}`), expect: no },
  { name: 'AC2 [safety] [unprompted] signed JSON that is broken is refused, not a crash', run: async (l) => { const body = Buffer.from('not json'); const m = await V(l); return code(() => m.verifyWebhook(body, H(`t=${T},v1=${sig(body)}`), D())); }, expect: 'bad_signature' },
  { name: 'AC2 [functional] the same event again is a replay', run: async (l) => { const m = await V(l); const d = D(); m.verifyWebhook(B(), H(`t=${T},v1=${sig(B())}`), d); return code(() => m.verifyWebhook(B(), H(`t=${T},v1=${sig(B())}`), d)); }, expect: 'replayed' },
  { name: 'AC2 [safety] [unprompted] a forged delivery does not burn an event id', run: async (l) => { const m = await V(l); const d = D(); code(() => m.verifyWebhook(B(), H(`t=${T},v1=${'0'.repeat(64)}`), d)); return code(() => m.verifyWebhook(B(), H(`t=${T},v1=${sig(B())}`), d)); }, expect: null },
  { name: 'AC2 [regression] the event type helper is unchanged', run: async (l) => (await V(l)).eventType({}), expect: 'unknown' },
];
