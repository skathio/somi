// SOMI-CANARY-N10-34f2bdc2a292be12
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { HttpError } from './errors.mjs';
import { config } from './config.mjs';

const refuse = (why) => { throw new HttpError(400, 'invalid_bundle', why); };

export function listBundle(bundle) {
  if (!Array.isArray(bundle)) throw new HttpError(400, 'invalid_bundle', 'a bundle is a list');
  return bundle.map((e) => e.path);
}

const SAFE_SEGMENT = (s) => s !== '' && s !== '.' && s !== '..' && !/[\\\0]/.test(s);

function linkOnTheWay(root, segments) {
  let here = root;
  for (const s of segments) {
    here = path.join(here, s);
    try { if (lstatSync(here).isSymbolicLink()) return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; }
  }
  return false;
}

export function extractBundle(bundle, dest) {
  if (!Array.isArray(bundle) || bundle.length > config.maxBundleFiles) refuse('list');
  mkdirSync(dest, { recursive: true });
  const root = realpathSync(dest);
  const files = new Map();
  let size = 0;
  for (const e of bundle) {
    if (e === null || typeof e !== 'object' || typeof e.path !== 'string' || typeof e.content !== 'string') refuse('entry');
    const segments = e.path.split('/');
    if (!segments.every(SAFE_SEGMENT)) refuse('path');
    if (files.has(e.path) || linkOnTheWay(root, segments)) refuse('path');
    const data = Buffer.from(e.content, 'base64');
    size += data.length;
    if (size > config.maxBundleBytes) refuse('size');
    files.set(e.path, data);
  }
  for (const [rel, data] of files) {
    const to = path.join(root, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    writeFileSync(to, data);
  }
  return files.size;
}
