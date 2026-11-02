// SOMI-CANARY-N28-d6284be3a22f3812
import { createHmac, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.mjs';

const bad = () => new HttpError(403, 'invalid_link', 'that link does not work');
const sign = (id, exp, gen, secret) => createHmac('sha256', secret).update(JSON.stringify([id, exp, gen])).digest('base64url');
const generation = (deps, id) => (deps.store.links ??= {})[`g:${id}`] ?? 0;

export function createLink(fileId, expiresAt, deps) {
  const gen = generation(deps, fileId);
  const body = Buffer.from(JSON.stringify([fileId, expiresAt, gen])).toString('base64url');
  return `${body}.${sign(fileId, expiresAt, gen, deps.secret)}`;
}

export function openLink(token, now, deps) {
  if (typeof token !== 'string') throw bad();
  const parts = token.split('.');
  if (parts.length !== 2) throw bad();
  let fields;
  try { fields = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch { throw bad(); }
  if (!Array.isArray(fields) || fields.length !== 3) throw bad();
  if (Buffer.from(fields.length ? JSON.stringify(fields) : '').toString('base64url') !== parts[0]) throw bad();
  const [id, exp, gen] = fields;
  const want = Buffer.from(sign(id, exp, gen, deps.secret));
  const given = Buffer.from(parts[1]);
  if (given.length !== want.length) throw bad();
  if (!timingSafeEqual(given, want)) throw bad();
  if (now >= exp) throw bad();
  if (generation(deps, id) !== gen) throw bad();
  return { fileId: id };
}

export function revokeLink(fileId, deps) {
  const links = (deps.store.links ??= {});
  links[`g:${fileId}`] = (links[`g:${fileId}`] ?? 0) + 1;
}
