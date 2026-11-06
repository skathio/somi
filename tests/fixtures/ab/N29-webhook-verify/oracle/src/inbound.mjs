// SOMI-CANARY-N29-76d22d6616b79c6c
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.mjs';

const WINDOW = 300000;

export const eventType = (event) => String(event.type ?? 'unknown');

const bad = () => new HttpError(401, 'bad_signature', 'that delivery does not verify');

function matches(sig, secret, t, rawBody) {
  const want = createHmac('sha256', secret).update(Buffer.concat([Buffer.from(`${t}.`), rawBody])).digest();
  if (!/^[0-9a-f]{64}$/.test(sig)) return false;
  return timingSafeEqual(Buffer.from(sig, 'hex'), want);
}

export function verifyWebhook(rawBody, headers, deps) {
  const now = deps.clock();
  const pairs = String(headers['x-pay-signature'] ?? '').split(',').map((p) => { const at = p.indexOf('='); return at < 0 ? [p, ''] : [p.slice(0, at).trim(), p.slice(at + 1).trim()]; });
  const stamps = pairs.filter(([k]) => k === 't').map(([, v]) => v);
  const given = pairs.filter(([k]) => k === 'v1').map(([, v]) => v);
  if (stamps.length !== 1 || !/^\d+$/.test(stamps[0]) || given.length === 0) throw bad();
  const t = stamps[0];
  if (Math.abs(now - t * 1000) > WINDOW) throw bad();
  const ok = given.some((sig) => deps.secrets.some((secret) => matches(sig, secret, t, rawBody)));
  if (!ok) throw bad();
  let event;
  try { event = JSON.parse(rawBody.toString('utf8')); } catch { throw bad(); }
  if (event === null || typeof event !== 'object' || event.id === undefined) throw bad();
  for (const [id, at] of deps.seen) if (now - at > 2 * WINDOW) deps.seen.delete(id);
  if (deps.seen.has(event.id)) throw new HttpError(409, 'replayed', 'already accepted');
  deps.seen.set(event.id, now);
  return event;
}
