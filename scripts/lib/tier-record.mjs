// tier-record.mjs -- read side of the sizing record written by scripts/somi-tier.mjs, shared by
// that CLI (approve) and scripts/somi-loop.mjs (the brief-only entry check).
//
// A brief-only work item (.somi/plans/<slug>/ holding brief.md but no phases/) may start a code loop
// only when the record for the slug says: tier small, a real signals hash (the CLI computed it), an
// approval stamp, and a brief hash equal to the brief as it is now. Links are never followed.
// Limit, accepted: an agent that deliberately writes both files by hand defeats this; the protected
// path hook and .somi/audit.log are what make that visible.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_BYTES = 64 * 1024;
const HASH_RE = /^[0-9a-f]{64}$/;

// -> Buffer of a regular, non-link file of at most MAX_BYTES, or null when absent / not usable.
function readRegular(file) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size > MAX_BYTES) return null;
    return fs.readFileSync(fd);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

const noLinks = (root, parts) => {
  let dir = root;
  for (const part of parts) {
    dir = path.join(dir, part);
    try {
      if (!fs.lstatSync(dir).isDirectory()) return false;
    } catch {
      return false;
    }
  }
  return true;
};

export const briefPath = (root, slug) => path.join(root, '.somi', 'plans', slug, 'brief.md');

export function briefSha256(root, slug) {
  const bytes = readRegular(briefPath(root, slug));
  return bytes ? crypto.createHash('sha256').update(bytes).digest('hex') : null;
}

// -> the parsed record, or null.
export function readRecord(root, slug) {
  if (!SLUG_RE.test(slug) || !noLinks(root, ['.somi', 'somi-state', 'tier'])) return null;
  const bytes = readRegular(path.join(root, '.somi', 'somi-state', 'tier', `${slug}.json`));
  if (!bytes) return null;
  try {
    const rec = JSON.parse(bytes.toString('utf8'));
    return rec !== null && typeof rec === 'object' && !Array.isArray(rec) ? rec : null;
  } catch {
    return null;
  }
}

// -> { ok: true } or { ok: false, reason } for a brief-only work item.
export function verifyBriefOnly(root, slug) {
  const rec = readRecord(root, slug);
  if (!rec) return { ok: false, reason: 'no readable tier record from scripts/somi-tier.mjs' };
  if (rec.slug !== slug) return { ok: false, reason: 'the tier record names another slug' };
  if (rec.tier !== 'small') return { ok: false, reason: 'the tier record is not small' };
  if (typeof rec.signals_sha256 !== 'string' || !HASH_RE.test(rec.signals_sha256)) {
    return { ok: false, reason: 'the tier record has no signals hash' };
  }
  if (typeof rec.approved_at !== 'string' || rec.approved_at === '') {
    return { ok: false, reason: 'the tier record carries no approval (run somi-tier.mjs approve after the human replies)' };
  }
  const now = briefSha256(root, slug);
  if (now === null || rec.brief_sha256 !== now) {
    return { ok: false, reason: 'brief.md is missing or changed since it was approved' };
  }
  return { ok: true };
}
