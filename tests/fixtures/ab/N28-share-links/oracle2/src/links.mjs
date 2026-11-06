// SOMI-CANARY-N28-d6284be3a22f3812
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.mjs';

const refuse = () => { throw new HttpError(403, 'invalid_link', 'no'); };
const mac = (text, secret) => createHmac('sha256', secret).update(text).digest();
const revokedBefore = (deps, id) => deps.store.links?.[id] ?? -1;

export function createLink(fileId, expiresAt, deps) {
  const payload = JSON.stringify({ f: fileId, e: expiresAt, n: (deps.store.links ??= {})['#' + fileId] ?? 0 });
  const encoded = Buffer.from(payload).toString('base64url');
  return encoded + '~' + mac(encoded, deps.secret).toString('base64url');
}

export function openLink(token, now, deps) {
  if (typeof token !== 'string' || !/^[\w-]+~[\w-]+$/.test(token)) refuse();
  const [encoded, tag] = token.split('~');
  const expected = mac(encoded, deps.secret);
  const actual = Buffer.from(tag, 'base64url');
  if (tag !== expected.toString('base64url') || actual.length !== expected.length || !timingSafeEqual(actual, expected)) refuse();
  const { f, e, n } = JSON.parse(Buffer.from(encoded, 'base64url').toString());
  const current = (deps.store.links ??= {})['#' + f] ?? 0;
  if (!(now < e) || n !== current) refuse();
  return { fileId: f };
}

export function revokeLink(fileId, deps) {
  const links = (deps.store.links ??= {});
  links['#' + fileId] = (links['#' + fileId] ?? 0) + 1;
}
