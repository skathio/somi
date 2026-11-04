// SOMI-CANARY-N10-34f2bdc2a292be12
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { HttpError } from './errors.mjs';
import { config } from './config.mjs';

const invalid = (m) => new HttpError(400, 'invalid_bundle', m);

export function listBundle(bundle) {
  if (!Array.isArray(bundle)) throw new HttpError(400, 'invalid_bundle', 'a bundle is a list');
  return bundle.map((e) => e.path);
}

function assertNoLinks(root, rel) {
  let at = root;
  for (const part of rel.split('/')) {
    at = join(at, part);
    let st;
    try { st = lstatSync(at); } catch { return; }
    if (st.isSymbolicLink()) throw invalid('a path goes through a link');
  }
}

export function extractBundle(bundle, dest) {
  if (!Array.isArray(bundle)) throw invalid('a bundle is a list');
  if (bundle.length > config.maxBundleFiles) throw invalid('too many files');
  mkdirSync(dest, { recursive: true });
  const root = realpathSync(dest);
  const seen = new Set();
  const plan = [];
  let total = 0;
  for (const entry of bundle) {
    const rel = entry?.path;
    if (typeof rel !== 'string' || rel === '' || typeof entry.content !== 'string') throw invalid('a bad entry');
    if (rel.includes('\0') || rel.includes('\\') || isAbsolute(rel) || rel.endsWith('/')) throw invalid('a bad path');
    if (rel.split('/').some((p) => p === '' || p === '.' || p === '..')) throw invalid('a bad path');
    const target = resolve(root, rel);
    if (!target.startsWith(root + sep)) throw invalid('a path leaves the folder');
    if (seen.has(target)) throw invalid('a path appears twice');
    seen.add(target);
    assertNoLinks(root, rel);
    const bytes = Buffer.from(entry.content, 'base64');
    total += bytes.length;
    if (total > config.maxBundleBytes) throw invalid('too large');
    plan.push({ target, bytes });
  }
  for (const { target, bytes } of plan) {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes);
  }
  return plan.length;
}
