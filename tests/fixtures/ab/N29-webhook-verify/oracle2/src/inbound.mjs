// SOMI-CANARY-N29-76d22d6616b79c6c
import { createHmac } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.mjs';

export const eventType = (event) => String(event.type ?? 'unknown');

const unsigned = () => new HttpError(401, 'bad_signature', 'no');

function parseHeader(value) {
  const out = { t: [], v1: [] };
  if (typeof value !== 'string') return out;
  for (const piece of value.split(',')) {
    const [k, ...rest] = piece.trim().split('=');
    if (k === 't' || k === 'v1') out[k].push(rest.join('='));
  }
  return out;
}

const hexEq = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function verifyWebhook(rawBody, headers, { secrets, clock, seen }) {
  const { t, v1 } = parseHeader(headers['x-pay-signature']);
  if (t.length !== 1 || !/^[0-9]+$/.test(t[0]) || !v1.length) throw unsigned();
  const sent = Number(t[0]) * 1000;
  const now = clock();
  if (now - sent > 300000 || sent - now > 300000) throw unsigned();
  const expected = secrets.map((s) => { const h = createHmac('sha256', s); h.update(t[0] + '.'); h.update(rawBody); return h.digest('hex'); });
  if (!v1.some((sig) => expected.some((e) => hexEq(sig, e)))) throw unsigned();
  let event;
  try { event = JSON.parse(rawBody.toString()); } catch { throw unsigned(); }
  if (!event || typeof event !== 'object' || event.id == null) throw unsigned();
  if (seen.has(event.id)) throw new HttpError(409, 'replayed', 'seen');
  seen.set(event.id, now);
  return event;
}
